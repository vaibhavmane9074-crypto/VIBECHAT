/* Calls history + quick-dial contacts; the actual call UX lives in CallOverlay (WebRTC). */
import React, { useEffect, useState } from 'react';
import { api, fmtAgo } from '../lib/api.js';
import { useApp } from '../state/store.jsx';

export default function CallsView() {
  const { chats, user, toast } = useApp();
  const [calls, setCalls] = useState([]);
  useEffect(() => { api('GET', '/api/calls', undefined, { fresh: true }).then((d) => setCalls(d.calls)).catch(() => {}); }, []);

  const contacts = chats.filter((c) => c.type === 'dm').map((c) => c.members.find((m) => m.id !== user.id)).filter(Boolean);

  return (
    <div className="panel-body">
      <div className="dim" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>QUICK CALL</div>
      <div className="row wrap" style={{ gap: 8 }}>
        {contacts.map((m) => (
          <button key={m.id} className="call-quick" onClick={() => window.__vcInitCall?.(m.id, 'audio')}>
            <img className="avatar" width={36} height={36} src={m.avatar} alt="" />
            <div style={{ fontSize: 11 }}>{m.displayName?.split(' ')[0]}</div>
            <span style={{ fontSize: 10 }}>📞 🎥</span>
          </button>
        ))}
        {!contacts.length && <div className="dim">Add contacts to start calls.</div>}
      </div>
      <div className="dim" style={{ fontSize: 12, fontWeight: 700, margin: '12px 0 4px' }}>HISTORY</div>
      {calls.map((c) => (
        <div key={c.id} className="row rec">
          <span>{c.outgoing ? '↗' : '↙'}</span>
          <img className="avatar" width={30} height={30} src={c.peer?.avatar || ''} alt="" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{c.peer?.displayName || 'Unknown'}</div>
            <div className="dim" style={{ fontSize: 11 }}>{c.type === 'video' ? '🎥 video' : '📞 audio'} · {c.status}{c.duration > 0 ? ` · ${Math.floor(c.duration / 60)}m ${c.duration % 60}s` : ''}</div>
          </div>
          <div className="spacer" />
          <small className="dim">{fmtAgo(c.startedAt)}</small>
          <button className="btn icon btn-sm" onClick={() => window.__vcInitCall?.(c.peer?.id, c.type)}>📞</button>
        </div>
      ))}
      {!calls.length && <div className="dim pad">No calls yet. WebRTC audio/video is ready — hit the call buttons in a DM header.</div>}
    </div>
  );
}
