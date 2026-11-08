/* VIBECHAT message routes: paginated history, send (text/media/poll/game/sticker/voice), edit, delete, reactions, stars, pins, forward, scheduled send, drafts are client-side. */
import { Router } from 'express';
import { q, uid, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { V, ValidationError, rateLimit } from '../security.js';
import * as chat from '../services/chat.js';
import * as storage from '../services/storage.js';

const router = Router();
router.use(requireAuth);
const sendLimit = rateLimit({ bucket: 'send', limit: 120 });
export const CANON = (fn) => (req, res, next) => { const p = fn(req, res, next); if (p && typeof p.catch === 'function') p.catch(next); };

/* ---- history (paginated, newest-last) ---- */
router.get('/:chatId', requireAuth, (req, res) => {
  const g = chat.canAccess(req.params.chatId, req.user.id);
  if (!g.ok) return res.status(g.status).json({ error: g.error });
  const before = V.int(req.query.before || now() + 1, { min: 0, max: now() + 1 });
  const limit = Math.min(V.int(req.query.limit || 50, { min: 1 }), 100);
  const search = req.query.q ? String(req.query.q).slice(0, 200) : null;
  let rows;
  if (search) rows = q.all(`SELECT * FROM messages WHERE chatId=? AND deletedAt IS NULL AND body LIKE ? AND createdAt < ? ORDER BY createdAt DESC LIMIT ?`, req.params.chatId, `%${search.replace(/[%_]/g, '\\$&')}%`, before, limit + 1);
  else rows = q.all(`SELECT * FROM messages WHERE chatId=? AND deletedAt IS NULL AND createdAt < ? ORDER BY createdAt DESC LIMIT ?`, req.params.chatId, before, limit + 1);
  const hasMore = rows.length > limit;
  rows = rows.slice(0, limit).reverse();
  res.json({ messages: rows.map((m) => chat.messageJson(m, req.user.id)), hasMore, oldestAt: rows[0]?.createdAt ?? null });
});

/* ---- pinned messages ---- */
router.get('/:chatId/pins', requireAuth, (req, res) => {
  const g = chat.canAccess(req.params.chatId, req.user.id);
  if (!g.ok) return res.status(g.status).json({ error: g.error });
  res.json({ messages: q.all(`SELECT * FROM messages WHERE chatId=? AND pinned=1 AND deletedAt IS NULL ORDER BY createdAt DESC LIMIT 50`, req.params.chatId).map((m) => chat.messageJson(m, req.user.id)) });
});

/* ---- starred messages ---- */
router.get('/stars/list', requireAuth, (req, res) => {
  res.json({
    messages: q.all(`SELECT m.* FROM messages m JOIN stars s ON s.messageId=m.id WHERE s.userId=? AND m.deletedAt IS NULL ORDER BY s.createdAt DESC LIMIT 200`, req.user.id)
      .map((m) => chat.messageJson(m, req.user.id)),
  });
});

const SCHEDULED_TICK = () => {
  const due = q.all(`SELECT * FROM messages WHERE scheduledFor IS NOT NULL AND scheduledFor <= ? AND deletedAt IS NULL`, now());
  for (const m of due) {
    q.run(`UPDATE messages SET scheduledFor=NULL, createdAt=? WHERE id=?`, now(), m.id);
    const payload = { message: chat.messageJson(q.get(`SELECT * FROM messages WHERE id=?`, m.id), m.senderId) };
    emitRoom(m.chatId, 'message:new', payload);
    const chatRow = q.get(`SELECT * FROM chats WHERE id=?`, m.chatId);
    const others = q.all(`SELECT userId FROM chatMembers WHERE chatId=? AND userId != ?`, m.chatId, m.senderId);
    for (const o of others) chat.notify(o.userId, 'message', chatRow.type === 'dm' ? (q.get(`SELECT displayName d FROM users WHERE id=?`, m.senderId)?.d || 'Someone') + ' sent a scheduled message' : chatRow.title, chat.preview(m), { chatId: m.chatId, messageId: m.id, actorId: m.senderId });
  }
};
setInterval(SCHEDULED_TICK, 10_000).unref();
const emitRoom = (id, ev, data) => { import('../realtime/socket.js').then(({ emit }) => emit(`chat:${id}`, ev, data)); };

/* ---- send ---- */
router.post('/send', sendLimit, CANON(async (req, res) => {
  const me = req.user.id;
  const chatId = String(req.body.chatId || '');
  const g = chat.canAccess(chatId, me);
  if (!g.ok) return res.status(g.status).json({ error: g.error });
  const otherId = g.chat.type === 'dm' ? (q.get(`SELECT userId FROM chatMembers WHERE chatId=? AND userId != ?`, chatId, me)?.userId || null) : null;
  if (otherId && (chat.isBlocked(me, otherId) || chat.blockedBy(me, otherId))) return res.status(403).json({ error: 'User is blocked' });
  if (g.chat.type === 'channel' && !['owner', 'admin'].includes(g.member.role)) return res.status(403).json({ error: 'Only channel admins can post' });

  const type = V.limit(String(req.body.type || 'text'), ['text', 'image', 'video', 'audio', 'voice', 'file', 'sticker', 'gif', 'poll', 'game', 'location', 'contact', 'snap'], { fallback: 'text' });

  let body = '';
  let meta = {};
  if (['text', 'system', 'contact'].includes(type)) body = V.str(String(req.body.body || ''), { max: 8000, name: 'Message' }) || '';
  if (type === 'sticker' || type === 'gif') {
    body = V.str(String(req.body.body || 'emoji'), { max: 64, name: 'Sticker' });
  }
  if (['image', 'video', 'audio', 'voice', 'file'].includes(type)) {
    const fileId = String(req.body.fileId || '');
    const f = storage.get(fileId);
    const fOwn = q.get(`SELECT ownerId FROM files WHERE id=?`, fileId);
    if (!f || !fOwn || fOwn.ownerId !== me) throw new ValidationError('fileId of your own uploaded media is required');
    meta = { fileId, name: f.originalName, size: f.size, mime: f.mime, kind: f.kind, ext: f.ext, durationMs: V.int(req.body.durationMs || 0, { min: 0, max: 36e5 }), dimensions: req.body.dimensions && String(req.body.dimensions).slice(0, 20) };
  }
  if (type === 'poll') {
    const title = V.str(String(req.body.title || req.body.body || 'Poll'), { min: 1, max: 200, name: 'Poll title' });
    const opts = (Array.isArray(req.body.options) ? req.body.options : []).map(String).map((o) => o.trim().slice(0, 80)).filter(Boolean).slice(0, 12);
    if (opts.length < 2) throw new ValidationError('Poll needs at least 2 options');
    meta = { id: uid(), title, options: opts };
    body = title;
  }
  if (type === 'game') {
    body = V.str(String(req.body.body || 'Tic-tac-toe'), { max: 40, name: 'Game' });
    meta = { id: uid(), game: req.body.game === 'quiz' ? 'quiz' : 'ttt', state: req.body.game === 'quiz' ? (req.body.quiz || null) : { board: Array(9).fill(''), turn: 'x', players: [me] }, title: body };
  }
  if (type === 'location') {
    if (!Array.isArray(req.body.coords) || req.body.coords.length !== 2) throw new ValidationError('Location requires [lat,lng]');
    const [la, ln] = req.body.coords.map(Number);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) throw new ValidationError('Invalid coordinates');
    meta = { lat: la, lng: ln, live: !!req.body.live, ttlMin: V.int(req.body.ttlMin || 15, { min: 1, max: 480 }) };
  }
  if (type === 'snap') {
    const file = storage.get(String(req.body.fileId || ''));
    if (!file) throw new ValidationError('Snap requires fileId');
    meta = { fileId: file.id, snapId: String(req.body.snapId || ''), caption: V.str(String(req.body.caption || ''), { max: 200 }) };
  }

  // scheduled messages
  const scheduledFor = req.body.scheduledFor ? V.int(req.body.scheduledFor, { min: now(), max: now() + 10 * 864e5 }) : null;

  // disappearing: chat default or per-message
  const disappear = V.int(req.body.disappearAfter ?? g.chat.disappearAfter ?? 0, { min: 0, max: 604800 });

  const id = uid();
  q.run(`INSERT INTO messages (id, chatId, senderId, type, body, meta, disappears, scheduledFor, createdAt) VALUES (?,?,?,?,?,?,?,?,?)`,
    id, chatId, me, type, body, JSON.stringify(meta), disappear, scheduledFor, scheduledFor || now());

  let message = null;
  if (!scheduledFor) {
    message = chat.messageJson(q.get(`SELECT * FROM messages WHERE id=?`, id), me);
    emitRoom(chatId, 'message:new', { message });
    // notify offline members
    const others = q.all(`SELECT userId FROM chatMembers WHERE chatId=? AND userId != ? AND muted=0`, chatId, me);
    for (const o of others) chat.notify(o.userId, 'message', g.chat.type === 'dm' ? req.user.displayName : `${req.user.displayName} → ${g.chat.title}`, (body || chat.preview({ type, body, meta })).slice(0, 120), { chatId, messageId: id, actorId: me });
  } else {
    message = chat.messageJson(q.get(`SELECT * FROM messages WHERE id=?`, id), me);
  }
  q.run(`UPDATE chatMembers SET lastReadAt=? WHERE chatId=? AND userId=?`, now(), chatId, me);
  res.json({ message });
}));

/* ---- vote on a poll ---- */
router.post('/poll/vote', requireAuth, (req, res) => {
  const mid = String(req.body.messageId || '');
  const opt = V.int(req.body.optionIndex, { min: 0, max: 11 });
  const m = q.get(`SELECT * FROM messages WHERE id=? AND deletedAt IS NULL`, mid);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  const g = chat.canAccess(m.chatId, req.user.id);
  if (!g.ok) return res.status(g.status).json({ error: g.error });
  const meta = chat.safeJson(m.meta);
  if (m.type !== 'poll' || !Array.isArray(meta.options)) return res.status(400).json({ error: 'Not a poll' });
  if (opt >= meta.options.length) throw new ValidationError('Bad option index');
  q.run(`INSERT INTO pollVotes (messageId, userId, optionIndex, createdAt) VALUES (?,?,?,?) ON CONFLICT(messageId, userId) DO UPDATE SET optionIndex=excluded.optionIndex, createdAt=excluded.createdAt`, mid, req.user.id, opt, now());
  const updated = chat.messageJson(q.get(`SELECT * FROM messages WHERE id=?`, mid), req.user.id);
  emitRoom(m.chatId, 'message:update', updated);
  res.json({ ok: true, poll: updated.poll });
});

/* ---- game move (tic-tac-toe / quiz) ---- */
router.post('/game/move', requireAuth, (req, res) => {
  const mid = String(req.body.messageId || '');
  const m = q.get(`SELECT * FROM messages WHERE id=? AND deletedAt IS NULL`, mid);
  if (!m || m.type !== 'game') return res.status(404).json({ error: 'Game not found' });
  const g = chat.canAccess(m.chatId, req.user.id);
  if (!g.ok) return res.status(g.status).json({ error: g.error });
  const meta = chat.safeJson(m.meta);
  const state = meta.state || {};
  if (meta.game === 'ttt') {
    const idx = V.int(req.body.cell, { min: 0, max: 8 });
    if (!Array.isArray(state.board) || state.board.length !== 9) state.board = Array(9).fill('');
    if (state.board[idx] !== '' || state.winner) throw new ValidationError('Cell taken');
    const players = state.players && state.players.length === 2 ? state.players : [m.senderId, req.user.id];
    state.players = players;
    const symbol = players.indexOf(req.user.id) === 0 ? 'x' : 'o';
    if (state.turn && state.turn !== symbol) throw new ValidationError('Not your turn');
    state.board[idx] = symbol;
    state.turn = symbol === 'x' ? 'o' : 'x';
    const W = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    state.winner = W.some((w) => w.every((i) => state.board[i] === symbol)) ? symbol : (state.board.every((c) => c) ? 'draw' : null);
  }
  q.run(`UPDATE messages SET meta=? WHERE id=?`, JSON.stringify(meta), mid);
  emitRoom(m.chatId, 'message:update', { id: mid, chatId: m.chatId, type: 'game', meta });
  res.json({ ok: true, meta });
});

/* ---- edit ---- */
router.put('/:id', requireAuth, (req, res) => {
  const m = q.get(`SELECT * FROM messages WHERE id=? AND deletedAt IS NULL`, req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  if (m.senderId !== req.user.id) return res.status(403).json({ error: 'You can only edit your own messages' });
  const g = chat.canAccess(m.chatId, req.user.id);
  if (!g.ok) return res.status(g.status).json({ error: g.error });
  const body = V.str(String(req.body.body || ''), { max: 8000, name: 'Message' });
  const hist = chat.safeJson(m.editHistory) || [];
  hist.push({ body: m.body, editedAt: m.editedAt || m.createdAt });
  if (m.type === 'text' || m.type === 'system') q.run(`UPDATE messages SET body=?, editedAt=?, editHistory=? WHERE id=?`, body, now(), JSON.stringify(hist.slice(-10)), m.id);
  else if (m.type === 'poll') {
    const meta = chat.safeJson(m.meta);
    meta.title = body; q.run(`UPDATE messages SET body=?, editedAt=?, editHistory=? WHERE id=?`, body, now(), JSON.stringify(hist.slice(-10)), m.id);
  } else throw new ValidationError('Only text messages and polls can be edited');
  const payload = chat.messageJson(q.get(`SELECT * FROM messages WHERE id=?`, m.id), req.user.id);
  emitRoom(m.chatId, 'message:update', { ...payload, edited: true });
  res.json({ message: payload });
});

/* ---- delete (for me everyone = real delete) ---- */
router.delete('/:id', requireAuth, (req, res) => {
  const m = q.get(`SELECT * FROM messages WHERE id=? AND deletedAt IS NULL`, req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  const g = chat.canAccess(m.chatId, req.user.id);
  if (!g.ok) return res.status(g.status).json({ error: g.error });
  const member = g.member;
  const canDelete = m.senderId === req.user.id || (['owner', 'admin'].includes(member.role) && ['group', 'channel', 'community'].includes(g.chat.type));
  if (!canDelete) return res.status(403).json({ error: 'Not allowed to delete this message' });
  if (chat.safeJson(m.meta)?.fileId) storage.revoke(chat.safeJson(m.meta).fileId).catch(() => {});
  q.run(`UPDATE messages SET deletedAt=?, body='', meta='{}' WHERE id=?`, now(), m.id);
  emitRoom(m.chatId, 'message:update', { id: m.id, chatId: m.chatId, deletedAt: now() });
  res.json({ ok: true });
});

/* ---- reactions ---- */
router.post('/:id/react', requireAuth, (req, res) => {
  const m = q.get(`SELECT * FROM messages WHERE id=? AND deletedAt IS NULL`, req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  const g = chat.canAccess(m.chatId, req.user.id);
  if (!g.ok) return res.status(g.status).json({ error: g.error });
  const emoji = V.emoji(String(req.body.emoji || ''));
  const mine = q.get(`SELECT 1 x FROM reactions WHERE messageId=? AND userId=? AND emoji=?`, m.id, req.user.id, emoji);
  if (mine) q.run(`DELETE FROM reactions WHERE messageId=? AND userId=? AND emoji=?`, m.id, req.user.id, emoji);
  else q.run(`INSERT INTO reactions (messageId, userId, emoji, createdAt) VALUES (?,?,?,?)`, m.id, req.user.id, emoji, now());
  const reactions = q.all(`SELECT emoji, userId FROM reactions WHERE messageId=?`, m.id);
  emitRoom(m.chatId, 'message:update', { id: m.id, chatId: m.chatId, reactions, type: 'reaction', actorId: req.user.id });
  if (!mine && m.senderId !== req.user.id) chat.notify(m.senderId, 'react', `${req.user.displayName} reacted ${emoji}`, chat.preview(m).slice(0, 80), { chatId: m.chatId, messageId: m.id, actorId: req.user.id });
  res.json({ ok: true, reactions });
});

/* ---- star ---- */
router.post('/:id/star', requireAuth, (req, res) => {
  const m = q.get(`SELECT * FROM messages WHERE id=? AND deletedAt IS NULL`, req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  const g = chat.canAccess(m.chatId, req.user.id);
  if (!g.ok) return res.status(g.status).json({ error: g.error });
  if (q.get(`SELECT 1 x FROM stars WHERE userId=? AND messageId=?`, req.user.id, m.id)) q.run(`DELETE FROM stars WHERE userId=? AND messageId=?`, req.user.id, m.id);
  else q.run(`INSERT INTO stars (userId, messageId, createdAt) VALUES (?,?,?)`, req.user.id, m.id, now());
  res.json({ ok: true, stared: !!q.get(`SELECT 1 x FROM stars WHERE userId=? AND messageId=?`, req.user.id, m.id) });
});

/* ---- pin ---- */
router.post('/:id/pin', requireAuth, (req, res) => {
  const m = q.get(`SELECT * FROM messages WHERE id=? AND deletedAt IS NULL`, req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  const g = chat.canAccess(m.chatId, req.user.id);
  if (!g.ok) return res.status(g.status).json({ error: g.error });
  const canPin = g.chat.type === 'dm' || g.chat.type === 'notes' || ['owner', 'admin'].includes(g.member.role) || g.chat.type === 'dm';
  if (!canPin && g.chat.type !== 'dm') return res.status(403).json({ error: 'Only admins can pin in groups' });
  const p = q.get(`SELECT pinned FROM messages WHERE id=?`, m.id).pinned;
  q.run(`UPDATE messages SET pinned=? WHERE id=?`, p ? 0 : 1, m.id);
  emitRoom(m.chatId, 'message:update', { id: m.id, chatId: m.chatId, pinned: p ? 0 : 1, type: 'pin' });
  res.json({ ok: true, pinned: !p });
});

/* ---- forward ---- */
router.post('/forward', requireAuth, CANON(async (req, res) => {
  const mid = String(req.body.messageId || '');
  const targets = (Array.isArray(req.body.chatIds) ? req.body.chatIds : []).slice(0, 20);
  const src = q.get(`SELECT * FROM messages WHERE id=? AND deletedAt IS NULL`, mid);
  if (!src) return res.status(404).json({ error: 'Message not found' });
  if (chat.canAccess(src.chatId, req.user.id).status === 403) return res.status(403).json({ error: 'Cannot read source message' });
  const out = [];
  for (const chatId of targets) {
    const g = chat.canAccess(chatId, req.user.id);
    if (!g.ok) continue;
    if (g.chat.type === 'channel' && !['owner', 'admin'].includes(g.member.role)) continue;
    const id = uid();
    const meta = { ...chat.safeJson(src.meta), forwardedFrom: { chatId: src.chatId, senderId: src.senderId, originalId: src.id } };
    q.run(`INSERT INTO messages (id, chatId, senderId, type, body, meta, createdAt) VALUES (?,?,?,?,?,?,?)`,
      id, chatId, req.user.id, src.type, src.body, JSON.stringify(meta), now());
    const message = chat.messageJson(q.get(`SELECT * FROM messages WHERE id=?`, id), req.user.id);
    emitRoom(chatId, 'message:new', { message });
    out.push(message);
    const others = q.all(`SELECT userId FROM chatMembers WHERE chatId=? AND userId != ? AND muted=0`, chatId, req.user.id);
    for (const o of others) chat.notify(o.userId, 'message', g.chat.type === 'dm' ? req.user.displayName : g.chat.title, chat.preview(src), { chatId, messageId: id, actorId: req.user.id });
  }
  res.json({ messages: out });
}));

/* ---- mark read (REST fallback for the socket path) ---- */
router.post('/:chatId/read', requireAuth, (req, res) => {
  const g = chat.canAccess(req.params.chatId, req.user.id);
  if (!g.ok) return res.status(g.status).json({ error: g.error });
  q.run(`UPDATE chatMembers SET lastReadAt=? WHERE chatId=? AND userId=?`, now(), req.params.chatId, req.user.id);
  q.run(`UPDATE messages SET expiresAt=? + disappears*1000 WHERE chatId=? AND disappears>0 AND expiresAt IS NULL AND senderId<>?`, now(), req.params.chatId, req.user.id);
  res.json({ ok: true });
});

export default router;
