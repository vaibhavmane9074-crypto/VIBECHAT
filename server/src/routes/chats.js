/* VIBECHAT chat routes: chat list & snapshots, DM bootstrap, groups (members, invite links, roles, pins, archive/mute/read), communities, channels, personal notes chat. */
import { Router } from 'express';
import crypto from 'node:crypto';
import { q, uid, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { V, ValidationError } from '../security.js';
import * as chat from '../services/chat.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);
export const CANON = (fn) => (req, res, next) => { const p = fn(req, res, next); if (p && typeof p.catch === 'function') p.catch(next); };

/* personal notes chat (Saved Messages) */
export function ensureNotesChat(userId) {
  const existing = q.get(`SELECT * FROM chats WHERE type='notes' AND ownerId=?`, userId);
  if (existing) return existing;
  return chat.createGroup({ ownerId: userId, title: 'saved-notes', type: 'notes', memberIds: [] });
}

/* ---- chat list ---- */
router.get('/', requireAuth, (req, res) => {
  req.user.lastSeen = now();
  const rows = q.all(`
    SELECT c.*, cm.role, cm.pinned, cm.muted, cm.archived, cm.lastReadAt
    FROM chats c JOIN chatMembers cm ON cm.chatId=c.id AND cm.userId=?
    WHERE c.type IN ('notes','dm','group','channel','community')
    ORDER BY cm.lastReadAt DESC`, req.user.id);
  const out = [];
  for (const c of rows) {
    if (c.type === 'notes') continue;
    out.push(chat.snapshot(c.id, req.user.id));
  }
  res.json({ chats: out.filter(Boolean) });
});

/* ---- single chat ---- */
router.get('/:id', requireAuth, (req, res) => {
  const g = chat.canAccess(req.params.id, req.user.id);
  if (!g.ok) return res.status(g.status).json({ error: g.error });
  res.json({ chat: chat.snapshot(req.params.id, req.user.id) });
});

/* ---- open DM with a user ---- */
router.post('/dm', requireAuth, CANON(async (req, res) => {
  const target = String(req.body.userId || '');
  const peer = q.get(`SELECT * FROM users WHERE id=? AND deletedAt IS NULL`, target);
  if (!peer) return res.status(404).json({ error: 'User not found' });
  if (target === req.user.id) {
    const dm = await chat.ensureDM(req.user.id, req.user.id); // Saved Messages
    return res.json({ chat: chat.snapshot(dm.id, req.user.id) });
  }
  if (chat.isBlocked(req.user.id, target) || chat.blockedBy(req.user.id, target)) return res.status(403).json({ error: 'User is blocked' });
  if (target !== req.user.id) {
    const priv = peer.privDM || 'contacts';
    if (priv === 'nobody') return res.status(403).json({ error: 'This person is not accepting messages' });
    if (priv === 'contacts' && !q.get(`SELECT 1 x FROM contacts WHERE (a=? AND b=?) OR (b=? AND a=?)`, req.user.id, target, req.user.id, target)) {
      return res.status(403).json({ error: 'Only their contacts can message this person — send a contact request first' });
    }
  }
  const dm = await chat.ensureDM(req.user.id, target);
  res.json({ chat: chat.snapshot(dm.id, req.user.id) });
}));

/* ---- groups & channels ---- */
router.post('/group', requireAuth, CANON(async (req, res) => {
  const title = V.str(req.body.title, { min: 1, max: 100, name: 'Group name' });
  const ids = Array.isArray(req.body.memberIds) ? req.body.memberIds.slice(0, 200) : [];
  const bad = ids.find((i) => !q.get(`SELECT 1 x FROM users WHERE id=?`, i));
  if (bad) return res.status(400).json({ error: 'Unknown member in member list' });
  for (const ido of ids) {
    if (chat.isBlocked(req.user.id, ido) || chat.blockedBy(req.user.id, ido)) return res.status(403).json({ error: 'Cannot add a blocked user' });
  }
  const g = chat.createGroup({ ownerId: req.user.id, title, memberIds: ids, description: req.body.description || '', type: 'group' });
  chat.notifyMany(ids.filter((i) => i !== req.user.id), 'invite', `${req.user.displayName} added you to ${title}`, `You are now a member of ${title}.`, { chatId: g.id, actorId: req.user.id, exclude: req.user.id });
  res.json({ chat: chat.snapshot(g.id, req.user.id) });
}));

router.post('/channel', requireAuth, CANON(async (req, res) => {
  const title = V.str(req.body.title, { min: 1, max: 100, name: 'Channel name' });
  const g = chat.createGroup({ ownerId: req.user.id, title, memberIds: [], description: req.body.description || '', type: 'channel' });
  res.json({ chat: chat.snapshot(g.id, req.user.id) });
}));

router.post('/:id/members', requireAuth, (req, res) => {
  const g = chat.canAccess(req.params.id, req.user.id);
  if (!g.ok) return res.status(g.status).json({ error: g.error });
  const me = chat.member(req.params.id, req.user.id);
  if (g.chat.type !== 'group' || req.user.id !== g.chat.ownerId) {
    if (me?.role !== 'admin') return res.status(403).json({ error: 'Only group admins can add members' });
  }
  const ids = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
  if (!ids.length) throw new ValidationError('Provide memberIds');
  for (const tgt of ids.slice(0, 100)) {
    if (!q.get(`SELECT 1 x FROM users WHERE id=?`, tgt)) continue;
    if (tgt !== req.user.id && (chat.isBlocked(req.user.id, tgt) || chat.blockedBy(req.user.id, tgt))) continue;
    if (!q.get(`SELECT 1 x FROM chatMembers WHERE chatId=? AND userId=?`, req.params.id, tgt)) {
      q.run(`INSERT INTO chatMembers (chatId, userId, role, joinedAt) VALUES (?,?,?,?)`, req.params.id, tgt, 'member', now());
      chat.notify(tgt, 'invite', g.chat.title, `${req.user.displayName} added you to ${g.chat.title}`, { chatId: req.params.id, actorId: req.user.id });
      emitRoom(g.chat.id, 'members:add', { chatId: g.chat.id, userId: tgt });
    }
  }
  res.json({ chat: chat.snapshot(g.chat.id, req.user.id) });
});

router.delete('/:id/members/:userId', requireAuth, (req, res) => {
  const g = chat.canAccess(req.params.id, req.user.id);
  if (!g.ok) return res.status(g.status).json({ error: g.error });
  if (g.chat.type !== 'group') return res.status(400).json({ error: 'Not a group' });
  const me = chat.member(req.params.id, req.user.id);
  const self = req.params.userId === req.user.id;
  if (!self && me.role === 'member' && g.chat.ownerId !== req.user.id) return res.status(403).json({ error: 'Only admins can remove members' });
  if (req.params.userId === g.chat.ownerId && !self) return res.status(403).json({ error: 'Cannot remove the owner' });
  q.run(`DELETE FROM chatMembers WHERE chatId=? AND userId=?`, req.params.id, req.params.userId);
  emitChat(req.params.id, 'members:remove', { chatId: req.params.id, userId: req.params.userId, actorId: req.user.id });
  res.json({ ok: true, remaining: q.all(`SELECT u.id, u.username, u.displayName FROM chatMembers cm JOIN users u ON u.id=cm.userId WHERE cm.chatId=?`, req.params.id) });
});
const emitChat = (id, ev, data) => emitRoom(id, ev, data);
function emitRoom(id, ev, data) { import('../realtime/socket.js').then(({ emit }) => emit(id && `chat:${id}`, ev, data)); }

router.post('/:id/role', requireAuth, (req, res) => {
  const g = chat.canAccess(req.params.id, req.user.id);
  if (!g.ok || g.chat.type !== 'group') return res.status(403).json({ error: 'Group only' });
  if (g.chat.ownerId !== req.user.id) return res.status(403).json({ error: 'Only the owner can manage roles' });
  const role = V.limit(req.body.role, ['member', 'admin']);
  q.run(`UPDATE chatMembers SET role=? WHERE chatId=? AND userId=?`, role, req.params.id, String(req.body.userId));
  emitRoom(req.params.id, 'members:update', { chatId: req.params.id, userId: String(req.body.userId), role });
  res.json({ ok: true });
});

/* invite links */
router.post('/:id/invite', requireAuth, (req, res) => {
  const g = chat.canAccess(req.params.id, req.user.id);
  if (!g.ok || g.chat.type === 'dm' || g.chat.type === 'notes') return res.status(400).json({ error: 'Only groups/channels have invite links' });
  const token = crypto.randomBytes(10).toString('hex');
  q.run(`UPDATE chats SET inviteToken=? WHERE id=?`, token, req.params.id);
  res.json({ inviteToken: token, url: `${req.protocol}://${req.get('host')}/invite/${token}` });
});
router.get('/join/:token', requireAuth, CANON(async (req, res) => {
  const chatRow = q.get(`SELECT * FROM chats WHERE inviteToken=?`, String(req.params.token));
  if (!chatRow) return res.status(404).json({ error: 'Invalid invite link' });
  if (!q.get(`SELECT 1 x FROM chatMembers WHERE chatId=? AND userId=?`, chatRow.id, req.user.id)) {
    q.run(`INSERT INTO chatMembers (chatId, userId, role, joinedAt) VALUES (?,?,?,?)`, chatRow.id, req.user.id, 'member', now());
    chat.notify(chatRow.ownerId, 'join', chatRow.title || 'Chat', `${req.user.displayName} joined via invite link`, { chatId: chatRow.id, actorId: req.user.id });
    emitRoom(chatRow.id, 'members:add', { chatId: chatRow.id, userId: req.user.id });
  }
  res.json({ chat: chat.snapshot(chatRow.id, req.user.id) });
}));

/* chat customisation + membership prefs */
router.patch('/:id/settings', requireAuth, (req, res) => {
  const g = chat.canAccess(req.params.id, req.user.id);
  if (!g.ok) return res.status(g.status).json({ error: g.error });
  const body = req.body || {};
  const mem = g.member;
  if (body.wallpaper !== undefined) {
    if (g.chat.type === 'group' || g.chat.type === 'channel') { if (['owner', 'admin'].includes(mem.role)) q.run(`UPDATE chats SET wallpaper=? WHERE id=?`, String(body.wallpaper).slice(0, 200), req.params.id); }
    else q.run(`UPDATE chats SET wallpaper=? WHERE id=?`, String(body.wallpaper).slice(0, 200), req.params.id);
  }
  for (const k of ['muted', 'pinned', 'archived']) if (body[k] !== undefined) q.run(`UPDATE chatMembers SET ${k}=? WHERE chatId=? AND userId=?`, body[k] ? 1 : 0, req.params.id, req.user.id);
  if (body.disappearAfter !== undefined) {
    if (g.chat.type === 'dm') q.run(`UPDATE chats SET disappearAfter=? WHERE id=?`, V.int(body.disappearAfter, { min: 0, max: 604800 }), req.params.id);
    else if (mem.role === 'owner' || mem.role === 'admin') q.run(`UPDATE chats SET disappearAfter=? WHERE id=?`, V.int(body.disappearAfter, { min: 0, max: 604800 }), req.params.id);
  }
  if (body.title !== undefined && ['owner', 'admin'].includes(mem.role)) {
    q.run(`UPDATE chats SET title=? WHERE id=?`, V.str(String(body.title), { min: 1, max: 100, name: 'Title' }), req.params.id);
    emitRoom(req.params.id, 'chat:update', { chatId: req.params.id });
  }
  if (body.description !== undefined && ['owner', 'admin'].includes(mem.role)) q.run(`UPDATE chats SET description=? WHERE id=?`, V.str(String(body.description), { max: 500, name: 'Description' }), req.params.id);
  res.json({ chat: chat.snapshot(req.params.id, req.user.id) });
});

/* communities */
router.get('/communities/list', requireAuth, (req, res) => {
  res.json({
    mine: q.all(`SELECT co.*, cm.role FROM communities co JOIN communityMembers cm ON cm.communityId=co.id AND cm.userId=?`, req.user.id),
    discover: q.all(`SELECT co.id, co.name, co.description, co.avatarFileId, co.isPublic, (SELECT COUNT(*) FROM communityMembers WHERE communityId=co.id) memberCount FROM communities co WHERE co.isPublic=1 AND co.id NOT IN (SELECT communityId FROM communityMembers WHERE userId=?) ORDER BY memberCount DESC LIMIT 30`, req.user.id),
  });
});
router.post('/communities', requireAuth, CANON(async (req, res) => {
  const name = V.str(req.body.name, { min: 2, max: 80, name: 'Community name' });
  const id = uid();
  q.run(`INSERT INTO communities (id, name, description, ownerId, isPublic, inviteToken, createdAt) VALUES (?,?,?,?,?,?,?)`,
    id, name, V.str(String(req.body.description || ''), { max: 300, name: 'Description' }), req.user.id, req.body.isPublic === false ? 0 : 1, crypto.randomBytes(8).toString('hex'), now());
  q.run(`INSERT INTO communityMembers (communityId, userId, role, joinedAt) VALUES (?,?,'owner',?)`, id, req.user.id, now());
  const general = chat.createGroup({ ownerId: req.user.id, title: `general-${name}`, type: 'community', communityId: id, description: 'General' });
  q.run(`INSERT INTO communityMembers (communityId, userId) VALUES (?,?)`, id, req.user.id);
  res.json({ community: q.get(`SELECT * FROM communities WHERE id=?`, id), generalChatId: general.id });
}));
router.post('/communities/:id/join', requireAuth, CANON(async (req, res) => {
  const co = q.get(`SELECT * FROM communities WHERE id=?`, req.params.id);
  if (!co || (co.isPublic === 0 && req.body.inviteToken !== co.inviteToken)) return res.status(404).json({ error: 'Community not found or private' });
  if (!q.get(`SELECT 1 x FROM communityMembers WHERE communityId=? AND userId=?`, co.id, req.user.id)) {
    q.run(`INSERT INTO communityMembers (communityId, userId, role, joinedAt) VALUES (?,?,'member',?)`, co.id, req.user.id, now());
  }
  const chatsList = q.all(`SELECT * FROM chats WHERE communityId=?`, co.id);
  for (const c of chatsList) q.run(`INSERT OR IGNORE INTO chatMembers (chatId, userId, role, joinedAt) VALUES (?,?,?,?)`, c.id, req.user.id, 'member', now());
  res.json({ ok: true, chats: chatsList.map((c) => chat.snapshot(c.id, req.user.id)) });
}));
router.get('/communities/:id/chats', requireAuth, (req, res) => {
  if (!q.get(`SELECT 1 x FROM communityMembers WHERE communityId=? AND userId=?`, req.params.id, req.user.id)) return res.status(403).json({ error: 'Not a member' });
  res.json({ chats: q.all(`SELECT * FROM chats WHERE communityId=?`, req.params.id).map((c) => chat.snapshot(c.id, req.user.id)) });
});

export default router;
