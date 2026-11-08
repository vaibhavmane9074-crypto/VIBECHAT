/*
 * VIBECHAT server entry.
 * Express 5 + Socket.IO on one port; serves the built React client from client/dist when present.
 * Security: JSON limit, cookie sessions (httpOnly), central error handler, per-IP rate limits, admin bootstrap from env.
 */
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { q, uid, now } from './db.js';
import { config } from './config.js';
import { registerUser } from './auth.js';
import { initSocket } from './realtime/socket.js';
import { startSweeper } from './services/storage.js';
import { ValidationError } from './security.js';

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  // hard security headers for the app shell
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), display-capture=(self)');
  next();
});

/* API routes */
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import chatRoutes from './routes/chats.js';
import messageRoutes from './routes/messages.js';
import fileRoutes from './routes/files.js';
import snapRoutes from './routes/snaps.js';
import aiRoutes from './routes/ai.js';
import searchRoutes from './routes/search.js';
import notificationRoutes from './routes/notifications.js';
import adminRoutes from './routes/admin.js';

app.get('/api/health', (req, res) => res.json({ ok: true, name: config.appName, tagline: config.tagline, time: now() }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/snaps', snapRoutes);
app.use('/api/stories', snapRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/search', searchRoutes);
app.use('/api', notificationRoutes);
app.use('/api/admin', adminRoutes);

/* 404 for unknown API paths */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* static client (built React app) */
const dist = config.clientDistDir;
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: process.env.NODE_ENV === 'production' ? '1h' : '0' }));
  app.get('/*splat', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.status(503).send('VIBECHAT client not built yet. Run: cd client && npm run build (or see README).'));
}

/* central error handler */
app.use((err, req, res, _next) => {
  const status = err?.status || err?.statusCode || 500;
  const msg = err instanceof ValidationError || status < 500 ? err.message : 'Something went wrong';
  if (status >= 500) console.error('[error]', req.method, req.path, err);
  if (!res.headersSent) res.status(status).json({ error: msg });
});

/* ---- boot ---- */
async function bootstrap() {
  // admin bootstrap: identical email+password from env, or dev default printed once
  const known = q.get(`SELECT id FROM users WHERE email=?`, config.adminBootstrap.email);
  const adminPw = String(config.adminBootstrap.password || '');
  const weakAdminPw = adminPw.length < 12 || ['strongpass1', 'password', 'changeme', 'replace-with-a-long-random-passphrase'].includes(adminPw.toLowerCase());
  if (!known && adminPw && weakAdminPw) console.error('[vibechat] VC_ADMIN_PASSWORD is an example or too short (min 12 chars). Admin NOT created.');
  if (!known && adminPw && !weakAdminPw) {
    try {
      const a = await registerUser({
        email: config.adminBootstrap.email,
        username: config.adminBootstrap.username || `vibeadmin_${(config.adminBootstrap.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '') || 'user').slice(0, 12)}`,
        password: config.adminBootstrap.password,
        displayName: config.adminBootstrap.displayName,
      }, 'admin');
      console.log(`[vibechat] admin ready → ${a.username} (${config.adminBootstrap.email})`);
    } catch (e) { console.error('[vibechat] admin bootstrap failed:', e.message); }
  } else if (!known) {
    console.log('[vibechat] no admin seeded (set VC_ADMIN_EMAIL + VC_ADMIN_PASSWORD to create one; an existing "specials" claim is also supported)');
  }
  startSweeper();
  initSocket(server);
  server.listen(config.port, config.host, () => {
    console.log(`[vibechat] ${config.appName} — Beyond Messaging. listening on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
    console.log(`[vibechat] AI provider: ${config.aiProvider}`);
  });
}
bootstrap();

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
