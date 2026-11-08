const BASE = 'http://localhost:4811';
const jars = {};
async function call(who, method, path, body, opts = {}) {
  const h = { ...(opts.headers || {}) };
  if (body !== undefined && !Buffer.isBuffer(body)) { h['content-type'] = 'application/json'; body = JSON.stringify(body); }
  if (jars[who]) h.cookie = jars[who];
  const r = await fetch(BASE + path, { method, headers: h, body, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc) jars[who] = sc.split(' ;').map((s) => s.trim()).join('; ');
  const buf = Buffer.from(await r.arrayBuffer());
  let data; try { data = JSON.parse(buf.toString()); } catch { data = buf; }
  return { status: r.status, data, buf };
}
const out = [];
const t = (n, ok, x = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${n} ${x}`);
const tag = Date.now().toString(36);
const reg = (who, name) => call(who, 'POST', '/api/auth/register', { email: `${name}@t.dev`, username: name, password: 'Passw0rd1', displayName: name });
const A = `ka_${tag}`, B = `kb_${tag}`, S = `ks_${tag}`;
const uidA = (await reg('a', A)).data.user.id;
const uidB = (await reg('b', B)).data.user.id;
await reg('s', S); const uidS = (await call('s', 'GET', '/api/auth/me')).data.user.id;
// A and B are contacts; S is a stranger
await call('a', 'POST', '/api/users/contacts/request', { userId: uidB });
const inc = await call('b', 'GET', '/api/users/contacts');
const rid = (inc.data.incoming || [])[0]?.id;
if (rid) await call('b', 'POST', '/api/users/contacts/respond', { requestId: rid, action: 'accept' });

// ---- stories: a stranger cannot view / react / reply to a contacts-only story ----
const sto = await call('b', 'POST', '/api/snaps/stories', { type: 'text', body: 'contacts only', visibility: 'contacts' });
const stId = sto.data.story?.id;
const sv = await call('s', 'POST', `/api/snaps/stories/${stId}/view`, {});
t('stranger view blocked', sv.status === 403, `status=${sv.status}`);
const sr = await call('s', 'POST', `/api/snaps/stories/${stId}/react`, { emoji: '🔥' });
t('stranger react blocked', sr.status === 403, `status=${sr.status}`);
const srp = await call('s', 'POST', `/api/snaps/stories/${stId}/reply`, { body: 'hi' });
t('stranger reply blocked', srp.status === 403, `status=${srp.status}`);
const av = await call('a', 'POST', `/api/snaps/stories/${stId}/view`, {});
t('contact can still view', av.status === 200, `status=${av.status}`);

// ---- file ownership: cannot attach or snap someone else's upload ----
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d1d5550000000049454e44ae426082', 'hex');
const bfile = await call('b', 'POST', '/api/files', png, { headers: { 'x-file-name': 'b.png', 'x-file-type': 'image/png' } });
const bFileId = bfile.data.file?.id;
const cm = await call('s', 'POST', '/api/chats/dm', { userId: uidB });
const steal = await call('s', 'POST', '/api/messages/send', { chatId: cm.data.chat?.id, type: 'image', fileId: bFileId });
t('cannot send message with someone else\'s file', steal.status >= 400 && steal.status < 500, `status=${steal.status}`);
const stealSnap = await call('s', 'POST', '/api/snaps/send', { fileId: bFileId, recipients: [uidB], duration: 5, singleView: true });
t('cannot snap someone else\'s file', stealSnap.status >= 400 && stealSnap.status < 500, `status=${stealSnap.status}`);

// ---- single-view: two concurrent opens -> exactly one succeeds ----
const snap = await call('b', 'POST', '/api/snaps/send', { fileId: bFileId, recipients: [uidA], duration: 5, singleView: true, caption: 'race' });
const snapId = snap.data.snapId;
const [o1, o2] = await Promise.all([call('a', 'POST', `/api/snaps/${snapId}/open`, {}), call('a', 'POST', `/api/snaps/${snapId}/open`, {})]);
const okCount = [o1, o2].filter((x) => x.status === 200).length;
t('single-view concurrent open: exactly one wins', okCount === 1, `statuses=${o1.status},${o2.status}`);

// ---- replay: a replayed snap gets a fresh viewing window ----
const rep = await call('b', 'POST', '/api/snaps/send', { fileId: bFileId, recipients: [uidA], duration: 5, singleView: false, caption: 'replay' });
const repId = rep.data.snapId;
await call('a', 'POST', `/api/snaps/${repId}/open`, {});
await new Promise((r) => setTimeout(r, 7000)); // first window (5s + grace) has now closed
const media1 = await call('a', 'GET', `/api/snaps/media/${bFileId}`, undefined, {});
await call('a', 'POST', `/api/snaps/${repId}/replay`, {});
const reopen = await call('a', 'POST', `/api/snaps/${repId}/open`, {});
const media2 = await call('a', 'GET', `/api/snaps/media/${bFileId}`, undefined, {});
t('replay: reopen succeeds', reopen.status === 200, `status=${reopen.status}`);
t('replay: media available in the new window', media2.status === 200 || media2.status === 206, `status=${media2.status} (before reopen: ${media1.status})`);
console.log(out.join('\n'));
console.log(`SUMMARY: ${out.filter((x) => x.startsWith('PASS')).length} passed, ${out.filter((x) => x.startsWith('FAIL')).length} failed`);
