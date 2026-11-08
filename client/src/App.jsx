/* VIBECHAT root — auth gate, app shell, global action bridges, forward/invite/QR flows. */
import React, { useEffect, useState } from 'react';
import { useApp } from './state/store.jsx';
import { api, invalidate } from './lib/api.js';
import { on, connect } from './lib/rt.js';
import { QrModal } from './components/ProfileBits.jsx';
import Auth from './pages/Auth.jsx';
import Sidebar from './components/Sidebar.jsx';
import ChatList from './components/ChatList.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import CallOverlay from './components/CallOverlay.jsx';
import PanelHost from './components/PanelHost.jsx';
import MediaViewer from './components/MediaViewer.jsx';
import { VibeMark } from './components/logos.jsx';

const TITLES = { chats: 'Chat', snaps: 'Snaps', stories: 'Stories', contacts: 'Contacts', groups: 'Groups', communities: 'Communities', channels: 'Channels', ai: 'Vibe AI', calls: 'Calls', media: 'Media', archived: 'Archive', notifications: 'Notifications', settings: 'Settings', admin: 'Admin', search: 'Search' };
const MORE_ITEMS = [['stories', 'Stories', '◎'], ['groups', 'Groups', '🏕️'], ['communities', 'Communities', '🌐'], ['channels', 'Channels', '📣'], ['ai', 'Vibe AI', '🤖'], ['media', 'Media', '🗂️'], ['archived', 'Archive', '📦'], ['settings', 'Settings', '⚙️'], ['admin', 'Admin', '🛡️']];

export default function App() {
  const { user, booting, toast, refreshChats, refreshSnaps, setView, setNotify, activeChat, setActiveChat, view } = useApp();
  const [moreOpen, setMoreOpen] = useState(false);
  const [fwdMsg, setFwdMsg] = useState(null);
  const [viewed, setViewed] = useState(null);
  const [qrMe, setQrMe] = useState(null);

  /* socket + user identity bridges */
  useEffect(() => { if (user) connect(); }, [user]);
  useEffect(() => {
    window.__vcUser = () => user;
    window.__vcIsAdmin = () => user?.role === 'admin';
  }, [user]);

  /* realtime wiring */
  useEffect(() => {
    if (!user) return;
    const offs = [
      on('notify', (n) => { setNotify(n); setTimeout(() => setNotify((cur) => (cur && cur.title === n.title ? null : cur)), 5000); invalidate('GET /api/notifications'); }),
      on('message:new', () => window.__vcRefreshChats?.()),
      on('message:read', () => window.__vcRefreshChats?.()),
      on('presence', () => window.__vcRefreshChats?.()),
      on('members:add', () => window.__vcRefreshChats?.()),
      on('members:remove', () => window.__vcRefreshChats?.()),
      on('chat:new', () => window.__vcRefreshChats?.()),
      on('snap:new', () => refreshSnaps()),
      on('snap:expired', () => refreshSnaps()),
      on('snap:opened', () => refreshSnaps()),
      on('story:new', () => invalidate('GET /api/snaps/stories')),
      on('contact:accepted', () => window.__vcRefreshChats?.()),
    ];
    return () => offs.forEach((o) => o?.());
  }, [user, refreshSnaps, refreshChats, setNotify]);

  /* global bridges (chat-free sidebar pages call these) */
  useEffect(() => {
    window.__vcSetView = (v) => setView(v);
    window.__vcGoSnaps = () => setView('snaps');
    window.__vcForward = (m) => setFwdMsg(m);
    window.__vcViewMedia = (f) => setViewed(f);
    window.__vcShowQR = () => setQrMe(window.__vcUser?.() || {});
    window.__vcShareProfile = () => {
      const me = window.__vcUser?.() || {};
      navigator.clipboard?.writeText(`${location.origin}/#/u/${me.id}`);
      toast('Profile link copied — share it to add me');
    };
    window.__vcOpenSnap = (id) => { setView('snaps'); setTimeout(() => window.__vcViewSnap?.(id), 260); };
    window.__vcOpenSnapCam = () => setView('snaps');
    window.__vcOpenChat = (c) => { setView('chats'); setActiveChat(c); };
    window.__vcAiRewrite = (body) => { setView('ai'); setTimeout(() => window.__vcAiFill?.(`Polish this message: ${body}`), 300); };
    return () => {};
  }, [toast, setView, setActiveChat]);

  /* deep links: #/invite/TOKEN and #/u/USERID */
  useEffect(() => {
    if (!user) return;
    const h = location.hash || '';
    const inv = h.match(/^#\/invite\/(.+)$/);
    const uidm = h.match(/^#\/u\/([a-f0-9]+)/);
    if (!inv && !uidm) return;
    history.replaceState(null, '', location.pathname);
    location.hash = '';
    (async () => {
      try {
        if (inv) {
          const d = await api('GET', `/api/chats/join/${inv[1]}`);
          toast(`Joined ${d.chat?.title || 'the chat'} 🎉`);
          await refreshChats();
          setActiveChat(d.chat); setView('chats');
        } else {
          const d = await api('POST', '/api/chats/dm', { userId: uidm[1] });
          await refreshChats();
          setActiveChat(d.chat); setView('chats');
          toast('Contact opened — say hi 👋');
        }
      } catch (e) { toast(e.message, 'warn'); }
    })();
  }, [user]);

  if (booting) return <div className="boot2" />;
  if (!user) return <Auth />;

  return (
    <div className="shell">
      <header className="topbar glass">
        <button className="circ" title="Settings" onClick={() => setView('settings')}>{(user?.displayName || user?.username || 'V').slice(0, 1).toUpperCase()}</button>
        <button className="circ" title="Search" onClick={() => setView('search')}>🔍</button>
        <div className="top-title">{TITLES[view] || 'VIBECHAT'}</div>
        <button className="circ" title="Notifications" onClick={() => setView('notifications')}>🔔</button>
        <button className="circ" title="Add friends" onClick={() => setView('contacts')}>➕</button>
        <button className="circ" title="More" onClick={() => setMoreOpen(true)}>⋯</button>
      </header>
      <div className={`cols ${activeChat ? 'chat-open' : ''}`}>
        <Sidebar />
        <ChatList />
        {activeChat ? <ChatPanel /> : (
          <section className="empty hear glass">
            <VibeMark size={72} />
            <h2>WELCOME</h2>
            <p>Pick a conversation, capture a snap, share a story, or ask Vibe AI something big.</p>
          </section>
        )}
      </div>
      {moreOpen && (
        <div className="sheet-veil" onClick={() => setMoreOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grab" />
            <div className="sheet-head">
              <div className="set-name">{user?.displayName || user?.username}</div>
              <div className="set-sub">@{user?.username}</div>
            </div>
            <div className="sheet-list">
              {MORE_ITEMS.map(([id, label, icon]) => (
                <button key={id} className="sheet-item" onClick={() => { setView(id); setMoreOpen(false); }}>
                  <span className="sheet-tile">{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="sheet-sep" />
            <div className="sheet-list">
              <button className="sheet-item danger" onClick={async () => { try { await api('POST', '/api/auth/logout'); } catch {} window.location.reload(); }}>
                <span className="sheet-tile">🚪</span>
                <span>Log out</span>
              </button>
            </div>
          </div>
        </div>
      )}
      <PanelHost />
      <CallOverlay />
      <ForwardModal msg={fwdMsg} onClose={() => setFwdMsg(null)} />
      {viewed && <MediaViewer src={viewed} onClose={() => setViewed(null)} />}
      {qrMe && <QrModal me={qrMe} onClose={() => setQrMe(null)} />}
      <Toaster />
    </div>
  );
}

function Toaster() {
  const { toasts } = useApp();
  return (
    <div className="toast-stack">
      {toasts.map((t) => <div key={t.id} className={`toast pop ${t.kind}`}>{t.msg}</div>)}
    </div>
  );
}

function ForwardModal({ msg, onClose }) {
  const { chats, toast, setActiveChat, setView, refreshChats } = useApp();
  const [sel, setSel] = useState({});
  const [busy, setBusy] = useState(false);
  if (!msg) return null;
  const targets = chats.filter((c) => c.type === 'dm' || c.type === 'group');
  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal-card pop" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>➡️ Forward</h3>
        <p className="dim" style={{ fontSize: 12 }}>"{(msg.body || '(media)').slice(0, 80)}"</p>
        <div className="recipient-list">
          {targets.map((c) => {
            const other = c.type === 'dm' ? (c.members || []).find((m) => m.id !== window.__vcUser?.()?.id) : null;
            return (
              <button key={c.id} className={`row rec ${sel[c.id] ? 'on' : ''}`} onClick={() => setSel({ ...sel, [c.id]: !sel[c.id] })}>
                <img className="avatar" width={30} height={30} src={other?.avatar || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"/>'} alt="" />
                <div>{other ? other.displayName : `🏕️ ${c.title || 'Group'}`}</div>
                <div className="spacer" />{sel[c.id] ? '✅' : ''}
              </button>
            );
          })}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={busy || !Object.values(sel).some(Boolean)} onClick={async () => {
            setBusy(true);
            try {
              const ids = Object.keys(sel).filter((k) => sel[k]);
              await api('POST', '/api/messages/forward', { messageId: msg.id, chatIds: ids });
              toast(`Forwarded to ${ids.length}`); invalidate('GET /api/chats'); refreshChats();
              onClose();
            } catch (e) { toast(e.message, 'warn'); }
            setBusy(false);
          }}>Send to {Object.values(sel).filter(Boolean).length || '…'}</button>
          <div className="spacer" /><button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
void ChatList; void ChatPanel; void Sidebar;
