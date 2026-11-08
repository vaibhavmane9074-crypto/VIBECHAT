# Deploying VIBECHAT

Three supported targets. In every case: build the client, ship the static files with the API.

## A. Single server (systemd or similar) — simplest

```bash
git clone <your-repo> vibechat && cd vibechat
cd client && npm ci && npm run build && cd ../server && npm ci
cp env/.env.example server/.env && nano server/.env    # set secrets, admin email/password
node server/src/index.js                               # serves API + built client on :4811
```

### systemd unit (example)

```ini
[Unit]
Description=VIBECHAT
After=network-online.target

[Service]
WorkingDirectory=/opt/vibechat/server
Environment=NODE_ENV=production
Environment=PORT=4811
Environment=VC_DB_PATH=/var/lib/vibechat/vibechat.db
Environment=VC_UPLOADS_DIR=/var/lib/vibechat/uploads
Environment=VC_ADMIN_EMAIL=you@example.com
Environment=VC_ADMIN_PASSWORD=change-me
Environment=VC_SESSION_SECRET=long-random-string
ExecStart=/usr/bin/node src/index.js
Restart=always
User=vibechat

[Install]
WantedBy=multi-user.target
```

### TLS in front (recommended)

Caddy (2 lines, automatic HTTPS):

```
chat.example.com {
    reverse_proxy 127.0.0.1:4811
}
```

Nginx equivalent: proxy `/` + `Upgrade`/`Connection` headers (Socket.IO needs WebSocket upgrade).

## B. Docker / docker-compose

See `deploy/Dockerfile.*` and `deploy/docker-compose.yml` in this directory.

```bash
docker compose up -d --build
# app on :4811; mount ./data for persistent DB + uploads
```

## C. Cloud Run / Kubernetes (multi-region)

- Build a container per `Dockerfile.server` + `Dockerfile.client` (static bundle served from the API image).
- SQLite works for one instance; for >1 instance move to Postgres/Cloud SQL and the Redis socket adapter, or follow `docs/FIREBASE-MIGRATION.md`.
- Set session affinity (sticky) on your LB for Socket.IO polling mode.

## Post-deploy checklist

1. `VC_ADMIN_EMAIL` + `VC_ADMIN_PASSWORD` seeded; log in, land on Admin, immediately change the password in Settings.
2. HTTPS live (cookies then auto-`Secure`).
3. Uploads volume backed up (`data/uploads` + DB).
4. TURN configured for calls across strict NATs.
5. Run one round of `docs/TESTING-REPORT.md §4` checklist with two accounts.
