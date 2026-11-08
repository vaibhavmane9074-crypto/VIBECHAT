/* VIBECHAT left rail: identity, nav, counts, quick actions. Responsive → bottom bar on mobile. */
import React from 'react';
import { useApp } from '../state/store.jsx';
import { api } from '../lib/api.js';
import { on } from '../lib/rt.js';
import { QrModal, ProfileMini } from './ProfileBits.jsx';

const NAV = [
  { id: 'chats', icon: '💬', label: 'Chats' },
  { id: 'snaps', icon: '📸', label: 'Snaps' },
  { id: 'stories', icon: '👥', label: 'Stories' },
  { id: 'contacts', icon: '🙋', label: 'Contacts' },
  { id: 'groups', icon: '🏕️', label: 'Groups' },
  { id: 'communities', icon: '🌐', label: 'Communities' },
  { id: 'channels', icon: '📣', label: 'Channels' },
  { id: 'ai', icon: '🤖', label: 'Vibe AI' },
  { id: 'calls', icon: '📞', label: 'Calls' },
  { id: 'media', icon: '🗂️', label: 'Media' },
  { id: 'archived', icon: '📦', label: 'Archive' },
];

const PRIMARY = ['chats', 'calls', 'snaps', 'contacts'];

const GLYPH = {
  chats: <path d="M4 5h16v11H9l-5 4V5z" />,
  calls: <path d="M6.5 3.5h3l1.5 4.5-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3a2 2 0 0 1-2 2A17 17 0 0 1 4.5 5.5a2 2 0 0 1 2-2z" />,
  snaps: <><rect x="3" y="7" width="18" height="13" rx="3" /><path d="M8.5 7l1.5-2.5h4L15.5 7" /><circle cx="12" cy="13.5" r="3.2" /></>,
  contacts: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c1.4-3.8 4.2-5.5 7.5-5.5s6.1 1.7 7.5 5.5" /></>,
  stories: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></>,
  admin: <path d="M12 3l7.5 3v5.5c0 4.4-3.2 7.9-7.5 9.5-4.3-1.6-7.5-5.1-7.5-9.5V6z" />,
};
function Glyph({ id, fallback }) {
  if (!GLYPH[id]) return <span>{fallback}</span>;
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPH[id]}
    </svg>
  );
}

export default function Sidebar() {
  const { user, setUser, view, setView, mUnread, unreadSnaps, toast, theme, setTheme } = useApp();

  const logout = async () => {
    try { await api('POST', '/api/auth/logout'); } catch {}
    window.location.reload();
  };

  return (
    <nav className="rail glass">
      <div className="rail-head">
        <ProfileMini user={user} />
      </div>
      <div className="rail-nav" style={{ overflowY: 'auto' }}>
        {NAV.map((n) => (
          <button
            key={n.id}
            data-tab={n.id}
            className={`rail-item ${view === n.id ? 'on' : ''} ${PRIMARY.includes(n.id) ? '' : 'secondary'}`}
            onClick={() => window.__vcSetView?.(n.id)}
            title={n.label}
          >
            <span className="rail-ico"><Glyph id={n.id} fallback={n.icon} /></span>
            <span className="rail-lab">{n.label}</span>
            {n.id === 'chats' && mUnread > 0 && <span className="count">{mUnread > 99 ? '99+' : mUnread}</span>}
            {n.id === 'snaps' && unreadSnaps > 0 && <span className="count">{unreadSnaps}</span>}
          </button>
        ))}
        <button data-tab="settings" className={`rail-item ${view === 'settings' ? 'on' : ''}`} onClick={() => window.__vcSetView?.('settings')} title="Settings">
          <span className="rail-ico"><Glyph id="settings" fallback="⚙️" /></span><span className="rail-lab">Settings</span>
        </button>
        {user && window.__vcIsAdmin?.() ? null : null}
        <button className={`rail-item secondary ${view === 'admin' ? 'on' : ''}`} onClick={async () => {
          try { await api('GET', '/api/admin/stats'); window.__vcSetView?.('admin'); }
          catch { toast('Admin area is restricted to administrators', 'warn'); }
        }}>
          <span className="rail-ico"><Glyph id="admin" fallback="🛡️" /></span><span className="rail-lab">Admin</span>
        </button>
      </div>
      <div className="rail-foot">
        <button className="btn ghost icon-sm" title={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? '🌙' : '☀️'}
        </button>
        <QrSmall />
        <button className="btn ghost icon-sm" title="Log out" onClick={logout}>🚪</button>
      </div>
    </nav>
  );
}

function QrSmall() {
  return (
    <button
      className="btn ghost icon-sm"
      title="Share my profile (QR)"
      onClick={async () => {
        window.__vcShowQR?.(window.__vcUser?.() || {});
      }}
    >🔗</button>
  );
}
void on;
