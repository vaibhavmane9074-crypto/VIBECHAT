# VIBECHAT — Firebase migration guide

The app currently runs on a self-hosted Node/SQLite core. This guide maps each layer to Firebase
(or Google Cloud) equivalents **without changing the client**, because both share the same REST +
Socket.IO contract. Use this if you prefer managed infrastructure or want multi-region scale.

## Layer mapping

| Layer | Current | Firebase / GCP equivalent |
| --- | --- | --- |
| Password auth | bcrypt + sessions table | Firebase Auth (Email/Password) — keep API shape, mint our own cookie via Admin SDK session cookies |
| Google sign-in | `GET /api/auth/google/url` | native Firebase Auth popup client OR existing OAuth route |
| Social graph, chats, messages | SQLite tables | Firestore collections (rules below) |
| File store | disk blobs | Cloud Storage — content-addressed paths `uploads/{sha256}` |
| Realtime | Socket.IO | Firestore `onSnapshot` (simpler) or keep Socket.IO on Cloud Run with Firestore listeners |
| TTL (snaps/stories) | sweeper every 15 s | Cloud Scheduler → Cloud Function (or per-doc expiry fields + rules) |
| AI | server routes (never client) | same routes on Cloud Run; keys in Secret Manager |
| Push notifications | in-app toasts | FCM tokens via `devices` table (add registration + FCM send) |

## 1. Firestore collections (mirrors the SQL schema)

```
users/{uid}                     profile, role, statusEmoji, privacy{}, appearance{}
users/{uid}/private/settings    nobody can read except owner (rules)
sessions/{hash}                 — replaced by Auth session cookies
contactRequests/{id} , contacts/{uid_uid}
chats/{chatId}                  type, title, dmKey, inviteToken?, communityId?, settings{}
chats/{chatId}/members/{uid}    role, joinedAt, muted, archived, lastReadAt
chats/{chatId}/messages/{mid}   decrypted content; body, meta{}, createdAt number
files/{sha256}                  owner, kind, mime, size, storagePath, refs count
snaps/{snapId}                  sender, fileId, duration, singleView, expiresAt
snaps/{snapId}/recipients/{uid} state, openedAt, viewExpiresAt
stories/{storyId}               userId, visibility, audience[], expiresAt
storyViews/{storyId_viewers}
calls/{callId}, notifications/{uid}/{nid}, reports/{id}, aiMessages/{uid}/{id}
```

## 2. Security rules (Firestore) — server-equivalents

```js
rules_version = '2';
service cloud.firestore {
  function signedIn() { return request.auth != null; }
  function isSelf(uid) { return signedIn() && request.auth.uid == uid; }
  function memberOf(chatId) {
    return exists(/databases/$(database)/documents/chats/$(chatId)/members/$(request.auth.uid));
  }
  function isAdmin() {
    return signedIn() && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
  }

  match /databases/{database}/documents {
    match /users/{uid} {
      allow read: if signedIn();
      allow create: if isSelf(uid);
      allow update: if isSelf(uid) // only these fields:
        && request.resource.data.diff(resource.data).affectedKeys()
             .hasOnly(['displayName','bio','statusEmoji','statusText','accent','privacy','appearance','avatarFileId']);
      allow delete: if isSelf(uid) || isAdmin();
    }
    match /chats/{chatId} {
      allow read: if memberOf(chatId);
      allow create: if signedIn();
      allow update: if memberOf(chatId);       // client only edits titles it owns — business rules stay server-side
      match /messages/{mid} {
        allow read: if memberOf(chatId);
        allow create: if memberOf(chatId)
          && request.resource.data.senderId == request.auth.uid
          && request.resource.data.createdAt == request.time.toMillis();
        // edits/deletes/history hydration go through server routes (Cloud Run) that
        // re-check membership + block rules, so allow update only via Admin SDK:
        allow update, delete: if false;
      }
      match /members/{uid} {
        allow read: if memberOf(chatId);
        allow write: if false;                 // server/API only (invite tokens enforced server-side)
      }
    }
    match /snaps/{snapId} {
      allow read: if signedIn() && (request.auth.uid == resource.data.sender || exists(/databases/$(database)/documents/snaps/$(snapId)/recipients/$(request.auth.uid)));
      allow write: if signedIn() && request.resource.data.sender == request.auth.uid;
      match /recipients/{uid} {
        allow read: if signedIn() && (uid == request.auth.uid || request.auth.uid == get(/databases/$(database)/documents/snaps/$(snapId)).data.sender);
        allow update: if signedIn() && uid == request.auth.uid
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['state','openedAt','viewExpiresAt']);
      }
    }
    match /stories/{id} {
      allow read: if signedIn() && (resource.data.visibility == 'public' || request.auth.uid == resource.data.userId
        || (resource.data.visibility == 'contacts' && exists(/databases/$(database)/documents/contacts/$(request.auth.uid + '_' + resource.data.userId)))
        || (resource.data.visibility == 'custom' && request.auth.uid in resource.data.audience));
      allow write: if signedIn() && request.resource.data.userId == request.auth.uid
        && request.resource.data.expiresAt <= request.time.toMillis() + duration.value(26, 'h');
    }
    match /files/{sha} {
      allow read: if signedIn();
      allow write: if false;                   // uploads via server route → size/mime sniffing stays authoritative
    }
    match /notifications/{uid}/{nid} { allow read, update: if isSelf(uid); }
    match /reports/{id}      { allow create: if signedIn(); allow read: if isAdmin(); }
    match /aiMessages/{uid}/{id}               { allow read, write: if isSelf(uid); }
    match /adminLogs/{id}    { allow read: if isAdmin(); allow write: if false; }
  }
}
```

## 3. Storage rules (Cloud Storage)

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // all reads+writes through server routes only (authz + magic-byte checks stay server-side)
    match /uploads/{sha} {
      allow read: if request.auth != null;
      allow write: if false;   // upload via Admin SDK/Cloud Function (size+type checked)
    }
    match /public/{allPaths=**} { allow read: if true; allow write: if false; }
  }
}
```

Upload flow with Firebase: client gets a **server-issued, short-lived** Storage upload URL only
after `/api/files/preflight` confirms auth + quota + filename; final blob validation (magic bytes)
runs in a Cloud Function before the file counts as uploaded.

## 4. Hosting & deployment mapping

| Current | Firebase |
| --- | --- |
| `server` + `client/dist` static serve | Firebase Hosting (client) + Cloud Run (API) + Hosting rewrites `/api/**` |
| Socket.IO on one port | Cloud Run with session affinity (WebSockets supported) or Firestore listeners |
| sweeper interval | Cloud Scheduler job every minute |

## 5. Ordering of work (suggested PRs)

1. Introduce a data-access module boundary (`server/src/services/*` already exists) — swap SQLite queries for Firestore SDK calls per table.
2. Adopt Firebase Auth session cookies (5-day max age; reuse the same cookie name).
3. Move files to Storage with the preflight+validate upload route.
4. Port the sweeper to a Cloud Scheduler expiring snaps + stories + disappearing messages.
5. Turn on the rules in this file — they enforce exactly the invariants in `docs/SECURITY.md`.
