/*
 * VIBECHAT chat domain service: access control, DM/group bootstrap, message hydration, notifications.
 * Single source of truth for "who may see what", used by REST routes and Socket.IO alike.
 */
import crypto from 'node:crypto';
import { q, uid, now } from '../db.js';
import { getUser } from '../auth.js';
import * as storage from './storage.js';

/* ---- presence & privacy-aware user JSON ---- */
export function userPub(u, viewerId, { contacted = false } = {}) {
  if (!u) return null;
  const onlineAllowed = u.privOnline === 'everyone' || (u.privOnline === 'contacts' && contacted) || u.privOnline === 'everyone';
  const lastSeenAllowed = u.privLastSeen === 'everyone' || (u.privLastSeen === 'contacts' && contacted) || u.privLastSeen === 'everyone';
  return {
    id: u.id, username: u.username, displayName: u.displayName,
    bio: u.privProfile === 'nobody' && viewerId !== u.id ? '' : u.bio,
    statusEmoji: u.statusEmoji, statusText: u.statusText,
    accent: u.accent, role: u.role,
    avatar: u.avatarFileId ? `/api/files/${u.avatarFileId}` : `/api/users/${u.id}/avatar.svg`,
    avatarFileId: u.avatarFileId || null,
    cover: u.coverFileId ? `/api/files/${u.coverFileId}` : null,
    online: !!u.online && onlineAllowed,
    lastSeen: lastSeenAllowed && !u.online ? u.lastSeen : null,
  };
}
export const isContact = (a, b) => !!q.get(`SELECT 1 x FROM contacts WHERE (a=? AND b=?) OR (a=? AND b=?)`, a, b, b, a);
export const isBlocked = (a, b) => !!q.get(`SELECT 1 x FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)`, a, b, b, a);
export const blockedBy = (a, b) => !!q.get(`SELECT 1 x FROM blocks WHERE blocker=? AND blocked=?`, b, a); // did b block a?

export function publicUserById(id, viewerId) {
  const u = q.get(`SELECT * FROM users WHERE id=? AND deletedAt IS NULL`, id);
  if (!u) return null;
  const contacted = isContact(id, viewerId) || viewerId === id;
  const viewerBlocks = !!q.get(`SELECT 1 x FROM blocks WHERE blocker=? AND blocked=?`, viewerId, id);
  const pu = userPub(u, viewerId, { contacted });
  pu.blocked = viewerBlocks || blockedBy(viewerId, id);
  return pu;
}

/* ---- chats ---- */
export const member = (chatId, uidv) => q.get(`SELECT * FROM chatMembers WHERE chatId=? AND userId=?`, chatId, uidv);
export function chatWithMembers(chatId) {
  const chat = q.get(`SELECT * FROM chats WHERE id=?`, chatId);
  if (!chat) return null;
  chat.members = q.all(`
    SELECT cm.role, cm.lastReadAt, cm.lastDeliveredAt, cm.muted, cm.joinedAt, u.id, u.username, u.displayName, u.avatarFileId, u.online, u.lastSeen, u.accent, u.statusEmoji
    FROM chatMembers cm JOIN users u ON u.id=cm.userId WHERE cm.chatId=?`, chatId)
    .map((r) => ({ role: r.role, lastReadAt: r.lastReadAt, lastDeliveredAt: r.lastDeliveredAt, muted: r.muted, joinedAt: r.joinedAt, ...userPub({ ...r, bio: undefined }, null) }));
  return chat;
}
export function canAccess(chatId, userId) {
  const chat = q.get(`SELECT * FROM chats WHERE id=?`, chatId);
  if (!chat) return { ok: false, status: 404, error: 'Chat not found' };
  const m = member(chatId, userId);
  if (!m) return { ok: false, status: 403, error: 'Not a member of this chat' };
  return { ok: true, chat, member: m };
}
export async function ensureDM(a, b) {
  if (a === b) {
    // Saved Messages: personal notes chat
    const selfKey = `self:${a}`;
    let self = q.get(`SELECT * FROM chats WHERE dmKey=?`, selfKey);
    if (!self) {
      const id = uid();
      q.run(`INSERT INTO chats (id, type, dmKey, ownerId, title, createdAt) VALUES (?,?,?,?,?,?)`, id, 'notes', selfKey, a, 'Saved Notes', now());
      q.run(`INSERT INTO chatMembers (chatId, userId, role, joinedAt) VALUES (?,?,?,?)`, id, a, 'owner', now());
      self = q.get(`SELECT * FROM chats WHERE id=?`, id);
    }
    return self;
  }
  const dmKey = `${a < b ? a : b}:${a < b ? b : a}`;
  let chat = q.get(`SELECT * FROM chats WHERE dmKey=?`, dmKey);
  if (!chat) {
    const id = uid();
    q.run(`INSERT INTO chats (id, type, dmKey, createdAt) VALUES (?,?,?,?)`, id, 'dm', dmKey, now());
    q.run(`INSERT INTO chatMembers (chatId, userId, role, joinedAt) VALUES (?,?,'member',?), (?,?,'member',?)`,
      id, a, now(), id, b, now());
    chat = q.get(`SELECT * FROM chats WHERE id=?`, id);
  }
  return chat;
}
export function createGroup({ ownerId, title, memberIds = [], type = 'group', description = '', communityId = null }) {
  const id = uid();
  const token = type === 'group' || type === 'community' || type === 'channel' ? crypto.randomBytes(10).toString('hex').replace(/[-_]/g, 'a') : null;
  q.run(`INSERT INTO chats (id, type, title, description, ownerId, communityId, inviteToken, createdAt) VALUES (?,?,?,?,?,?,?,?)`,
    id, type, title.slice(0, 100), description.slice(0, 500), ownerId, communityId, token, now());
  const unique = [...new Set([ownerId, ...memberIds])].filter(Boolean);
  for (const u of unique) q.run(`INSERT OR IGNORE INTO chatMembers (chatId, userId, role, joinedAt) VALUES (?,?,?,?)`,
    id, u, u === ownerId ? 'owner' : 'member', now());
  return q.get(`SELECT * FROM chats WHERE id=?`, id);
}

/* ---- access gates ---- */
export function snapshot(chatId, userId) {
  const chat = chatWithMembers(chatId);
  if (!chat) return null;
  const last = q.get(`SELECT * FROM messages WHERE chatId=? AND deletedAt IS NULL ORDER BY createdAt DESC LIMIT 1`, chatId);
  const mem = member(chatId, userId);
  chat.unread = last ? q.get(`SELECT COUNT(*) c FROM messages WHERE chatId=? AND deletedAt IS NULL AND createdAt > ? AND senderId != ?`, chatId, mem?.lastReadAt || 0, userId).c : 0;
  chat.lastMessage = last ? messageJson(last, userId) : null;
  chat.pinned = mem?.pinned || 0;
  chat.muted = mem?.muted || 0;
  chat.archived = mem?.archived || 0;
  chat.myRole = mem?.role;
  return chat;
}

/* ---- messages ---- */
export function messageJson(m, viewerId) {
  if (!m) return null;
  const j = { ...m, meta: safeJson(m.meta), editHistory: safeJson(m.editHistory) };
  j.mine = m.senderId === viewerId;
  j.reactions = q.all(`SELECT emoji, userId FROM reactions WHERE messageId=?`, m.id).map((r) => r);
  j.stared = viewerId ? !!q.get(`SELECT 1 x FROM stars WHERE userId=? AND messageId=?`, viewerId, m.id) : false;
  j.pinned = !!m.pinned;
  const senderRow = q.get(`SELECT id, username, displayName, avatarFileId, accent, online FROM users WHERE id=?`, m.senderId);
  j.sender = senderRow ? userPub({ ...senderRow, bio: '' }, viewerId) : null;
  if (m.replyTo) {
    const r = q.get(`SELECT * FROM messages WHERE id=?`, m.replyTo);
    if (r) { j.replyMessage = { id: r.id, type: r.type, body: preview(r), senderId: r.senderId, meta: safeJson(r.meta) }; }
  }
  const fi = j.meta?.fileId && storage.get(j.meta.fileId);
  if (fi) j.file = { id: fi.id, name: fi.originalName, size: fi.size, mime: fi.mime, kind: fi.kind, ext: fi.ext, url: `/api/files/${fi.id}`, downloadUrl: `/api/files/${fi.id}?dl=1` };
  if (j.type === 'snap') j.snap = snapJson(m.meta?.snapId, viewerId);
  if (j.type === 'poll') j.poll = hydratePoll(j.meta, viewerId);
  return j;
}
export const preview = (m) => {
  if (m.deletedAt) return '(deleted)';
  const fi = safeJson(m.meta)?.fileId;
  switch (m.type) {
    case 'image': return '📷 Photo'; case 'video': return '🎥 Video'; case 'audio': case 'voice': return '🎙 Voice message';
    case 'file': return `📎 ${safeJson(m.meta)?.name || 'Attachment'}`; case 'sticker': return 'Sticker';
    case 'gif': return 'GIF'; case 'snap': return '📸 Snap'; case 'poll': return `📊 Poll: ${safeJson(m.meta)?.title || ''}`;
    case 'game': return '🎮 Game'; case 'location': return '📍 Location'; case 'system': return m.body;
    default: return (m.body || '').slice(0, 160);
  }
};
export const safeJson = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };

function hydratePoll(meta, viewerId) {
  const votes = q.all(`SELECT userId, optionIndex, createdAt FROM pollVotes WHERE messageId=?`, meta.id);
  if (!meta) return null;
  for (const v of votes) void v;
  const mine = votes.find((v) => v.userId === viewerId);
  return {
    ...meta,
    totalVotes: votes.length,
    myVote: mine ? mine.optionIndex : null,
    votes: meta.options?.map((label, i) => ({ label, count: votes.filter((v) => v.optionIndex === i).length })) || [],
    voters: votes.map((v) => v.userId),
  };
}
export function snapJson(snapId, viewerId) {
  if (!snapId) return null;
  const sn = q.get(`SELECT * FROM snaps WHERE id=?`, snapId);
  if (!sn) return { id: snapId, expired: true };
  const expired = sn.expiresAt < now();
  const rec = q.get(`SELECT * FROM snapRecipients WHERE snapId=?`, snapId);
  const isSender = viewerId === sn.senderId;
  const isRecipient = !!rec;
  if (!isSender && !isRecipient) return { id: snapId, expired: true, denied: true };
  const out = {
    id: sn.id, senderId: sn.senderId, caption: sn.caption, duration: sn.duration,
    singleView: !!sn.singleView, expired,
    createdAt: sn.createdAt, mine: isSender,
  };
  if (isRecipient && !expired) {
    out.state = rec.state;
    if (rec.openedAt) out.openedAt = rec.openedAt;
    // media only reachable while unexpired & (not opened || sender replays)
  }
  if (isSender) {
    out.recipients = q.all(`SELECT rc.userId, rc.state, rc.openedAt, u.username, u.displayName, u.avatarFileId FROM snapRecipients rc JOIN users u ON u.id=rc.userId WHERE rc.snapId=?`, snapId);
    out.expiresAt = sn.expiresAt;
  }
  return out;
}

/* ---- notifications ---- */
export function notify(userId, type, title, body = '', data = {}) {
  if (isBlocked(userId, data.actorId) && ['message','snapp','call','react','story'].includes(type)) return null;
  const id = uid();
  q.run(`INSERT INTO notifications (id, userId, type, title, body, data, createdAt) VALUES (?,?,?,?,?,?,?)`,
    id, userId, type, title, String(body || '').slice(0, 300), JSON.stringify(data), now());
  const payload = { id, type, title, body, data, createdAt: now(), id };
  import('../realtime/socket.js').then(({ emit }) => emit(`user:${userId}`, 'notify', payload));
  return payload;
}
export async function notifyMany(userIds, type, title, body, data) {
  for (const u of new Set(userIds)) if (u && u !== data?.exclude) notify(u, type, title, body, data);
}
