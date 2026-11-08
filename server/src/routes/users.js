/* VIBECHAT user routes: directory/discovery, profiles (view/update incl. avatar & cover), QR contact sharing, contacts & requests, blocks, reports. */
import { Router } from 'express';
import { q, uid, now } from '../db.js';
import { requireAuth, sessionByCookie } from '../auth.js';
import { V, ValidationError } from '../security.js';
import * as chat from '../services/chat.js';

const router = Router();
router.use(requireAuth);

/* directory / discovery */
router.get('/', requireAuth, (req, res) => {
  const raw = req.query.q ? String(req.query.q).slice(0, 80).trim() : '';
  if (raw) return res.json({ users: chat.searchUsers(raw, req.user.id) });
  const rows = q.all(`SELECT * FROM users WHERE deletedAt IS NULL AND id IN (SELECT CASE WHEN a=? THEN b ELSE a END FROM contacts WHERE a=? OR b=?) ORDER BY username LIMIT 50`, req.user.id, req.user.id, req.user.id);
  res.json({ users: rows.map((u) => chat.publicUserById(u.id, req.user.id)).filter(Boolean) });
});

router.get('/lookup', requireAuth, (req, res) => {
  const ident = String(req.query.q || req.query.username || '').trim().toLowerCase();
  const u = ident.startsWith('@') ? q.get(`SELECT * FROM users WHERE username=? AND deletedAt IS NULL`, ident.slice(1))
    : q.get(`SELECT * FROM users WHERE deletedAt IS NULL AND (username=? OR email=?)`, ident, ident);
  if (!u) return res.status(404).json({ error: 'No user found for that username' });
  res.json({ user: chat.publicUserById(u.id, req.user.id) });
});


/* profile sharing (QR payload lives client-side; this resolves it) */
router.get('/qr/resolve', requireAuth, (req, res) => {
  const token = String(req.query.t || '').replace(/[^a-zA-Z0-9-]/g, '');
  const u = q.get(`SELECT * FROM users WHERE id=? AND deletedAt IS NULL`, token);
  if (!u) return res.status(404).json({ error: 'Invalid profile code' });
  res.json({ user: chat.publicUserById(u.id, req.user.id) });
});

/* privacy matrix — read current effective values */
router.get('/me/privacy', requireAuth, (req, res) => {
  res.json({ privacy: {
    privDM: req.user.privDM || 'everyone',
    privLastSeen: req.user.privLastSeen || 'everyone',
    privOnline: req.user.privOnline || 'everyone',
    privProfile: req.user.privProfile || 'everyone',
    privStory: req.user.privStory || 'everyone',
    readReceipts: !!req.user.readReceipts,
  } });
});

/* update profile (privacy controls included) */
router.patch('/me/privacy', requireAuth, (req, res) => {
  const allowed = ['privLastSeen', 'privOnline', 'privProfile', 'privStory', 'privDM'];
  const vals = Object.fromEntries(Object.entries(req.body || {}).filter(([k, v]) => allowed.includes(k) && ['everyone', 'contacts', 'nobody'].includes(String(v))));
  const keys = Object.keys(vals);
  const sql = keys.length
    ? `UPDATE users SET ${keys.map((k) => `${k}=?`).join(',')}, readReceipts=? WHERE id=?`
    : `UPDATE users SET readReceipts=? WHERE id=?`;
  const args = [...keys.map((k) => vals[k]), req.body.readReceipts === undefined ? req.user.readReceipts : (req.body.readReceipts ? 1 : 0), req.user.id];
  if (keys.length || req.body.readReceipts !== undefined) q.run(sql, ...args);
  res.json({ user: chat.userPub(q.get(`SELECT * FROM users WHERE id=?`, req.user.id), req.user.id) });
});

/* set profile image from uploaded fileId (avatar or cover) */
router.post('/me/image', requireAuth, (req, res) => {
  const fileId = String(req.body.fileId || '');
  const kind = req.body.kind === 'cover' ? 'coverFileId' : 'avatarFileId';
  const f = q.get(`SELECT * FROM files WHERE id=? AND ownerId=? AND deletedAt IS NULL`, fileId, req.user.id);
  if (!f) return res.status(400).json({ error: 'Upload the image first' });
  if (!['image'].includes(f.kind)) return res.status(400).json({ error: 'Profile images must be image files' });
  q.run(`UPDATE users SET ${kind}=? WHERE id=?`, fileId, req.user.id);
  res.json({ user: chat.userPub(q.get(`SELECT * FROM users WHERE id=?`, req.user.id), req.user.id) });
});

/* contacts: request → accept/decline → contact */
router.get('/contacts', requireAuth, (req, res) => {
  const me = req.user.id;
  const all = q.all(`SELECT CASE WHEN a=? THEN b ELSE a END uid FROM contacts WHERE a=? OR b=?`, me, me, me).map((c) => c.uid);
  const users = all.map((id) => chat.publicUserById(id, me)).filter(Boolean);
  const incoming = q.all(`SELECT r.*, u.username, u.displayName, u.avatarFileId FROM contactRequests r JOIN users u ON u.id=r.requester WHERE r.target=? AND r.status='pending'`, me);
  const outgoing = q.all(`SELECT r.*, u.username, u.displayName, u.avatarFileId FROM contactRequests r JOIN users u ON u.id=r.target WHERE r.requester=? AND r.status='pending'`, me);
  res.json({ contacts: users, incoming: incoming.map(incomingRow), outgoing: outgoing.map((o) => ({ id: o.id, user: chat.publicUserById(o.target, me), createdAt: o.createdAt })) });
});
const incomingRow = (r) => ({ id: r.id, user: { id: r.requester, username: r.username, displayName: r.displayName, avatar: r.avatarFileId ? `/api/files/${r.avatarFileId}` : null }, createdAt: r.createdAt });

router.post('/contacts/request', requireAuth, (req, res) => {
  const target = String(req.body.userId || '');
  if (target === req.user.id) throw new ValidationError('You are already your own contact (Saved Messages)');
  const tu = q.get(`SELECT * FROM users WHERE id=? AND deletedAt IS NULL`, target);
  if (!tu) return res.status(404).json({ error: 'User not found' });
  if (chat.isContact(target, req.user.id)) return res.json({ ok: true, state: 'contacts' });
  if (chat.isBlocked(target, req.user.id) || chat.blockedBy(target, req.user.id)) return res.status(403).json({ error: 'Cannot add this user' });
  const rider = q.get(`SELECT * FROM contactRequests WHERE requester=? AND target=?`, target, req.user.id);
  if (rider && rider.status === 'pending') { accept(target, req.user.id, req.user.id); return res.json({ ok: true, state: 'contacts' }); }
  q.run(`INSERT INTO contactRequests (id, requester, target, status, createdAt) VALUES (?,?,?,'pending',?) ON CONFLICT(requester, target) DO NOTHING`,
    uid(), req.user.id, target, now());
  chat.notify(target, 'contact', `${req.user.displayName} sent you a contact request`, 'Open Contacts to respond', { actorId: req.user.id });
  res.json({ ok: true, state: 'sent' });
});

function accept(requester, target, actor) {
  q.run(`UPDATE contactRequests SET status='accepted', respondedAt=? WHERE requester=? AND target=?`, now(), requester, target);
  q.run(`INSERT OR IGNORE INTO contacts (a, b, createdAt) VALUES (?,?,?), (?,?,?)`, requester, target, now(), target, requester, now());
  chat.notify(requester, 'contact', `${q.get(`SELECT displayName d FROM users WHERE id=?`, actor)?.d || 'Someone'} accepted your contact request`, 'You can now chat instantly', { actorId: actor });
}

router.post('/contacts/respond', requireAuth, (req, res) => {
  const reqId = String(req.body.requestId || '');
  const action = String(req.body.action || 'accept');
  const r0 = q.get(`SELECT * FROM contactRequests WHERE id=? AND status='pending'`, reqId);
  if (!r0) return res.status(404).json({ error: 'Request not found' });
  if (r0.target !== req.user.id && r0.requester !== req.user.id) return res.status(403).json({ error: 'Not your request' });
  if (action === 'accept') {
    if (r0.target !== req.user.id) throw new ValidationError('Only the recipient can accept');
    accept(r0.requester, r0.target, req.user.id);
  } else {
    q.run(`UPDATE contactRequests SET status='declined', respondedAt=? WHERE id=?`, now(), reqId);
  }
  res.json({ ok: true, state: action === 'accept' ? 'contacts' : 'declined' });
});

router.delete('/contacts/:userId', requireAuth, (req, res) => {
  q.run(`DELETE FROM contacts WHERE (a=? AND b=?) OR (a=? AND b=?)`, req.user.id, req.params.userId, req.params.userId, req.user.id);
  q.run(`UPDATE contactRequests SET status='declined', respondedAt=? WHERE (requester=? AND target=?) OR (requester=? AND target=?)`, now(), req.user.id, req.params.userId, req.params.userId, req.user.id);
  res.json({ ok: true });
});

/* ---- self-service: password, devices (other sessions), account deletion ---- */
const strongPw = (p) => typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /[0-9]/.test(p);

router.post('/me/password', requireAuth, async (req, res) => {
  const bcrypt = (await import('bcryptjs')).default;
  if (!strongPw(req.body.to)) throw new ValidationError('New password needs 8+ chars with a letter and a number');
  if (!(await bcrypt.compare(String(req.body.current || ''), req.user.passwordHash))) {
    return res.status(403).json({ error: 'Current password was incorrect' });
  }
  q.run(`UPDATE users SET passwordHash=? WHERE id=?`, await bcrypt.hash(String(req.body.to), 10), req.user.id);
  const cur = sessionByCookie(req);
  q.run(`DELETE FROM sessions WHERE userId=? AND tokenHash != ?`, req.user.id, cur.tokenHash); // revoke other sessions
  res.json({ ok: true });
});

router.get('/devices', requireAuth, (req, res) => {
  const cur = sessionByCookie(req);
  res.json({ devices: q.all(`SELECT id, device, lastSeen FROM sessions WHERE userId=? AND id != ? ORDER BY lastSeen DESC`, req.user.id, cur.id) });
});
router.delete('/devices/:id', requireAuth, (req, res) => {
  q.run(`DELETE FROM sessions WHERE userId=? AND id=?`, req.user.id, req.params.id);
  res.json({ ok: true });
});

router.post('/me/delete', requireAuth, async (req, res) => {
  const bcrypt = (await import('bcryptjs')).default;
  if (!(await bcrypt.compare(String(req.body.password || ''), req.user.passwordHash))) {
    return res.status(403).json({ error: 'Password was incorrect' });
  }
  q.run(`UPDATE users SET deletedAt=?, online=0 WHERE id=?`, now(), req.user.id);
  q.run(`UPDATE sessions SET expiresAt=0 WHERE userId=?`, req.user.id);
  const c = req.headers.cookie || '';
  const tk = c.split(';').map((p) => p.trim()).find((p) => p.startsWith('vc_session='))?.slice('vc_session='.length);
  if (tk) q.run(`DELETE FROM sessions WHERE tokenHash=?`, (await import('node:crypto')).createHmac('sha256', 'vc-session-ring').update(tk).digest('hex'));
  res.clearCookie('vc_session', { path: '/' });
  res.json({ ok: true, deleted: true });
});

/* blocks */
router.get('/blocked', requireAuth, (req, res) => {
  res.json({ blocked: q.all(`SELECT blocked id, createdAt FROM blocks WHERE blocker=?`, req.user.id).map((b) => ({ ...b, user: chat.publicUserById(b.id, req.user.id) })) });
});
router.post('/block', requireAuth, (req, res) => {
  const target = String(req.body.userId || '');
  if (target === req.user.id) throw new ValidationError('You cannot block yourself');
  if (!q.get(`SELECT 1 x FROM users WHERE id=?`, target)) return res.status(404).json({ error: 'User not found' });
  q.run(`INSERT OR IGNORE INTO blocks (blocker, blocked, createdAt) VALUES (?,?,?)`, req.user.id, target, now());
  emitBot(target, 'blocked-you', { by: req.user.id });
  res.json({ ok: true });
});
router.post('/unblock', requireAuth, (req, res) => {
  q.run(`DELETE FROM blocks WHERE blocker=? AND blocked=?`, req.user.id, String(req.body.userId || ''));
  res.json({ ok: true });
});
const emitBot = (id, ev, data) => { import('../realtime/socket.js').then(({ emit }) => emit(`user:${id}`, ev, data)); };

/* report */
router.post('/report', requireAuth, (req, res) => {
  const targetType = V.limit(String(req.body.targetType || 'user'), ['user', 'message', 'chat', 'story', 'snap', 'channel', 'community']);
  const targetId = String(req.body.targetId || '');
  const reason = V.str(String(req.body.reason || 'Not specified'), { max: 400, name: 'Reason' });
  const id = uid();
  q.run(`INSERT INTO reports (id, reporter, targetType, targetId, reason, createdAt) VALUES (?,?,?,?,?,?)`,
    id, req.user.id, targetType, targetId, reason, now());
  broadcast('reports:new', { id, targetType, reason });
  res.json({ ok: true, reportId: id });
});
const broadcast = (ev, data) => { import('../realtime/socket.js').then(({ emit }) => q.all(`SELECT id FROM users WHERE role='admin'`).forEach((a) => emit(`user:${a.id}`, ev, data))); };

/* profile view — declared LAST so static paths (contacts, lookup, …) never match :id */
router.get('/:id', requireAuth, (req, res) => {
  const pu = chat.publicUserById(req.params.id, req.user.id);
  if (!pu) return res.status(404).json({ error: 'User not found' });
  pu.contacted = chat.isContact(req.params.id, req.user.id);
  pu.requestState = (() => {
    const r0 = q.get(`SELECT * FROM contactRequests WHERE requester=? AND target=?`, req.user.id, req.params.id);
    const r1 = q.get(`SELECT * FROM contactRequests WHERE requester=? AND target=?`, req.params.id, req.user.id);
    if (r0 && r0.status === 'pending') return 'sent';
    if (r1 && r1.status === 'pending') return 'incoming';
    return r0?.status === 'accepted' || r1?.status === 'accepted' ? 'contacts' : 'none';
  })();
  const t = now();
  pu.stories = q.all(`SELECT id, type, bgColor, createdAt, fileId FROM stories WHERE userId=? AND expiresAt > ? ORDER BY createdAt DESC LIMIT 10`, req.params.id, t);
  res.json({ user: pu });
});

export default router;
