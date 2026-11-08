/* Notification center + call history strip. */
import React, { useEffect, useState } from 'react';
import { api, fmtAgo } from '../lib/api.js';
import { useApp } from '../state/store.jsx';

export default function NotificationsView() {
  const { toast, setActiveChat, setView, refreshChats } = useApp();
  const [list, setList] = useState([]);
  useEffect(() => { load(); }, []);
  const load = async () => { try { setList((await api('GET', '/api/notifications', undefined, { fresh: true })).notifications); } catch (e) { toast(e.message, 'warn'); } };
  return (
    <div className="panel-body">
      <button className="btn" onClick={async () => { try { await api('POST', '/api/notifications/read'); load(); } catch (e) { toast(e.message, 'warn'); } }}>✓ Mark all read</button>
      {list.map((n) => (
        <button key={n.id} className={`row rec ${n.readAt ? '' : 'unread-row'}`} onClick={async () => {
          try { await api('POST', '/api/notifications/read', { id: n.id }); } catch {}
          if (n.chatId) { setView('chats'); setActiveChat({ id: n.chatId }); window.__vcRefreshChats?.(); }
          load();
        }}>
          <span>{({ message: '💬', friend: '🙋', invite: '➕', snap: '📸', story: '⭐', react: '❤️', call: '📞' }[n.type]) || '🔔'}</span>
          <div style={{ minWidth: 0, textAlign: 'left' }}>
            <div style={{ fontSize: 13, fontWeight: 650 }}>{n.title}</div>
            {n.body && <div className="dim" style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.body}</div>}
          </div>
          <div className="spacer" />
          <small className="dim">{fmtAgo(n.createdAt)}</small>
        </button>
      ))}
      {!list.length && <div className="dim pad">No notifications yet — they land here when friends message you.</div>}
      <div className="hairline" />
      <button className="btn ghost btn-sm" onClick={() => { setView('calls'); }}>📞 Call history →</button>
    </div>
  );
}
