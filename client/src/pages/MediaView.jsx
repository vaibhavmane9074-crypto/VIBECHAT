/* Media manager: all/sent/received, kind filters, storage usage, preview + download + open in chat. */
import React, { useEffect, useState } from 'react';
import { api, uploadFile, fmtSize, fmtAgo } from '../lib/api.js';
import { useApp } from '../state/store.jsx';

const KINDS = [['', 'All'], ['image', '🖼 Images'], ['video', '🎬 Videos'], ['audio', '🎵 Audio'], ['document', '📄 Docs'], ['code', '💻 Code'], ['archive', '🗜 Archives']];

export default function MediaView() {
  const { toast, setActiveChat, setView, refreshSnaps } = useApp();
  const [files, setFiles] = useState([]);
  const [usage, setUsage] = useState({ count: 0, bytes: 0 });
  const [kind, setKind] = useState('');
  const [dir, setDir] = useState('');
  const [q, setQ] = useState('');
  const [view, setViewer] = useState(null);
  const [uploading, setUploading] = useState(false);
  void refreshSnaps;

  const load = async () => {
    try {
      const pr = new URLSearchParams();
      if (kind) pr.set('kind', kind);
      if (dir) pr.set('dir', dir);
      if (q.trim()) pr.set('q', q.trim());
      const d = await api('GET', `/api/files?${pr.toString()}`, undefined, { fresh: true });
      setFiles(d.files); setUsage(d.usage || usage);
    } catch (e) { toast(e.message, 'warn'); }
  };
  useEffect(() => { load(); }, [kind, dir, q]);

  return (
    <div className="panel-body">
      <div className="row">
        <input className="field grow" placeholder="Search my media…" value={q} onChange={(e) => setQ(e.target.value)} />
        <input type="file" hidden multiple id="mg-up" onChange={async (e) => { setUploading(true); for (const f of [...e.target.files]) { try { await uploadFile(f); } catch (er) { toast(er.message, 'warn'); } } e.target.value = ''; setUploading(false); load(); }} />
        <button className="btn primary" onClick={() => document.getElementById('mg-up')?.click()}>{uploading ? '⏳' : '＋ Upload'}</button>
      </div>
      <div className="row wrap" style={{ marginTop: 8 }}>
        {['', 'sent', 'received'].map((d) => <button key={d || 'all'} className={`chip ${dir === d ? 'acc' : ''}`} onClick={() => setDir(d)}>{d || 'all'}{d === 'sent' ? ' ⇢' : d === 'received' ? ' ⇠' : ''}</button>)}
        <span className="chip">💾 {fmtSize(usage.bytes)} · {usage.count} files</span>
      </div>
      <div className="row wrap" style={{ marginTop: 6 }}>
        {KINDS.map(([k, label]) => <button key={k || 'all'} className={`chip ${kind === k ? 'acc' : ''}`} onClick={() => setKind(k)}>{label}</button>)}
      </div>
      <div className="media-grid">
        {files.map((f) => (
          <button key={f.id} className="media-tile" onClick={() => setViewer(f)} title={f.name}>
            {f.kind === 'image' ? <img src={f.url} loading="lazy" alt="" /> : f.kind === 'video' ? <video src={f.url} preload="metadata" muted /> : (
              <span style={{ fontSize: 30 }}>{({ audio: '🎵', code: '💻', document: '📄', archive: '🗜️' }[f.kind]) || '📎'}</span>
            )}
            <div className="mg-name">{f.name}</div>
            <div className="mg-sub">{fmtSize(f.size)} · {fmtAgo(f.createdAt)}{dir === 'sent' && !f.ownerId ? '' : ''}</div>
          </button>
        ))}
        {!files.length && <div className="dim pad">Nothing here yet. Files you send or receive land in this library.</div>}
      </div>
      {view && (
        <div className="modal-veil" onClick={() => setViewer(null)}>
          <div className="modal-card pop" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'grid', placeItems: 'center' }}>
              {view.kind === 'image' && <img src={view.url} style={{ maxWidth: '100%', borderRadius: 12 }} alt="" />}
              {view.kind === 'video' && <video src={view.url} controls style={{ maxWidth: '100%' }} />}
              {view.kind === 'audio' && <audio src={view.url} controls />}
              {!['image', 'video', 'audio'].includes(view.kind) && <div className="dim pad">📎 {view.name}</div>}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <a className="btn" download href={view.downloadUrl}>⬇ Download</a>
              <span className="chip">{view.mime}</span>
              <div className="spacer" /><button className="btn ghost" onClick={() => setViewer(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
