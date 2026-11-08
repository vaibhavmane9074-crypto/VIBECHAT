/* Admin dashboard: stats, users, reports, community management. Server verifies admin role on every call. */
import React, { useEffect, useState } from 'react';
import { api, fmtAgo, fmtSize } from '../lib/api.js';
import { useApp } from '../state/store.jsx';

export default function AdminView() {
  const { user, toast } = useApp();
  const [stats, setStats] = useState(null);
  const [tab, setTab] = useState('Overview');
  const [users, setUsers] = useState([]);
  const [reports, setReports] = useState([]);
  const [uq, setUq] = useState('');
  const [pending, setPending] = useState(null);

  useEffect(() => { if (user?.role !== 'admin') { setPending('Admin area is restricted.'); return; } load(); }, [user]);

  const load = async () => {
    try {
      setStats(null); setStats(await api('GET', '/api/admin/stats', undefined, { fresh: true }));
      setUsers((await api('GET', '/api/admin/users', undefined, { fresh: true })).users);
      setReports((await api('GET', '/api/admin/reports', undefined, { fresh: true })).reports);
    } catch (e) { setPending(e.message); }
  };

  if (pending && !stats) return <div className="pad fades"><h2>🛡 Admin</h2><div className="error-banner" style={{ marginTop: 10 }}>{pending}</div><p className="dim" style={{ fontSize: 12 }}>Bootstrap an admin with VC_ADMIN_EMAIL + VC_ADMIN_PASSWORD on the server, or claim via the specials table.</p></div>;

  const act = async (fn) => { try { await fn(); load(); } catch (e) { toast(e.message, 'warn'); } };

  return (
    <div className="panel-body">
      <div className="row chips-inline">
        {['Overview', 'Users', 'Reports'].map((t) => <button key={t} className={`chip ${tab === t ? 'acc' : ''}`} onClick={() => setTab(t)}>{t}</button>)}
        <div className="spacer" /><button className="btn ghost icon-sm" onClick={load}>↻</button>
      </div>
      {tab === 'Overview' && stats && (
        <div className="stat-grid">
          {[
            ['Users', `${stats.users.total}`, `${stats.users.online} online · ${stats.messages.total} msgs`],
            ['Messages 24h', `${stats.messages.last24h}`, `of ${stats.messages.total} total`],
            ['DMs', `${stats.chats.dms}`, `${stats.chats.groups} groups · ${stats.chats.channels} channels`],
            ['Communities', `${stats.chats.communities}`, `${stats.reports.open} open reports`],
            ['Live snaps', `${stats.files.snapsLive}`, `${stats.files.storiesLive} live stories`],
            ['Storage', fmtSize(stats.storageBytes), `${stats.files.count} files · ${stats.calls} calls`],
          ].map(([k, v, sub]) => (
            <div key={k} className="stat-card glass">
              <div style={{ fontSize: 20, fontWeight: 800 }}>{v}</div>
              <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>{k}</div>
              <div className="dim" style={{ fontSize: 10 }}>{sub}</div>
            </div>
          ))}
        </div>
      )}
      {tab === 'Users' && (<>
        <input className="field" placeholder="Filter users…" value={uq} onChange={(e) => setUq(e.target.value)} />
        {users.filter((u) => !uq || (u.username + u.displayName + u.email).toLowerCase().includes(uq.toLowerCase())).map((u) => (
          <div key={u.id} className="row rec">
            <img className="avatar" width={30} height={30} src={u.avatar || ''} alt="" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{u.displayName}{u.role === 'admin' ? ' 🛡' : ''}{u.deletedAt ? ' · 🗑 deleted' : ''}</div>
              <div className="dim" style={{ fontSize: 11 }}>@{u.username} · {u.email} · joined {fmtAgo(u.createdAt)}</div>
            </div>
            <div className="spacer" />
            <button className="btn ghost btn-sm" onClick={() => act(() => api('POST', `/api/admin/users/${u.id}/role`, { role: u.role === 'admin' ? 'user' : 'admin' }))}>{u.role === 'admin' ? 'Demote' : 'Promote'}</button>
            {u.deletedAt
              ? <button className="btn ghost btn-sm" onClick={() => act(() => api('POST', `/api/admin/users/${u.id}/unban`))}>Restore</button>
              : <button className="btn ghost btn-sm danger" onClick={() => act(() => api('POST', `/api/admin/users/${u.id}/ban`))}>🚫 Suspend</button>}
          </div>
        ))}
      </>)}
      {tab === 'Reports' && (reports.length ? reports.map((r) => (
        <div key={r.id} className="row rec">
          <span>🚩</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13 }}>{r.targetType}: {r.targetId}</div>
            <div className="dim" style={{ fontSize: 12 }}>{r.reason}</div>
          </div>
          <div className="spacer" /><small className="dim">{fmtAgo(r.createdAt)}</small>
          <button className="btn btn-sm" onClick={() => act(() => api('POST', `/api/admin/reports/${r.id}`, { status: 'dismissed' }))}>Dismiss</button>
        </div>
      )) : <div className="dim pad">No open reports 🎉</div>)}
    </div>
  );
}
void fmtSize;
