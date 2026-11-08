/* VIBECHAT Stories: create (text/photo/video), rings, viewer, replies, viewer-list for my own. */
import React, { useEffect, useRef, useState } from 'react';
import { api, uploadFile, invalidate } from '../lib/api.js';
import { useApp } from '../state/store.jsx';

const BG = ['linear-gradient(160deg,#7c5cff,#ff5ca8)', 'linear-gradient(160deg,#0ea5e9,#34d399)', 'linear-gradient(160deg,#f59e0b,#ef4444)', 'linear-gradient(160deg,#111,#6e6a8a)'];

export default function StoriesView() {
  const { user, toast, chats, setActiveChat, setView } = useApp();
  const [data, setData] = useState({ mine: [], others: [], contacts: 0 });
  const [viewer, setViewer] = useState(null);    // {user, stories, idx}
  const [creating, setCreating] = useState(false);
  useEffect(() => { load(); }, []);

  const load = async () => { try { setData(await api('GET', '/api/snaps/stories', undefined, { fresh: true })); } catch {} };

  const openUser = (g) => { setViewer({ ...g, idx: 0 }); markSeen(g.stories[0]); };
  const markSeen = async (s) => { try { await api('POST', `/api/snaps/stories/${s.id}/view`); load(); } catch {} };

  const next = () => {
    if (!viewer) return;
    const i = viewer.idx + 1;
    if (i >= viewer.stories.length) { setViewer(null); return; }
    setViewer({ ...viewer, idx: i });
    markSeen(viewer.stories[i]);
  };

  return (
    <div className="stories-view">
      <div className="row" style={{ gap: 10, paddingBottom: 10 }}>
        <button className="btn primary" onClick={() => setCreating(true)}>＋ Create story</button>
        <button className="btn" onClick={load}>↻ Refresh</button>
      </div>
      <div className="dim" style={{ fontSize: 12, fontWeight: 700, marginTop: 6 }}>MY STORY</div>
      <div className="story-row">
        {data.mine.length ? data.mine.map((g) => (
          <button key={g.user.id} className="story-b" onClick={() => openUser(g)}>
            <div className="ring me">{g.stories.length}</div><span>My stories</span>
          </button>
        )) : <button className="story-b" onClick={() => setCreating(true)}><div className="ring add">＋</div><span>Add story</span></button>}
      </div>
      <div className="dim" style={{ fontSize: 12, fontWeight: 700, marginTop: 14 }}>FRIENDS</div>
      <div className="story-row">
        {data.others.map((g) => (
          <button key={g.user.id} className="story-b" onClick={() => openUser(g)}>
            <div className="ring"><img src={g.user.avatar} width={44} height={44} className="avatar" alt="" /></div>
            <span style={{ maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.user.displayName}</span>
          </button>
        ))}
        {!data.others.length && <span className="dim" style={{ fontSize: 12 }}>Friends' active stories appear here.</span>}
      </div>

      {creating && <CreateStory onDone={() => { setCreating(false); load(); }} />}

      {viewer && (
        <StoryViewer
          g={viewer}
          onNext={next}
          onClose={() => { setViewer(null); load(); }}
          onReact={async (emoji) => { try { const s = viewer.stories[viewer.idx]; await api('POST', `/api/snaps/stories/${s.id}/react`, { emoji }); toast('Reaction sent'); } catch (e) { toast(e.message, 'warn'); } }}
          onReply={async (body) => {
            const s = viewer.stories[viewer.idx];
            try {
              await api('POST', `/api/snaps/stories/${s.id}/reply`, { body });
              toast('Reply sent to DM');
              const d = await api('POST', '/api/chats/dm', { userId: viewer.user.id });
              setActiveChat(d.chat); setView('chats'); setViewer(null);
            } catch (e) { toast(e.message, 'warn'); }
          }}
        />
      )}
    </div>
  );
}

function CreateStory({ onDone }) {
  const { user, toast, chats } = useApp();
  const [type, setType] = useState('text');
  const [body, setBody] = useState('');
  const [bg, setBg] = useState(0);
  const [vis, setVis] = useState('contacts');
  const [aud, setAud] = useState([]);
  const [file, setFile] = useState(null);
  const fi = useRef();
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      let fileId;
      if (type !== 'text' && file) fileId = (await uploadFile(file)).id;
      await api('POST', '/api/snaps/stories', { type, body: type === 'text' ? body : (body || ''), bgColor: BG[bg], visibility: vis, audience: aud, fileId });
      toast('Story posted for 24h ✨');
      onDone();
    } catch (e) { toast(e.message, 'warn'); }
    setBusy(false);
  };

  return (
    <div className="modal-veil" onClick={onDone}>
      <div className="modal-card pop" onClick={(e) => e.stopPropagation()}>
        <h3>Create story <span className="chip">live 24h</span></h3>
        <div className="row" style={{ gap: 8 }}>
          {['text', 'photo', 'video'].map((t) => <button key={t} className={`chip ${type === t ? 'acc' : ''}`} onClick={() => setType(t)}>{t}</button>)}
        </div>
        {type === 'text' && (<>
          <textarea className="field" style={{ marginTop: 10 }} rows={2} value={body} onChange={(e) => setBody(e.target.value.slice(0, 300))} placeholder="What's the vibe?" autoFocus />
          <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
            {BG.map((b, i) => <button key={i} className="wall-dot" style={{ background: b, width: 40, height: 40, border: bg === i ? '2px solid #fff' : 'none' }} onClick={() => setBg(i)} />)}
          </div>
        </>)}
        {type !== 'text' && (
          <div className="row" style={{ marginTop: 10 }}>
            <input ref={fi} type="file" accept={type + '/*'} hidden onChange={(e) => setFile(e.target.files?.[0])} />
            <button className="btn" onClick={() => fi.current?.click()}>Select {type}</button>
            {file && <span className="chip">{file.name}</span>}
          </div>
        )}
        <label className="small">Who can see</label>
        <select className="field" value={vis} onChange={(e) => setVis(e.target.value)}>
          <option value="contacts">My contacts</option>
          <option value="custom">Custom audience…</option>
          <option value="public">Public (any registered user)</option>
        </select>
        {vis === 'custom' && (
          <div className="emoji-grid big" style={{ marginTop: 8 }}>
            {chats.filter((c) => c.type === 'dm').map((c) => c.members.find((m) => m.id !== user.id) || ({})).filter(Boolean).map((m) => (
              <button key={m.id} className={`chip ${aud.includes(m.id) ? 'acc' : ''}`} onClick={() => setAud(aud.includes(m.id) ? aud.filter((x) => x !== m.id) : [...aud, m.id])}>{m.displayName?.slice(0, 12)}</button>
            ))}
          </div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={busy || (type === 'text' && !body.trim())} onClick={create}>Post story</button>
          <div className="spacer" />
          {busy && <div className="spinner" />}
        </div>
      </div>
    </div>
  );
}

function StoryViewer({ g, onClose, onNext, onReact, onReply }) {
  const s = g.stories[g.idx];
  const [replying, setReplying] = useState('');
  const [viewers, setViewers] = useState(null);
  const my = g.user.id === window.__vcUser?.()?.id;
  useEffect(() => { setReplying(''); }, [g.idx]);
  return (
    <div className="modal-veil" style={{ background: '#000d' }}>
      <div className="story-viewer pop" style={{ background: s.bgColor || undefined }}>
        {s.type === 'photo' && <img src={s.media?.url} className="sv-media" alt="" />}
        {s.type === 'video' && <video src={s.media?.url} className="sv-media" autoPlay controls playsInline />}
        {s.type === 'text' && <div className="sv-text">{s.body}</div>}
        <div className="sv-top row">
          <button className="btn ghost" style={{ color: '#fff' }} onClick={() => { const i = g.idx - 1; if (i >= 0) onNextBack(g, i); else onClose(); }}>←</button>
          <div className="progress" style={{ flex: 1 }}>{g.stories.map((_, i) => <span key={i} className={i <= g.idx ? 'on' : ''} />)}</div>
          <button className="btn ghost" style={{ color: '#fff' }} onClick={onClose}>✕</button>
        </div>
        <div className="sv-bottom">
          {!my && (<>
            <div className="row rxrow">
              {['❤️', '🔥', '😂', '😮'].map((e) => <button key={e} className="rxb" onClick={() => onReact(e)}>{e}</button>)}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <input className="field" placeholder="Reply to story…" value={replying} onChange={(e) => setReplying(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && replying.trim()) onReply(replying.trim()); }} />
              <button className="btn primary" disabled={!replying.trim()} onClick={() => onReply(replying.trim())}>Send</button>
            </div>
          </>)}
          {my && s.viewersCount !== undefined && (
            <button className="btn" onClick={async () => { const d = await api('GET', `/api/snaps/stories/${s.id}/viewers`); setViewers(d.viewers); }}>{s.viewersCount} viewers 👁</button>
          )}
          {my && <button className="btn primary" onClick={onNext}>Next story →</button>}
        </div>
        {viewers && (
          <div className="viewer-list">
            <div className="row"><b style={{ color: '#fff' }}>Viewers</b><div className="spacer" /><button className="btn ghost icon-sm" onClick={() => setViewers(null)}>✕</button></div>
            {viewers.map((v) => (
              <div key={v.userId} className="row" style={{ padding: '4px 0' }}>
                <img className="avatar" width={26} height={26} src={v.avatarFileId ? `/api/files/${v.avatarFileId}` : ''} alt="" />
                <span style={{ color: '#fff', fontSize: 13 }}>{v.displayName}</span>
                <div className="spacer" />
                {v.reactions?.map((r, i) => <span key={i}>{r}</span>)}
              </div>
            ))}
            {!viewers.length && <div className="dim">No viewers yet!</div>}
          </div>
        )}
      </div>
    </div>
  );
  function onNextBack(g2, i) { g; window.__vcStoryBack?.(i); }
}
