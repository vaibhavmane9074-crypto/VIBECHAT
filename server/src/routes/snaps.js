/*
 * VIBECHAT snaps & stories.
 * Snaps: photo/video sent to chosen recipients, single/replay views with sender-chosen duration,
 *        backend-enforced expiry (sweeper in services/storage.js deletes blobs and marks nothing recoverable).
 *        The API never promises impossibility: recipients may capture the screen; expiry is enforced server-side.
 * Stories: 24h posts to contacts/custom/public audiences with viewer lists and reactions.
 */
import { Router } from 'express';
import { q, uid, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { V, ValidationError } from '../security.js';
import * as chat from '../services/chat.js';
import * as storage from '../services/storage.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);
const CANON = (fn) => (req, res, next) => { const p = fn(req, res, next); if (p && typeof p.catch === 'function') p.catch(next); };

/* ---------------- snaps ---------------- */
router.post('/send', requireAuth, CANON(async (req, res) => {
  const me = req.user.id;
  const file = storage.get(String(req.body.fileId || ''));
  const fOwn = q.get(`SELECT ownerId, deletedAt FROM files WHERE id=?`, String(req.body.fileId || ''));
  if (!file || file.deletedAt || !fOwn || fOwn.ownerId !== me) throw new ValidationError('fileId of your own uploaded media is required');
  const recipients = [...new Set((Array.isArray(req.body.recipients) ? req.body.recipients : []).slice(0, 300))].filter((r) => r !== me);
  if (!recipients.length) throw new ValidationError('Select at least one recipient');
  for (const r of recipients) {
    if (!q.get(`SELECT 1 x FROM users WHERE id=? AND deletedAt IS NULL`, r)) throw new ValidationError('Unknown recipient');
    if (chat.isBlocked(me, r) || chat.blockedBy(me, r)) throw new ValidationError('Send to unavailable recipient (blocked)');
  }
  const duration = V.int(req.body.duration || config.snapViewSecondsMax > 10 ? Math.min(req.body.duration || 10, config.snapViewSecondsMax) : 10, { min: 1, max: config.snapViewSecondsMax });
  const caption = V.str(String(req.body.caption || ''), { max: 200, name: 'Caption' });
  const singleView = req.body.singleView !== false;
  const ttlHours = V.int(req.body.ttlHours || config.snapDefaultTtlHours, { min: 1, max: 72 });
  const id = uid();
  q.run(`INSERT INTO snaps (id, senderId, fileId, caption, duration, singleView, expiresAt, createdAt) VALUES (?,?,?,?,?,?,?,?)`,
    id, me, file.id, caption, duration, singleView ? 1 : 0, now() + ttlHours * 3600_000, now());
  q.run(`UPDATE files SET ttl=?, expiresAt=? WHERE id=?`, Math.max(file.ttl, ttlHours * 3600), now() + ttlHours * 3600_000, file.id);
  for (const r of recipients) q.run(`INSERT OR IGNORE INTO snapRecipients (snapId, userId, state) VALUES (?,?,'delivered')`, id, r);
  // drop pointer messages in DMs so snaps appear in chat history
  const out = { snapId: id, duration, singleView, caption, targets: recipients };
  for (const r of recipients) {
    const dm = await chat.ensureDM(me, r);
    const mid = uid();
    q.run(`INSERT INTO messages (id, chatId, senderId, type, body, meta, createdAt) VALUES (?,?,?,?,?,?,?)`,
      mid, dm.id, me, 'snap', '', JSON.stringify({ snapId: id, fileId: file.id, caption, duration, singleView, recipientsFor: r }), now());
    emitUser(r, 'snap:new', { snapId: id, chatId: dm.id, from: me, duration, singleView });
    chat.notify(r, 'snap', `${req.user.displayName} sent a snap`, caption || 'Tap to view the snap', { chatId: dm.id, snapId: id, actorId: me });
  }
  res.json({ ...out });
}));

router.get('/', requireAuth, (req, res) => {
  const me = req.user.id;
  const incoming = q.all(`SELECT s.*, rc.state myState, rc.openedAt myOpenedAt, u.username senderName, u.displayName senderDisplay, u.avatarFileId senderAvatar
    FROM snaps s JOIN snapRecipients rc ON rc.snapId=s.id AND rc.userId=?
    JOIN users u ON u.id=s.senderId WHERE s.expiresAt > ? ORDER BY s.createdAt DESC`, me, now());
  const sent = q.all(`SELECT s.*, (SELECT COUNT(*) FROM snapRecipients WHERE snapId=s.id) recipients, (SELECT COUNT(*) FROM snapRecipients WHERE snapId=s.id AND state IN ('opened','replayed')) openedCount
    FROM snaps s WHERE s.senderId=? AND s.expiresAt > ? ORDER BY s.createdAt DESC`, me, now());
  res.json({
    incoming: incoming.map((s) => ({ ...s, fileId: s.fileId, expired: s.expiresAt < now(), mine: false })),
    sent: sent.map((s) => ({ ...s, expired: s.expiresAt < now(), mine: true })),
  });
});

/* open a snap (records the view, starts backend-enforced countdown) */
router.post('/:id/open', requireAuth, CANON(async (req, res) => {
  const me = req.user.id;
  const sn = q.get(`SELECT * FROM snaps WHERE id=?`, req.params.id);
  if (!sn || sn.expiresAt < now()) return res.status(404).json({ error: 'Snap not found or expired' });
  const rec = q.get(`SELECT * FROM snapRecipients WHERE snapId=? AND userId=?`, sn.id, me);
  if (!rec) return res.status(403).json({ error: 'This snap was not sent to you' });
  if (sn.singleView && rec.state === 'opened') return res.status(410).json({ error: 'View already used up' });
  const viewDuration = V.int(req.body.viewSeconds || sn.duration, { min: 1, max: config.snapViewSecondsMax });
  /* atomic claim: two concurrent opens of a single-view snap cannot both succeed */
  const upd = sn.singleView
    ? q.run(`UPDATE snapRecipients SET state='opened', openedAt=? WHERE snapId=? AND userId=? AND state <> 'opened'`, now(), sn.id, me)
    : q.run(`UPDATE snapRecipients SET state='opened', openedAt=? WHERE snapId=? AND userId=?`, now(), sn.id, me);
  if (sn.singleView && !upd.changes) return res.status(410).json({ error: 'View already used up' });
  emitUser(sn.senderId, 'snap:opened', { snapId: sn.id, by: me, at: now() });
  const f = storage.get(sn.fileId);
  res.json({
    snap: {
      id: sn.id, caption: sn.caption, duration: viewDuration, singleView: !!sn.singleView,
      senderId: sn.senderId, expiresAt: sn.expiresAt, replayable: !sn.singleView,
      media: { id: f.id, mime: f.mime, kind: f.kind, url: `/api/snaps/media/${f.id}?snapId=${encodeURIComponent(sn.id)}`, expiresAt: Math.min(sn.expiresAt, now() + viewDuration * 1000) },
    },
  });
}));

/* replay (only if not singleView or sender allows) */
router.post('/:id/replay', requireAuth, (req, res) => {
  const sn = q.get(`SELECT * FROM snaps WHERE id=?`, req.params.id);
  if (!sn || sn.expiresAt < now()) return res.status(404).json({ error: 'Snap not found or expired' });
  const rec = q.get(`SELECT * FROM snapRecipients WHERE snapId=? AND userId=?`, sn.id, req.user.id);
  if (!rec) return res.status(403).json({ error: 'Not your snap' });
  if (sn.singleView) return res.status(403).json({ error: 'This snap is single-view only' });
  q.run(`UPDATE snapRecipients SET state='replayed' WHERE snapId=? AND userId=?`, sn.id, req.user.id);
  emitUser(sn.senderId, 'snap:replayed', { snapId: sn.id, by: req.user.id });
  res.json({ ok: true });
});

/* snap media stream — authorized: sender or intended recipient, unexpired only */
router.get('/media/:fileId', requireAuth, async (req, res) => {
  const f = storage.get(req.params.fileId);
  if (!f || f.deletedAt) return res.status(404).json({ error: 'Media not found' });
  /* the same file can be sent in several snaps: pick the one this URL was issued for */
  const snapId = String(req.query.snapId || '');
  const snap = q.get(`SELECT sn.* FROM snaps sn LEFT JOIN snapRecipients rc ON rc.snapId = sn.id AND rc.userId=? WHERE sn.fileId=? AND (sn.senderId=? OR rc.userId IS NOT NULL)${snapId ? ' AND sn.id=?' : ''} ORDER BY sn.createdAt DESC`,
    ...[req.user.id, req.params.fileId, req.user.id, ...(snapId ? [snapId] : [])]);
  if (!snap) return res.status(403).json({ error: 'No access to this media' });
  if (snap.expiresAt < now()) return res.status(410).json({ error: 'Snap expired' });
  const rec = snap.senderId === req.user.id ? null : q.get(`SELECT * FROM snapRecipients WHERE snapId=? AND userId=?`, snap.id, req.user.id);
  if (rec?.state === 'expired') return res.status(410).json({ error: 'Snap expired' });
  // single/replayed views: media is served only during the recipient's viewing window (duration + small grace)
  if (rec && now() > rec.openedAt + snap.duration * 1000 + 1000) {
    return res.status(410).json({ error: 'View window closed' });
  }
  const ok = await storage.streamTo(res, f, { download: false });
  if (!ok) res.status(404).json({ error: 'Content missing' });
});

/* my snap inbox/outbox deletion */
router.delete('/:id', requireAuth, (req, res) => {
  const sn = q.get(`SELECT * FROM snaps WHERE id=?`, req.params.id);
  if (!sn) return res.status(404).json({ error: 'Snap not found' });
  if (sn.senderId !== req.user.id) return res.status(403).json({ error: 'Only the sender can unsend' });
  storage.revoke(sn.fileId);
  q.run(`UPDATE snaps SET expiresAt=? WHERE id=?`, now(), sn.id);
  for (const r of q.all(`SELECT userId FROM snapRecipients WHERE snapId=?`, sn.id)) {
    emitUser(r.userId, 'snap:expired', { snapId: sn.id });
  }
  q.run(`UPDATE snapRecipients SET state='expired' WHERE snapId=?`, sn.id);
  res.json({ ok: true });
});

const emitUser = (id, ev, data) => { import('../realtime/socket.js').then(({ emit }) => emit(`user:${id}`, ev, data)); };

/* ---------------- stories ---------------- */
router.post('/stories', requireAuth, CANON(async (req, res) => {
  const me = req.user.id;
  const type = V.limit(String(req.body.type || 'text'), ['text', 'photo', 'video']);
  let fileId = null;
  if (type !== 'text') {
    const f = storage.get(String(req.body.fileId || ''));
    if (!f) throw new ValidationError('fileId required for photo/video stories');
    fileId = f.id;
  } else if (!String(req.body.body || '').trim()) throw new ValidationError('Text story needs content');
  const visibility = V.limit(String(req.body.visibility || 'contacts'), ['contacts', 'custom', 'public']);
  const audience = Array.isArray(req.body.audience) ? req.body.audience.map(String).slice(0, 500) : [];
  const ttlHours = V.int(req.body.ttlHours || config.storyTtlHours, { min: 1, max: config.storyTtlHours });
  const id = uid();
  q.run(`INSERT INTO stories (id, userId, type, body, bgColor, fileId, visibility, audience, expiresAt, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id, me, type, V.str(String(req.body.body || ''), { max: 300 }), V.str(String(req.body.bgColor || '#7c5cff'), { max: 24 }),
    fileId, visibility, JSON.stringify(audience), now() + ttlHours * 36e5, now());
  if (fileId) q.run(`UPDATE files SET expiresAt=? WHERE id=? AND expiresAt = 0`, now() + ttlHours * 36e5, fileId);
  emitUser(me, 'story:new', { storyId: id });
  res.json({ story: q.get(`SELECT * FROM stories WHERE id=?`, id) });
}));

router.get('/stories', requireAuth, (req, res) => {
  const me = req.user.id;
  const t = now();
  const contacts = [...new Set(q.all(`SELECT CASE WHEN a=? THEN b ELSE a END id FROM contacts WHERE a=? OR b=?`, me, me, me).map((c) => c.id))];
  const visible = q.all(`SELECT s.*, u.username, u.displayName, u.avatarFileId FROM stories s JOIN users u ON u.id=s.userId WHERE s.expiresAt > ? ORDER BY s.createdAt DESC`, t);
  const ok = visible.filter((sRow) => {
    if (sRow.userId === me) return true;
    if (sRow.visibility === 'public') return true;
    if (sRow.visibility === 'contacts') return contacts.includes(sRow.userId) || sRow.userId === me;
    const aud = chat.safeJson(sRow.audience);
    return Array.isArray(aud) && aud.includes(me);
  });
  const mine = ok.filter((sRow) => sRow.userId === me);
  const others = ok.filter((sRow) => sRow.userId !== me);
  const group = (arr) => {
    const byUser = new Map();
    for (const sRow of arr) {
      if (!byUser.has(sRow.userId)) byUser.set(sRow.userId, { user: chat.userPub(q.get(`SELECT * FROM users WHERE id=?`, sRow.userId), me), stories: [] });
      const seen = !!q.get(`SELECT 1 x FROM storyViews WHERE storyId=? AND userId=?`, sRow.id, me);
      const media = sRow.fileId ? { fileId: sRow.fileId, url: `/api/stories/media/${sRow.fileId}` } : null;
      byUser.get(sRow.userId).stories.push({ id: sRow.id, type: sRow.type, body: sRow.body, bgColor: sRow.bgColor, createdAt: sRow.createdAt, expiresAt: sRow.expiresAt, seen, media, viewersCount: sRow.userId === me ? q.get(`SELECT COUNT(*) c FROM storyViews WHERE storyId=?`, sRow.id).c : undefined });
    }
    return [...byUser.values()];
  };
  res.json({ mine: group(mine), others: group(others), contacts: contacts.length });
});

/* story media access: members of audience only, unexpired */
router.get('/stories/media/:fileId', requireAuth, async (req, res) => {
  const f = storage.get(req.params.fileId);
  if (!f || f.deletedAt) return res.status(404).json({ error: 'Not found' });
  const st = q.get(`SELECT * FROM stories WHERE fileId=? AND expiresAt > ?`, req.params.fileId, now());
  if (!st) return res.status(410).json({ error: 'Story expired' });
  if (!canViewStory(st, req.user.id)) return res.status(403).json({ error: 'No access' });
  if (st.userId !== req.user.id) {
    if (st.visibility === 'custom') {
      const aud = chat.safeJson(st.audience);
      if (!Array.isArray(aud) || !aud.includes(req.user.id)) return res.status(403).json({ error: 'No access' });
    } else if (st.visibility === 'contacts') {
      if (!q.get(`SELECT 1 x FROM contacts WHERE (a=? AND b=?) OR (a=? AND b=?)`, st.userId, req.user.id, req.user.id, st.userId)) return res.status(403).json({ error: 'No access' });
    }
  }
  const ok = await storage.streamTo(res, f, { download: false });
  if (!ok) res.status(404).json({ error: 'Content missing' });
});

/* one audience rule for every story action (matches the listing rules) */
function canViewStory(st, me) {
  if (st.userId === me || st.visibility === 'public') return true;
  if (st.visibility === 'contacts') return !!q.get(`SELECT 1 x FROM contacts WHERE (a=? AND b=?) OR (a=? AND b=?)`, st.userId, me, me, st.userId);
  const aud = chat.safeJson(st.audience);
  return Array.isArray(aud) && aud.includes(me);
}

router.post('/stories/:id/view', requireAuth, (req, res) => {
  const st = q.get(`SELECT * FROM stories WHERE id=? AND expiresAt > ?`, req.params.id, now());
  if (!st) return res.status(404).json({ error: 'Story not found or expired' });
  if (!canViewStory(st, req.user.id)) return res.status(403).json({ error: 'You cannot view this story' });
  if (st.userId !== req.user.id) {
    q.run(`INSERT OR IGNORE INTO storyViews (storyId, userId, createdAt) VALUES (?,?,?)`, st.id, req.user.id, now());
    emitUser(st.userId, 'story:view', { storyId: st.id, viewerId: req.user.id, at: now() });
  }
  res.json({ ok: true });
});
router.post('/stories/:id/react', requireAuth, (req, res) => {
  const st = q.get(`SELECT * FROM stories WHERE id=? AND expiresAt > ?`, req.params.id, now());
  if (!st) return res.status(404).json({ error: 'Story not found or expired' });
  if (!canViewStory(st, req.user.id)) return res.status(403).json({ error: 'You cannot view this story' });
  if (st.userId === req.user.id) return res.status(400).json({ error: 'React to your own story via reactions from friends' });
  const emoji = V.emoji(String(req.body.emoji || '❤️'));
  q.run(`INSERT INTO storyReactions (storyId, userId, emoji, createdAt) VALUES (?,?,?,?) ON CONFLICT(storyId, userId) DO UPDATE SET emoji=excluded.emoji, createdAt=excluded.createdAt`,
    st.id, req.user.id, emoji, now());
  emitUser(st.userId, 'story:react', { storyId: st.id, by: req.user.id, emoji });
  const previewText = st.type === 'text' ? st.body : `[${st.type} story]`;
  chat.notify(st.userId, 'story', `${req.user.displayName} reacted ${emoji} to your story`, previewText.slice(0, 100), { storyId: st.id, actorId: req.user.id });
  res.json({ ok: true });
});
router.post('/stories/:id/reply', requireAuth, CANON(async (req, res) => {
  const st = q.get(`SELECT * FROM stories WHERE id=? AND expiresAt > ?`, req.params.id, now());
  if (!st) return res.status(404).json({ error: 'Story not found or expired' });
  if (!canViewStory(st, req.user.id)) return res.status(403).json({ error: 'You cannot view this story' });
  if (st.userId === req.user.id) return res.status(400).json({ error: 'Reply to another user\'s story' });
  const text = V.str(String(req.body.body || ''), { min: 1, max: 1000, name: 'Reply' });
  const dm = await chat.ensureDM(req.user.id, st.userId);
  const mid = uid();
  q.run(`INSERT INTO messages (id, chatId, senderId, type, body, meta, createdAt) VALUES (?,?,?,?,?,?,?)`,
    mid, dm.id, req.user.id, 'text', text, JSON.stringify({ storyReply: st.id, storyPreview: st.type === 'text' ? st.body : `[${st.type} story]` }), now());
  const message = chat.messageJson(q.get(`SELECT * FROM messages WHERE id=?`, mid), req.user.id);
  emitRoom(dm.id, 'message:new', { message });
  chat.notify(st.userId, 'message', `${req.user.displayName} replied to your story`, text.slice(0, 100), { chatId: dm.id, messageId: mid, actorId: req.user.id });
  res.json({ message });
}));

export { emitUser };
function emitRoom(id, ev, data) { import('../realtime/socket.js').then(({ emit }) => emit(`chat:${id}`, ev, data)); }

/* story viewer list (owner only) */
router.get('/stories/:id/viewers', requireAuth, (req, res) => {
  const st = q.get(`SELECT * FROM stories WHERE id=?`, req.params.id);
  if (!st) return res.status(404).json({ error: 'Story not found' });
  if (st.userId !== req.user.id) return res.status(403).json({ error: 'Viewers are visible only to the story owner' });
  const viewers = q.all(`SELECT sv.userId, sv.createdAt, u.username, u.displayName, u.avatarFileId FROM storyViews sv JOIN users u ON u.id=sv.userId WHERE sv.storyId=? ORDER BY sv.createdAt DESC`, st.id)
    .map((v) => ({ ...v, avatar: v.avatarFileId ? `/api/files/${v.avatarFileId}` : null, reactions: q.all(`SELECT emoji FROM storyReactions WHERE storyId=? AND userId=?`, st.id, v.userId).map((x) => x.emoji) }));
  res.json({ viewers });
});

export default router;
