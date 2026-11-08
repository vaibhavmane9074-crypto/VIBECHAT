/* VIBECHAT composer: text, drafts, emoji/stickers, GIF-lite, universal file attach, voice record,
 * camera snap, poll creator, location (consent), AI assist, scheduled send. */
import React, { useEffect, useRef, useState } from 'react';
import { api, uploadFile, invalidate } from '../lib/api.js';
import { useApp } from '../state/store.jsx';
import { emit } from '../lib/rt.js';

const EMO = ['😀','😂','🥲','😍','🥳','😎','🤔','😴','😭','😤','🤯','🥺','😇','🫡','🙌','👏','👍','👎','🙏','💪','👻','💀','🤖','🎉','❤️','🔥','✨','🌈','⭐','🍕','🍰','☕','🏖️','🚀','🎮','🎧','💜','⚡','🌙','☀️'];
const STICKERS = ['👋','🐸','🦄','🐙','🦋','🌟','🎈','🥇','🍩','🍪','🐼','🫶'];

export default function Composer({ chat, selfNote }) {
  const { user, toast, refreshChats } = useApp();
  const [text, setText] = useState('');
  const [reply, setReply] = useState(null);
  const [picker, setPicker] = useState(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [extra, setExtra] = useState(null);
  const inputRef = useRef(null);
  const finputRef = useRef(null);
  const recRef = useRef({});
  const chunks = useRef([]);
  void selfNote;

  /* drafts/typing reset per chat */
  useEffect(() => { setText(''); setReply(null); setFiles([]); setExtra(null); }, [chat?.id]);

  /* app-wide reply bridge */
  useEffect(() => {
    window.__vcReplyHandler = (r) => { if (r.chatId !== chat.id) return toast('Reply targets a different conversation', 'warn'); setReply(r); };
    window.__vcReply = window.__vcReplyHandler;
    return () => { if (window.__vcReply === window.__vcReplyHandler) window.__vcReply = null; };
  }, [chat?.id, toast]);

  const onType = (v) => {
    setText(v.slice(0, 4000));
    emit('typing', { chatId: chat.id, typing: true });
    clearTimeout(recRef.t);
    recRef.t = setTimeout(() => emit('typing', { chatId: chat.id, typing: false }), 1800);
  };

  const refresh = () => { invalidate('GET /api/chats'); refreshChats(); };

  const doSend = async (payload) => {
    await api('POST', '/api/messages/send', { chatId: chat.id, replyTo: reply?.id, ...payload });
    refresh();
  };

  const send = async () => {
    if (busy || (!text.trim() && !files.length)) return;
    busyCheck(true);
    try {
      const note = text.trim();
      for (const f of files) {
        const type = ({ image: 'image', video: 'video', audio: 'audio', document: 'file', code: 'file', archive: 'file' })[f.kind] || 'file';
        await doSend({ type, fileId: f.id, body: f.name });
      }
      if (note) await doSend({ type: 'text', body: note });
      setText(''); setFiles([]); setReply(null);
      inputRef.current?.focus();
    } catch (e) { toast(e.message, 'warn'); }
    busyCheck(false);
  };
  function busyCheck(v) { setBusy(v); }

  /* universal file attach — server sniffs magic bytes, any extension accepted */
  const attach = async (list) => {
    for (const file of [...list].slice(0, 8)) {
      try {
        const f = await uploadFile(file);
        setFiles((x) => [...x, f]);
      } catch (e) { toast(`${file.name}: ${e.message}`, 'warn'); }
    }
  };

  /* voice recording */
  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      recRef.current = { mr, secs: 0, stream, timer: null };
      chunks.current = [];
      mr.ondataavailable = (e) => chunks.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(recRef.current.timer);
        setRecording(false); setRecSecs(0);
        const type = mr.mimeType || 'audio/webm';
        const blob = new Blob(chunks.current, { type });
        if (blob.size < 900) return toast('Recording too short');
        const f = await uploadFile(new File([blob], `voice-${Date.now()}.${type.includes('mp4') ? 'm4a' : 'webm'}`, { type }));
        await doSend({ type: 'voice', fileId: f.id, body: `Voice note (${recRef.current.secs}s)` });
      };
      mr.start();
      recRef.current.timer = setInterval(() => setRecSecs((recRef.current.secs += 1)), 1000);
      setRecording(true);
    } catch { toast('Microphone permission denied', 'warn'); }
  };
  const stopRec = () => { try { recRef.current.mr.stop(); } catch {} };

  const schedule = async (mins) => {
    if (!text.trim()) return toast('Write the message first', 'warn');
    try { await doSend({ type: 'text', body: text, scheduledFor: Date.now() + mins * 60000 }); setText(''); toast(`📤 Scheduled in ${mins}m`); }
    catch (e) { toast(e.message, 'warn'); }
    setExtra(null);
  };

  const aiAssist = async () => {
    setAiBusy(true);
    try {
      const d = await api('POST', '/api/ai/assist', { kind: text.trim() ? 'grammar' : 'write', text: text || 'a warm hello to a friend' });
      setText((t) => (t.trim() ? d.text : d.text.startsWith('Hello') ? d.text : `${d.text}`));
      toast(`🤖 ${d.provider || 'local'} assist`);
    } catch (e) { toast(e.message, 'warn'); }
    setAiBusy(false);
  };

  const sendLocation = () => {
    if (!window.confirm('Share your current location in this chat?')) return;
    navigator.geolocation.getCurrentPosition(async (p) => {
      try { await doSend({ type: 'location', lat: p.coords.latitude, lng: p.coords.longitude }); }
      catch (e) { toast(e.message, 'warn'); }
    }, () => toast('Could not read location', 'warn'), { enableHighAccuracy: true, timeout: 8000 });
  };

  return (
    <div className="composer">
      {reply && (
        <div className="reply-bar fades">
          <div className="row" style={{ minWidth: 0 }}>
            <span>↩️</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700 }} className="dim">{reply.sender}</div>
              <div style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 300 }}>{(reply.body || '(media)').slice(0, 90)}</div>
            </div>
          </div>
          <button className="btn ghost icon-sm" onClick={() => setReply(null)}>✕</button>
        </div>
      )}

      {files.length > 0 && (
        <div className="files-bg fades">
          {files.map((f) => (
            <div key={f.id} className="file-p row">
              <span>{({ image: '🖼️', video: '🎬', audio: '🎵', document: '📄', code: '💻', archive: '🗜️' }[f.kind]) || '📎'}</span>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>{f.name}</span>
              <button className="btn ghost icon-sm" onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}>✕</button>
            </div>
          ))}
        </div>
      )}

      {recording ? (
        <div className="row" style={{ padding: '10px 14px' }}>
          <span className="recdot" /> Recording… {recSecs}s
          <div className="spacer" />
          <button className="btn danger" onClick={stopRec}>■ Stop &amp; send</button>
        </div>
      ) : (
        <>
          {picker === 'emoji' && <EmojiPad list={EMO} pick={(e) => setText((t) => t + e)} close={() => setPicker(null)} />}
          {picker === 'sticker' && <EmojiPad big list={STICKERS} pick={async (s) => { try { await doSend({ type: 'sticker', body: s }); } catch (e) { toast(e.message, 'warn'); } setPicker(null); }} close={() => setPicker(null)} />}
          {picker === 'gif' && <GifPick pick={async (s) => { try { await doSend({ type: 'gif', body: s }); } catch (e) { toast(e.message, 'warn'); } setPicker(null); }} close={() => setPicker(null)} />}
          {extra === 'poll' && <PollCreator close={() => setExtra(null)} onSend={async (title, options) => { try { await doSend({ type: 'poll', title, options }); } catch (e) { toast(e.message, 'warn'); } setExtra(null); }} />}
          {extra === 'sched' && <SchedulePick on={schedule} close={() => setExtra(null)} />}

          <div className="c-row">
            <button className="btn ghost icon" title="Emoji" onClick={() => setPicker(picker === 'emoji' ? null : 'emoji')}>😊</button>
            <button className="btn ghost icon" title="Stickers" onClick={() => setPicker(picker === 'sticker' ? null : 'sticker')}>🧿</button>
            <button className="btn ghost icon" title="GIF board" onClick={() => setPicker(picker === 'gif' ? null : 'gif')}>🎞️</button>
            <button className="btn ghost icon" title="Attach any file" onClick={() => finputRef.current?.click()}>📎</button>
            <input hidden multiple ref={finputRef} type="file" onChange={async (e) => { await attach(e.target.files || []); e.target.value = ''; }} />
            {user && (<>
              <button className="btn ghost icon" title="Camera / snap" onClick={() => window.__vcOpenSnapCam?.()}>📷</button>
              <button className="btn ghost icon" title="Poll" onClick={() => setExtra(extra === 'poll' ? null : 'poll')}>📊</button>
              <button className="btn ghost icon" title="Share location (with consent)" onClick={sendLocation}>📍</button>
              <button className="btn ghost icon" title="Schedule send" onClick={() => setExtra(extra === 'sched' ? null : 'sched')}>⏰</button>
            </>)}
            <input
              ref={inputRef}
              className="field grow"
              placeholder={chat.type === 'channel' ? 'Broadcast to subscribers…' : 'Message…'}
              value={text}
              onChange={(e) => onType(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              autoFocus
            />
            <button className="btn icon ghost" title="AI polish" onClick={aiAssist} disabled={aiBusy}>{aiBusy ? '⏳' : '🤖'}</button>
            {text.trim() || files.length ? (
              <button className="btn icon primary" onClick={send} disabled={busy} title="Send (Enter)">{busy ? '…' : '➤'}</button>
            ) : (
              <button className="btn icon primary" onClick={startRec} title="Record voice">🎙️</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EmojiPad({ list, pick, close, big }) {
  return (
    <div className="emoji-pad pop glass">
      <div className="row" style={{ padding: '4px 10px 0' }}><div className="spacer" /><button className="btn ghost icon-sm" onClick={close}>✕</button></div>
      <div className={`emoji-grid ${big ? 'big' : ''}`}>
        {list.map((e, i) => <button key={i} onClick={() => pick(e)}>{e}</button>)}
      </div>
    </div>
  );
}

function GifPick({ pick, close }) {
  const presets = ['🎉 party', '🥳 yay!', '🐱 cat crush', '😂 dead', '🔥 too hot', '🚀 ship it', '🙌 well done', '💌 love note', '😎 cool kid', '🤝 deal'];
  return (
    <div className="modal-veil" onClick={close}>
      <div className="modal-card pop" onClick={(e) => e.stopPropagation()}>
        <h3>🎞️ Vibe stamps</h3>
        <p className="dim" style={{ fontSize: 12 }}>Pick a stamp to send as an animated-style message. Full GIF search can be wired to a provider key (env GIF_TENOR_KEY) later.</p>
        <div className="emoji-grid big">{presets.map((p) => <button key={p} onClick={() => pick(p)}>{p}</button>)}</div>
      </div>
    </div>
  );
}

function PollCreator({ onSend, close }) {
  const [title, setTitle] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const ok = title.trim() && opts.filter((o) => o.trim()).length >= 2;
  return (
    <div className="modal-veil" onClick={close}>
      <div className="modal-card pop" onClick={(e) => e.stopPropagation()}>
        <h3>📊 Create poll</h3>
        <label className="small">Question</label>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Pizza or sushi?" autoFocus />
        {opts.map((o, i) => (
          <input key={i} className="field" style={{ marginTop: 8 }} value={o} placeholder={`Option ${i + 1}`}
            onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} />
        ))}
        {opts.length < 12 && <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setOpts([...opts, ''])}>+ option</button>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={!ok} onClick={() => onSend(title.trim(), opts.filter((o) => o.trim()))}>Create</button>
          <div className="spacer" /><button className="btn ghost" onClick={close}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function SchedulePick({ on, close }) {
  return (
    <div className="modal-veil" onClick={close}>
      <div className="modal-card pop" onClick={(e) => e.stopPropagation()}>
        <h3>⏰ Schedule send</h3>
        <div className="row wrap" style={{ marginTop: 10 }}>
          {[1, 5, 15, 60, 240].map((m) => <button key={m} className="btn" onClick={() => on(m)}>{m < 60 ? `${m} min` : `${m / 60} hr${m > 60 ? 's' : ''}`}</button>)}
        </div>
      </div>
    </div>
  );
}
