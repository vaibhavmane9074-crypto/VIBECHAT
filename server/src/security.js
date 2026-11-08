/* VIBECHAT security & validation utilities: rate limiting, input validation, magic-byte sniffing, sanitisation. */

/* ---- rate limiter ---- */
const buckets = new Map();
setInterval(() => { const cutoff = Date.now() - 3600_000; for (const [k, b] of buckets) if (b.start < cutoff) buckets.delete(k); }, 600_000).unref();
export function rateLimit({ bucket, limit = 60, windowMs = 60_000 }) {
  return (req, res, next) => {
    const key = `${bucket}:${req.ip}`;
    const t = Date.now();
    let b = buckets.get(key);
    if (!b || t - b.start > windowMs) { b = { start: t, count: 0 }; buckets.set(key, b); }
    b.count++;
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - b.count));
    if (b.count > limit) return res.status(429).json({ error: 'Rate limit exceeded. Try again shortly.' });
    next();
  };
}

const s = (v) => typeof v === 'string';
export const V = {
  str: (v, { min = 0, max = 5000, name = 'value' } = {}) => {
    if (!s(v)) throw new ValidationError(`${name} must be a string`);
    const t = v.trim();
    if (t.length < min || t.length > max) throw new ValidationError(`${name} must be ${min}–${max} characters`);
    return t;
  },
  username: (v) => {
    const t = s(v) ? v.trim() : '';
    if (!/^[a-z0-9_]{3,24}$/.test(t)) throw new ValidationError('Username must be 3–24 chars: lowercase letters, numbers, underscore');
    return t;
  },
  email: (v) => {
    const t = s(v) ? v.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) || t.length > 254) throw new ValidationError('Enter a valid email address');
    return t;
  },
  password: (v) => {
    if (!s(v) || v.length < 8 || v.length > 128) throw new ValidationError('Password must be 8–128 characters');
    if (!/[a-zA-Z]/.test(v) || !/[0-9]/.test(v)) throw new ValidationError('Password needs at least one letter and one number');
    return v;
  },
  emoji: (v) => {
    if (!s(v) || v.length > 16) throw new ValidationError('Invalid emoji');
    return v;
  },
  limit: (v, allowed, { name = 'value', fallback = allowed?.[0] } = {}) => {
    if (!allowed.includes(v)) return fallback;
    return v;
  },
  int: (v, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const n = Math.trunc(Number(v));
    if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError('Invalid number');
    return n;
  },
};
export class ValidationError extends Error { status = 400 }

/* ---- magic-byte sniffing: content over claims, always ---- */
const MAGIC = [
  { bytes: [0x89, 0x50, 0x4e, 0x47], kind: 'image', mime: 'image/png', ext: 'png' },
  { bytes: [0xff, 0xd8, 0xff], kind: 'image', mime: 'image/jpeg', ext: 'jpg' },
  { bytes: [0x47, 0x49, 0x46, 0x38], kind: 'image', mime: 'image/gif', ext: 'gif' },
  { bytes: [0x42, 0x4d], kind: 'image', mime: 'image/bmp', ext: 'bmp' },
  { bytes: [0x49, 0x49, 0x2a, 0x00], kind: 'image', mime: 'image/tiff', ext: 'tif' },
  { bytes: [0x4d, 0x4d, 0x00, 0x2a], kind: 'image', mime: 'image/tiff', ext: 'tif' },
  { str: 'RIFF', offset: 8, bytes: [0x57, 0x45, 0x42, 0x50], kind: 'image', mime: 'image/webp', ext: 'webp' },
  { str: 'fTyp', offset: 4, kind: 'media', mime: 'video/mp4', ext: 'mp4' },
  { bytes: [0x1a, 0x45, 0xdf, 0xa3], kind: 'media', mime: 'video/webm', ext: 'webm' },
  { str: 'OggS', kind: 'media', mime: 'audio/ogg', ext: 'ogg' },
  { str: 'ID3', kind: 'media', mime: 'audio/mpeg', ext: 'mp3' },
  { bytes: [0xff, 0xfb], kind: 'media', mime: 'audio/mpeg', ext: 'mp3' },
  { str: 'fLaC', kind: 'media', mime: 'audio/flac', ext: 'flac' },
  { bytes: [0x1f, 0x8b], kind: 'archive', mime: 'application/gzip', ext: 'gz' },
  { str: 'PK', kind: 'archive', mime: 'application/zip', ext: 'zip' },
  { str: 'Rar!', kind: 'archive', mime: 'application/vnd.rar', ext: 'rar' },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf], kind: 'archive', mime: 'application/x-7z-compressed', ext: '7z' },
  { str: '%PDF', kind: 'document', mime: 'application/pdf', ext: 'pdf' },
];
const EIF = { bytes: [0x4d, 0x5a], kind: 'other', mime: 'application/vnd.android.package-archive', ext: 'apk' }; // MZ: APK/DLL/EXE

const extKind = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', tiff: 'image', tif: 'image', heic: 'image', avif: 'image',
  mp4: 'video', mkv: 'video', mov: 'video', avi: 'video', webm: 'video', '3gp': 'video',
  mp3: 'audio', wav: 'audio', aac: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', opus: 'audio',
  pdf: 'document', doc: 'document', docx: 'document', xls: 'document', xlsx: 'document', ppt: 'document', pptx: 'document', txt: 'document', csv: 'document', rtf: 'document',
  html: 'code', css: 'code', js: 'code', ts: 'code', jsx: 'code', tsx: 'code', json: 'code', xml: 'code', py: 'code', c: 'code', cpp: 'code', java: 'code', php: 'code', sql: 'code', sh: 'code', md: 'code', yaml: 'code', yml: 'code', toml: 'code',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', apk: 'archive',
};
const codeMime = { txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', json: 'application/json', xml: 'application/xml', yaml: 'text/yaml', yml: 'text/yaml', toml: 'text/plain', html: 'text/plain', css: 'text/css', js: 'text/javascript', ts: 'text/plain', jsx: 'text/plain', tsx: 'text/plain', py: 'text/plain', c: 'text/plain', cpp: 'text/plain', java: 'text/plain', php: 'text/plain', sql: 'text/plain', sh: 'text/x-shellscript' };

/**
 * Classify an upload: sniff magic bytes first; fall back to client claims.
 * Executable/script content is NEVER served with an active MIME — see storage.serveHeaders.
 */
export function classify(buf, declaredName, declaredMime) {
  const name = String(declaredName || 'file').slice(0, 180).replace(/[\\/]/g, '_').replace(/[\u0000-\u001f]/g, '') || 'file';
  const ext = (name.split('.').pop() || '').toLowerCase();
  let hit = null;
  for (const m of MAGIC) {
    const sig = m.str ? Buffer.from(m.str) : Buffer.from(m.bytes || []);
    if (buf && buf.length >= (m.offset || 0) + sig.length && !Buffer.compare(buf.subarray((m.offset || 0), (m.offset || 0) + sig.length), sig)) {
      // RIFF container: WEBP flavour is at bytes 8..12; raw RIFF without WEBP falls through
      if (m.str === 'RIFF' && buf.subarray(8, 12).toString('latin1') !== 'WEBP') continue;
      hit = m; break;
    }
  }
  if (!hit && buf?.length >= 2) {
    for (const e of [EIF]) {
      if (Buffer.compare(buf.subarray(0, 2), Buffer.from(e.bytes)) === 0) hit = e; break;
    }
  }
  let kind = extKind[ext] || 'other';
  let mime = hit?.mime || (codeMime[ext]) || declaredMime || 'application/octet-stream';
  if (hit) {
    if (hit.kind === 'media') kind = extKind[ext] || (mime.startsWith('audio') ? 'audio' : mime.startsWith('image') ? 'image' : 'video');
    else kind = hit.kind;
  }
  if (mime.startsWith('image/') && !['image/png','image/jpeg','image/gif','image/webp','image/bmp','image/tiff','image/avif','image/x-icon'].includes(mime)) mime = 'image/png';
  // never honour active-browser mimes
  if (['text/html','application/xhtml+xml','image/svg+xml','application/javascript','text/javascript','text/x-javascript'].includes(mime)) mime = 'text/plain';
  return { name, ext, kind, mime, sniffed: !!hit, size: buf?.length || 0 };
}

/** Per-storage serving policy — active content is never served with an active MIME. */
export function serveHeaders(kind, mime, name, download) {
  const inlineSafe =
    (kind === 'image' && ['image/png','image/jpeg','image/gif','image/webp','image/bmp','image/tiff','image/avif'].includes(mime)) ||
    kind === 'video' || kind === 'audio' ||
    mime === 'application/pdf' ||
    (kind === 'document' && (mime.startsWith('text/') || mime === 'application/json')) ||
    (kind === 'code' && mime.startsWith('text/'));
  return {
    'Content-Type': inlineSafe ? mime : 'application/octet-stream',
    'Content-Disposition': `${!download && inlineSafe ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'",
  };
}
