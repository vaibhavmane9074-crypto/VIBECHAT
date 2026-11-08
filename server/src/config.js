/* VIBECHAT configuration — all secrets from environment, never committed. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  appName: 'VIBECHAT',
  tagline: 'Beyond Messaging.',
  port: Number(process.env.PORT || 4411),
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.join(__dirname, '..', '..', 'data'),
  publicDir: path.join(__dirname, '..', '..', 'public'),
  clientDistDir: path.join(__dirname, '..', '..', 'client', 'dist'),
  uploadMaxBytes: Number(process.env.VC_UPLOAD_MAX_MB || 200) * 1024 * 1024,
  sessionTtlDays: Number(process.env.VC_SESSION_TTL_DAYS || 30),
  snapDefaultTtlHours: Number(process.env.VC_SNAP_TTL_HOURS || 24),
  storyTtlHours: Number(process.env.VC_STORY_TTL_HOURS || 24),
  snapViewSecondsMax: Number(process.env.VC_SNAP_VIEW_MAX_S || 60),
  aiProvider: process.env.VC_AI_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : process.env.GEMINI_API_KEY ? 'gemini' : 'local'),
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  geminiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  adminBootstrap: {
    email: process.env.VC_ADMIN_EMAIL || 'admin@vibechat.app',
    username: process.env.VC_ADMIN_USERNAME || '',
    displayName: process.env.VC_ADMIN_DISPLAYNAME || 'Vibe Admin',
    password: process.env.VC_ADMIN_PASSWORD || '',
  },
  rateLimits: {
    apiPerMin: Number(process.env.VC_RATE_API || 300),
    authPerMin: Number(process.env.VC_RATE_AUTH || 20),
    uploadPerMin: Number(process.env.VC_RATE_UPLOAD || 30),
  },
  turn: {
    url: process.env.TURN_URL || '',
    user: process.env.TURN_USER || '',
    pass: process.env.TURN_PASS || '',
  },
};
