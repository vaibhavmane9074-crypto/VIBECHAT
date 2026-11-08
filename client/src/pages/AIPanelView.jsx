/* Vibe AI — assistant chat + quick tools (writing/tone/translate/summarize) + conversation summary of active chat. */
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../state/store.jsx';

export default function AIPanelView() {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  const { activeChat, toast } = useApp();
  const [provider, setProvider] = useState('');

  const load = async () => { try { const d = await api('GET', '/api/ai/history'); setMsgs(d.messages || []); } catch {} };
  useEffect(() => { load(); api('GET', '/api/ai/status').then((d) => setProvider(d.provider)).catch(() => {}); }, []);
  useEffect(() => { window.__vcAiFill = (body) => setText(body); }, []);

  useEffect(() => { setTimeout(() => end.current?.scrollIntoView({ smooth: false }), 50); }, [msgs]);
  // ai rewrite entrypoint defined at app level (__vcAiRewrite -> __vcAiFill)
  void toast;

  const send = async () => {
    if (!text.trim() || busy) return;
    const t = text; setText(''); setBusy(true);
    setMsgs((m) => [...m, { role: 'user', content: t, createdAt: Date.now() }]);
    try {
      const d = await api('POST', '/api/ai/chat', { prompt: t });
      setMsgs((m) => [...m, { role: 'assistant', content: d.text, createdAt: Date.now(), provider: d.provider }]);
    } catch (e) { setMsgs((m) => [...m, { role: 'assistant', content: `⚠️ ${e.message}`, createdAt: Date.now() }]); }
    setBusy(false);
  };

  const tool = async (kind, textIn) => {
    setBusy(true);
    try {
      let out;
      if (activeChat) {
        const starts = activeChat.lastMessage ? [activeChat.lastMessage.body] : [];
        const d = await api('POST', '/api/ai/assist', { kind, text: textIn, recent: starts });
        out = d.text;
      } else out = (await api('POST', '/api/ai/chat', { prompt: `${kind}: ${textIn}` })).text;
      setMsgs((m) => [...m, { role: 'assistant', content: out, createdAt: Date.now() }]);
    } catch (e) { toast(e.message, 'warn'); }
    setBusy(false);
  };

  return (
    <div className="ai-wrap">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="chip" onClick={() => tool('translate', 'This is my vibe today.')}>🌐 Translate demo</button>
        <button className="chip" onClick={() => tool('summarize', (activeChat?.lastMessage?.body) || 'Summarize my latest conversation.')}>📝 Summarize chat</button>
        <button className="chip" onClick={() => tool('suggest', '')}>✨ Reply ideas</button>
        <button className="chip" onClick={() => tool('tone', activeChat?.lastMessage?.body || '')}>🎩 Formal tone</button>
        <span className="chip">engine: {provider || '…'}</span>
      </div>
      <div className="ai-msgs">
        {msgs.map((m, i) => (
          <div key={i} className={`mrow ${m.role === 'user' ? 'me' : 'them'} fades`}>
            <div className="bubble"><div className="mbody" style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div></div>
          </div>
        ))}
        {busy && <div className="spinner" style={{ margin: 12 }} />}
        <div ref={end} />
      </div>
      <div className="row" style={{ padding: 10 }}>
        <button className="btn ghost icon-sm" title="Clear history" onClick={async () => { await api('POST', '/api/ai/clear'); load(); }}>🧹</button>
        <input className="field grow" placeholder="Ask Vibe AI anything — writing, ideas, translation, chat help…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) send(); }} />
        <button className="btn icon primary" onClick={send} disabled={!text.trim() || busy}>➤</button>
      </div>
    </div>
  );
}
