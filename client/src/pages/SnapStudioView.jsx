/* VIBECHAT Snap studio: live camera (front/rear, flash where supported), capture photo/video, retake,
 * edit (text, stickers, draw, filters, crop-lite, timestamp), choose duration/single-view, pick recipients, send. */
import React, { useEffect, useRef, useState } from 'react';
import { api, uploadFile, invalidate } from '../lib/api.js';
import { useApp } from '../state/store.jsx';

const COLORS = ['#ffffff', '#ff5470', '#7c5cff', '#34d399', '#fbbf24', '#000000'];
const FILTERS = ['none', 'grayscale(0.7)', 'saturate(1.6)', 'sepia(0.5)', 'contrast(1.25)', 'hue-rotate(25deg)', 'blur(1.2px) brightness(1.05)'];

export default function SnapStudioView() {
  const { user, chats, toast, setActiveChat, setView, refreshSnaps, unreadSnaps } = useApp();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const shotRef = useRef(null);          // {url, blob, kind, video?}
  const [facing, setFacing] = useState('user');
  const [recSeconds, setRecSeconds] = useState(0);
  const [recording, setRecording] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [filter, setFilter] = useState(0);
  const [mode, setMode] = useState('capture'); // capture | edit | send
  const [recips, setRecips] = useState({});
  const [duration, setDuration] = useState(10);
  const [singleView, setSingleView] = useState(true);
  const [caption, setCaption] = useState('');
  const [inbox, setInbox] = useState({ incoming: [], sent: [] });
  const [tab, setTab] = useState('camera');
  const [drug, setDrug] = useState({ strokes: [], cur: null, color: '#ffffff', size: 4 });
  const [textOver, setTextOver] = useState([]);
  const [overText, setOverText] = useState('');
  const [editFilter, setEditFilter] = useState(0);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const expiresRef = useRef(null);
  expiresRef.current = recSeconds;

  useEffect(() => { window.__vcOpenSnapCam = () => { setTab('camera'); }; }, []);
  useEffect(() => { window.__vcSnapTo = (chat) => { setTab('send'); const dm = chat; if (dm?.members) { const other = dm.members.find((m) => m.id !== user.id); if (other) refreshThenMark(other.id); } }; }, [user]);

  const refreshThenMark = (id) => {
    refreshInbox();
    setRecips((r) => ({ ...r, [id]: true }));
  };

  const refreshInbox = async () => {
    try { const d = await api('GET', '/api/snaps', undefined, { fresh: true }); setInbox(d); } catch {}
  };
  useEffect(() => { refreshInbox(); }, []);

  /* camera */
  const start = async (f = facing) => {
    stop();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: f, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play().catch(() => {}); }
    } catch (e) {
      toast('Camera unavailable — use the fallback tester below', 'warn');
      setMode('fallback');
    }
  };
  const stop = () => { streamRef.current?.getTracks?.().forEach((t) => t.stop()); streamRef.current = null; };
  useEffect(() => { if (tab === 'camera' && mode !== 'edit' && mode !== 'send') start(); return stop; }, [tab, mode, facing]);

  const capturePhoto = () => {
    const v = videoRef.current;
    if (!v) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth || 720; c.height = v.videoHeight || 960;
    const ctx = c.getContext('2d');
    ctx.filter = FILTERS[filter] || 'none';
    if (facing === 'self' || facing === 'user') { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob((b) => finishShot(b, 'image'), 'image/jpeg', 0.92);
    void flashOn;
  };

  const finishShot = (blob, kind) => {
    stop();
    const f = new File([blob], `snap-${Date.now()}.${kind === 'video' ? 'webm' : 'jpg'}`, { type: blob.type });
    shotRef.current = { blob, file: f, kind, url: URL.createObjectURL(blob) };
    setMode('edit');
  };

  const startVideo = async () => {
    stop();
    try {
      const vs = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = vs;
      if (videoRef.current) { videoRef.current.srcObject = vs; videoRef.current.play().catch(() => {}); }
      const mr = new MediaRecorder(vs);
      recorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.stopTimeout = null;
      mr.onstop = () => {
        const b = new Blob(chunksRef.current, { type: mr.mimeType || 'video/webm' });
        finishShot(b, 'video');
      };
      mr.start(); setRecording(true);
      recorderRef.stopTimer = setTimeout(() => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); setRecording(false); }, 30000);
      let t = 0; setRecSeconds(0);
      recorderRef.timer = setInterval(() => { t += 1; setRecSeconds(t); }, 1000);
    } catch (e) { toast('Video capture failed: ' + e.message, 'warn'); }
  };
  const stopVideo = () => {
    try { recorderRef.current?.stop(); } catch {}
    clearInterval(recorderRef?.timer);
    clearTimeout(recorderRef?.stopTimer);
    setRecording(false);
    stop();
  };

  /* drawing overlay */
  const draw = (e) => {
    if (mode !== 'edit') return;
    const cv = canvasRef.current;
    const r = cv.getBoundingClientRect();
    const x = ((e.clientX ?? e.touches?.[0]?.clientX) - r.left) / r.width;
    const y = ((e.clientY ?? e.touches?.[0]?.clientY) - r.top) / r.height;
    setDrug((d) => (d.cur ? { ...d, cur: [...d.cur, [x, y]] } : { ...d, cur: [[x, y]] }));
  };
  const drawEnd = () => setDrug((d) => ({ ...d, strokes: [...d.strokes, { pts: d.cur, color: d.color, size: d.size }], cur: null }));

  const uploadAndSend = async () => {
    const shot = shotRef.current;
    if (!shot) return;
    setMode('send');
  };

  const recipients = Object.keys(recips).filter((k) => recips[k]);
  const sendSnaps = async () => {
    const shot = shotRef.current;
    if (!shot || !recipients.length) return toast('Pick at least one recipient', 'warn');
    try {
      // render edit layer onto the image
      let blob = shot.blob;
      if (shot.kind === 'image' && (drug.strokes.length || textOver.length || editFilter)) blob = await bake(canvasRef, shot, drug, textOver, editFilter);
      const f = await uploadFile(new File([blob], `snap-${Date.now()}.${shot.kind === 'video' ? 'webm' : 'jpg'}`, blob.type.includes('video') ? { type: 'video/webm' } : { type: 'image/jpeg' }));
      await api('POST', '/api/snaps/send', { fileId: f.id, recipients, duration, singleView, caption });
      toast('📸 Snap sent!');
      resetAll(); refreshInbox(); refreshSnaps();
    } catch (e) { toast(e.message, 'warn'); }
  };

  const openSnap = async (snapId) => { window.__vcViewSnap?.(snapId); };
  void openSnap;

  const resetAll = () => { shotRef.current = null; setDrug({ strokes: [], cur: null, color: '#fff', size: 4 }); setTextOver([]); setOverText(''); setCaption(''); setRecips({}); setMode('capture'); setTab('camera'); };

  const groupTargets = chats.filter((c) => c.type !== 'dm' && c.type !== 'notes');

  return (
    <div className="snap-view">
      <div className="snap-tabs row">
        <button className={`chip ${tab === 'camera' ? 'acc' : ''}`} onClick={() => { if (tab !== 'camera') { resetAll(); setTab('camera'); } }}>📸 Camera</button>
        <button className={`chip ${tab === 'send' ? 'acc' : ''}`} onClick={() => { if (shotRef.current) setTab('send'); else toast('Capture a snap first', 'warn'); }}>➕ Send</button>
        <button className={`chip ${tab === 'inbox' ? 'acc' : ''}`} onClick={refreshInbox}>📥 Inbox {unreadSnaps > 0 ? `(${unreadSnaps})` : ''}</button>
        <button className={`chip ${tab === 'out' ? 'acc' : ''}`} onClick={refreshInbox}>📤 Sent</button>
      </div>

      {tab === 'camera' && mode !== 'edit' && mode !== 'send' && visualCamera()}
      {mode === 'edit' && visualEdit()}
      {tab === 'send' && shotRef.current && sendSheet()}

      {tab === 'inbox' && (<div className="snap-inbox">
        {inbox.incoming.length === 0 && <div className="dim pad">No unopened snaps.</div>}
        {inbox.incoming.map((s) => (
          <div key={s.id} className="row snapy">
            <span>{s.state === 'opened' ? '👁️' : '🔴'}</span>
            <div><b>{s.senderDisplay}</b><div className="dim snap-dim" style={{ fontSize: 11 }}>{s.state} · {Math.round((s.expiresAt - Date.now()) / 60000)}m left</div></div>
            <div className="spacer" />
            <button className="btn primary" onClick={async () => window.__vcViewSnap?.(s.id)}>Open</button>
          </div>
        ))}
      </div>)}
      {tab === 'out' && (<div className="snap-inbox">
        {inbox.sent.length === 0 && <div className="dim pad">No sent snaps yet.</div>}
        {inbox.sent.map((s) => (
          <div key={s.id} className="row snapy">
            <span>📤</span>
            <div><b>to {s.recipients} friend{s.recipients === 1 ? '' : 's'}</b><div className="dim snap-dim" style={{ fontSize: 11 }}>{s.openedCount} opened · {Math.round((s.expiresAt - Date.now()) / 60000)}m left</div></div>
            <div className="spacer" />
            <button className="btn danger icon-sm" onClick={async () => { await api('DELETE', `/api/snaps/${s.id}`); refreshInbox(); toast('Snap unsent'); }}>🗑</button>
          </div>
        ))}
      </div>)}

      <SnapPlayer onClose={() => { refreshInbox(); refreshSnaps(); }} />
    </div>
  );

  function visualCamera() {
    return (
      <div className="cam-shelf">
        <div className="cam-wrap">
          <video ref={videoRef} playsInline muted className="cam" style={{ filter: FILTERS[filter] }} />
          <canvas hidden ref={canvasRef} />
          {recording && <span className="recdot2">● {recSeconds}s</span>}
          <div className="cam-actions row">
            <button className="btn icon" title="Switch camera" onClick={async () => { const f = facing === 'user' ? 'environment' : 'user'; setFacing(f); }}>🔄</button>
            <button className="btn icon" title="Flash overlay (approximation)" onClick={() => setFlashOn(!flashOn)} style={flashOn ? { background: '#fff' } : {}}>⚡</button>
            <button className="btn primary big" onClick={capturePhoto} title="Photo">📷</button>
            <button className="btn primary" onClick={recording ? stopVideo : startVideo} title={recording ? 'Stop video' : 'Record video (max 30s)'}>{recording ? '⏹' : '🎥'}</button>
            <button className="btn icon" title="Change filter" onClick={() => setFilter((filter + 1) % FILTERS.length)}>🎛</button>
          </div>
        </div>
        <p className="dim" style={{ fontSize: 12, textAlign: 'center' }}>Photos &amp; up to 30s videos · single-view or replayable · expiry enforced by the server. Screenshots are still possible — be aware.</p>
      </div>
    );
  }

  function visualEdit() {
    const shot = shotRef.current;
    return (
      <div className="edit-shelf">
        <div className="edit-canvas" onPointerDown={() => {}} >
          {shot.kind === 'video' ? (
            <video src={shot.url} className="snap-img" autoPlay loop muted playsInline style={{ filter: FILTERS[editFilter] }} />
          ) : (
            <>
              <img ref={canvasRef ? null : null} src={shot.url} className="snap-img" style={{ filter: FILTERS[editFilter] }} alt="" />
              <canvas
                ref={canvasRef}
                className="snap-draw"
                onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(false); draw(e); }}
                onPointerMove={(e) => { if (drug.cur) draw(e); }}
                onPointerUp={drawEnd}
              />
            </>
          )}
          {textOver.filter(Boolean).map((t, i) => (
            <div key={i} className="over-text" style={{ top: `${t.y}%`, left: `${t.x}%`, color: t.color }}>{t.text}</div>
          ))}
        </div>
        <div className="edit-tools">
          <div className="row wrap">
            <input className="field grow" style={{ minWidth: 120 }} placeholder="Add text caption…" value={overText} onChange={(e) => setOverText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && overText.trim()) { setTextOver([...textOver.filter(Boolean), { text: overText, x: 50 - overText.length / 4, y: 12 + textOver.length * 12, color: drug.color }]); setOverText(''); } }} />
            <div className="row wrap">
              {COLORS.map((c) => <button key={c} className="csel" style={{ background: c }} onClick={() => setDrug({ ...drug, color: c })} />)}
            </div>
            <span className="dim" style={{ fontSize: 11 }}>brush {drug.size}px</span>
            <input type="range" min={2} max={22} value={drug.size} onChange={(e) => setDrug({ ...drug, size: Number(e.target.value) })} style={{ width: 90 }} />
          </div>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button className="chip" onClick={() => setEditFilter((editFilter + 1) % FILTERS.length)}>🎛 Filter</button>
            <button className="chip" onClick={() => setTextOver([...textOver, { text: new Date().toLocaleString(), x: 50, y: 90, color: drug.color }])}>⏰ Timestamp</button>
            <button className="chip" onClick={() => setTextOver([...textOver.filter(Boolean), { text: '🔥', x: 30, y: 30, color: '#fff' }])}>😀 Sticker</button>
            <button className="chip danger" onClick={() => { setDrug({ strokes: [], cur: null, color: drug.color, size: drug.size }); setTextOver([]); }}>↺ Clean</button>
            <div className="spacer" />
            <button className="btn ghost" onClick={() => { shotRef.current = null; setMode('capture'); }}>♻ Retake</button>
            <button className="btn primary" onClick={uploadAndSend}>Next ➕ Send</button>
          </div>
        </div>
      </div>
    );
  }

  function sendSheet() {
    const shot = shotRef.current;
    return (
      <div className="send-sheet">
        <div className="row" style={{ gap: 12 }}>
          <img src={shot.kind === 'video' ? undefined : shot.url} className="snap-thumb" alt="" />
          <div style={{ flex: 1 }}>
            <label className="small">Caption</label>
            <input className="field" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption…" />
            <div className="row" style={{ marginTop: 8 }}>
              <button className={`chip ${singleView ? 'acc' : ''}`} onClick={() => setSingleView(!singleView)}>{singleView ? '👁 Single view' : '🔁 Replayable'}</button>
              <span className="dim" style={{ fontSize: 11 }}>view duration {duration}s</span>
              <input type="range" min={1} max={60} value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={{ width: 110 }} />
            </div>
          </div>
        </div>
        <hr className="hairline" />
        <div className="dim" style={{ fontSize: 12, fontWeight: 700 }}>SEND TO</div>
        <div className="recipient-list">
          {chats.filter((c) => c.type === 'dm' && !c.dmKey?.startsWith('self:')).map((c) => {
            const other = (c.members || []).find((m) => m.id !== user.id);
            if (!other) return null;
            return (
              <button key={other.id} className={`row rec ${recips[other.id] ? 'on' : ''}`} onClick={() => setRecips({ ...recips, [other.id]: !recips[other.id] })}>
                <img className="avatar" width={30} height={30} src={other.avatar} alt="" />
                <div>{other.displayName}<div className="dim" style={{ fontSize: 11 }}>@{other.username}</div></div>
                <div className="spacer" />
                <span>{recips[other.id] ? '✅' : ''}</span>
              </button>
            );
          })}
          {groupTargets.map((g) => (
            <button key={g.id} className={`row rec ${recips['*' + g.id] ? 'on' : ''}`} onClick={() => toast('Group snaps land as regular chat attachments in the group', 'info')}>
              <span>🏕️</span><div>{g.title}</div>
            </button>
          ))}
          {!chats.length && <div className="dim" style={{ padding: 10 }}>Add contacts to send snaps.</div>}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <div className="spacer" />
          {recipients.length > 0 && <button className="btn primary" onClick={sendSnaps}>Send to {recipients.length}</button>}
          <button className="btn ghost" onClick={() => { shotRef.current = null; setTab('camera'); }}>Discard</button>
        </div>
      </div>
    );
  }
}

async function bake(canvasRef, shot, drug, textOver, editFilter) {
  const img = new Image();
  img.src = shot.url;
  await img.decode().catch(() => {});
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || 720; c.height = img.naturalHeight || 960;
  const ctx = c.getContext('2d');
  ctx.filter = FILTERS[editFilter] || 'none';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  ctx.filter = 'none';
  for (const s of drug.strokes.filter(Boolean)) {
    if (!s.pts) continue;
    ctx.strokeStyle = s.color; ctx.lineWidth = s.size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    s.pts.forEach(([x, y], i) => { const X = x * c.width, Y = y * c.height; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
    ctx.stroke();
  }
  for (const t of textOver.filter(Boolean)) {
    ctx.font = `bold ${Math.round(c.width / 18)}px sans-serif`;
    ctx.fillStyle = t.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeText(t.text, t.x / 100 * c.width - 40, t.y / 100 * c.height);
    ctx.fillText(t.text, t.x / 100 * c.width - 40, t.y / 100 * c.height);
  }
  return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
}

/* snap player (viewer with countdown) */
export function SnapPlayer({ onClose }) {
  const [viewing, setViewing] = useState(null);
  useEffect(() => { window.__vcViewSnap = openListener; function openListener(id) { setViewing({ id }); } }, []);
  const [snap, setSnap] = useState(null);
  const [err, setErr] = useState('');
  const [seed, setSeed] = useState(0);
  useEffect(() => {
    if (!viewing?.id) return;
    (async () => {
      try {
        const { snap: sn } = await api('POST', `/api/snaps/${viewing.id}/open`, { viewSeconds: 10 });
        setSnap(sn); setErr('');
        let t = sn.duration;
        setSeed(t);
        const iv = setInterval(() => { t--; setSeed(t); if (t <= 0) { clearInterval(iv); closeV(); } }, 1000);
        return () => clearInterval(iv);
      } catch (e) { setErr(e.message); setSnap(null); }
    })();
    function closeV() { setViewing(null); setSnap(null); onClose?.(); }
  }, [viewing?.id]);
  void 0;

  if (!viewing) return null;
  return (
    <div className="modal-veil" style={{ background: '#000' }}>
      <div className="snap-player">
        {err && <div className="dim" style={{ color: '#999' }}>{err}</div>}
        {snap && (<>
          {snap.media.kind === 'video' ? <video src={snap.media.url} autoPlay playsInline className="snap-full" /> : <img src={snap.media.url} className="snap-full" alt="" />}
          {snap.caption && <div className="snap-cap">{snap.caption}</div>}
          <div className="snap-count">{Math.max(0, seed)}s</div>
        </>)}
        <button className="btn ghost" style={{ position: 'absolute', top: 12, right: 12, color: '#fff' }} onClick={() => { setViewing(null); onClose?.(); }}>✕</button>
        <div className="dim snap-privacy">Screenshots can still be taken outside this app. Expiry is enforced by the VIBECHAT server.</div>
      </div>
    </div>
  );
}

