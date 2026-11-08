/* VIBECHAT frontend client library — same-origin API wrapper (httpOnly cookie sessions). */
export class ApiError extends Error {
  constructor(status, body) { super(body?.error || `Request failed (${status})`); this.status = status; this.body = body; }
}
const cache = new Map();
export async function api(method, path, body, opts = {}) {
  const key = method + path + JSON.stringify(body || '');
  if (method === 'GET' && !opts.fresh && cache.has(key)) {
    const hit = cache.get(key);
    if (Date.now() - hit.t < 15000) return hit.data;
    cache.delete(key);
  }
  if (opts.invalidate) for (const k of cache.keys()) if (k.startsWith(opts.invalidate)) cache.delete(k);
  void key || 0;
  const head = {};
  if (body !== undefined && !(body instanceof ArrayBuffer)) head['content-type'] = 'application/json';
  if (opts.headers) Object.assign(head, opts.headers);
  const r = await fetch(path, {
    method,
    headers: head,
    body: body === undefined ? undefined : typeof body === 'string' || body instanceof ArrayBuffer ? body : JSON.stringify(body),
  });
  let data = null;
  const text = await r.text();
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text?.slice(0, 200) }; }
  if (!r.ok) throw new ApiError(r.status, data);
  if (method === 'GET') cache.set(key, { data, t: Date.now() });
  return data;
}
export const invalidate = (prefix) => { if (prefix) for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k); };
export function uploadFile(file, name) {
  return new Promise((resolve, reject) => {
    const fileName = name || file.name || 'file';
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = await api('POST', '/api/files', reader.result, {
          invalidate: 'GET /api/files',
          headers: { 'x-file-name': encodeURIComponent(fileName), 'x-file-type': file.type || '' },
        });
        resolve(data.file);
      } catch (e) { reject(e); }
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsArrayBuffer(file);
  });
}
export const fmtSize = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1e9 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1e9).toFixed(2)} GB`;
export const fmtTime = (t) => { const d = new Date(t); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
export const fmtDay = (t) => { const d = new Date(t); const today = new Date(); const y = new Date(today.getTime() - 864e5); return d.toDateString() === today.toDateString() ? fmtTime(t) : d.toDateString() === y.toDateString() ? `Yesterday ${fmtTime(t)}` : `${d.toDateString().slice(0, 3)} ${d.getDate()}, ${fmtTime(t)}`; };
export const fmtAgo = (t) => {
  if (!t) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
};
export const snapStateIcon = { delivered: 'sent', opened: 'view', replayed: 'view', expired: 'timer' };
