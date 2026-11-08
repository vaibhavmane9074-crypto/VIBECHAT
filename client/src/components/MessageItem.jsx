/* VIBECHAT message bubbles: text/media/poll/game/sticker/voice/snap/location rendering + actions menu. */
import React, { useEffect, useRef, useState } from 'react';
import { api, fmtTime, fmtSize } from '../lib/api.js';
import { useApp } from '../state/store.jsx';

const REACTIONS = ['❤️', '😂', '🔥', '👍', '😮', '😢'];
const FICON = { image: '🖼️', video: '🎬', audio: '🎵', document: '📄', code: '💻', archive: '🗜️' };

/* sent ✓ · delivered ✓✓ (every other member's app received it) · read ✓✓ in accent (every other member has read it) */
function Ticks({ m, chat, me }) {
  const others = (chat.members || []).filter((x) => x.id !== me);
  if (!others.length) return <span className="tick">✓</span>;
  if (others.every((x) => (x.lastReadAt || 0) >= m.createdAt)) return <span className="tick read" title="Read">✓✓</span>;
  if (others.every((x) => (x.lastDeliveredAt || 0) >= m.createdAt)) return <span className="tick" title="Delivered">✓✓</span>;
  return <span className="tick" title="Sent">✓</span>;
}

export default function MessageItem({ m, chat, refresh }) {
  const { user, toast } = useApp();
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(m.body || '');
  const mine = m.senderId === user.id;

  if (m.type === 'system') return <div className="sys fades">{m.body}</div>;

  const react = async (emoji) => {
    setMenu(false);
    try { await api('POST', `/api/messages/${m.id}/react`, { emoji }); }
    catch (e) { toast(e.message, 'warn'); }
  };
  const del = async () => {
    setMenu(false);
    try { await api('DELETE', `/api/messages/${m.id}`); refresh?.(); }
    catch (e) { toast(e.message, 'warn'); }
  };

  if (editing) {
    return (
      <div className={`mrow ${mine ? 'me' : 'them'}`}>
        <div className="bubble">
          <input className="field" value={editBody} onChange={(e) => setEditBody(e.target.value)} autoFocus
            onKeyDown={async (e) => {
              if (e.key === 'Enter') {
                try { await api('PUT', `/api/messages/${m.id}`, { body: editBody }); setEditing(false); }
                catch (er) { toast(er.message, 'warn'); }
              }
              if (e.key === 'Escape') setEditing(false);
            }} />
        </div>
      </div>
    );
  }

  const summary = {};
  for (const r of (m.reactions || [])) (summary[r.emoji] ||= []).push(r.userId);
  const jumbo = ['sticker', 'gif'].includes(m.type) || /^[\p{Extended_Pictographic}\s]{1,9}$/u.test(m.body || '') && m.type === 'text';

  return (
    <div className={`mrow ${mine ? 'me' : 'them'}`} onDoubleClick={() => !mine && react('❤️')}>
      {!mine && chat.type !== 'dm' && <img className="avatar" width={26} height={26} src={m.sender?.avatar || '/api/users/x/avatar.svg'} alt="" />}
      <div className={`bubble ${['image', 'video', 'file', 'poll', 'game'].includes(m.type) ? 'media' : ''}`}>
        {!mine && chat.type !== 'dm' && chat.type !== 'notes' && <span className="meta-s">{m.sender?.displayName}</span>}

        {m.replyMessage && (
          <div className="reply-tag" onClick={() => window.__vcJumpTo?.(m.replyTo)}>
            <div style={{ fontSize: 10, fontWeight: 700 }}>{m.replyMessage.senderId === user.id ? 'You' : m.replyMessage.senderName || 'Reply'}</div>
            <div style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 230 }}>{m.replyMessage.body || '(media)'}</div>
          </div>
        )}

        {m.type === 'snap' && (
          <button className="snap-bubble" onClick={() => window.__vcOpenSnap?.(m.meta?.snapId || m.snapId)}>
            {m.meta?.expired ? '🕳️ Snap expired' : `📸 ${m.meta?.caption || 'Tap to view'}`}
            <div style={{ fontSize: 10, opacity: 0.65, fontWeight: 500 }}>single view · expiry enforced by server</div>
          </button>
        )}

        {m.type === 'image' && m.file && <img className="b-media" src={m.file.url} alt={m.file.name} onClick={() => window.__vcViewMedia?.(m.file)} />}
        {m.type === 'video' && m.file && <video className="b-media" src={m.file.url} controls preload="metadata" playsInline />}
        {m.type === 'audio' && m.file && <audio style={{ width: 240 }} src={m.file.url} controls preload="metadata" />}
        {m.type === 'voice' && m.file && <Voice file={m.file} />}
        {m.type === 'file' && m.file && (
          <a className="file-chip" href={m.file.downloadUrl} target="_blank" rel="noreferrer">
            <div className="ficon">{FICON[m.file.kind] || '📎'}</div>
            <div>
              <div className="fname">{m.file.name}</div>
              <div style={{ fontSize: 10, opacity: 0.6 }}>{fmtSize(m.file.size)} · {m.file.ext || 'file'}</div>
            </div>
          </a>
        )}
        {m.type === 'poll' && <Poll m={m} />}
        {m.type === 'game' && <Game m={m} />}
        {m.type === 'location' && (
          <a className="file-chip" target="_blank" rel="noreferrer"
            href={`https://www.openstreetmap.org/?mlat=${m.meta?.lat}&mlon=${m.meta?.lng}#map=15/${m.meta?.lat}/${m.meta?.lng}`}>
            📍 Location — open map
          </a>
        )}
        {m.type === 'text' && <div className={`mbody ${jumbo ? 'jumbo' : ''}`} style={{ whiteSpace: 'pre-wrap' }}>{linkify(m.body)}</div>}
        {['sticker', 'gif'].includes(m.type) && <div className="jumbo">{m.body}</div>}

        <div className="mbottom row">
          <div className="rx row">
            {Object.entries(summary).filter(([, us]) => us.length).map(([emoji, us]) => (
              <button key={emoji} className="rxb" onClick={() => react(emoji)}>{emoji} {us.length}</button>
            ))}
          </div>
          <div className="spacer" />
          <small style={{ fontSize: 10, opacity: 0.65, whiteSpace: 'nowrap' }}>
            {m.disappears ? `⏱` : ''}
            {' '}{fmtTime(m.createdAt)}
            {mine && <Ticks m={m} chat={chat} me={user?.id} />}
          </small>
        </div>
      </div>

      <button className="mact" onClick={() => setMenu(true)} title="Actions">⋯</button>
      {menu && (
        <div className="mact-menu pop glass" onMouseLeave={() => setMenu(false)}>
          <div className="row rxrow" style={{ paddingBottom: 4 }}>
            {REACTIONS.map((e) => <button key={e} className="rxb" onClick={() => react(e)}>{e}</button>)}
          </div>
          <div className="hairline" style={{ margin: '2px 0 4px' }} />
          <button className="mactb" onClick={() => { window.__vcReply?.({ chatId: chat.id, id: m.id, body: m.body, sender: m.sender?.displayName || 'them' }); setMenu(false); }}>↩️ Reply</button>
          {mine && m.type === 'text' && <button className="mactb" onClick={() => { setEditing(true); setMenu(false); }}>✏️ Edit</button>}
          <button className="mactb" onClick={() => { window.__vcForward?.(m); setMenu(false); }}>➡️ Forward</button>
          <button className="mactb" onClick={() => { api('POST', `/api/messages/${m.id}/pin`).catch((e) => toast(e.message, 'warn')); setMenu(false); }}>{m.pinned ? '📌 Unpin' : '📌 Pin'}</button>
          <button className="mactb" onClick={() => { api('POST', `/api/messages/${m.id}/star`).catch((e) => toast(e.message, 'warn')); toast('Star toggled ⭐'); setMenu(false); }}>{m.stared ? '☆ Unstar' : '⭐ Star'}</button>
          {m.body && <button className="mactb" onClick={() => { navigator.clipboard?.writeText(m.body); toast('Copied'); setMenu(false); }}>📋 Copy</button>}
          {mine && m.type === 'text' && m.body && <button className="mactb" onClick={() => { window.__vcAiRewrite?.(m.body); setMenu(false); }}>🤖 AI polish</button>}
          <button className="mactb danger" onClick={del}>{mine ? '🗑️ Delete for everyone' : '🗑️ Delete for me'}</button>
        </div>
      )}
    </div>
  );
}

const URL_RE = /(https?:\/\/[^\s<]+)/g;
function linkify(text) {
  if (!text) return null;
  const parts = String(text).split(URL_RE);
  return parts.map((p, i) => (URL_RE.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer" style={{ color: 'inherit', fontWeight: 700 }}>{p}</a> : p));
}

function Voice({ file }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  return (
    <div className="voice row">
      <button className="btn icon-sm" style={{ borderRadius: '50%', background: 'rgba(255,255,255,0.15)', border: 'none' }}
        onClick={() => { const a = ref.current; if (!a) return; if (a.paused) { a.play(); setPlaying(true); } else { a.pause(); setPlaying(false); } }}>
        {playing ? '⏸' : '▶'}
      </button>
      <div style={{ fontSize: 10, opacity: 0.7 }}>🎙 voice note</div>
      <audio ref={ref} src={file.url} preload="metadata" onEnded={() => setPlaying(false)} />
    </div>
  );
}

function Poll({ m }) {
  const { toast } = useApp();
  const poll = m.poll || {};
  const options = poll.options || [];
  const votes = poll.votes || [];
  const total = votes.reduce((a, v) => a + (v.count || 0), 0);
  return (
    <div className="poll">
      <div style={{ fontWeight: 700, fontSize: 13 }}>{poll.title || m.body || 'Poll'}</div>
      {options.map((label, i) => {
        const count = votes[i]?.count || 0;
        const pct = total ? Math.round((count / total) * 100) : 0;
        return (
          <button key={i} className={`poll-opt ${poll.myVote === i ? 'mine' : ''}`}
            onClick={async () => {
              try { await api('POST', '/api/messages/poll/vote', { messageId: m.id, optionIndex: i }); }
              catch (e) { toast(e.message, 'warn'); }
            }}>
            <div className="poll-bar"><span style={{ width: `${pct}%` }} /></div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13 }}>{label}{poll.myVote === i ? ' ✓' : ''}</span>
              <small style={{ fontSize: 10, opacity: 0.7 }}>{pct}%</small>
            </div>
          </button>
        );
      })}
      <small style={{ fontSize: 10, opacity: 0.6 }}>{total} vote{total === 1 ? '' : 's'}</small>
    </div>
  );
}

function Game({ m }) {
  const { toast } = useApp();
  const g = m.meta?.game || {};
  const [board, setBoard] = useState(g.board || Array(9).fill(''));
  const [winner, setWinner] = useState(g.winner);
  const [turn, setTurn] = useState(g.turn || 'x');
  useEffect(() => { setBoard(m.meta?.game?.board || Array(9).fill('')); setWinner(m.meta?.game?.winner); setTurn(m.meta?.game?.turn || 'x'); }, [JSON.stringify(m.meta?.game || {})]);
  const move = async (cell) => {
    try {
      const d = await api('POST', '/api/messages/game/move', { messageId: m.id, cell });
      setBoard(d.game.board); setWinner(d.game.winner); setTurn(d.game.turn);
    } catch (e) { toast(e.message, 'warn'); }
  };
  const reset = async () => {
    try {
      const d = await api('POST', '/api/messages/game/reset', { messageId: m.id });
      setBoard(d.game.board); setWinner(null); setTurn(d.game.turn);
    } catch (e) { toast(e.message, 'warn'); }
  };
  return (
    <div className="ttt">
      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>
        🎮 Tic-tac-toe · {winner ? (winner === 'draw' ? 'Draw!' : `${winner.toUpperCase()} wins!`) : `${(turn || 'x').toUpperCase()}'s turn`}
      </div>
      <div className="ttt-grid">
        {board.map((c, i) => (
          <button key={i} className="ttt-cell" disabled={!!c || !!winner} onClick={() => move(i)}>{c}</button>
        ))}
      </div>
      {(winner || (!myMovePossible(board))) && <button className="chip" style={{ marginTop: 6 }} onClick={reset}>Play again</button>}
    </div>
  );
}
const myMovePossible = (b) => !b.every(Boolean);
void fmtSize;
