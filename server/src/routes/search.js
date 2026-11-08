/* VIBECHAT global search: users, chats, messages, files/groups/channels — plus filters. */
import { Router } from 'express';
import { q, now } from '../db.js';
import { requireAuth } from '../auth.js';
import * as chat from '../services/chat.js';
import * as storage from '../services/storage.js';

const router = Router();
router.use(requireAuth);

router.get('/', requireAuth, (req, res) => {
  const term = String(req.query.q || '').slice(0, 120).trim();
  const type = String(req.query.type || 'all');
  const mine = req.user.id;
  if (!term) return res.json({ users: [], chats: [], messages: [], files: [], total: 0 });
  const like = `%${term.replace(/[%_]/g, '\\$&')}%`;
  const out = { users: [], chats: [], messages: [], files: [] };

  if (['all', 'users'].includes(type) || ['all', 'users'].includes(type)) {
    out.users = q.all(`SELECT * FROM users WHERE deletedAt IS NULL AND (username LIKE ? OR displayName LIKE ?) LIMIT 10`, like, like)
      .map((u) => chat.publicUserById(u.id, mine));
  }
  if (['all', 'chats'].includes(type)) {
    out.chats = q.all(`
      SELECT c.* FROM chats c JOIN chatMembers cm ON cm.chatId=c.id AND cm.userId=?
      WHERE (c.title LIKE ? OR c.description LIKE ?) AND c.type IN ('group','channel','community','dm')
      LIMIT 10`, mine, like, like).map((c) => chat.snapshot(c.id, mine));
  }
  if (['all', 'messages'].includes(type)) {
    const { chatId } = req.query; let where = `m.deletedAt IS NULL AND m.body LIKE ? AND cm.userId=?`; const args = [like, mine];
    if (chatId && V2(chatId)) { where += ` AND m.chatId=?`; args.push(String(chatId)); }
    out.messages = q.all(`
      SELECT m.* FROM messages m JOIN chatMembers cm ON cm.chatId=m.chatId AND cm.userId=?
      WHERE ${where} ORDER BY m.createdAt DESC LIMIT 40`, mine, ...args).map((m) => {
      const c = q.get(`SELECT id, type, title FROM chats WHERE id=?`, m.chatId);
      const peer = c?.type === 'dm' ? (q.get(`SELECT u.id, u.displayName, u.username FROM chatMembers cm2 JOIN users u ON u.id=cm2.userId WHERE cm2.chatId=? AND cm2.userId != ?`, m.chatId, mine)) : null;
      return { ...chat.messageJson({ ...m, body: m.body.slice(0, 160) }, mine), chatTitle: c?.type === 'dm' ? peer?.displayName || 'DM' : c?.title, chatType: c?.type };
    });
  }
  if (['all', 'files'].includes(type)) {
    const rows = q.all(`SELECT * FROM files WHERE deletedAt IS NULL AND originalName LIKE ? ORDER BY createdAt DESC LIMIT 60`, like);
    out.files = rows.filter((f) => storage.get(f.id) && isFileAllowed(f, mine) && f.ttl === 0).slice(0, 20)
      .map((f) => ({ id: f.id, name: f.originalName, size: f.size, kind: f.kind, mime: f.mime, url: `/api/files/${f.id}`, createdAt: f.createdAt }));
  }
  out.total = out.users.length + out.chats.length + out.messages.length + out.files.length;
  res.json(out);
});
const V2 = (id) => id && /^[a-z0-9]{32}$/.test(String(id));
const isFileAllowed = (f, uidv) => f.ownerId === uidv || !!q.get(`SELECT 1 x FROM messages m JOIN chatMembers cm ON cm.chatId=m.chatId AND cm.userId=? WHERE m.deletedAt IS NULL AND m.meta LIKE ? LIMIT 1`, uidv, `%"${f.id}"%`);

/* search suggestions (recent + frequently messaged contacts) */
router.get('/suggest', requireAuth, (req, res) => {
  const rec = q.all(`SELECT DISTINCT c.id, c.type, c.title, MAX(m.createdAt) lastAt FROM chats c JOIN chatMembers cm ON cm.chatId=c.id AND cm.userId=? LEFT JOIN messages m ON m.chatId=c.id WHERE c.type != 'notes' GROUP BY c.id ORDER BY lastAt DESC LIMIT 6`, req.user.id);
  res.json({ recents: rec.map((c) => chat.snapshot(c.id, req.user.id)) });
});

export default router;
