/* Groups + Communities + Channels pages live here (re-export helpers in CommunitiesView.jsx / ChannelsView.jsx). */
import React, { useEffect, useState } from 'react';
import { api, invalidate, uploadFile } from '../lib/api.js';
import { useApp } from '../state/store.jsx';

export default function GroupsView() {
  const { chats, setActiveChat, setView, refreshChats, toast, user } = useApp();
  const [creating, setCreating] = useState(false);
  const [list, setList] = useState([]);
  useEffect(() => { setList(chats.filter((c) => c.type === 'group')); }, [chats]);

  return (
    <div className="panel-body">
      <button className="btn primary wide" onClick={() => setCreating(true)}>🏕️ Create group</button>
      {list.map((g) => (
        <GroupRow key={g.id} g={g} open={async () => { const d = await api('GET', `/api/chats/${g.id}`); setActiveChat(d.chat); setView('chats'); }} />
      ))}
      {!list.length && <div className="dim pad">No groups yet — create your first group space.</div>}
      {creating && <CreateGroup onClose={() => setCreating(false)} />}
    </div>
  );
}

function GroupRow({ g, open }) {
  const { activeChat } = useApp();
  return (
    <button className="row rec" onClick={open}>
      <img className="avatar" width={34} height={34} src={g.avatar ? `/api/files/${g.avatarFileId}` : 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" rx="20" fill="rgba(124,92,255,0.2)"/><text x="50%" y="58%" font-size="17" text-anchor="middle">🏕️</text></svg>`)} alt="" />
      <div style={{ minWidth: 0, textAlign: 'left' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{g.title}</div>
        <div className="dim" style={{ fontSize: 11 }}>{(g.members || []).length} members {g.mine ? '' : ''}{g.myRole ? ` · ${g.myRole}` : ''}{activeChat?.id === g.id ? ' · open' : ''}</div>
      </div>
      <div className="spacer" />{g.unread > 0 && <span className="unread">{g.unread}</span>}<span>›</span>
    </button>
  );
}

function CreateGroup({ onClose }) {
  const { chats, toast, user, refreshChats, setActiveChat, setView } = useApp();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [sel, setSel] = useState({});
  const contacts = chats.filter((c) => c.type === 'dm').map((c) => c.members.find((m) => m.id !== user.id)).filter(Boolean);
  const [busy, setBusy] = useState(false);
  const [avatarFileId, setAvatarFileId] = useState(null);

  const create = async () => {
    setBusy(true);
    try {
      const d = await api('POST', '/api/chats/group', { title: title.trim(), description: desc, memberIds: Object.keys(sel).filter((k) => sel[k]), avatarFileId });
      await refreshChats(); invalidate('GET /api/chats');
      setActiveChat(d.chat); setView('chats'); onClose(); toast('Group created 🎉');
    } catch (e) { toast(e.message, 'warn'); }
    setBusy(false);
  };

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal-card pop" onClick={(e) => e.stopPropagation()}>
        <h3>Create group</h3>
        <div className="row" style={{ gap: 12 }}>
          <AvatarPick onPicked={setAvatarFileId} />
          <div style={{ flex: 1 }}>
            <label className="small">Group name</label>
            <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Vibe Squad" autoFocus />
          </div>
        </div>
        <label className="small">Description</label>
        <input className="field" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What is this group about?" />
        <label className="small">Add members</label>
        <div className="member-list" style={{ maxHeight: 180 }}>
          {contacts.map((m) => (
            <button key={m.id} className={`row rec ${sel[m.id] ? 'on' : ''}`} onClick={() => setSel({ ...sel, [m.id]: !sel[m.id] })}>
              <img className="avatar" width={28} height={28} src={m.avatar} alt="" />{m.displayName}<div className="spacer" />{sel[m.id] ? '✅' : ''}
            </button>
          ))}
          {!contacts.length && <div className="dim pad">Add contacts first to invite them.</div>}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={busy || title.trim().length < 1} onClick={create}>Create</button>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function AvatarPick({ onPicked }) {
  const { toast } = useApp();
  const ref = React.useRef();
  const [url, setUrl] = useState(null);
  return (<>
    <button className="btn" style={{ padding: 4 }} onClick={() => ref.current?.click()} title="Upload avatar">
      {url ? <img className="avatar" width={44} height={44} src={url} alt="" /> : <div style={{ width: 44, height: 44, display: 'grid', placeItems: 'center' }}>🖼️</div>}
    </button>
    <input ref={ref} type="file" accept="image/*" hidden onChange={async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try { const fd = await uploadFile(f); setUrl(`/api/files/${fd.id}`); onPicked(fd.id); } catch (er) { toast(er.message, 'warn'); }
    }} />
  </>);
}

/* ---------------- communities ---------------- */
export function CommunitiesPage() {
  const { user, toast, setActiveChat, setView } = useApp();
  const [list, setList] = useState({ mine: [], discover: [] });
  const [creating, setCreating] = useState(false);
  const load = async () => { try { setList(await api('GET', '/api/chats/communities/list', undefined, { fresh: true })); } catch {} };
  useEffect(() => { load(); }, []);
  return (
    <div className="panel-body">
      <button className="btn primary wide" onClick={() => setCreating(true)}>🌐 Create community</button>
      <div className="dim" style={{ fontSize: 12, fontWeight: 700, marginTop: 10 }}>MY COMMUNITIES</div>
      {list.mine.map((c) => (
        <button key={c.id} className="row rec" onClick={async () => { const d = await api('GET', `/api/chats/communities/${c.id}/chats`); if (d.chats[0]) { setActiveChat(d.chats[0]); setView('chats'); } }}>
          <span>🌐</span><div style={{ textAlign: 'left', minWidth: 0 }}><b style={{ fontSize: 13 }}>{c.name}</b><div className="dim" style={{ fontSize: 11 }}>{c.role}</div></div>
        </button>
      ))}
      <div className="dim" style={{ fontSize: 12, fontWeight: 700, marginTop: 10 }}>DISCOVER PUBLIC</div>
      {list.discover.map((c) => (
        <button key={c.id} className="row rec" onClick={async () => { await api('POST', `/api/chats/communities/${c.id}/join`); toast('Joined ' + c.name); load(); refreshAcross(); }}>
          <span>🌐</span><div style={{ textAlign: 'left', minWidth: 0 }}><b style={{ fontSize: 13 }}>{c.name}</b><div className="dim" style={{ fontSize: 11 }}>{c.memberCount} members</div></div>
          <div className="spacer" /><span className="chip">Join</span>
        </button>
      ))}
      {creating && <CreateCommunity onClose={() => { setCreating(false); load(); }} />}
    </div>
  );
}
const refreshAcross = () => window.__vcRefreshChats?.();

function CreateCommunity({ onClose }) {
  const { toast } = useApp();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const create = async () => {
    try { await api('POST', '/api/chats/communities', { name, description: desc, isPublic }); toast('Community created'); onClose(); refreshAcross(); } catch (e) { toast(e.message, 'warn'); }
  };
  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal-card pop" onClick={(e) => e.stopPropagation()}>
        <h3>New community</h3>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoFocus />
        <input className="field" style={{ marginTop: 8 }} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description" />
        <div className="row" style={{ marginTop: 8 }}>
          <span className="chip">Public discovery {isPublic ? 'on' : 'off (invite-only)'}</span>
          <button className="btn ghost" onClick={() => setIsPublic(!isPublic)}>Toggle</button>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={!name.trim()} onClick={create}>Create</button>
          <div className="spacer" />
        </div>
      </div>
    </div>
  );
}

/* ---------------- channels ---------------- */
export function ChannelsPage() {
  const { chats, setActiveChat, setView, user, toast, refreshChats } = useApp();
  const [creating, setCreating] = useState(false);
  const myChannels = chats.filter((c) => c.type === 'channel');
  const [all, setAll] = useState([]);
  const load = async () => { try { setAll(await api('GET', '/api/chats', undefined, { fresh: true }).then((d) => d.chats.filter((c) => c.type === 'channel'))); } catch {} };
  useEffect(() => { load(); }, [chats]);

  return (
    <div className="panel-body">
      <button className="btn primary wide" onClick={() => setCreating(true)}>📣 Create channel</button>
      <div className="dim" style={{ fontSize: 12, fontWeight: 700, margin: '10px 0 4px' }}>SUBSCRIBED</div>
      {myChannels.map((c) => (
        <button key={c.id} className="row rec" onClick={() => { setView('chats'); setActiveChat(c); }}>
          <span>📣</span><div style={{ textAlign: 'left', minWidth: 0 }}><b style={{ fontSize: 13 }}>{c.title}</b><div className="dim" style={{ fontSize: 11 }}>{c.myRole ? c.myRole : 'subscriber'}</div></div>
          <div className="spacer" />{c.unread > 0 && <span className="unread">{c.unread}</span>}
        </button>
      ))}
      {creating && <CreateChannel onClose={() => { setCreating(false); refreshChats(); }} />}
    </div>
  );
}

function CreateChannel({ onClose }) {
  const { toast, user, refreshChats } = useApp();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const create = async () => {
    try { await api('POST', '/api/chats/channel', { title: title.trim(), description: desc }); await refreshChats(); toast('Channel created — invite people via the share sheet'); onClose(); } catch (e) { toast(e.message, 'warn'); }
  };
  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal-card pop" onClick={(e) => e.stopPropagation()}>
        <h3>New channel</h3>
        <p className="dim" style={{ fontSize: 12 }}>Admin-only posting: subscribers read everything, only you and admins can post.</p>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Channel name" autoFocus />
        <input className="field" style={{ marginTop: 8 }} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="About" />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={!title.trim()} onClick={create}>Create</button>
          <div className="spacer" />
        </div>
      </div>
    </div>
  );
}
