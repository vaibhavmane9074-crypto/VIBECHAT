/* VIBECHAT center list: search, filter chips, chats (unread/pin/typing/online), snaps + stories rows. */
import React, { useEffect, useMemo, useState } from 'react';
import { api, fmtAgo } from '../lib/api.js';
import { useApp } from '../state/store.jsx';
import { on } from '../lib/rt.js';

const FILTERS = [['all', 'All'], ['unread', 'Unread'], ['friends', 'Friends'], ['groups', 'Groups'], ['channels', 'Channels']];
const FILTER_TYPE = { friends: 'dm', groups: 'group', channels: 'channel' };

export default function ChatList() {
  const { user, chats, activeChat, setActiveChat, refreshChats, toast, searchQ, setSearchQ } = useApp();
  const [q, setQ] = useState('');
  const [typing, setTyping] = useState({});
  const [payload, setPayload] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const o1 = on('typing', ({ chatId, userId, typing: t }) => setTyping((s) => ({ ...s, [chatId + ':' + userId]: t ? Date.now() : 0 })));
    const o2 = on('message:new', () => refreshChats());
    const o3 = on('message:read', () => refreshChats());
    const iv = setInterval(() => setTyping((s) => ({ ...s })), 4000);
    return () => { o1?.(); o2?.(); o3?.(); clearInterval(iv); };
  }, [refreshChats]);

  const list = useMemo(() => {
    const f = (chats?.filter((c) => !c.archived) || []).filter((c) => (filter === 'all' ? true : filter === 'unread' ? c.unread > 0 : c.type === FILTER_TYPE[filter]));
    if (!q.trim()) return [...f].sort((a, b) => (b.pinned - a.pinned) || ((b.lastMessage?.createdAt || 0) - (a.lastMessage?.createdAt || 0)));
    const t = q.toLowerCase();
    return f.filter((c) => c.title?.toLowerCase().includes(t) || c.lastMessage?.body?.toLowerCase().includes(t));
  }, [chats, q, filter]);
  const active = list || [];
  const unreadTotal = (chats || []).filter((c) => !c.archived).reduce((n, c) => n + (c.unread || 0), 0);
  void payload;

  return (
    <section className="center glass">
      <div className="center-head">
        <input className="field search" placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="filter-row">
        {FILTERS.map(([id, label]) => (
          <button key={id} className={`fchip ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)}>
            {label}{id === 'unread' && unreadTotal > 0 ? <b>{unreadTotal > 99 ? '99+' : unreadTotal}</b> : null}
          </button>
        ))}
      </div>
      <div className="chat-scroll">
        {list.map((c) => {
          const other = c.type === 'dm' ? (c.members || []).find((m) => m.id !== user.id) : null;
          const tKey = Object.keys(typing).find((k) => k.startsWith(c.id + ':') && typing[k] && Date.now() - typing[k] < 6000);
          const isTyping = !!tKey && typing[tKey];
          return (
            <button key={c.id} className={`chat-row fades ${activeChat?.id === c.id ? 'on' : ''}`} onClick={() => setActiveChat(c)}>
              <div className="ava-wrap">
                <img className="avatar" width={44} height={44} src={c.type === 'dm' ? other?.avatar || '/api/users/x/avatar.svg' : c.avatar ? `/api/files/${c.avatarFileId}` : groupAvatar(c)} alt="" />
                {other?.online ? <span className="dot" /> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <span className="title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.type === 'dm' ? other?.displayName || 'Saved Notes' : `${iconFor(c.type)} ${c.title || 'Untitled'}`}
                  </span>
                  <span className="dim" style={{ fontSize: 11 }}>{c.lastMessage ? fmtAgo(c.lastMessage.createdAt) : ''}</span>
                </div>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <span className={`muted preview ${isTyping ? 'typing' : ''}`} style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {isTyping ? '✏️ typing…' : c.lastMessage ? `${c.lastMessage.mine ? (c.type === 'dm' ? '' : 'You: ') : ''}${c.lastMessage.body || ''}` : c.description || (c.type === 'channel' ? 'Channel' : '')}
                  </span>
                  <div className="row" style={{ gap: 6 }}>
                    {c.pinned ? <span title="Pinned">📌</span> : null}
                    {c.unread > 0 && <span className="unread">{c.unread > 99 ? '99+' : c.unread}</span>}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
        {!list.length && (
          <div style={{ padding: 26, textAlign: 'center' }} className="dim">
            {q ? 'Nothing found' : (
              <div>
                <p style={{ marginTop: 26, fontSize: 22 }}>👋</p>
                <p style={{ fontSize: 13 }}>No conversations yet.<br />Find friends in Contacts, or start <a className="link" onClick={() => window.__vcSetView?.('ai')}>Vibe AI</a>.</p>
              </div>
            )}
          </div>
        )}
      </div>
      <button className="fab" title="New chat" onClick={() => window.__vcSetView?.('contacts')}>✎</button>
    </section>
  );
}

const iconFor = (t) => ({ group: '🏕️', channel: '📣', community: '🌐', dm: '@' }[t] || '');
const groupAvatar = (c) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" fill="none"/><text x="50%" y="55%" font-size="34" text-anchor="middle" dominant-baseline="middle">${iconFor(c.type)}</text></svg>`)}`;
