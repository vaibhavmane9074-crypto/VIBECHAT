# VIBECHAT — Security rules & hardening reference

This document is the security contract shipped with this build, plus the real Firebase rules used
if you migrate (`docs/FIREBASE-MIGRATION.md`).

## 1. Client ⇄ API (always)

- ✅ Sessions in **httpOnly** cookies (`vc_session`), `SameSite=Strict`, `Secure` in production.
- ✅ CSRF: strict same-site cookies + JSON body + custom header checks on mutating routes;
  rate limits on auth (20/min), API (300/min), uploads (30/min), sends.
- ✅ Security headers on every response:
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`,
  `Permissions-Policy: camera=(self), microphone=(self), geolocation=(self), display-capture=(self)`.
- ✅ No secrets in the client bundle: AI/API keys live **only** in server env.
- ✅ Registration: username reserved-list, email format, password ≥ 8 chars incl. letter + number,
  bcrypt cost ≥ 10; login rate-limited; session tokens stored **hashed** (HMAC-SHA256).
- ✅ Errors never leak stack traces (5xx → generic "Something went wrong" + server log only).

## 2. Authorization invariants (server-enforced)

| Rule | Enforcement |
| --- | --- |
| Every API route authenticated | `requireAuth` middleware (sessions table, expiry check) |
| Admin-only endpoints | `requireAdmin` reads `users.role` from the DB — cannot be forged client-side |
| Chat access | `chat.canAccess` (membership + block + type rules); posting to channels limited to owner/admin |
| File access | owner OR member of a chat that shares the file |
| Snap access | sender/recipients AND unexpired AND first-open state machine + view window |
| Story access | visibility rules (contacts graph / explicit audience / public) |
| Bot/AI route | authenticated per-user history; no cross-user leakage |
| Reports | rate-limited, admin-only review |

## 3. File-safety rules (the important ones)

1. **Never execute uploads.** Files are stored under `server/data/uploads` with random IDs,
   never under the web root, never with any execute bit, and are **only** served through the
   authorized streaming endpoint.
2. **Content sniffing:** real type determined by **magic bytes** (JPEG/PNG/GIF/WEBP/WEBM/MP4/
   MP3-OGG/PDF/ZIP/PNG-script confusion checks); declared MIME/extension is advisory only.
3. **HTML/SVG/JS/unknown extensions are served as `text/plain`** with `nosniff`, and never
   rendered as active content — `<script>` uploads stay inert by design.
4. **Size caps** enforced before memory use; images are streamed with `Accept-Ranges` for seeking.
5. **SVG sanitized policy:** treated as text (XSS-safe) rather than as an image; if inline images
   become desirable, run a sanitizer (DOMPurify server-side) before ever emitting an image/svg+xml.
6. **Snap sanity:** snap blobs revoked at absolute expiry (sweeper), single-view window timed on
   the server; UI states explicitly screenshots remain outside app control.

## 4. Privacy matrix (settings the user controls)

| Setting (server field) | Options | Applies to |
| --- | --- | --- |
| `privDM` — Who can message me | everyone (default) / contacts / nobody | DM initiation — enforced in `POST /api/chats/dm` (403 + friendly error) |
| `privLastSeen` | everyone / contacts / nobody | presence projection |
| `privOnline` | everyone / contacts / nobody | online badge |
| `privProfile` | everyone / contacts / nobody | bio visibility |
| `privStory` | everyone / contacts / nobody | story visibility default |

plus: blocked users list (`GET /api/users/blocked`, reconfigurable in Settings → Privacy),
read receipts toggle, delete-for-everyone messages, disappearing chats, snap single-view,
account deletion (password-verified soft delete via `POST /api/users/me/delete`),
password change (`POST /api/users/me/password`, revokes other sessions),
and device/session management (`GET /api/users/devices`, `DELETE /api/users/devices/:id`).

## 5. Content reporting & admin

- Report users/messages/chats → `reports` queue → admin console dismiss/act with `adminLogs`.
- Admin can demote/promote, suspend (soft-delete) offenders; every action logged.

## 6. Deployment checklist

- [ ] Run behind TLS (Caddy/Nginx) → cookies become `Secure`.
- [ ] Set `VC_DB_PATH` outside the webroot; back up `data/` (DB + uploads).
- [ ] Configure SMTP (`SMTP_URL`) for real verification/reset e-mails.
- [ ] Provide a TURN server (`TURN_URL`) for call reliability.
- [ ] Optionally swap the local rate limiter for Redis when scaling to multiple nodes.
- [ ] Keep `node --check src` and `npm test` in CI; add your own smoke keys.

## 7. Threats intentionally NOT claimed as solved

- Receiver-side screenshots/screen recording of snaps or any chat content.
- Compromised devices or OS-level keylogging.
- Insider access to your hosting (single-admin assumption is a feature: `specials` is single-use).
- Metadata analysis by your server operator (VIBECHAT is not end-to-end encrypted; we say so
  plainly rather than promise E2EE we don't ship).
