/* Contacts: directory search, lookup by @username, requests, contact list with actions. */
import React, { useEffect, useState } from 'react';
import { api, invalidate } from '../lib/api.js';
import { useApp } from '../state/store.jsx';

export default function ContactsView() {
  const { toast, setActiveChat, setView } = useApp();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState([]);
  const [list, setList] = useState({ contacts: [], incoming: [], outgoing: [] });
  const [tab, setTab] = useState('contacts');

  const loadAll = async () => { try { setList(await api('GET', '/api/users/contacts', undefined, { fresh: true })); } catch {} };
  useEffect(() => { loadAll(); }, []);
  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) return setUsers([]);
      try {
        const d = await api('GET', `/api/users?q=${encodeURIComponent(q.trim())}`, undefined, { fresh: true });
        setUsers(d.users || []);
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const dm = async (u) => {
    try { const d = await api('POST', '/api/chats/dm', { userId: u.id }); setView('chats'); setActiveChat(d.chat); }
    catch { toast('Only their contacts can message this person — send a contact request first', 'warn'); }
  };

  return (
    <div className="panel-body">
      <input className="field search" placeholder="Search by name, @username or full email" value={q} onChange={(e) => setQ(e.target.value)} />
      {q.trim().length >= 2 && !users.length && <div className="dim pad">No users match “{q}”.</div>}
      {users.map((u) => (
        <button key={u.id} className="row rec" onClick={() => dm(u)}>
          <img className="avatar" width={34} height={34} src={u.avatar} alt="" />
          <div style={{ minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{u.displayName}</div><div className="dim" style={{ fontSize: 11 }}>@{u.username}{u.online ? ' · online' : ''}</div></div>
          <div className="spacer" /><span>💬</span>
        </button>
      ))}

      <div className="row chips-inline" style={{ margin: '12px 0 6px' }}>
        {['contacts', 'requests in', 'sent'].map((t, i) => (
          <button key={t} className={`chip ${tab === ['contacts', 'requests in', 'sent'][i] ? 'acc' : ''}`} onClick={() => setTab(i === 1 ? 'requests in' : t)}>{t}{t === 'requests in' && list.incoming.length ? ` (${list.incoming.length})` : ''}</button>
        ))}
      </div>

      {tab === 'contacts' && list.contacts.map((u) => (
        <div key={u.id} className="row rec">
          <img className="avatar" width={34} height={34} src={u.avatar} alt="" />
          <div style={{ minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{u.displayName}</div><div className="dim" style={{ fontSize: 11 }}>@{u.username}{u.blocked ? ' · blocked' : u.online ? ' · online' : ''}</div></div>
          <div className="spacer" />
          <button className="btn icon primary btn-sm" title="Message" onClick={() => dm(u)}>💬</button>
        </div>
      ))}

      {tab === 'requests in' && (list.incoming.length ? list.incoming.map((r) => (
        <div key={r.id} className="row rec">
          <img className="avatar" width={34} height={34} src={r.user?.avatar || ''} alt="" />
          <div style={{ minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{r.user?.displayName}</div><div className="dim" style={{ fontSize: 11 }}>@{r.user?.username}</div></div>
          <div className="spacer" />
          <button className="btn icon btn-sm" title="Accept" onClick={async () => { await api('POST', '/api/users/contacts/respond', { requestId: r.id, action: 'accept' }); loadAll(); invalidate('GET /api/users/contacts'); }}>✅</button>
          <button className="btn icon ghost btn-sm" title="Decline" onClick={async () => { await api('POST', '/api/users/contacts/respond', { requestId: r.id, action: 'decline' }); loadAll(); }}>✖</button>
        </div>
      )) : <div className="dim pad">No incoming requests.</div>)}

      {tab === 'sent' && (list.outgoing.length ? list.outgoing.map((r) => (
        <div key={r.id} className="row rec"><span className="dim">⏳ {r.user?.displayName} · awaiting action</span></div>
      )) : <div className="dim pad">No outgoing requests.</div>)}

      <UserPeek />
    </div>
  );
}

function UserPeek() { void 0; return <UserCardBox />; }
function UserCardBox() { void 0; return null; }
