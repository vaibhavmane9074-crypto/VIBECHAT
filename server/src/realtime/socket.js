/*
 * VIBECHAT realtime layer (Socket.IO):
 * - cookie-session handshake auth (same origin, httpOnly cookie forwarded by the client)
 * - presence (online / last-seen) broadcast
 * - chat rooms, typing indicators, delivery & read receipts
 * - WebRTC call signaling: 1:1 calls and group mesh (join room, exchange offers/ICE)
 * Exposes emit(room, event, payload) for REST routes.
 */
import { Server } from 'socket.io';
import crypto from 'node:crypto';
import { q, uid, now } from '../db.js';

let io = null;
export const emit = (room, event, payload) => { if (io) io.to(room).emit(event, payload); };
export const emitMany = (rooms, event, payload) => { for (const r of rooms) emit(r, event, payload); };
export const onlineUserIds = () => [...new Set([...io?.sockets?.sockets?.values() || []].map((s) => s.data.userId))];

const SIG = 'vc-session-ring';
const hashToken = (t) => crypto.createHmac('sha256', SIG).update(t).digest('hex');

export function setPresence(userId, online) {
  q.run(`UPDATE users SET online=?, lastSeen=? WHERE id=?`, online ? 1 : 0, now(), userId);
  const rel = q.all(`
    SELECT DISTINCT CASE WHEN cm1.userId=? THEN cm2.userId ELSE cm1.userId END id
    FROM chatMembers cm1 JOIN chatMembers cm2 ON cm1.chatId=cm2.chatId
      JOIN chats c ON c.id=cm1.chatId AND c.type='dm'
    WHERE cm1.userId=?`, userId, userId);
  emitMany([...rel.map((r) => `user:${r.id}`), `user:${userId}`], 'presence', { userId, online, lastSeen: online ? null : now() });
}

export function initSocket(httpServer) {
  io = new Server(httpServer, { cors: { origin: true, credentials: true }, maxHttpBufferSize: 8e6 });

  io.use((socket, next) => {
    const cookie = typeof socket.handshake.headers.cookie === 'string' ? socket.handshake.headers.cookie : '';
    const token = cookie.split(';').map((p) => p.trim()).find((p) => p.startsWith('vc_session='))?.slice('vc_session='.length);
    if (!token) return next(new Error('unauthorized'));
    const row = q.get(`SELECT s.* FROM sessions s WHERE s.tokenHash=?`, hashToken(token));
    if (!row || row.expiresAt < Date.now()) return next(new Error('unauthorized'));
    socket.data.userId = row.userId;
    next();
  });

  io.on('connection', (socket) => {
    const me = socket.data.userId;
    socket.join(`user:${me}`);
    q.all(`SELECT chatId FROM chatMembers WHERE userId=?`, me).forEach((r) => socket.join(`chat:${r.chatId}`));

    if ([...io.sockets.sockets.values()].filter((s) => s.data.userId === me).length === 1) setPresence(me, true);

    socket.on('chat:join', ({ chatId }) => {
      if (q.get(`SELECT 1 x FROM chatMembers WHERE chatId=? AND userId=?`, chatId, me)) socket.join(`chat:${chatId}`);
    });
    socket.on('chat:leave', ({ chatId }) => socket.leave(`chat:${chatId}`));

    socket.on('typing', ({ chatId, typing }) => {
      if (!memberOK(chatId, me)) return;
      q.run(`UPDATE chatMembers SET typingAt=? WHERE chatId=? AND userId=?`, typing ? Date.now() : 0, chatId, me);
      socket.to(`chat:${chatId}`).emit('typing', { chatId, userId: me, typing: !!typing });
    });

    socket.on('message:read', ({ chatId, upto }) => {
      if (!memberOK(chatId, me)) return;
      q.run(`UPDATE chatMembers SET lastReadAt=? WHERE chatId=? AND userId=?`, Math.max(upto || 0, Date.now()), chatId, me);
      q.run(`UPDATE messages SET expiresAt=? + disappears*1000 WHERE chatId=? AND disappears>0 AND expiresAt IS NULL AND senderId<>?`, Date.now(), chatId, me);
      socket.to(`chat:${chatId}`).emit('message:read', { chatId, userId: me, at: Date.now() });
    });
    socket.on('message:delivered', ({ chatId }) => {
      if (!memberOK(chatId, me)) return;
      q.run(`UPDATE chatMembers SET lastDeliveredAt=? WHERE chatId=? AND userId=?`, Date.now(), chatId, me);
      socket.to(`chat:${chatId}`).emit('message:delivered', { chatId, userId: me, at: Date.now() });
    });

    /* ---------------- WebRTC calls ---------------- */
    const inCall = (callId) => { const c = q.get(`SELECT * FROM calls WHERE id=?`, callId); return c && (c.initiator === me || c.callee === me || io.sockets.adapter.rooms.get(`call:${callId}`)?.has(socket.id)) ? c : null; };

    const otherOf = (row) => (row.initiator === me ? row.callee : row.initiator);

    socket.on('call:ring', ({ peerId, type = 'audio' }) => {
      const peer = peerId && q.get(`SELECT * FROM users WHERE id=?`, peerId);
      if (!peer) return socket.emit('call:error', { error: 'User not found' });
      if (q.get(`SELECT 1 x FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)`, me, peerId, peerId, me))
        return socket.emit('call:error', { error: 'Cannot call this user' });
      const chat = q.get(`SELECT c.id FROM chats c JOIN chatMembers m1 ON m1.chatId=c.id AND m1.userId=? JOIN chatMembers m2 ON m2.chatId=c.id AND m2.userId=? WHERE c.type='dm' LIMIT 1`, me, peerId);
      const callId = uid();
      q.run(`INSERT INTO calls (id, chatId, initiator, callee, type, status, startedAt) VALUES (?,?,?,?,?,'ringing',?)`,
        callId, chat?.id || null, me, peerId, type, now());
      socket.join(`call:${callId}`);
      const timer = setTimeout(() => {
        const c = q.get(`SELECT status FROM calls WHERE id=?`, callId);
        if (c?.status === 'ringing') {
          q.run(`UPDATE calls SET status='missed', endedAt=? WHERE id=?`, now(), callId);
          emit(`user:${me}`, 'call:state', { callId, status: 'missed' });
          emit(`user:${peerId}`, 'call:state', { callId, status: 'missed', missed: true });
        }
      }, 45_000);
      timers.set(callId, timer);
      emit(`user:${peerId}`, 'call:incoming', { callId, from: me, type });
      socket.emit('call:ringing', { callId, peerId, type });
      return { callId };
    });

    socket.on('call:answer', ({ callId, accept = true }) => {
      const row = q.get(`SELECT * FROM calls WHERE id=?`, callId);
      if (!row || row.callee !== me) return;
      clearTimeout(timers.get(callId)); timers.delete(callId);
      if (accept) {
        q.run(`UPDATE calls SET status='answered', answeredAt=? WHERE id=?`, now(), callId);
        socket.join(`call:${callId}`);
        emit(`user:${row.initiator}`, 'call:accepted', { callId, peer: me });
        socket.emit('call:accepted', { callId, peer: row.initiator, me: true });
        socket.emit('call:state', { callId, status: 'answered' });
      } else {
        q.run(`UPDATE calls SET status='declined', endedAt=? WHERE id=?`, now(), callId);
        emit(`user:${row.initiator}`, 'call:state', { callId, status: 'declined', by: me });
      }
    });

    socket.on('call:signal', ({ callId, to, data }) => {
      const row = inCall(callId);
      if (!row || !to || to !== otherOf(row)) return;
      emit(`user:${to}`, 'call:signal', { callId, from: me, data });
    });
    socket.on('call:ice', ({ callId, to, candidate }) => {
      const row = inCall(callId);
      if (!row || !to || to !== otherOf(row)) return;
      emit(`user:${to}`, 'call:ice', { callId, from: me, candidate });
    });
    socket.on('call:media-state', ({ callId, to, state }) => {
      const row = inCall(callId);
      if (!row || !to || to !== otherOf(row)) return socket.emit('call:error', { error: 'Cannot signal' });
      emit(`user:${to}`, 'call:media-state', { callId, from: me, state });
    });

    socket.on('call:end', ({ callId }) => {
      clearTimeout(timers.get(callId)); timers.delete(callId);
      const row = q.get(`SELECT * FROM calls WHERE id=?`, callId);
      if (!row) return;
      const other = row.initiator === me ? row.callee : row.initiator;
      const answeredAt = row.answeredAt;
      const dur = row.status === 'answered' && answeredAt ? Math.max(0, Math.round((Date.now() - answeredAt) / 1000)) : 0;
      const status = row.status === 'ringing' ? 'missed' : 'ended';
      q.run(`UPDATE calls SET status=?, endedAt=?, duration=? WHERE id=?`, status, now(), dur, callId);
      emit(`user:${other}`, 'call:ended', { callId, by: me, duration: dur, missed: status === 'missed' });
      socket.emit('call:ended', { callId, by: me, duration: dur });
    });

    socket.on('disconnect', () => {
      if (![...io.sockets.sockets.values()].some((s) => s.data.userId === me && s.id !== socket.id)) setPresence(me, false);
    });
  });
  return io;
}

const timers = new Map();
const memberOK = (chatId, uidv) => !!q.get(`SELECT 1 x FROM chatMembers WHERE chatId=? AND userId=?`, chatId, uidv);
