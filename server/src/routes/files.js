/* VIBECHAT universal file sharing:
 * - POST /api/files  : raw-body upload with metadata headers; magic-byte validation; size limit; no extension whitelist (any format allowed)
 * - GET  /api/files/:id : authorized inline stream w/ Range support (owner + participants of chats using it)
 * - GET  /api/files/:id?dl=1 : forced download
 * Uploads never render as HTML/SVG/JS — see security.serveHeaders.
 */
import { Router } from 'express';
import * as storage from '../services/storage.js';
import { q, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { rateLimit } from '../security.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);
const upLimit = rateLimit({ bucket: 'upload', limit: config.rateLimits.uploadPerMin });

router.post('/', upLimit, (req, res) => {
  const chunks = [];
  let size = 0;
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > config.uploadMaxBytes) return res.status(413).json({ error: `File exceeds the ${Math.round(config.uploadMaxBytes / 1024 / 1024)}MB limit` });
  let aborted = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > config.uploadMaxBytes) { aborted = true; res.status(413).json({ error: 'File too large' }).end(); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', async () => {
    if (aborted) return;
    try {
      const f = await storage.save(Buffer.concat(chunks), decodeURIComponent(req.headers['x-file-name'] || 'file'), req.headers['x-file-type'] || '', req.user.id);
      res.json({
        file: {
          id: f.id, name: f.originalName, size: f.size, mime: f.mime, kind: f.kind, ext: f.ext,
          url: `/api/files/${f.id}`, downloadUrl: `/api/files/${f.id}?dl=1`, createdAt: f.createdAt,
        },
      });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Upload failed' });
    }
  });
  req.on('error', () => { if (!res.writableEnded) res.status(400).end(); });
});

/* authorized access: owner, or member of any chat where the file was shared */
export function isAllowed(file, userId) {
  if (!file) return false;
  if (file.ownerId === userId) return true;
  return !!q.get(`
    SELECT 1 x FROM messages m JOIN chatMembers cm ON cm.chatId=m.chatId AND cm.userId=?
    WHERE m.deletedAt IS NULL AND CAST(m.meta AS TEXT) LIKE ? LIMIT 1`,
    userId, `%"${file.id}"%`);
}

router.get('/:id', requireAuth, async (req, res) => {
  const f = storage.get(req.params.id);
  if (!f || f.deletedAt) return res.status(404).json({ error: 'File not found' });
  if (!isAllowed(f, req.user.id)) return res.status(403).json({ error: 'No access to this file' });
  const ok = await storage.streamTo(res, f, { download: req.query.dl === '1' });
  if (!ok) res.status(404).json({ error: 'File content missing' });
});

/* gallery / media manager listing (searchable, kind + direction filters) */
router.get('/', requireAuth, (req, res) => {
  const kind = req.query.kind ? String(req.query.kind) : null;
  let dir = req.query.dir ? String(req.query.dir) : null;
  const limit = Math.min(Number(req.query.limit || 60), 100);
  const search = req.query.q ? String(req.query.q).slice(0, 120).replace(/[%_]/g, '\\$&') : null;
  if (!['sent', 'received'].includes(dir)) dir = null;
  const base = dir === 'received'
    ? q.all(`SELECT f.id, f.originalName name, f.size, f.mime, f.kind, f.ext, f.createdAt, f.ownerId, u.username ownerUsername, u.displayName ownerName FROM files f JOIN users u ON u.id=f.ownerId WHERE f.deletedAt IS NULL AND f.ownerId != ? ORDER BY f.createdAt DESC LIMIT 400`, req.user.id)
    : q.all(`SELECT f.id, f.originalName name, f.size, f.mime, f.kind, f.ext, f.createdAt, f.ownerId, u.username ownerUsername, u.displayName ownerName FROM files f JOIN users u ON u.id=f.ownerId WHERE f.deletedAt IS NULL ORDER BY f.createdAt DESC LIMIT 400`);
  const out = [];
  for (const frow of base) {
    if (dir === 'received' && frow.ownerId === req.user.id) continue;
    if (dir === 'sent' && frow.ownerId !== req.user.id) continue;
    const full = storage.get(frow.id);
    if (!isAllowed(full, req.user.id)) continue;
    if (kind && full.kind !== kind) continue;
    if (search && !full.originalName.toLowerCase().includes(search.toLowerCase())) continue;
    out.push({ ...frow, url: `/api/files/${frow.id}`, downloadUrl: `/api/files/${frow.id}?dl=1` });
    if (out.length >= limit) break;
  }
  res.json({ files: out, usage: storage.usage(req.user.id) });
});

export default router;
