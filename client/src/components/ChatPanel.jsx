/* VIBECHAT chat panel: header, pinned bar, history (lazy), composer, message actions, media viewer, chat info. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, invalidate, fmtDay } from '../lib/api.js';
import { useApp } from '../state/store.jsx';
import { emit, on } from '../lib/rt.js';
import MediaViewer from './MediaViewer.jsx';
import MessageItem from './MessageItem.jsx';
import Composer from './Composer.jsx';
import { ChatInfo } from './FilesBar.jsx';

const PAGE = 40;

/* crisp line icons (no emoji) for the chat header */
function Ico({ children }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const PHONE = <path d="M6.5 3.5h3l1.5 4.5-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3a2 2 0 0 1-2 2A17 17 0 0 1 4.5 5.5a2 2 0 0 1 2-2z" />;
const VIDEO = <><rect x="3" y="6.5" width="12" height="11" rx="2.5" /><path d="M15 10.5l6-3.5v10l-6-3.5" /></>;
const BACK = <path d="M15 5l-7 7 7 7" />;
const FALLBACK = (icon) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" fill="rgba(124,92,255,0.15)"/><text x="50%" y="57%" font-size="30" text-anchor="middle" dominant-baseline="middle">${icon}</text></svg>`)}`;

export default function ChatPanel() {
  const { user, activeChat: chat, setActiveChat, refreshChats, wallpaper: globalWall } = useApp();
  const [msgs, setMsgs] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [typing, setTyping] = useState({});
  const topRef = useRef(null);
  const endRef = useRef(null);
  const oldLen = useRef(0);

  const other = useMemo(() => (chat?.type === 'dm' ? (chat.members || []).find((m) => m.id !== user.id) : null), [chat, user]);
  const selfNote = chat?.type === 'dm' && (chat.dmKey?.startsWith('self:') || !other);

  const load = useCallback(async (before) => {
    if (!chat) return;
    setLoading(true);
    const d = await api('GET', `/api/messages/${chat.id}?limit=${PAGE}${before ? `&before=${before}` : ''}`);
    setMsgs((m) => (before ? [...d.messages, ...m] : d.messages));
    setHasMore(d.hasMore);
    setLoading(false);
    invalidate('GET /api/chats');
  }, [chat?.id]);

  useEffect(() => {
    setMsgs([]); setHasMore(false); setInfo(false); setTyping({});
    load();
  }, [chat?.id]);

  /* realtime */
  useEffect(() => {
    if (!chat) return;
    const o1 = on('message:new', ({ message }) => {
      if (message && message.senderId !== user?.id && message.chatId === chat?.id) emit('message:delivered', { chatId: message.chatId });
      if (message.chatId !== chat.id) return;
      setMsgs((m) => (m.some((x) => x.id === message.id) ? m : [...m, message]));
      if (!message.mine) {
        api('POST', `/api/messages/${chat.id}/read`).catch(() => {});
        emit('message:read', { chatId: chat.id, upto: Date.now() });
      }
      refreshChats();
    });
    const o2 = on('message:update', (u) => {
      if (u.chatId !== chat.id) return;
      setMsgs((m) => m.map((x) => (x.id === u.id ? { ...x, ...u } : x)));
    });
    const o3 = on('typing', ({ userId, typing: t }) => setTyping((s) => ({ ...s, [userId]: t ? Date.now() : 0 })));
    return () => [o1, o2, o3].forEach((o) => o?.());
  }, [chat?.id, refreshChats]);

  /* autoscroll */
  useEffect(() => {
    const grew = msgs.length > oldLen.current;
    oldLen.current = msgs.length;
    if (grew) requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
  }, [msgs.length]);

  /* mark read on open */
  useEffect(() => {
    if (!chat) return;
    api('POST', `/api/messages/${chat.id}/read`).catch(() => {});
  }, [chat?.id]);

  /* typing expiry tick */
  useEffect(() => {
    const iv = setInterval(() => setTyping((s) => (Object.values(s).some(Boolean) ? { ...s } : s)), 3000);
    return () => clearInterval(iv);
  }, []);

  if (!chat) return null;
  const typingNow = Object.entries(typing).some(([uid, t]) => Number(uid) !== user.id && t && Date.now() - t < 6000);
  const pins = msgs.filter((m) => m.pinned);
  const wall = chat.wallpaper || globalWall;
  /* first message that arrived after I last read this chat */
  const myReadAt = (chat.members || []).find((x) => x.id === user?.id)?.lastReadAt || 0;
  const firstUnreadId = (msgs.find((x) => x.createdAt > myReadAt && x.senderId !== user?.id) || {}).id;
  const avatar = chat.type === 'dm' ? (other?.avatar || '/api/users/x/avatar.svg') : FALLBACK({ group: '🏕️', channel: '📣', community: '🌐' }[chat.type] || '#');
  const title = chat.type === 'dm' ? (selfNote ? 'Saved Notes' : other?.displayName || 'Direct chat') : chat.title || 'Untitled';
  const subtitle = selfNote ? 'Only you can see these'
    : chat.type === 'dm' ? (other?.online ? 'online' : other?.lastSeen ? `last seen ${fmtDay(other.lastSeen)}` : 'offline')
    : `${(chat.members || []).length} members`;

  return (
    <section className="chat-panel glass">
      <header className="chat-head">
        <button className="hbtn back" aria-label="Back" onClick={() => setActiveChat(null)}><Ico>{BACK}</Ico></button>
        <span className="hava">
          <img className="avatar" width={40} height={40} src={avatar} alt="" onClick={() => setInfo(true)} />
          {chat.type === 'dm' && other?.online && !selfNote ? <span className="hdot" title="Online" /> : null}
        </span>
        <div style={{ minWidth: 0, cursor: 'pointer' }} onClick={() => setInfo(true)}>
          <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          <div className="dim" style={{ fontSize: 11 }}>
            {subtitle}
            {typingNow ? <span className="typing"> · typing…</span> : ''}
          </div>
        </div>
        <div className="spacer" />
        {chat.type === 'dm' && !selfNote && (<>
          <button className="hbtn" title="Voice call" aria-label="Voice call" onClick={() => window.__vcInitCall?.(other.id, 'audio')}><Ico>{PHONE}</Ico></button>
          <button className="hbtn" title="Video call" aria-label="Video call" onClick={() => window.__vcInitCall?.(other.id, 'video')}><Ico>{VIDEO}</Ico></button>
        </>)}
        {chat.type === 'channel' ? null : <button className="btn ghost icon" title="Snaps" onClick={() => window.__vcOpenSnapCam?.()}>📸</button>}
      </header>

      {pins.length > 0 && (
        <div className="pins">📌 {pins.length} pinned message{pins.length > 1 ? 's' : ''}</div>
      )}

      <div className="msgs" ref={topRef} style={wall ? { background: wall } : undefined}>
        {hasMore && <div style={{ textAlign: 'center', padding: 6 }}><button className="chip" onClick={() => msgs[0] && load(msgs[0].createdAt)}>Load older</button></div>}
        {loading && <div className="spinner" style={{ margin: '18px auto' }} />}
        {!loading && msgs.map((m, i) => (
          <React.Fragment key={m.id}>
            {i === 0 || new Date(msgs[i - 1].createdAt).toDateString() !== new Date(m.createdAt).toDateString() ? (
              <div className="day-sep"><span>{dayLabel(m.createdAt)}</span></div>
            ) : null}
            {m.id === firstUnreadId ? <div className="unread-sep"><span>New messages</span></div> : null}
            <MessageItem m={m} chat={chat} refresh={load} />
          </React.Fragment>
        ))}
        {!loading && !msgs.length && (
          <div style={{ textAlign: 'center', marginTop: 40 }} className="dim">
            {selfNote ? '📝 Your private note space' : '✨ Say hello, share a file, or snap a vibe.'}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <Composer chat={chat} selfNote={selfNote} />
      {info && <ChatInfo chatId={chat.id} selfKey={selfNote} onClose={() => { setInfo(false); refreshChats(); }} />}
      {viewer && <MediaViewer src={viewer} onClose={() => setViewer(null)} />}
    </section>
  );
}

function dayLabel(t) {
  const d = new Date(t);
  const today = new Date().toDateString();
  const yest = new Date(Date.now() - 864e5).toDateString();
  if (d.toDateString() === today) return 'Today';
  if (d.toDateString() === yest) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
