/* Global search: users, chats, messages (filters), files. */
import React, { useEffect, useState } from 'react';
import { api, fmtAgo, fmtSize } from '../lib/api.js';
import { useApp } from '../state/store.jsx';

const TYPES = ['all', 'messages', 'chats', 'users', 'files'];

export default function SearchView() {
  const { toast, setActiveChat, setView } = useApp();
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [res, setRes] = useState({ users: [], chats: [], messages: [], files: [], total: 0 });
  const [busy, setBusy] = useState(false);
  void toast; void setBusy;

  useEffect(() => {
    if (q.trim().length < 2) return setRes({ users: [], chats: [], messages: [], files: [], total: 0 });
    const t = setTimeout(async () => {
      try {
        const d = await api('GET', `/api/search?q=${encodeURIComponent(q.trim())}&type=${type}`, undefined, { fresh: true });
        setRes(d);
      } catch (e) { toast(e.message, 'warn'); }
    }, 280);
    return () => clearTimeout(t);
  }, [q, type]);

  const goChat = (c) => { setView('chats'); setActiveChat(c); };

  return (
    <div className="panel-body">
      <input className="field search" placeholder="Search everything — messages, people, chats, files…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="row wrap" style={{ margin: '8px 0' }}>
        {TYPES.map((t) => <button key={t} className={`chip ${type === t ? 'acc' : ''}`} onClick={() => setType(t)}>{t}</button>)}
      </div>

      {res.messages.map((m) => (
        <button key={m.id + m.chatId} className="row rec" onClick={() => goChat({ ...m, id: m.chatId })}>
          <span>💬</span>
          <div style={{ minWidth: 0, textAlign: 'left' }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{m.chatTitle} · {m.sender?.displayName}</div>
            <div className="dim" style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.body}</div>
          </div>
          <div className="spacer" /><small className="dim">{fmtAgo(m.createdAt)}</small>
        </button>
      ))}

      {res.chats.map((c) => (
        <button key={c.id} className="row rec" onClick={() => goChat(c)}>
          <span>{c.type === 'channel' ? '📣' : '🏕️'}</span>
          <div style={{ textAlign: 'left', minWidth: 0 }}><b style={{ fontSize: 13 }}>{c.title}</b>{c.lastMessage && <div className="dim" style={{ fontSize: 12 }}>{c.lastMessage.body?.slice(0, 60)}</div>}</div>
        </button>
      ))}

      {res.users.map((u) => (
        <button key={u.id} className="row rec" onClick={async () => {
          try { const d = await api('POST', '/api/chats/dm', { userId: u.id }); goChat(d.chat); }
          catch (e) { toast(e.message, 'warn'); }
        }}>
          <img className="avatar" width={30} height={30} src={u.avatar} alt="" />
          <div style={{ textAlign: 'left' }}><b style={{ fontSize: 13 }}>{u.displayName}</b> <span className="dim">@{u.username}</span></div>
        </button>
      ))}

      {res.files.map((f) => (
        <a key={f.id} className="row rec" href={f.url} target="_blank" rel="noreferrer">
          <span>{({ image: '🖼️', video: '🎬', audio: '🎵', document: '📄', code: '💻', archive: '🗜️' }[f.kind]) || '📎'}</span>
          <div style={{ minWidth: 0 }}><div style={{ fontSize: 13 }}>{f.name}</div><div className="dim" style={{ fontSize: 11 }}>{fmtSize(f.size)}</div></div>
        </a>
      ))}

      {q.trim().length >= 2 && !res.total && <div className="dim pad">No results for “{q}”.</div>}
    </div>
  );
}
