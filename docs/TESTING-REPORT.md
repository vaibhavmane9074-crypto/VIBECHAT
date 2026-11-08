# VIBECHAT — Testing Report

**Date:** 2026-11-07 · **Environments:** Node 22.23.2 (linux/arm64), SQLite via node:sqlite,
Express 5.1, Socket.IO 4.8 · **Test DB:** fresh instance per run.

## 1. Backend functional suite — `server/scripts/smoke.mjs`

Two independent accounts (A & B) exercising the real REST API on a live server.
**Result: 41/41 PASS** (re-verified on the final build — 42 PASS lines / 0 FAIL in the log).

| # | Check | Verified behavior |
| --- | --- | --- |
| 1–2 | register A / B | valid account creation, session cookie issued |
| 3 | /auth/me | session resolves identity |
| 4–6 | contact request → visible → accept | requests flow; contacts graph established |
| 7 | open DM | deterministic direct chat (A↔B) |
| 8–13 | send text / history / edit / reaction / star / pin | core messaging works + persisted |
| 14 | poll vote | server-tallied option counts + per-user vote |
| 14b | AI assistant reply | Vibe AI responds via the configured provider (local fallback labelled) |
| 15 | upload unknown ext yet real image | magic-byte sniffing stamps JPEG despite `.weirdext` |
| 16–17 | send image message / authorized media access | hydration + streaming to members |
| 18 | stranger denied media | non-member 403 on another user's file |
| 19–20 | zip & python file classification | archive/code kinds detected by sniffing |
| 21 | HTML upload served **inert** | served as `text/plain` (never text/html) |
| 22–26 | snap send → inbox → open (media) → single-view exhausted (410) → media within view window | full snap lifecycle |
| 27 | snap media blocked after view window | 410 after duration+grace — expiry is server-enforced |
| 28–31 | story create → visible to contact → react → reply | replies land as DM messages |
| 32–33 | group create / group message | multi-member chat flow |
| 34 | forward | message forwarded to another chat with meta |
| 35 | admin denied for member | 403 for non-admin on /api/admin/* |
| 36 | notifications | notification row generated for an action |
| 37 | search | user/message search permission-filtered |
| 38 | delete for everyone | tombstone visible to both sides |
| 39–40 | block user / blocked user cannot DM | privacy invariant enforced at the API |

## 2. Realtime & call-signaling suite — `server/scripts/socket.mjs`

Real Socket.IO connections with each user's own session cookie.
**Result: 10/10 PASS.**

| Check | Verified behavior |
| --- | --- |
| both sockets connected | cookie handshake auth accepted for both users |
| B receives A message in realtime | `message:new` delivered to chat room members |
| typing indicator delivered | `typing` event relayed to the peer |
| chat join ok | room membership accepted |
| **anonymous socket rejected** | unauthenticated handshake denied (error → 'unauthorized') |
| call invitation reaches B | `call:incoming` with callId |
| call accepted relayed | `call:accepted` to initiator |
| SDP offer relayed to callee | `call:signal` passes offer untouched |
| ICE candidate relayed | `call:ice` passes candidates |
| end event reaches caller | `call:ended` cleanup event |

## 3. Frontend

- `npx vite build` → **production bundle compiles clean** (165 modules, ~101 KB gz JS).
- Design system renders from CSS variables (dark/light parity, 360px→4K responsive rules).
- Playwright-driven browser tests were attempted; the sandbox cannot download a browser binary,
  so UI-level walkthrough shipped as the **manual QA checklist** below instead of an honest claim
  of clickable verification.

## 4. Manual QA checklist (maps to the spec's 26-point plan)

Run: server on :4811 + built client; two browser profiles (or two machines), accounts A and B.

1. [ ] Register A → dev verification code appears in the server console; paste it to verify.
2. [ ] Register B → server console shows the code; verify.
3. [ ] A: Contacts → search @B → contact request.
4. [ ] B: Contacts → requests-in → accept → both see the contact.
5. [ ] A: open DM → send text/emoji/long text/link (auto-linkified).
6. [ ] B: receives it in realtime; receipt ticks; typing indicator shows while A types.
7. [ ] Attach files in Composer (pick a `.txt`, an image, and an unknown ex `.xyz`): preview chips
       → send → both sides see correct classification + download works from Media manager.
8. [ ] Upload an `.html` file → opens as plain text in the viewer (never, ever, executed).
9. [ ] Create a poll → both vote → percentages update live via socket.
10. [ ] Start tic-tac-toe → alternate moves → winner/board persists.
11. [ ] A: 📸 snap → capture → draw/text/sticker → single-view 10 s → send to B.
12. [ ] B: Inbox shows red dot → open → countdown; after it ends, cannot re-open (410) and the
        media route refuses afterwards (**server 410**, the client drawer is cosmetic).
13. [ ] A: re-send as replayable variant → B re-opens twice within validity (works) then expires.
14. [ ] Story: A posts text with "Contact-only" → B views + reacts → reaction appears in DM;
        story vanishes from rings after 24 h (or delete mine).
15. [ ] Voice note: record → send → play.
16. [ ] Account settings: change display name/status → visible to B via profile card.
17. [ ] Privacy: A sets whoCanDM=nobody → B cannot message (403) → revert.
18. [ ] Blocked-user invariant: A blocks B → B's DM send → 403; A reads "blocked" list.
19. [ ] Group: create with B; send; invite link generated; open the #/invite link in profile C
        (third browser) → joins successfully.
20. [ ] Channel: create → B cannot post (composer disabled by role rules) → A broadcasts; both read.
21. [ ] Community: create public → discoverable in list → second profile joins.
22. [ ] Calls: initiate A→B audio; B accepts (browser prompt) → RTCPeerConnection state connected;
        mute/camera toggles work; end → call rows in both call histories.
23. [ ] Vibe AI: with no keys set, engine shows "local" and offers pragmatic suggestions; set
        `OPENAI_API_KEY` and restart → responses now labelled openai, keys never visible in client.
24. [ ] Notifications: B's message to A (A on another screen) → bell shows unread; click → mark read.
25. [ ] Search: query picks up an older message, a group, a file.
26. [ ] Admin: log in as seeded admin → stats, promote B to admin, then demote; non-admin shows 403.

### Known gaps (honesty list)

- SMTP not wired in dev (codes print to server console) — `SMTP_URL` env hook documented.
- GIF board ships as vibe-stamps (no provider key) — Tenor/Giphy key hook documented.
- Voice calls verified at the signaling layer; two-browser media-path testing requires a
  graphical browser that this sandbox cannot launch (WebRTC media quality/candidate paths can
  only be confirmed interactively; checklist step 22 covers it).
- Snap screenshots remain technically possible for the receiver — enforced expiry + single
  view is only within the app (by design and stated in-product).

## 6. Second-pass audit round (2026-11-08) — aligning every Settings/Admin button

A dedicated audit paired each Settings/Admin UI action with the real endpoint and
**tested each one live** with fresh accounts (`qa-new.mjs`, `qa-admin.mjs` runs):

| # | Check | Result |
| --- | --- | --- |
| 1 | Register two fresh accounts | PASS |
| 2 | Profile update (name/bio/status/accent) via `POST /api/auth/me` | PASS (after fix — see below) |
| 3 | Privacy GET defaults readable (`/api/users/me/privacy`) | PASS |
| 4 | Privacy PATCH accepted (`privDM`, read receipts) | PASS (after fix) |
| 5 | `privDM=contacts` blocks non-contact DM with 403; contact request + accept then allows DM | PASS |
| 6 | Notification prefs saved via `PUT /api/settings` and round-tripped | PASS |
| 7 | Devices = other sessions listed; session revoke works | PASS |
| 8 | Password change (current verified, others' sessions revoked, old password rejected) | PASS |
| 9 | Admin login (env seed), role verified server-side | PASS |
| 10 | Admin stats shape (users/messages/chats/files groups) | PASS |
| 11 | Admin user search (parameter spread fixed) | PASS |
| 12 | Admin promote → demote → ban (sessions revoked, 401) → unban (re-login 200, still non-admin 403) | PASS |
| 13 | Admin reports list + dismiss | PASS |
| 14 | Admin action logs recorded | PASS |
| 15 | Non-admin still denied on admin routes | PASS |

**Result: 15/15 PASS** (final run), after fixing these previously-undetected bugs:

1. `PATCH /me/privacy` and `POST /api/auth/me` passed the whole bound-parameter array as a
   single SQLite bind value (`node:sqlite` rejects arrays) — both updates were broken and are
   now verified working; a debug wrapper in `db.js q.run` surfaces SQL + args on future errors.
2. Admin user search had the same single-array bind bug.
3. New: server-side `privDM` enforcement for who can open a DM with you (default `everyone`,
   settable to `contacts` / `nobody` in Privacy settings); enforced in `POST /api/chats/dm`.
4. Client Settings/Notifications/Admin pages were calling endpoints that don't exist
   (`/api/notifications/settings`, `/read-all`, `PATCH /admin/users/:id/role`,
   `DELETE /admin/users/:id`, `/admin/reports/:id/dismiss`) — all wired to the real ones;
   blocked-list rows now render from the server's `{ user: … }` shape.
5. New self-service endpoints: `PATCH /api/auth/me` (already existed) unchanged;
   `GET /api/users/devices` + `DELETE /api/users/devices/:id`,
   `POST /api/users/me/password`, `POST /api/users/me/delete` (password-verified soft delete).

## 5. Reproducing these tests

```bash
cd server
npm install
VC_DB_PATH=/tmp/test.db PORT=4811 node src/index.js &   # fresh DB
node scripts/smoke.mjs          # 41 checks
BASE=http://localhost:4811 node scripts/socket.mjs     # 10 checks
```
