/* Attachments preview bar + Chat details sheet (settings, members, invite link, disappearing timer, wallpaper). */
import React, { useEffect, useState } from 'react';
import { api, invalidate } from '../lib/api.js';
import { useApp } from '../state/store.jsx';

export function ChatInfo({ chatId, selfKey, onClose }) {
  const { user, toast, activeChat, refreshChats, wallpaper: gWall, setWallpaper } = useApp();
  const [details, setDetails] = useState(null);
  const [title, setTitle] = useState(activeChat?.title || '');
  const [desc, setDesc] = useState(activeChat?.description || '');
  const [thr, setThr] = useState(0);
  const [invite, setInvite] = useState(null);
  const canEdit = ['owner', 'admin'].includes(activeChat?.myRole) || activeChat?.type === 'group';

  useEffect(() => {
    (async () => {
      try {
        const d = await api('GET', `/api/chats/${chatId}`, undefined, { fresh: true });
        setDetails(d.chat); setTitle(d.chat.title || ''); setDesc(d.chat.description || '');
        setThr(d.chat.transientDisappearAfter || d.chat.disappearAfter || 0);
        if (d.chat.inviteToken) setInvite(d.chat.inviteToken);
      } catch (e) { toast(e.message, 'warn'); }
    })();
  }, [chatId]);

  if (!details) return null;

  const save = async () => {
    try {
      await api('PATCH', `/api/chats/${chatId}/settings`, { title, description: desc, disappearAfter: Number(thr) });
      invalidate('GET /api/chats'); refreshChats(); toast('Chat updated ✓');
      onClose();
    } catch (e) { toast(e.message, 'warn'); }
  };
  const genInvite = async () => { try { const d = await api('POST', `/api/chats/${chatId}/invite`); setInvite(d.inviteToken); } catch (e) { toast(e.message, 'warn'); } };
  const removeMember = async (id) => {
    try { await api('DELETE', `/api/chats/${chatId}/members/${id}`); setDetails((d) => ({ ...d, members: (d.members || []).filter((m) => m.id !== id) })); }
    catch (e) { toast(e.message, 'warn'); }
  };

  const wall = details.wallpaper || gWall;

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal-card pop" onClick={(e) => e.stopPropagation()}>
        <div className="row"><h3 style={{ margin: 0 }}>Chat details</h3><div className="spacer" /><button className="btn ghost icon-sm" onClick={onClose}>✕</button></div>

        {details.type !== 'dm' && (<>
          <label className="small">Name</label>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canEdit} />
          <label className="small">Description</label>
          <input className="field" value={desc} onChange={(e) => setDesc(e.target.value)} disabled={!canEdit} />
          <label className="small">Members ({(details.members || []).length})</label>
          <div className="member-list">
            {(details.members || []).map((m) => (
              <div key={m.id} className="row member">
                <img className="avatar" width={30} height={30} src={m.avatar || '/api/users/x/avatar.svg'} alt="" />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{m.displayName}</div>
                  <div className="dim" style={{ fontSize: 11 }}>{m.role}</div>
                </div>
                <div className="spacer" />
                {canEdit && m.id !== user.id && details.type === 'group' && (
                  <button className="btn ghost icon-sm danger" title="Remove" onClick={() => removeMember(m.id)}>🗑</button>
                )}
              </div>
            ))}
          </div>
          {details.type !== 'channel' && (
            <>
              <label className="small">Invite link</label>
              <div className="row">
                <input className="field mono grow" readOnly onFocus={(e) => e.target.select()}
                  value={invite ? `${location.origin}/#/invite/${invite}` : 'no link yet'} />
                <button className="btn" onClick={genInvite}>{invite ? '↻' : 'Create'}</button>
                {invite && <button className="btn" title="Copy" onClick={() => { navigator.clipboard?.writeText(`${location.origin}/#/invite/${invite}`); toast('Invite link copied'); }}>📋</button>}
              </div>
            </>
          )}
        </>)}

        {details.type === 'dm' && !selfKey && (
          <div className="pad" style={{ padding: '6px 0' }}>
            <div className="row" style={{ gap: 10 }}>
              <img className="avatar" width={54} height={54} src={details.members?.find((m) => m.id !== user.id)?.avatar || ''} alt="" />
              <div>
                <b>{details.members?.find((m) => m.id !== user.id)?.displayName}</b>
                <div className="dim" style={{ fontSize: 12 }}>@{details.members?.find((m) => m.id !== user.id)?.username}</div>
              </div>
            </div>
          </div>
        )}

        <label className="small">Disappearing messages (sent from now on)</label>
        <select className="field" value={thr} onChange={(e) => setThr(e.target.value)}>
          <option value={0}>Off</option>
          <option value={10}>10s after read</option>
          <option value={60}>1 min</option>
          <option value={300}>5 min</option>
          <option value={3600}>1 hr</option>
          <option value={86400}>24 hr</option>
        </select>

        <label className="small">Chat wallpaper</label>
        <div className="row wrap" style={{ gap: 8 }}>
          {WALLS.map((w, i) => (
            <button key={i} className="wall-dot" style={{ background: w || 'var(--bg-2)', border: wall === w ? '2px solid var(--accent)' : '1px solid var(--border)' }}
              onClick={() => setWallpaper(w)} />
          ))}
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={save}>{details.type === 'dm' ? 'Save timer' : 'Save'}</button>
          <div className="spacer" />
          {details.type !== 'dm' && (
            <button className="btn danger" onClick={async () => {
              if (!window.confirm('Leave this chat?')) return;
              try { await api('DELETE', `/api/chats/${chatId}/members/${user.id}`); onClose(); refreshChats(); toast('You left the chat'); }
              catch (e) { toast(e.message, 'warn'); }
            }}>Leave chat</button>
          )}
        </div>
      </div>
    </div>
  );
}

export const WALLS = ['', 'linear-gradient(160deg,#2b1f4d,#0d0c18)', 'linear-gradient(160deg,#0e2233,#0d0c18)', 'linear-gradient(160deg,#3a1226,#0d0c18)', 'repeating-linear-gradient(45deg,#12101f 0 22px,#171428 22px 44px)'];
void invalidate;
