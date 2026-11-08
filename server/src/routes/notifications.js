/* VIBECHAT notifications (in-app; push-ready — see services/push notes in docs) + settings + calls history. */
import { Router } from 'express';
import { q, uid, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { V } from '../security.js';
import * as chat from '../services/chat.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);

/* ---- notifications ---- */
router.get('/notifications', requireAuth, (req, res) => {
  const items = q.all(`SELECT * FROM notifications WHERE userId=? ORDER BY createdAt DESC LIMIT 100`, req.user.id);
  res.json({ notifications: items.map((n) => ({ ...n, data: chat.safeJson(n.data) })), unread: items.filter((n) => !n.readAt).length });
});
router.post('/notifications/read', requireAuth, (req, res) => {
  if (req.body.id) q.run(`UPDATE notifications SET readAt=? WHERE userId=? AND id=? AND readAt IS NULL`, now(), req.user.id, String(req.body.id));
  else q.run(`UPDATE notifications SET readAt=? WHERE userId=? AND readAt IS NULL`, now(), req.user.id);
  res.json({ ok: true });
});
router.post('/notifications/register-device', requireAuth, (req, res) => {
  const endpoint = String(req.body.endpoint || '').slice(0, 500);
  if (!endpoint.startsWith('https://')) return res.status(400).json({ error: 'endpoint must be an https push subscription URL' });
  q.run(`INSERT INTO devices (id, userId, platform, pushEndpoint, pushKeys, name, createdAt) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(pushEndpoint) DO UPDATE SET pushKeys=excluded.pushKeys, userId=excluded.userId`,
    uid(), req.user.id, String(req.body.platform || 'web').slice(0, 20), endpoint, JSON.stringify(req.body.keys || {}), String(req.body.name || '').slice(0, 60), now());
  res.json({ ok: true, notifyNow: false });
});

/* ---- settings (appearance / notification prefs / storage) ---- */
router.get('/settings', requireAuth, (req, res) => {
  res.json({ settings: q.get(`SELECT * FROM userSettings WHERE userId=?`, req.user.id), usage: storageUsage(req.user.id) });
});
const storageUsage = (uidv) => q.get(`SELECT COUNT(*) count, COALESCE(SUM(size),0) bytes FROM files WHERE ownerId=? AND deletedAt IS NULL`, uidv);
router.put('/settings', requireAuth, (req, res) => {
  const body = req.body || {};
  q.run(`INSERT INTO userSettings (userId, notifications, appearance, extra, updatedAt) VALUES (?,?,?,?,?)
         ON CONFLICT(userId) DO UPDATE SET notifications=excluded.notifications, appearance=excluded.appearance, extra=excluded.extra, updatedAt=excluded.updatedAt`,
    req.user.id, JSON.stringify(body.notifications || {}).slice(0, 4000), JSON.stringify(body.appearance || {}).slice(0, 4000), JSON.stringify(body.extra || {}).slice(0, 4000), now());
  res.json({ settings: q.get(`SELECT * FROM userSettings WHERE userId=?`, req.user.id) });
});

/* ---- calls history ---- */
router.get('/calls', requireAuth, (req, res) => {
  const rows = q.all(`SELECT * FROM calls WHERE initiator=? OR callee=? ORDER BY startedAt DESC LIMIT 100`, req.user.id, req.user.id);
  res.json({
    calls: rows.map((c) => {
      const peer = c.initiator === req.user.id ? c.callee : c.initiator;
      return { id: c.id, type: c.type, status: c.status, duration: c.duration, startedAt: c.startedAt, outgoing: c.initiator === req.user.id, peer: chat.publicUserById(peer, req.user.id) };
    }),
  });
});

/* ---- presence heartbeat (REST fallback) ---- */
router.post('/presence', requireAuth, (req, res) => {
  q.run(`UPDATE users SET online=1, lastSeen=? WHERE id=?`, now(), req.user.id);
  res.json({ ok: true });
});

router.get('/calls/ice-servers', requireAuth, (req, res) => {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (config.turn.url) servers.push({ urls: config.turn.url, username: config.turn.user, credential: config.turn.pass });
  res.json({ iceServers: servers });
});

export default router;
