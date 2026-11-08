# VIBECHAT — Architecture

## 1. Stack & why

| Layer | Choice | Reason |
| --- | --- | --- |
| Runtime | Node.js ≥ 22.5 | native `node:sqlite` ESM, one language across the stack |
| HTTP | Express 5 | mature, per-route middleware, native `Range`-streaming friendly |
| Realtime | Socket.IO | rooms, acks, auth middleware, reconnection, fallback transports |
| Database | SQLite via `node:sqlite` | zero-config, single-file, WAL; the whole social graph is a handful of tokenized queries |
| Files | local disk (`server/data/uploads`) | content-addressed blobs (sha256 dedupe), authorized streaming, TTL sweeper |
| Client | React 18 + Vite (JavaScript) | fast dev, tiny deps, no build-env secrets needed |
| Styling | hand-rolled CSS design system (glassmorphism, CSS variables) | original identity, dark/light, no tracking fonts |

The original master spec assumed Firebase; this build ships with an equivalent **self-hosted core**
because no Firebase project exists. `docs/FIREBASE-MIGRATION.md` maps every service to Firestore /
Firebase Auth / Cloud Storage with ready rules, so the same API contracts survive a migration.

## 2. Backend (server/src)

```
index.js            app shell, static client serving, error handler, admin bootstrap
config.js           all env: port, DB path, limits, AI keys, admin seed, CORS/misc
db.js               schema (20+ tables), q.all/get/run helpers, uid(), now(), safeJson
auth.js             register (uniqueness, reserved names, strength), login, verify-email,
                    password reset, sessions create/read, requireAuth / requireAdmin middleware
security.js         token-bucket rate limiter, input validators (V.*), magic-byte classify(),
                    safe serve headers per kind
services/
  chat.js           privacy-aware user projection, access control (canAccess), DM/group/channel
                    creation & membership, message hydration (files/polls/games/reactions), notify*
  storage.js        save blob (sha256 dedupe), stream w/ Range + kind-based Content-Type,
                    revoke (hard delete), TTL sweeper every 15 s (snaps/stories/disappearing msgs)
realtime/socket.js  cookie-auth handshake (anonymous sockets rejected), presence graph,
                    chat rooms, typing, read receipts, 1:1 WebRTC signaling w/ missed-call timer
routes/
  auth.js   users.js   chats.js   messages.js   files.js   snaps.js
  ai.js     search.js  notifications.js   admin.js
```

### Auth & sessions
- Passwords: bcrypt (cost ≥ 10). Login accepts email **or** username.
- Session = random 128-bit token, httpOnly cookie (`vc_session`, SameSite=strict, secure in prod),
  DB row keeps only an HMAC-SHA256 **token hash** — a stolen DB cannot mint sessions.
- Sockets authenticate on handshake from the same cookie; anonymous sockets rejected.
- `specials` table: single-use username claim promotes a normal registration to admin at login.

### Authorization model (invariants)
1. Every `/api/*` route except register/login/reset/health requires a session → `requireAuth`.
2. Admin routes add `requireAdmin` — role is read from the DB row, **never** trusted from the client.
3. Chat access (`chat.canAccess`): member check + block rules + archive/mute flags; DMs verify both
   members; channels gate posting to owner/admin; communities gate joining.
4. File access: owner or membership of any chat that has shared the file (messages.meta lookups).
5. Snap access: sender-or-recipient AND unexpired AND (recipient: view window still open after FIRST open).
6. Story access: public → all; contacts → contact graph; custom → explicit audience list.

### Snap lifecycle (server-enforced)
```
POST /api/snaps/send {fileId, recipients, duration 1-60, singleView}
  → inserts snaps (expiresAt = now + ttlHours, default 4 h)
  → snapRecipients rows state='delivered'
POST /api/snaps/:id/open  → first open returns meta + media URL, sets rec.openedAt/state='opened'
  → second open → 410 Gone (single-view) within validity
GET  /api/snaps/media/:fileId
  → allowed ONLY to sender or the recipient currently inside view window (duration + grace)
  → after that: 410 View window closed
Sweeper (15 s): snap past expiresAt → revoke blob + mark "(snap expired)" + emit snap:expired
```
The honest rule is everywhere in UI text: **expiry + single-view are server-enforced, but a
receiver can still screenshot their own screen.**

### Universal file pipeline
```
POST /api/files (raw octet-stream, x-file-name header)
  ├── size ≤ limit (env), auth required, rate-limited
  ├── magic bytes sniffed → real {kind, mime}
  └── stored keyed by sha256 (dedupe), never executed (no +x, av/regex checks for extension abuse)
GET /api/files/:id?dl=1
  ├── owner-or-shared-in-chat check
  └── served with safe headers: images streamed with their sniffed type but sandboxed CSP;
      HTML/SVG/JS/unknown → Content-Type: text/plain + X-Content-Type-Options:nosniff, never inline-privileged
```

### Realtime protocol
Rooms: `chat:<chatId>`, `user:<userId>`.
Events (client ⇄ server): `chat:join/leave`, `typing`, `message:read`, `message:delivered`,
`presence` (server→), `message:new/update` (server→), `snap:new/opened/expired` (server→),
`call:*` (ring / incoming / answer / accepted / signal / ice / end / state; missed after 45 s).

### AI integration
`POST /api/ai/chat` + `/assist` take the user's text/history and call, in order:
`OPENAI_API_KEY` (chat-completions) → `GEMINI_API_KEY` (generateContent) → deterministic local
engine. The chosen provider is returned and labelled in the UI (`engine: openai|gemini|local`).
Keys never leave the server process; the client bundle contains no key.

## 3. Client (client/src)

```
main.jsx            boot
App.jsx             auth gate, shell, realtime wiring, global bridges (__vc*),
                    forward modal, deep links (#/invite, #/u), QR sheet, toasts
state/store.jsx     single context: session, chats cache, unread counts, theme/accent/
                    wallpaper, drafts, toasts, call + notify state
lib/api.js          fetch wrapper (cookie session, GET cache + invalidation), upload helper
lib/rt.js           socket.io-client singleton
components/
  Sidebar.jsx       nav rail + counts (mobile: collapses to icons)
  ChatList.jsx      search, chips, rows (unread/pin/typing/online), assistant
  ChatPanel.jsx     history (lazy pages), receipts, typing, day separators, wallpaper
  MessageItem.jsx   bubbles: text/media/poll/game/sticker/voice/snap/location + action menus
  Composer.jsx      emoji/stickers/GIF-lite, universal attach, voice recorder, poll creator,
                    camera snap, location (consent), AI assist, scheduled send
  FilesBar.jsx      attachment previews + Chat details sheet (members, invite link, timer, wallpaper)
  SnapStudioView    camera (front/rear, filters), draw/text/sticker editor, duration + single-view,
                    recipient picker, inbox/outbox, SnapPlayer (server-driven countdown)
  StoriesView       rings, viewer, reactions, DM replies, viewers list, creator (text/photo/video)
  GroupsView + CommunitiesView + ChannelsView   group/circle/channel management
  AIPanelView       assistant chat + tools (translate/summarize/suggest/polish)
  CallsView         quick dial + history
  MediaView         media manager grid + usage
  SearchView        global search (messages/chats/users/files, permission-filtered)
  SettingsView      profile, avatar, privacy matrix, notifications matrix, devices,
                    appearance (theme/accent), blocked list, danger zone
  AdminView         stats cards, users table (promote/suspend), reports queue
  CallOverlay       WebRTC peer connection + UI (mute/cam/screen share/end), incoming ring
styles/             design system tokens, themes, glass panels, responsive (360px → 4K)
```

### Design system
- Token palette: deep-space violet accent (#7c5cff) ↔ rose (#ff5ca8), glass panels with
  `backdrop-filter`, 16 px radii, soft shadows; dark is default, light parity.
- Motion: small eases only; `prefers-reduced-motion` respected.
- Mobile: nav collapses, center list hides while a chat is open, floating panels become sheets.

## 4. Data model (see docs/DATABASE-SCHEMA.md)

20+ tables: users, userSettings, sessions, blocks, contactRequests/contacts, chats, chatMembers,
messages, reactions, stars, messageViews, pollVotes, snapRecipients, snaps, stories(+views/reactions),
communities(+members), calls, notifications, reports, adminLogs, devices, aiMessages, specials.

## 5. Scale & limits
- sqlite WAL handles thousands of users comfortably on one box; swap `services/db` for Postgres
  when multicore write throughput is needed (queries are straightforward SQL).
- Uploads capped by env; rate limits per IP/user on auth (20/min), API (300/min), uploads (30/min).
- For a multi-node deployment: sticky sessions or the Postgres/Redis socket adapter.
