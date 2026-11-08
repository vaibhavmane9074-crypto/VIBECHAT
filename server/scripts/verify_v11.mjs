import { DatabaseSync } from 'node:sqlite';
import { io } from 'socket.io-client';
const BASE = 'http://localhost:4811';
const DBF = process.env.DBF;
const jars = {};
async function call(who, method, path, body) {
  const h = {};
  if (body !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(body); }
  if (jars[who]) h.cookie = jars[who];
  const r = await fetch(BASE + path, { method, headers: h, body, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc) jars[who] = sc.split(' ;').map((s) => s.trim()).join('; ');
  const txt = await r.text(); let data; try { data = JSON.parse(txt); } catch { data = txt; }
  return { status: r.status, data };
}
const out = [];
const t = (n, ok, x = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${n} ${x}`);
const tag = Date.now().toString(36);
const A = `wa_${tag}`, B = `wb_${tag}`;
const ra = await call('a', 'POST', '/api/auth/register', { email: `${A}@t.dev`, username: A, password: 'Passw0rd1', displayName: 'A' });
const rb = await call('b', 'POST', '/api/auth/register', { email: `${B}@t.dev`, username: B, password: 'Passw0rd1', displayName: 'B' });
const uidA = ra.data.user?.id, uidB = rb.data.user?.id;
await call('a', 'POST', '/api/users/contacts/request', { userId: uidB });
const inc = await call('b', 'GET', '/api/users/contacts');
const reqId = (inc.data.incoming || [])[0]?.id;
if (reqId) await call('b', 'POST', '/api/users/contacts/respond', { requestId: reqId, action: 'accept' });
const dm = await call('a', 'POST', '/api/chats/dm', { userId: uidB });
const chatId = dm.data.chat?.id;
const m = await call('a', 'POST', '/api/messages/send', { chatId, type: 'text', body: 'delivery check' });
t('setup: DM + message', !!chatId && !!m.data.message?.id);

// receiver's app acknowledges delivery over the socket
const sock = io(BASE, { transports: ['websocket'], extraHeaders: { cookie: jars.b } });
await new Promise((res, rej) => { sock.on('connect', res); sock.on('connect_error', rej); setTimeout(() => rej(new Error('timeout')), 5000); });
sock.emit('message:delivered', { chatId });
await new Promise((r) => setTimeout(r, 600));
sock.close();

const db = new DatabaseSync(DBF);
const row = db.prepare('SELECT lastDeliveredAt FROM chatMembers WHERE chatId=? AND userId=?').get(chatId, uidB);
t('receiver ack stored in DB', row && row.lastDeliveredAt > 0, `value=${row?.lastDeliveredAt}`);
db.close();

// sender's chat snapshot carries the receiver's delivery time
const list = await call('a', 'GET', '/api/chats', undefined);
const chats = Array.isArray(list.data) ? list.data : (list.data.chats || []);
const c = chats.find((x) => x.id === chatId);
const other = (c?.members || []).find((x) => x.id === uidB);
t('sender sees lastDeliveredAt in chat members', other && other.lastDeliveredAt > 0, `value=${other?.lastDeliveredAt}`);
t('chat members expose lastReadAt too', other && 'lastReadAt' in other, '');
console.log(out.join('\n'));
console.log(`SUMMARY: ${out.filter((x) => x.startsWith('PASS')).length} passed, ${out.filter((x) => x.startsWith('FAIL')).length} failed`);
