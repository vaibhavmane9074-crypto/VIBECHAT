/*
 * VIBECHAT authentication: cookie sessions (httpOnly, SameSite=Strict).
 * Registration/login/logout/password reset (email link flow simulated locally), session list + revoke.
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { config } from './config.js';
import { q, uid, now } from './db.js';
import { V, rateLimit, ValidationError } from './security.js';

const COOKIE = 'vc_session';
const hashToken = (t) => crypto.createHmac('sha256', 'vc-session-ring').update(t).digest('hex');

export function createSession(res, userId, { device = '', ip = '' } = {}) {
  const id = uid();
  const token = uid() + uid() + crypto.randomBytes(16).toString('hex');
  const expiresAt = now() + config.sessionTtlDays * 86_400_000;
  q.run(`INSERT INTO sessions (id, userId, tokenHash, device, ip, createdAt, expiresAt, lastSeen) VALUES (?,?,?,?,?,?,?,?)`,
    id, userId, hashToken(token), device, ip, now(), expiresAt, now());
  q.run(`DELETE FROM sessions WHERE userId=? AND id != ? AND expiresAt < ?`, userId, id, now());
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', path: '/', secure: process.env.NODE_ENV === 'production', maxAge: config.sessionTtlDays * 86_400_000 });
  return { sessionId: id, token }; // token raw value is for Socket.IO auth
}
export const sessionByCookie = (req) => {
  const c = req.headers.cookie || '';
  const token = c.split(';').map((p) => p.trim()).find((p) => p.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  if (!token) return null;
  const row = q.get(`SELECT s.*, u.id uid FROM sessions s JOIN users u ON u.id=s.userId WHERE s.tokenHash=?`, hashToken(token));
  if (!row || row.expiresAt < now() || q.get(`SELECT 1 x FROM users WHERE id=? AND deletedAt IS NOT NULL`, row.userId)) return null;
  return row;
};

export function requireAuth(req, res, next) {
  const s = sessionByCookie(req);
  if (!s) return res.status(401).json({ error: 'Not signed in' });
  if (now() - (s.lastSeen || 0) > 30_000) q.run(`UPDATE sessions SET lastSeen=? WHERE id=?`, now(), s.id);
  req.user = q.get(`SELECT * FROM users WHERE id=?`, s.userId);
  req.socketToken = crypto.createHmac('sha256', 'vc-socket-rule').update(s.tokenHash).digest('hex').slice(0, 40);
  next();
}
export const optionalAuth = (req, _res, next) => {
  const s = sessionByCookie(req);
  req.user = s ? q.get(`SELECT * FROM users WHERE id=?`, s.userId) : null;
  next();
};
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  q.run(`INSERT INTO adminLogs (id, adminId, action, target, createdAt) VALUES (?,?,?,?,?)`,
    uid(), req.user.id, req.method + ' ' + (req.baseUrl + req.route?.path || req.originalUrl), JSON.stringify(req.body || {}).slice(0, 500), now());
  next();
}

export function logout(req, res) {
  const c = req.headers.cookie || '';
  const token = c.split(';').map((p) => p.trim()).find((p) => p.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  if (token) q.run(`DELETE FROM sessions WHERE tokenHash=?`, hashToken(token));
  res.clearCookie(COOKIE, { path: '/' });
}

/* ---------------- account ops ---------------- */
const RESERVED = ['admin', 'vibechat', 'support', 'root', 'system', 'ai', 'assistant', 'vibeai', 'null', 'undefined', 'moderator', 'staff'];
export async function registerUser({ email, username, password, displayName }, role = 'user') {
  email = V.email(email);
  username = V.username(username);
  V.password(password);
  const name = V.str(displayName || username, { max: 60, name: 'Display name' });
  if (RESERVED.includes(username)) throw new ValidationError('That username is reserved');
  if (q.get(`SELECT 1 x FROM users WHERE email=?`, email)) throw new ValidationError('Email already registered');
  if (q.get(`SELECT 1 x FROM users WHERE username=?`, username)) throw new ValidationError('Username is taken');
  const hash = await bcrypt.hash(password, 11);
  const id = uid();
  q.run(`INSERT INTO users (id, username, email, passwordHash, displayName, emailVerified, role, createdAt, lastSeen) VALUES (?,?,?,?,?,1,?,?,?)`,
    id, username, email, hash, name, role, now(), now());
  q.run(`INSERT INTO userSettings (userId, updatedAt) VALUES (?,?)`, id, now());
  return getUser(id);
}
export const getUser = (id) => q.get(`SELECT id, username, email, displayName, bio, statusEmoji, statusText, avatarFileId, coverFileId, accent, role, emailVerified, online, lastSeen, privLastSeen, privOnline, privProfile, privStory, readReceipts, createdAt FROM users WHERE id=?`, id);
export const passwordOk = async (user, pw) => bcrypt.compare(pw, user.passwordHash);
export const setPassword = (userId, pw) => bcrypt.hash(pw, 11).then((h) => q.run(`UPDATE users SET passwordHash=? WHERE id=?`, h, userId));
export const authLimiter = rateLimit({ bucket: 'auth', limit: config.rateLimits.authPerMin });

/* token-based flows (email verify / password reset). No SMTP in dev: codes are logged and can be minted/read via console. */
export const issueCode = (userId, purpose, ttlMs = 3600_000) => {
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  q.run(`INSERT INTO verifications (id, userId, code, purpose, expiresAt) VALUES (?,?,?,?,?)`, uid(), userId, code, purpose, now() + ttlMs);
  return code;
};
export const consumeCode = (code, purpose) => {
  const row = q.get(`SELECT * FROM verifications WHERE code=? AND purpose=? AND expiresAt > ?`, String(code || '').toUpperCase(), purpose, now());
  if (!row) return null;
  q.run(`DELETE FROM verifications WHERE id=?`, row.id);
  return row;
};
export { config };
