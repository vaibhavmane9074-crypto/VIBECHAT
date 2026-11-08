/* VIBECHAT backend smoke test — two independent accounts exercising the real API. Run: node scripts/smoke.mjs */
const BASE = process.env.BASE || 'http://localhost:4811';
const jars = {};
async function call(who, method, path, body, opts = {}) {
  const h = { ...(opts.headers || {}) };
  if (body && !(typeof body === 'string' || body instanceof Buffer)) { h['content-type'] = 'application/json'; body = JSON.stringify(body); }
  if (jars[who]) h.cookie = jars[who];
  const r = await fetch(BASE + path, { method, headers: h, body, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc) jars[who] = sc.split(' ;').map((s2) => s2.trim()).join('; ');
  let data = null;
  if (!opts.raw) { const t = await r.text(); try { data = JSON.parse(t); } catch { data = t; } }
  else data = Buffer.from(await r.arrayBuffer());
  return { status: r.status, data, headers: r.headers };
}
const results = [];
const t = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const A = `ava_${Date.now().toString(36)}`, B = `ben_${Date.now().toString(36)}`;

const { execSync } = await import('node:child_process');
function hit(method, p, b) { return JSON.parse(execSync(`curl -s -X ${method} ${BASE}${p} -H 'Content-Type: application/json' -b "${jars.current || ''}" "${b ? `-d ${JSON.stringify(typeof b === 'object' ? JSON.stringify(b) : b)}` : ''}"`).toString()); }

const run = async () => {
  // 1 register both
  const ra = await call('a', 'POST', '/api/auth/register', { email: `${A}@t.dev`, username: A, password: 'Passw0rd1', displayName: 'Ava Test' });
  t('register A', ra.status === 200, JSON.stringify(ra.data).slice(0, 200));
  const rb = await call('b', 'POST', '/api/auth/register', { email: `${B}@t.dev`, username: B, password: 'Passw0rd1', displayName: 'Benny Test' });
  t('register B', rb.status === 200);
  const uidA = ra.data.user.id, uidB = rb.data.user.id;

  // 2 me
  const me = await call('a', 'GET', '/api/auth/me');
  t('me endpoint', me.status === 200 && me.data.user.username === A);

  // 3 contacts
  const reqc = await call('a', 'POST', '/api/users/contacts/request', { userId: uidB });
  t('contact request', reqc.status === 200);
  const inc = await call('b', 'GET', '/api/users/contacts');
  t('contact visible to B', inc.status === 200 && inc.data.incoming.length === 1);
  const resp = await call('b', 'POST', '/api/users/contacts/respond', { requestId: inc.data.incoming[0].id, action: 'accept' });
  t('contact accept', resp.data.state === 'contacts');

  // 4 DM
  const dm = await call('a', 'POST', '/api/chats/dm', { userId: uidB });
  t('open DM', dm.status === 200 && dm.data.chat?.id, JSON.stringify(dm.data).slice(0, 80));
  const chatId = dm.data.chat.id;

  // 5 send text
  const m1 = await call('a', 'POST', '/api/messages/send', { chatId, type: 'text', body: 'Hello Ben 👋' });
  t('send text', m1.status === 200 && m1.data.message.body.includes('Hello'), JSON.stringify(m1.data).slice(0, 100));
  const mid = m1.data.message.id;

  // 6 history for B
  const h = await call('b', 'GET', `/api/messages/${chatId}`);
  t('history', h.status === 200 && h.data.messages.length === 1);

  // 7 edit
  const ed = await call('a', 'PUT', `/api/messages/${mid}`, { body: 'Hello Ben (edited)' });
  t('edit message', ed.status === 200 && ed.data.message.body.includes('edited'));

  // 8 react from B
  const rc = await call('b', 'POST', `/api/messages/${mid}/react`, { emoji: '❤️' });
  t('reaction', rc.status === 200);

  // 9 star + pin
  const st = await call('b', 'POST', `/api/messages/${mid}/star`); t('star', st.status === 200);
  const pn = await call('a', 'POST', `/api/messages/${mid}/pin`); t('pin', pn.status === 200);

  // 10 polls
  const pl = await call('a', 'POST', '/api/messages/send', { chatId, type: 'poll', title: 'Snack?', options: ['Pizza', 'Sushi'] });
  const pid = pl.data.message.id;
  const pv = await call('b', 'POST', '/api/messages/poll/vote', { messageId: pid, optionIndex: 1 });
  t('poll vote', pv.status === 200, JSON.stringify(pv.data).slice(0, 60));

  // 11 upload jpg (magic byte sniffing) as B
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
  const up = await call('b', 'POST', '/api/files', jpg, { headers: { 'x-file-name': encodeURIComponent('photo unknown.weirdext'), 'x-file-type': 'image/jpeg' } });
  t('upload unknown-ext image (sniffed)', up.status === 200 && up.data.file?.kind === 'image', JSON.stringify(up.data).slice(0, 120));
  const fileId = up.data.file.id;

  // 12 send image msg
  const im = await call('b', 'POST', '/api/messages/send', { chatId, type: 'image', fileId });
  t('send image message', im.status === 200);

  // 13 A can download (participant)
  const dl = await call('a', 'GET', `/api/files/${fileId}`, null, { raw: true });
  t('authorized media access', dl.status === 200 && Buffer.isBuffer(dl.data) && dl.data.length === 68);

  // 14 stranger blocked from file
  const stranger = `sid_${Date.now().toString(36)}`;
  const rs = await call('s', 'POST', '/api/auth/register', { email: `${stranger}@t.dev`, username: stranger, password: 'Passw0rd1', displayName: 'S' });
  const nope = await call('s', 'GET', `/api/files/${fileId}`, null, { raw: true });
  t('stranger denied media', nope.status === 403);

  // 15 zip + py + unknown binary uploads
  const zip = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(30, 9)]);
  const uz = await call('a', 'POST', '/api/files', zip, { headers: { 'x-file-name': 'archive.zip' } });
  t('zip upload classified archive', uz.data.file?.kind === 'archive');
  const py = Buffer.from('print("hi")\n');
  const upyp = await call('a', 'POST', '/api/files', py, { headers: { 'x-file-name': 'main.py' } });
  t('python upload classified code', upyp.data.file?.kind === 'code');

  // 16 html upload must NOT be served as text/html (owner reads own file)
  const ev = Buffer.from('<script>alert(1)</script>');
  const uh = await call('a', 'POST', '/api/files', ev, { headers: { 'x-file-name': 'evil.html' } });
  const gh = await call('a', 'GET', uh.data.file?.id && `/api/files/${uh.data.file.id}`, null, { raw: true });
  t('htmlUploadServedInert', gh.status === 200 && (gh.headers.get('content-type')||'').includes('text/plain'), gh.headers.get('content-type'));

  // 17 snap flow: B uploads png snap shot 4
  const png = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47]), Buffer.alloc(80, 3)]);
  const sp = await call('b', 'POST', '/api/files', png, { headers: { 'x-file-name': 'snap.png' } });
  const snp = await call('b', 'POST', '/api/snaps/send', { fileId: sp.data.file.id, recipients: [uidA], duration: 10, singleView: true, caption: 'secret snap' });
  t('snap send', snp.status === 200 && snp.data.snapId, JSON.stringify(snp.data).slice(0, 100));
  const inbox = await call('a', 'GET', '/api/snaps');
  t('snap inbox for A', inbox.status === 200 && inbox.data.incoming.length >= 1);
  const open1 = await call('a', 'POST', `/api/snaps/${snp.data.snapId}/open`, { viewSeconds: 10 });
  t('snap open returns media', open1.status === 200 && open1.data.snap?.media?.url?.includes('/api/snaps/media/'), JSON.stringify(open1.data).slice(0, 150));
  const media1 = await call('a', 'GET', open1.data.snap.media.url.replace('/api/snaps/media/', '/api/snaps/media/'), null, { raw: true });
  t('snap media stream', media1.status === 200 && media1.data.length === 84);
  const open2 = await call('a', 'POST', `/api/snaps/${snp.data.snapId}/open`, { viewSeconds: 10 });
  t('single-view exhausted', open2.status === 410);
  // media remains reachable during the open view window (server-enforced: block begins after duration+grace)
  const mediaInWindow = await call('a', 'GET', `/api/snaps/media/${sp.data.file.id}`, null, { raw: true });
  t('snap media within view window', mediaInWindow.status === 200, String(mediaInWindow.status));
  await new Promise((r) => setTimeout(r, 13_000));
  const mediaAfter = await call('a', 'GET', `/api/snaps/media/${sp.data.file.id}`, null, { raw: true });
  t('snap media blocked after view window (single-view)', mediaAfter.status === 410 || mediaAfter.status === 403, String(mediaAfter.status));

  // 18 stories
  const sto = await call('b', 'POST', '/api/snaps/stories', { type: 'text', body: 'Vibing on VIBECHAT', visibility: 'contacts' });
  t('story create', sto.status === 200, JSON.stringify(sto.data).slice(0, 80));
  const list = await call('a', 'GET', '/api/snaps/stories');
  t('story visible to contact', list.status === 200 && JSON.stringify(list.data.others).includes('Vibing'));
  const react = await call('a', 'POST', `/api/snaps/stories/${sto.data.story.id}/react`, { emoji: '🔥' });
  t('story react', react.status === 200);
  const reply = await call('a', 'POST', `/api/snaps/stories/${sto.data.story.id}/reply`, { body: 'Nice story!' });
  t('story reply creates DM message', reply.status === 200 && reply.data.message?.meta?.storyReply === sto.data.story.id);

  // 19 group
  const grp = await call('a', 'POST', '/api/chats/group', { title: 'Test Fan Club', memberIds: [uidB] });
  t('group create', grp.status === 200);
  const gId = grp.data.chat.id;
  const gm = await call('b', 'POST', '/api/messages/send', { chatId: gId, type: 'text', body: 'hi group' });
  t('group message', gm.status === 200);

  // 20 forward
  const fw = await call('a', 'POST', '/api/messages/forward', { messageId: mid, chatIds: [gId] });
  t('forward', fw.status === 200 && fw.data.messages?.length === 1);

  // 21 AI (local engine)
  const ai = await call('a', 'POST', '/api/ai/chat', { prompt: 'hello there' });
  t('ai assistant', ai.status === 200 && ai.data.text, JSON.stringify(ai.data).slice(0, 60));

  // 22 admin authorization: member denied, admin route requires role
  const adNo = await call('a', 'GET', '/api/admin/stats');
  t('admin denied for member', adNo.status === 403);

  // 23 notifications + search
  const nf = await call('b', 'GET', '/api/notifications');
  t('notifications', nf.status === 200 && nf.data.notifications.length > 0);
  const se = await call('a', 'GET', `/api/search?q=Ben`);
  t('search', se.status === 200 && se.data.total > 0);

  // 24 delete message
  const del = await call('a', 'DELETE', `/api/messages/${mid}`);
  t('delete for everyone', del.status === 200);

  // 25 blocks: A blocks B, then B cannot DM
  const blk = await call('a', 'POST', '/api/users/block', { userId: uidB });
  t('block set', blk.status === 200);
  const dmb = await call('b', 'POST', '/api/chats/dm', { userId: uidA });
  t('blocked user cannot DM', dmb.status === 403);
};

run().then(() => console.log(results.join('\n'))).catch((e) => { console.error('CRASH', e); console.log(results.join('\n')); });
