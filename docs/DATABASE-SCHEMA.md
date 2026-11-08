# VIBECHAT — Database Schema (SQLite)

Single file: `server/data/vibechat.db` (WAL). Source of truth: `server/src/db.js`
(30 tables, created idempotently on boot).

## Identity & access

```sql
users               id PK, username UNIQUE COLLATE NOCASE, email UNIQUE, passwordHash,
                    displayName, bio, statusEmoji, statusText, accent, role ('user'|'admin'),
                    emailVerified, online, lastSeen, avatarFileId?, createdAt, deletedAt?
userSettings        userId PK → FK users, jurisdiction-free JSON columns:
                    privacy: privDM / privLastSeen / privOnline / privProfile / privStory
                    (everyone | contacts | nobody), readReceipts,
                    notification toggles, appearance
sessions            id PK, userId, tokenHash (HMAC-SHA256 — raw token never stored),
                    createdAt, expiresAt, device, ip
devices             id PK, userId, device, lastActive, revokedAt
verifications       id PK, userId, kind ('email'|'reset'), code, expiresAt, usedAt
specials            username — logging in as this username claims admin (password cleared after)
adminLogs           id, actorId, action, targetId, createdAt
blocks              blockerId, blockedId (PK pair), createdAt
```

## Contacts

```sql
contactRequests     id PK, requesterId, targetId, state ('pending'|'accepted'|'declined'|'cancelled'),
                    createdAt, respondedAt      (UNIQUE(requesterId,targetId))
contacts            a, b (unordered pair stored both ways for O(1) "contacts of X"), createdAt
```

## Chats & messages

```sql
chats               id PK, type ('dm'|'group'|'channel'|'community'|'notes'),
                    title, description, dmKey (deterministic 'uidA↔uidB' or 'self:uid'),
                    communityId?, avatarFileId?, inviteToken?, wallpaper?, disappearAfter s?,
                    createdAt, archivedAt?, lastMessageAt
chatMembers         chatId, userId, role ('owner'|'admin'|'member'),
                    joinedAt, muted, archived, lastReadAt     (PK pair)
messages            id PK, chatId, senderId, type ('text'|'image'|'video'|'audio'|'voice'|'file'|
                    'sticker'|'gif'|'poll'|'game'|'location'|'system'),
                    body, meta JSON (replyTo, snapId, forward, game board, poll snapshot, files),
                    fileId?, editedAt?, deletedAt?, pinnedAt?, disappearsAfter?,
                    scheduledFor?, createdAt       -- indexed on chatId+createdAt
reactions           messageId, userId, emoji     (PK triple)
stars               messageId, userId            (starred chats view)
messageViews        messageId, userId, readAt    (per-user receipts)
pollVotes           messageId, userId, optionIndex
chatMembers_filesMap (x TEXT)                    -- reserved scratch table (removed at boot)
```

## Files

```sql
files               id PK, ownerId, sha256 UNIQUE? -- dedupe key (first unique writer wins name),
                    name, ext, mime (sniffed), kind ('image'|'video'|'audio'|'code'|'document'|
                    'archive'|'other'), size, path (on disk), createdAt, revokedAt?
```

## Snaps (disappearing media) & stories

```sql
snaps               id PK, senderId, fileId, caption, duration s (1..60),
                    singleView bool, expiresAt (absolute TTL)          [swiped by sweeper]
snapRecipients      snapId, userId, state ('delivered'|'opened'|'replayed'|'expired'),
                    openedAt?, expiresAt(= min snap expiry, view window after open)
stories             id PK, userId, type ('text'|'photo'|'video'), body, bgColor?, fileId?,
                    mediaMime?, visibility ('contacts'|'custom'|'public'), audience JSON,
                    createdAt, expiresAt (created 24 h; server-stamped)
storyViews          storyId, userId, viewedAt          — viewer lists
storyReactions      storyId, userId, emoji              — include replyToChatId? (replies go to DM)
```

## Communities, calls, notifications, reports, AI

```sql
communities         id PK, name, description, ownerId, isPublic, avatarFileId?, createdAt
communityMembers    communityId, userId, role ('owner'|'admin'|'member')
calls               id PK, initiatorId, receiverId, type ('audio'|'video'),
                    status ('ringing'|'answered'|'declined'|'missed'|'ended'),
                    startedAt, answeredAt?, endedAt?, duration s?
notifications       id PK, userId, type ('message'|'friend'|'invite'|'snap'|'story'|'react'|'call'),
                    title, body, data JSON, chatId?, readAt?, createdAt     (indexed on userId)
reports             id PK, reporterId, targetType ('user'|'message'|'chat'), targetId, reason, createdAt
aiMessages          id PK, userId, role ('user'|'assistant'), content, provider, createdAt
```

## Indexes (created in db.js)

messages(chatId, createdAt) · chatMembers(chatId) · sessions(userId) · sessions(tokenHash) ·
notifications(userId, createdAt) · snapRecipients(snapId) · stories(userId) and similar.

## Notes for migration (Postgres/Firestore)

- SQLite `INTEGER` datetimes are **ms epoch numbers** (now() = Date.now()).
- DMs use a deterministic `dmKey` so reopening a DM is idempotent — replicate with a compound
  unique index in Firestore: `dmKey + ['dm']` lookup instead of a separate users doc.
- `meta` JSON columns translate to Firestore maps directly.
- `files.sha256` dedupe maps to a content-addressed Cloud Storage layout.
