/*
 * VIBECHAT AI assistant — server-side only; keys never reach the client.
 * Provider order: OPENAI_API_KEY → GEMINI_API_KEY → built-in local engine (always works offline).
 * The local engine is a deterministic helper, clearly labelled "local engine" in responses.
 */
import { Router } from 'express';
import { q, uid, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { V } from '../security.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);
const CANON = (fn) => (req, res, next) => { const p = fn(req, res, next); if (p && typeof p.catch === 'function') p.catch(next); };

const SYS = `You are Vibe AI, the assistant inside VIBECHAT ("Beyond Messaging."). Be concise, warm and helpful. For suggestions give 2-4 short options separated by newlines starting with a number.`;

async function callOpenAI(messages) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.openaiKey}` },
    body: JSON.stringify({ model: config.openaiModel, messages, max_tokens: 700, temperature: 0.7 }),
  });
  if (!r.ok) throw new Error((await r.text()).slice(0, 200));
  const j = await r.json();
  return j.choices?.[0]?.message?.content || '';
}
async function callGemini(prompt) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiKey}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!r.ok) throw new Error((await r.text()).slice(0, 200));
  const j = await r.json();
  return j.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/* deterministic local engine — feature parity fallback */
async function callLocal(kind, prompt) {
  const t = prompt.trim();
  let text;
  switch (kind) {
    case 'suggest': text = 'Sounds good!\nCan you tell me more?\nI\'ll get back to you soon.'; break;
    case 'rewrite:formal': text = t.replace(/\bi'm\b/gi, 'I am').replace(/\bgonna\b/gi, 'going to').replace(/!+/g, '.').replace(/\bpls\b|\bplz\b/gi, 'please').replace(/\bthx\b/gi, 'thank you'); text = text.charAt(0).toUpperCase() + text.slice(1); break;
    case 'rewrite:casual': text = `${t} 😄`; break;
    case 'rewrite:shorten': text = t.split(/\s+/).filter(Boolean).slice(0, Math.ceil(t.split(/\s+/).length / 2)).join(' '); break;
    case 'translate': {
      const dict = { hello: 'hola', thanks: 'gracias', yes: 'sí', no: 'no', how: 'cómo', 'how are you': 'cómo estás' };
      const es = t.toLowerCase();
      text = Object.keys(dict).reduce((acc, k) => acc.replaceAll(k, dict[k]), es);
      text = `(local engine, demo translation) ${text}`;
      break;
    }
    case 'summary': {
      const sents = t.split(/(?<=[.!?])\s+/).slice(0, 3);
      text = `Summary: ${sents.join(' ')}`.slice(0, 300);
      break;
    }
    default: {
      const m = [[/hi|hello|hey/i, 'Hey there! How can I help — chat writing, translation, summaries, or ideas?'],
        [/summar/i, 'Paste the text (or open a chat and use Summarize) and I\'ll compress it for you.'],
        [/translat/i, 'Give me the text and target language; in local engine mode I demo-translate EN→ES.'],
        [/joke/i, 'Why did the developer go broke? Because they used up all their cache. 😄'],
        [/help|what can/i, 'I can draft replies, fix grammar, adjust tone, translate, summarize and brainstorm. Ask away!']];
      const hit = m.find(([re]) => re.test(t));
      text = hit ? hit[1] : `Got it. Here's a quick take: "${t.slice(0, 120)}". Ask me to draft, shorten, fix, translate or summarize it.`;
    }
  }
  return text;
}

export async function ai(kind, prompt) {
  if (config.openaiKey) {
    try { return { text: (await callOpenAI([{ role: 'system', content: SYS }, { role: 'user', content: prompt }])).trim(), provider: 'openai' }; }
    catch (e) { console.error('[ai] openai failed, local fallback:', e.message); }
  }
  if (config.geminiKey) {
    try { return { text: (await callGemini(`${SYS}\n\n${prompt}`)).trim(), provider: 'gemini' }; }
    catch (e) { console.error('[ai] gemini failed, local fallback:', e.message); }
  }
  return { text: await callLocal(kind, prompt), provider: 'local' };
}

router.get('/status', requireAuth, (_req, res) => res.json({ provider: config.openaiKey ? 'openai' : config.geminiKey ? 'gemini' : 'local', model: config.openaiKey ? config.openaiModel : config.geminiKey ? config.geminiModel : 'local-engine' }));

router.get('/history', requireAuth, (req, res) => {
  res.json({ messages: q.all(`SELECT role, content, createdAt FROM aiMessages WHERE userId=? ORDER BY createdAt DESC LIMIT 100`, req.user.id).reverse() });
});
router.post('/clear', requireAuth, (req, res) => { q.run(`DELETE FROM aiMessages WHERE userId=?`, req.user.id); res.json({ ok: true }); });

router.post('/chat', requireAuth, CANON(async (req, res) => {
  const prompt = V.str(String(req.body.prompt || ''), { min: 1, max: 4000, name: 'Prompt' });
  const kind = String(req.body.kind || 'chat');
  const hist = q.all(`SELECT role, content FROM aiMessages WHERE userId=? ORDER BY createdAt DESC LIMIT 10`, req.user.id).reverse();
  void hist;
  q.run(`INSERT INTO aiMessages (id, userId, role, content, createdAt) VALUES (?,?,?,?,?)`, uid(), req.user.id, 'user', prompt, now());
  const { text, provider } = await ai(kind, prompt);
  q.run(`INSERT INTO aiMessages (id, userId, role, content, createdAt) VALUES (?,?,?,?,?)`, uid(), req.user.id, 'assistant', text, now());
  res.json({ text, provider });
}));

/* contextual helpers for chats */
router.post('/assist', requireAuth, CANON(async (req, res) => {
  const kind = V.limit(String(req.body.kind || 'suggest'), ['suggest', 'write', 'grammar', 'translate', 'summarize', 'tone', 'smart-search']);
  const input = String(req.body.text || '').slice(0, 4000);
  const recent = Array.isArray(req.body.recent) ? req.body.recent.map(String).slice(-10) : [];
  const lang = String(req.body.lang || 'es').slice(0, 20);
  const tone = V.limit(String(req.body.tone || 'formal'), ['formal', 'casual', 'shorten', 'friendly']);
  const promptFor = {
    suggest: `Conversation so far:\n${recent.join('\n')}\n\nSuggest 3 short reply options I could send. Number them.`,
    write: `Write a friendly, clear message based on this intent. Intent: ${input}`,
    grammar: `Fix grammar/spelling, keep meaning, return only corrected text:\n${input}`,
    translate: `Translate to ${lang}, return only translation:\n${input}`,
    summarize: `Summarize in 2-3 bullet-style lines:\n${recent.join('\n') || input}`,
    tone: `Rewrite this message in a ${tone} tone, return only the rewritten text:\n${input}`,
    'smart-search': `User searches chats for: ${input}. Return 5 diverse search query suggestions.`,
  }[kind];
  const { text, provider } = await ai(kind, promptFor);
  res.json({ text, provider, kind });
}));

export default router;
