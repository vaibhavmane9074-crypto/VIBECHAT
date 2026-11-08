/*
 * VIBECHAT storage service.
 * Files live on disk under data/uploads/<yy>/<mm>; DB (files table) holds metadata + ACL decisions.
 * - content-addressed by sha256 to dedupe
 * - original filenames never touch the disk path
 * - backend-enforced TTL deletion for snaps / disappearing media (cron loop below)
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { q, uid, now } from '../db.js';
import { config } from '../config.js';
import { serveHeaders, classify } from '../security.js';

export const UPLOAD_DIR = path.join(config.dataDir, 'uploads');

export const get = (id) => q.get(`SELECT * FROM files WHERE id=?`, id);
export const meta = (id) => {
  const f = get(id);
  if (!f) return null;
  return { ...f, url: `/api/files/${id}`, downloadUrl: `/api/files/${id}?dl=1` };
};
export const publicJson = (f) => f && ({
  id: f.id, name: f.originalName, size: f.size, mime: f.mime, kind: f.kind, ext: f.ext,
  url: f.ttl && f.expiresAt > now() && f.state !== 'expired' ? `/api/snaps/media/${f.id}` : `/api/files/${f.id}`,
  createdAt: f.createdAt,
});

/** Stream a stored file to res with Range support. Returns false if unreadable/deleted. */
export async function streamTo(res, fileRow, { download = false, full = {} } = {}) {
  const fp = path.join(UPLOAD_DIR, fileRow.storedName);
  let st;
  try { st = await fsp.stat(fp); } catch { return false; }
  const headers = serveHeaders(fileRow.kind, fileRow.mime, fileRow.originalName || fileRow.storedName, download);
  for (const [k, v] of Object.entries(full)) headers[k] = v;
  if (!headers['Cache-Control']) headers['Cache-Control'] = fileRow.ttl ? 'private, no-store' : 'private, max-age=3600';
  const size = st.size;
  headers['Accept-Ranges'] = 'bytes';
  if (size === 0) {
    headers['Content-Length'] = 0;
    res.writeHead(200, headers);
    res.end();
    return true;
  }
  const range = download ? null : res.req?.headers?.range;
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range && /^bytes=/i.test(range.trim())) {
    const m = /^bytes=(\d*)-(\d*)$/i.exec(range.trim().split(',')[0].trim());
    const unsatisfiable = () => { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return true; };
    if (!m || (m[1] === '' && m[2] === '')) return unsatisfiable();
    if (m[1] === '') {
      start = Math.max(0, size - Number(m[2]));
    } else {
      start = Number(m[1]);
      end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (start > end || start >= size) return unsatisfiable();
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  await new Promise((resolve) => {
    const s = fs.createReadStream(fp, { start, end });
    s.on('error', () => { res.destroy(); resolve(); });
    s.pipe(res);
    s.on('close', resolve);
  });
  return true;
}

/** Persist an in-memory buffer. Returns the files row. */
export async function save(buf, declaredName, declaredMime, ownerId, { ttl = 0 } = {}) {
  const info = classify(buf, declaredName, declaredMime);
  if (info.size === 0) throw new Error('Empty file');
  if (info.size > config.uploadMaxBytes) throw new Error(`File exceeds the ${Math.round(config.uploadMaxBytes / 1024 / 1024)}MB limit`);
  const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
  const safeExt = info.ext.replace(/[^a-z0-9]/g, '').slice(0, 12);
  const storedName = path.join(new Date().toISOString().slice(2, 4), new Date().toISOString().slice(5, 7), `${sha}.${safeExt || 'bin'}`);
  const fp = path.join(UPLOAD_DIR, storedName);
  await fsp.mkdir(path.dirname(fp), { recursive: true });
  await fsp.writeFile(fp, buf, { flag: 'wx' }).catch(async (e) => { if (e.code === 'EEXIST') return; throw e; });
  const id = uid();
  q.run(`INSERT INTO files (id, ownerId, sha256, originalName, ext, mime, size, kind, storedName, createdAt, ttl, expiresAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, ownerId, sha, info.name, info.ext, info.mime, info.size, info.kind, storedName, now(), ttl, ttl ? now() + ttl * 1000 : 0);
  return get(id);
}

/** Hard-delete a file row + disk blob (revoke). Used by expiry sweeper and admin moderation. */
export async function revoke(fileId, markDb = true) {
  const f = get(fileId);
  if (!f) return false;
  try { await fsp.rm(path.join(UPLOAD_DIR, f.storedName), { force: true }); } catch { /* already gone */ }
  if (markDb) q.run(`UPDATE files SET deletedAt=? WHERE id=?`, now(), fileId);
  return true;
}

/* ---------------- expiry sweeper: backend-enforced disappearing media ---------------- */
async function sweep() {
  const t = now();
  // expired snaps: revoke their blob, mark recipients expired, notify senders' rooms
  const snaps = q.all(`SELECT * FROM snaps WHERE expiresAt <= ?`, t);
  for (const sn of snaps) {
    const recs = q.all(`SELECT userId FROM snapRecipients WHERE snapId=? AND state != 'expired'`, sn.id);
    q.run(`UPDATE snapRecipients SET state='expired' WHERE snapId=?`, sn.id);
    await revoke(sn.fileId);
    q.run(`UPDATE messages SET body='(snap expired)', meta=? WHERE type='snap' AND json_extract(meta,'$.snapId')=?`,
      JSON.stringify({ snapId: sn.id, expired: true }), sn.id);
    import('./realtime/socket.js').then(({ emit }) => {
      for (const r of recs) emit(`user:${r.userId}`, 'snap:expired', { snapId: sn.id });
    });
  }
  // expired stories
  q.run(`DELETE FROM storyViews WHERE storyId IN (SELECT id FROM stories WHERE expiresAt <= ?)`, t);
  q.run(`DELETE FROM storyReactions WHERE storyId IN (SELECT id FROM stories WHERE expiresAt <= ?)`, t);
  const oldStories = q.all(`SELECT id, fileId FROM stories WHERE expiresAt <= ?`, t);
  for (const sRow of oldStories) { if (sRow.fileId) await revoke(sRow.fileId); }
  q.run(`DELETE FROM stories WHERE expiresAt <= ?`, t);
  // disappearing messages flagged for deletion past their expiresAt
  const dead = q.all(`SELECT id, chatId FROM messages WHERE expiresAt IS NOT NULL AND expiresAt <= ? AND deletedAt IS NULL`, t);
  for (const m of dead) {
    q.run(`UPDATE messages SET deletedAt=?, body='', meta='{}' WHERE id=?`, t, m.id);
    import('./realtime/socket.js').then(({ emit }) => emit(`chat:${m.chatId}`, 'message:update', { id: m.id, chatId: m.chatId, deletedAt: t }));
  }
  // expired files with TTL not tied to snaps (generic cleanup)
  const ttlFiles = q.all(`SELECT id FROM files WHERE expiresAt > 0 AND expiresAt <= ? AND deletedAt IS NULL`, t);
  for (const f of ttlFiles) await revoke(f.id);
  // purge temp dir
  try {
    const tmpDir = path.join(config.dataDir, 'tmp');
    for (const f of await fsp.readdir(tmpDir)) {
      const st = await fsp.stat(path.join(tmpDir, f)).catch(() => null);
      if (st && t - st.mtimeMs > 3600_000) await fsp.rm(path.join(tmpDir, f), { force: true });
    }
  } catch { /* noop */ }
}

export function startSweeper() {
  fsp.mkdir(UPLOAD_DIR, { recursive: true }).catch(() => {});
  setInterval(() => sweep().catch((e) => console.error('[sweep]', e.message)), 15_000).unref();
  sweep().catch(() => {});
}

/** total bytes used by a user's non-deleted files */
export const usage = (userId) => q.get(`SELECT COUNT(*) c, COALESCE(SUM(size),0) b FROM files WHERE ownerId=? AND deletedAt IS NULL`, userId) || { c: 0, b: 0 };
export const usageAll = () => q.get(`SELECT COUNT(*) c, COALESCE(SUM(size),0) b FROM files WHERE deletedAt IS NULL`) || { c: 0, b: 0 };
