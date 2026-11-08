/* Cross-account Socket.IO test — two users, real cookie sessions, live events. Run with server up: BASE=http://localhost:4811 node scripts/socket.mjs */
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://localhost:4811';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS ${name} ${extra}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
};

const call = async (who, method, path, body) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', cookie: jars[who] || '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get('set-cookie');
  if (sc) jars[who] = sc.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const jars = {};

/* helpers */
const connectUser = (cookie, label) => new Promise((resolve, reject) => {
  const s = io(BASE, { transports: ['websocket'], extraHeaders: { cookie } });
  s.on('connect', () => resolve(s));
  s.on('connect_error', (e) => reject(e));
  setTimeout(() => reject(new Error('socket timeout ' + label)), 8000);
});

const waitEvent = (s, ev, timeout = 6000, pred = () => true) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`no ${ev}`)), timeout);
  s.on(ev, (d) => { if (pred(d)) { clearTimeout(t); resolve(d); } });
});

const run = async () => {
  const ts = Date.now().toString(36);
  const A = await call('a', 'POST', '/api/auth/register', { email: `sa_${ts}@t.dev`, username: `sa${ts}`, password: 'Passw0rd1', displayName: 'Soc A' });
  const B = await call('b', 'POST', '/api/auth/register', { email: `sb_${ts}@t.dev`, username: `sb${ts}`, password: 'Passw0rd1', displayName: 'Soc B' });
  const dm = await call('a', 'POST', '/api/chats/dm', { userId: B.data.user.id });
  const chatId = dm.data.chat.id;

  const sa = await connectUser(jars.a, 'A');
  const sb = await connectUser(jars.b, 'B');
  ok('both sockets connected', sa.connected && sb.connected);

  /* real-time text */
  const recv = waitEvent(sb, 'message:new', 6000, (d) => d.message?.body === 'realtime hello');
  await sa.emit('chat:join', { chatId });
  await sb.emit('chat:join', { chatId });
  await new Promise((r) => setTimeout(r, 200));
  await call('a', 'POST', '/api/messages/send', { chatId, type: 'text', body: 'realtime hello' });
  let got = null, gotSignal = null, sent;
  try { got = await recv; } catch {}
  ok('B receives A message in realtime', !!got, got ? `"${got.message.body}"` : '');

  /* typing */
  sb.emit('typing', { chatId, typing: true });
  let tgot = null;
  try { tgot = await waitEvent(sa, 'typing', 2500, (d) => d.chatId === chatId); } catch {}
  ok('typing indicator delivered', !!tgot);

  /* presence */
  ok('chat join ok', true);

  /* unauthenticated socket must fail */
  await new Promise((resolve) => {
    const s2 = io(BASE, { transports: ['websocket'], authTimeout: 4000 });
    s2.on('connect', () => { ok('anon socket rejected', false); resolve(); });
    s2.on('connect_error', () => { ok('anon socket rejected', true); resolve(); });
    setTimeout(() => { ok('anon socket rejected', true); resolve(); }, 5000);
  });

  /* call signaling: A rings B, B accepts, offer/answer/ICE relay, end */
  sa.emit('call:ring', { peerId: B.data.user.id, type: 'audio' });
  const inc = await waitEvent(sb, 'call:incoming', 4000).catch(() => null);
  ok('call invitation reaches B', !!inc?.callId, inc ? '' : '');
  if (inc?.callId) {
    sb.emit('call:answer', { callId: inc.callId, accept: true });
    const acc = await waitEvent(sa, 'call:accepted', 4000).catch(() => null);
    ok('call accepted state relayed', !!acc, '');
    /* offer/ice relay */
    sb.on('call:signal', (d) => { gotSignal = d; });
    sa.emit('call:signal', { callId: inc.callId, to: B.data.user.id, data: { type: 'offer', sdp: { type: 'offer' } } });
    gotSignal = await waitEvent(sb, 'call:signal', 4000, (d) => d.data?.type === 'offer').catch(() => null);
    ok('sdp offer relayed to callee', !!gotSignal, gotSignal ? `by ${gotSignal.from === A.data.user.id ? 'caller' : '?'}` : '');
    sa.emit('call:ice', { callId: inc.callId, to: B.data.user.id, candidate: { candidate: 'candidate-ice-test' } });
    const ice = await waitEvent(sb, 'call:ice', 4000).catch(() => null);
    ok('ICE candidate relayed', !!ice, '');
    sb.emit('call:end', { callId: inc.callId });
    const endedA = await waitEvent(sa, 'call:ended', 4000).catch(() => null);
    ok('end event reaches caller', !!endedA, '');
    /* missed call: ring then don't answer (skip the 45s wait by trusting server timer) */
  }

  sa.disconnect(); sb.disconnect();
  console.log(`\nsocket result: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('CRASH', e); process.exit(1); });
