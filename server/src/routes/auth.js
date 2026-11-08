/* VIBECHAT auth routes: register, login, logout, session mgmt, verification, password reset, account deletion/export, Google OAuth (when configured). */
import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { q, uid, now } from '../db.js';
import {
  requireAuth, logout as doLogout, createSession, registerUser, getUser, passwordOk,
  setPassword, authLimiter, issueCode, consumeCode,
} from '../auth.js';
import { V, ValidationError } from '../security.js';
import { config } from '../config.js';
import * as chat from '../services/chat.js';
import { ensureNotesChat } from './chats.js';

const router = Router();
const r = (fn) => (req, res, next) => { try { const p = fn(req, res, next); if (p?.catch) p.catch(next); } catch (e) { next(e); } };

/* --- bootstrap admin (env creds; seeded once at startup via index.js) --- */

router.post('/register', authLimiter, r(async (req, res) => {
  const user = await registerUser({
    email: req.body.email, username: req.body.username,
    password: req.body.password, displayName: req.body.displayName || req.body.username,
  });
  createSession(res, user.id, { device: req.body.device || req.get('user-agent') || '', ip: req.ip });
  ensureNotesChat(user.id);
  const code = issueCode(user.id, 'email_verify', 24 * 3600_000);
  if (!isProd()) console.log(`[vibechat] verification code for ${user.username}: ${code}`);
  res.json({ user: chat.userPub(getUser(user.id), user.id), needsVerification: true, devCode: isProd() ? undefined : code, socketToken: tokenFor(user.id) });
}));

function tokenFor(userId) {
  const sess = q.get(`SELECT * FROM sessions WHERE userId=? ORDER BY createdAt DESC LIMIT 1`, userId);
  return sess ? crypto.createHmac('sha256', 'vc-socket-rule').update(sess.tokenHash).digest('hex').slice(0, 40) : null;
}
const isProd = () => process.env.NODE_ENV === 'production';

router.post('/login', authLimiter, r(async (req, res) => {
  const ident = V.str(String(req.body.identifier || ''), { max: 254 });
  const u = q.get(`SELECT * FROM users WHERE (email=? OR username=?) AND deletedAt IS NULL`, ident.toLowerCase(), ident.toLowerCase());
  if (!u || !(await passwordOk(u, String(req.body.password || '')))) {
    await bcrypt.compare(String(req.body.password || 'x'), '$2a$11$0000000000000000000000000000000000000000000000000000').catch(() => {});
    throw new ValidationError('Incorrect email/username or password');
  }
  createSession(res, u.id, { device: req.body.device || req.get('user-agent') || '', ip: req.ip });
  // absorb any claimed admin before first login
  if (!u.claimed && q.get(`SELECT 1 x FROM specials WHERE username=?`, u.username)) {
    q.run(`UPDATE users SET role='admin' WHERE id=?`, u.id);
    q.run(`UPDATE specials SET password='' WHERE username=?`, u.username);
  }
  ensureNotesChat(u.id);
  res.json({ user: chat.userPub(getUser(u.id), u.id), socketToken: tokenFor(u.id), unfinished: [] });
}));

router.post('/logout', (req, res) => { doLogout(req, res); q.run(`UPDATE users SET online=0, lastSeen=? WHERE id=?`, now(), req.user?.id || ''); res.json({ ok: true }); });

router.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  const settings = q.get(`SELECT * FROM userSettings WHERE userId=?`, u.id);
  res.json({
    user: chat.userPub(u, u.id, { full: true }), admin: u.role === 'admin',
    socketToken: tokenFor(u.id),
    settings: settings || {},
  });
});
router.post('/me', requireAuth, r((req, res) => {
  const u = req.user;
  const up = {};
  for (const k of ['displayName', 'bio', 'statusEmoji', 'statusText', 'accent']) {
    if (req.body[k] !== undefined) up[k] = V.str(String(req.body[k]), { max: k === 'bio' ? 280 : 60, name: k });
  }
  if (req.body.avatarFileId) up.avatarFileId = String(req.body.avatarFileId).slice(0, 40);
  if (req.body.coverFileId) up.coverFileId = String(req.body.coverFileId).slice(0, 40);
  const keys = Object.keys(up);
  if (!keys.length) throw new ValidationError('Nothing to update');
  q.run(`UPDATE users SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => up[k]), u.id);
  res.json({ user: chat.userPub(getUser(u.id), u.id) });
}));

/* email verification */
router.post('/verify-email', authLimiter, (req, res) => {
  const row = consumeCode(String(req.body.code || ''), 'email_verify');
  if (!row || row.userId !== req.user?.id) return res.status(400).json({ error: 'Invalid or expired code' });
  q.run(`UPDATE users SET emailVerified=1 WHERE id=?`, req.user.id);
  res.json({ ok: true });
});
router.post('/verify-email/resend', requireAuth, (req, res) => {
  const code = issueCode(req.user.id, 'email_verify');
  if (!isProd()) console.log(`[vibechat] verification code for ${req.user.username}: ${code}`);
  res.json({ ok: true, devCode: isProd() ? undefined : code });
});

/* forgot / reset password (code-based; SMTP hook documented in docs/ARCHITECTURE.md) */
router.post('/password/reset-request', authLimiter, (req, res) => {
  const u = q.get(`SELECT * FROM users WHERE email=? AND deletedAt IS NULL`, String(req.body.email || '').toLowerCase().trim());
  if (u) {
    const code = issueCode(u.id, 'password_reset', 3600_000);
    if (!isProd()) console.log(`[vibechat] password reset code for ${u.username}: ${code}`);
  }
  res.json({ ok: true, devCode: u && !isProd() ? undefined : undefined }); // never reveal whether the email exists
});
router.post('/password/reset', authLimiter, r(async (req, res) => {
  const row = consumeCode(String(req.body.code || ''), 'password_reset');
  if (!row) throw new ValidationError('Invalid or expired code');
  V.password(req.body.password);
  await setPassword(row.userId, req.body.password);
  q.run(`DELETE FROM sessions WHERE userId=?`, row.userId);
  res.json({ ok: true });
}));
router.post('/password/change', requireAuth, authLimiter, r(async (req, res) => {
  if (!(await passwordOk(req.user, String(req.body.currentPassword || '')))) throw new ValidationError('Current password is incorrect');
  V.password(req.body.newPassword);
  await setPassword(req.user.id, req.body.newPassword);
  q.run(`DELETE FROM sessions WHERE userId=? AND id != (SELECT id FROM sessions WHERE userId=? ORDER BY lastSeen DESC LIMIT 1)`, req.user.id, req.user.id);
  res.json({ ok: true });
}));

/* sessions (multi-device) */
router.get('/sessions', requireAuth, (req, res) => {
  req.user.ck = 1;
  res.json({ sessions: q.all(`SELECT id, device, ip, createdAt, lastSeen, expiresAt FROM sessions WHERE userId=? ORDER BY lastSeen DESC`, req.user.id) });
});
router.delete('/sessions/:id', requireAuth, (req, res) => {
  const s = q.get(`SELECT * FROM sessions WHERE id=? AND userId=?`, req.params.id, req.user.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  q.run(`DELETE FROM sessions WHERE id=?`, req.params.id);
  res.json({ ok: true });
});

/* Google Sign-In — real OAuth when VC_GOOGLE_CLIENT_ID/SECRET configured, else reported as unavailable */
router.get('/google/url', (req, res) => {
  if (!process.env.VC_GOOGLE_CLIENT_ID) return res.status(501).json({ error: 'Google sign-in is not configured on this server. Set VC_GOOGLE_CLIENT_ID/VC_GOOGLE_CLIENT_SECRET.' });
  const redirect = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  const state = uid();
  q.run(`INSERT INTO specials (id, email, username, displayName, password, role, createdAt) VALUES (?,?,?,?,?, 'oauth-state', ?)`,
    state, 'oauth@state', 'state', state, 'state', now());
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(process.env.VC_GOOGLE_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=openid%20email%20profile&state=${state}` });
});
router.get('/google/callback', authLimiter, r(async (req, res) => {
  const { code, state } = req.query;
  if (!process.env.VC_GOOGLE_CLIENT_ID) return res.status(501).send('Google sign-in not configured');
  const valid = q.get(`SELECT * FROM specials WHERE id=? AND role='oauth-state'`, String(state || ''));
  q.run(`DELETE FROM specials WHERE id=?`, String(state || ''));
  if (!valid) return res.status(400).send('Invalid OAuth state');
  const tr = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.VC_GOOGLE_CLIENT_ID, client_secret: process.env.VC_GOOGLE_CLIENT_SECRET || '', redirect_uri: `${req.protocol}://${req.get('host')}/api/auth/google/callback`, grant_type: 'authorization_code' }),
  }).then((r2) => r2.json());
  if (!tr.access_token) return res.status(400).send('OAuth exchange failed');
  const profile = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: `Bearer ${tr.access_token}` } }).then((r2) => r2.json());
  let user = q.get(`SELECT * FROM users WHERE email=?`, String(profile.email || '').toLowerCase());
  if (!user) user = await registerUser({ email: profile.email, username: `${(profile.given_name || 'user').toLowerCase().replace(/[^a-z0-9_]/g, '')}_${uid().slice(0, 5)}`, password: crypto.randomBytes(20).toString('hex'), displayName: profile.name || profile.email });
  createSession(res, user.id, { device: 'google-oauth', ip: req.ip });
  res.redirect('/?oauth=1');
}));

/* account data export / deletion */
router.get('/export', requireAuth, (req, res) => {
  const id = req.user.id;
  const pack = {
    profile: chat.userPub(getUser(id), id),
    contacts: q.all(`SELECT * FROM contacts WHERE a=? OR b=?`, id, id),
    chats: q.all(`SELECT * FROM chats c WHERE id IN (SELECT chatId FROM chatMembers WHERE userId=?)`, id),
    messages: q.all(`SELECT * FROM messages WHERE chatId IN (SELECT chatId FROM chatMembers WHERE userId=?) ORDER BY createdAt`, id),
    stories: q.all(`SELECT * FROM stories WHERE userId=?`, id),
    calls: q.all(`SELECT * FROM calls WHERE initiator=? OR callee=?`, id, id),
    files: q.all(`SELECT id, originalName, size, kind, createdAt FROM files WHERE ownerId=?`, id),
    settings: q.get(`SELECT * FROM userSettings WHERE userId=?`, id),
    exportedAt: now(),
  };
  res.setHeader('Content-Disposition', 'attachment; filename="vibechat-export.json"');
  res.json(pack);
});
router.post('/delete-account', requireAuth, r(async (req, res) => {
  if (!(await passwordOk(req.user, String(req.body.password || '')))) throw new ValidationError('Password required to delete your account');
  const id = req.user.id;
  doLogout(req, res);
  // anonymize; conversations get tombstones via column checks
  q.run(`UPDATE users SET deletedAt=?, email=?, username=?, displayName='Deleted user', passwordHash=?, bio='', avatarFileId=NULL WHERE id=?`,
    now(), `deleted-${id}@vibechat.invalid`, `deleted_${id.slice(0, 8)}`, '$2a$11$' + 'd'.repeat(53), id);
  q.run(`UPDATE sessions SET expiresAt=0 WHERE userId=?`, id);
  res.json({ ok: true });
}));

export default router;
