/* Archived chats list. */
import React, { useState } from 'react';
import { api, fmtAgo } from '../lib/api.js';
import { useApp } from '../state/store.jsx';

export default function ArchiveView() {
  const { chats, setActiveChat, setView, toast, refreshChats } = useApp();
  const [busy, setBusy] = useState(false);
  const archived = chats.filter((c) => c.archived);
  return (
    <div className="panel-body">
      {archived.map((c) => (
        <div key={c.id} className="row rec">
          <span>📦</span>
          <div style={{ minWidth: 0, textAlign: 'left' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{c.title || 'Saved Notes'}</div>
            <div className="dim" style={{ fontSize: 11 }}>{c.lastMessage ? fmtAgo(c.lastMessage.createdAt) : ''}</div>
          </div>
          <div className="spacer" />
          <button className="btn btn-sm" disabled={busy} onClick={async () => { setBusy(true); try { await api('PATCH', `/api/chats/${c.id}/archive`, { archived: false }); await refreshChats(); } catch (e) { toast(e.message, 'warn'); } setBusy(false); }}>Unarchive</button>
          <button className="btn icon btn-sm" onClick={() => { setView('chats'); setActiveChat(c); }}>Open</button>
        </div>
      ))}
      {!archived.length && <div className="dim pad">Archive is empty. Long-press conversations in the list to archive them.</div>}
    </div>
  );
}
