/* VIBECHAT admin dashboard API — every route re-verifies server-side role. All actions are logged. */
import { Router } from 'express';
import db, { q, uid, now } from '../db.js';
import { requireAuth, requireAdmin, getUser } from '../auth.js';
import { V, ValidationError } from '../security.js';
import * as chat from '../services/chat.js';
import * as storage from '../services/storage.js';
const router = Router();
router.use(requireAuth, requireAdmin);

/* stats */
router.get('/stats', (_req, res) => {
  const t = now();
  const one = (sql, ...args) => db.prepare(sql).get(...args).c;
  res.json({
    users: { total: one(`SELECT COUNT(*) c FROM users WHERE deletedAt IS NULL`), online: one(`SELECT COUNT(*) c FROM users WHERE online=1 AND deletedAt IS NULL`), deleted: one(`SELECT COUNT(*) c FROM users WHERE deletedAt IS NOT NULL`) },
    messages: { total: one(`SELECT COUNT(*) c FROM messages WHERE deletedAt IS NULL`), last24h: one(`SELECT COUNT(*) c FROM messages WHERE createdAt > ?`, t - 864e5) },
    chats: { dms: one(`SELECT COUNT(*) c FROM chats WHERE type='dm'`), groups: one(`SELECT COUNT(*) c FROM chats WHERE type='group'`), channels: one(`SELECT COUNT(*) c FROM chats WHERE type='channel'`), communities: one(`SELECT COUNT(*) c FROM communities`) },
    files: { count: one(`SELECT COUNT(*) c FROM files WHERE deletedAt IS NULL`), bytes: db.prepare(`SELECT COALESCE(SUM(size),0) b FROM files WHERE deletedAt IS NULL`).get().b, snapsLive: one(`SELECT COUNT(*) c FROM snaps WHERE expiresAt > ?`, t), storiesLive: one(`SELECT COUNT(*) c FROM stories WHERE expiresAt > ?`, t) },
    reports: { open: one(`SELECT COUNT(*) c FROM reports WHERE status='open'`), total: one(`SELECT COUNT(*) c FROM reports`) },
    calls: one(`SELECT COUNT(*) c FROM calls`),
    storageBytes: storage.usageAll(),
  });
});

/* user management */
router.get('/users', (req, res) => {
  const search = String(req.query.q || '').slice(0, 100);
  const params = search ? [`%${search}%`, `%${search}%`] : [];
  const rows = q.all(`SELECT * FROM users ${search ? `WHERE (username LIKE ? OR email LIKE ?)` : ''} ORDER BY createdAt DESC LIMIT 100`, ...params);
  res.json({ users: rows.map((u) => ({ ...chat.userPub(u, u.id), email: u.email, deletedAt: u.deletedAt, createdAt: u.createdAt, online: !!u.online, role: u.role })) });
});
void getUser;
router.post('/users/:id/role', (req, res) => {
  const role = V.limit(String(req.body.role || 'user'), ['user', 'admin']);
  if (req.params.id === req.user.id && role === 'user') throw new ValidationError('Demote yourself via another admin to avoid lockout');
  q.run(`UPDATE users SET role=? WHERE id=?`, role, req.params.id);
  res.json({ ok: true });
});
router.post('/users/:id/ban', (req, res) => {
  q.run(`UPDATE users SET deletedAt=? WHERE id=?`, now(), req.params.id);
  q.run(`UPDATE sessions SET expiresAt=0 WHERE userId=?`, req.params.id);
  res.json({ ok: true });
});
router.post('/users/:id/unban', (req, res) => {
  q.run(`UPDATE users SET deletedAt=NULL WHERE id=?`, req.params.id);
  res.json({ ok: true });
});
router.post('/users/:id/force-logout', (req, res) => {
  q.run(`UPDATE sessions SET expiresAt=0 WHERE userId=?`, req.params.id);
  res.json({ ok: true });
});

/* reports */
router.get('/reports', (_req, res) => {
  res.json({ reports: q.all(`SELECT * FROM reports ORDER BY createdAt DESC LIMIT 200`).map((r) => ({ ...r, reporterUser: chat.publicUserById(r.reporter, r.reporter) })) });
});
router.post('/reports/:id', (req, res) => {
  const status = V.limit(String(req.body.status || 'resolved'), ['resolved', 'dismissed']);
  q.run(`UPDATE reports SET status=?, resolvedAt=?, resolvedBy=? WHERE id=?`, status, now(), req.user.id, req.params.id);
  res.json({ ok: true });
});

/* moderation: hide content */
router.post('/moderate/message', (req, res) => {
  q.run(`UPDATE messages SET deletedAt=? WHERE id=?`, now(), String(req.body.messageId || ''));
  res.json({ ok: true });
});
router.get('/logs', (_req, res) => {
  res.json({ logs: q.all(`SELECT l.*, u.username adminUsername FROM adminLogs l LEFT JOIN users u ON u.id=l.adminId ORDER BY l.createdAt DESC LIMIT 100`) });
});

export default router;
