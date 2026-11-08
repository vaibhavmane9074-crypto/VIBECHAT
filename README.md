# VIBECHAT — Beyond Messaging

A production-ready next-generation messaging platform: direct chats, groups, communities, broadcast
channels, disappearing snaps, 24-hour stories, universal file sharing, voice/video calls, Vibe AI
assistance, rich notifications, an admin console, and full settings — in one real-time web app.

> **VIBECHAT goes beyond messaging:** it combines the chat DNA of WhatsApp, the speed of Telegram,
> the self-vanishing media of Snapchat, and community/circle spaces (Discord-style), with an in-app
> AI copilot — while treating privacy and file-safety as **server-enforced** guarantees, not promises.

---

## What is actually implemented (backend-verified)

| Area | Status | Notes |
| --- | --- | --- |
| Registration / login / sessions | ✅ | bcrypt password hashing, httpOnly SameSite=strict cookie sessions, session table + device tracking |
| Contact requests | ✅ | request → accept/decline, incoming/outgoing lists, block integration |
| DMs (incl. "Saved Notes" self-chat) | ✅ | privacy-aware, blocked users cannot DM |
| Text / edit / delete-for-everyone | ✅ | edit marks messages as edited; delete is tombstoned for all members |
| Reactions / stars / pins / replies | ✅ | including starred-message list endpoint |
| Polls (live vote counts) | ✅ | server-tallied; per-user vote tracking |
| Tic-tac-toe in-chat game | ✅ | server-moderated moves, win/draw detection, rematch |
| Universal file sharing | ✅ | ANY extension accepted; validated by **magic bytes**, MIME + size limits, auth checks; HTML/SVG uploads are served inert (`text/plain`) and never rendered |
| Media manager | ✅ | own + received media, kind filters, storage usage, authorized downloads |
| Snap (disappearing media) | ✅ | camera capture/retake, 1–60 s timer, single-view or replayable; **open + view-window + absolute expiry all enforced server-side**; sweeper deletes blobs |
| Stories | ✅ | text/photo/video, 24 h TTL, visibility (contacts / custom audience / public), viewer lists, reactions → DM replies |
| Groups | ✅ | create w/ members, invite links (`#/invite/TOKEN` deep links), roles (owner/admin/member), leave |
| Communities | ✅ | public discovery + join, member-of-member chats |
| Channels | ✅ | admin-only broadcasting |
| Voice & video calls (WebRTC) | ✅ Signaling verified | 1:1 calls, STUN, missed-call handling; media flows peer-to-peer |
| Realtime (Socket.IO) | ✅ | cookie-authenticated sockets (anonymous sockets rejected), message push, typing, presence, read receipts |
| Vibe AI | ✅ | **keys stay on the server**; OpenAI → Gemini → deterministic local fallback, clearly labelled |
| Scheduled send | ✅ | deliver at a future time, scheduled dispatcher on server |
| Disappearing messages | ✅ | server-enforced TTL after read |
| Global search | ✅ | users, chats, messages, files with visibility rules |
| Notifications | ✅ | per-type personalization, read state, in-app toasts (no third-party key required) |
| Admin console | ✅ | stats, user management, role changes, reports queue; **role checked server-side on every call** |
| Dark/light themes, accents, wallpapers | ✅ | persisted locally, no user tracking |
| PWA shell | ✅ | manifest + installable, offline-friendly static serving |

See `docs/TESTING-REPORT.md` for the exact test evidence (two-account API suite + socket suite).

## Repository layout

```
vibechat/
├── server/               Node 22 + Express 5 + Socket.IO + node:sqlite
│   ├── src/              all backend code (routes, services, realtime, security)
│   ├── scripts/smoke.mjs two-account API test suite
│   ├── scripts/socket.mjs cross-account realtime + call-signaling test suite
│   ├── data/             SQLite DB (created at runtime) + uploads/
│   └── .env.example
├── client/               React 18 (Vite) — JavaScript, no build-time secrets
│   ├── src/              app, pages, components, styles (design system)
│   └── dist/             production build output (served by the server)
├── docs/                 architecture, DB schema, security rules, testing report
├── deploy/               deployment guide + Dockerfiles
└── package.json          top-level dev tooling
```

## Quick start (dev)

```bash
# 1. backend
cd server
npm install
npm run dev            # http://localhost:4811  (admin auto-created in dev; see .env.example)

# 2. frontend (another terminal; proxies /api + /socket.io to :4811)
cd client
npm install
npm run dev            # http://localhost:5173
```

But you can also skip step 2 for a "normal" experience — the server serves the built client:

```bash
cd client && npm run build        # produces dist/
cd ../server && npm start         # serves app at http://localhost:4811
```

## Admin

Seed via env (recommended for deployments):

```bash
VC_ADMIN_EMAIL=you@example.com VC_ADMIN_PASSWORD='replace-with-a-long-random-passphrase' npm start
```

or, for a personal instance, the **specials claim**: register normally, then insert your username:

```bash
sqlite3 data/vibechat.db "INSERT INTO specials (username) VALUES ('yourname');"
# logging in with that account promotes it to admin (single-use claim)
```

## Recommended test scenario (two people or two browser profiles)

1. Person A registers (verification code prints in the dev server console).
2. Person B registers, searches `@name` in Contacts, sends a contact request.
3. A accepts → both get a DM; send text, emoji, poll, tic-tac-toe, files (try a `.weirdext` and an `.html`).
4. A presses 📸 → snaps a photo → adds text/brush → sends single-view to B.
5. B opens the snap from Inbox — it disappears after the timer and cannot be re-opened.
6. Either posts a story → the other sees it in Stories → reacts → the reaction lands in the DM.
7. Start a call from a DM header; A + B connect (accept the browser's media prompts).
8. Group: create one, generate an invite link, open it in a second profile to auto-join.
9. Try admin: log in as the seeded admin; visit Admin (stats, users, reports).

## honest limitations

- Email delivery (verification + password reset) prints codes to the server console in dev —
  wire an SMTP provider via `SMTP_URL` (see docs) to make it real.
- **Snaps:** receivers can always screenshot anything on their own device. The server enforces
  expiry and single-view *inside the app*, and the UI states this honestly — no claim of
  unscreenshotable media is made anywhere.
- Calls use public STUN by default; a TURN server (env `TURN_URL`) is recommended for restrictive
  networks. Extend `server/src/config.js` to pass the credential.
- The local AI engine (no API key) is a deterministic pragmatic fallback, clearly labelled "local";
  set `OPENAI_API_KEY` or `GEMINI_API_KEY` on the **server** for production quality.
