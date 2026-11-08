/*
 * VIBECHAT database layer — sqlite (node:sqlite).
 * All collections from the spec map to tables here; large media lives on disk (see services/storage.js).
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
export const DB_PATH = process.env.VC_DB_PATH || path.join(DATA_DIR, 'vibechat.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

export const now = () => Date.now();
export const uid = () => randomUUID().replace(/-/g, '');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  passwordHash TEXT NOT NULL,
  displayName TEXT NOT NULL,
  bio TEXT DEFAULT '',
  statusEmoji TEXT DEFAULT '',
  statusText TEXT DEFAULT '',
  avatarFileId TEXT,
  coverFileId TEXT,
  accent TEXT DEFAULT '#7c5cff',
  emailVerified INTEGER DEFAULT 0,
  role TEXT DEFAULT 'user' CHECK (role IN ('user','admin')),
  privDM TEXT DEFAULT 'everyone',
  online INTEGER DEFAULT 0,
  lastSeen INTEGER,
  deletedAt INTEGER,
  privLastSeen TEXT DEFAULT 'everyone' CHECK (privLastSeen IN ('everyone','contacts','nobody')),
  privOnline TEXT DEFAULT 'everyone',
  privProfile TEXT DEFAULT 'everyone',
  privStory TEXT DEFAULT 'contacts',
  readReceipts INTEGER DEFAULT 1,
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS userSettings (
  userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notifications TEXT DEFAULT '{}',      -- json: sounds, categories, push
  appearance TEXT DEFAULT '{}',         -- json: theme mode, wallpaper, fonts
  storageAllowAdultless_mode TEXT DEFAULT '', -- reserved
  extra TEXT DEFAULT '{}',
  updatedAt INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tokenHash TEXT NOT NULL UNIQUE,
  device TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,
  lastSeen INTEGER
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(userId);

CREATE TABLE IF NOT EXISTS blocks (
  blocker TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  createdAt INTEGER NOT NULL,
  PRIMARY KEY (blocker, blocked)
);

CREATE TABLE IF NOT EXISTS contactRequests (
  id TEXT PRIMARY KEY,
  requester TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  createdAt INTEGER NOT NULL,
  respondedAt INTEGER,
  UNIQUE(requester, target)
);
CREATE INDEX IF NOT EXISTS ix_cr_target ON contactRequests(target);

CREATE TABLE IF NOT EXISTS contacts (
  a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  createdAt INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('dm','group','community','channel','notes')),
  title TEXT DEFAULT '',
  description TEXT DEFAULT '',
  avatarFileId TEXT,
  ownerId TEXT,
  dmKey TEXT UNIQUE,
  communityId TEXT,
  disappearAfter INTEGER DEFAULT 0,     -- seconds; 0 = off
  wallpaper TEXT DEFAULT '',
  inviteToken TEXT UNIQUE,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_chats_community ON chats(communityId);

CREATE TABLE IF NOT EXISTS chatMembers (
  chatId TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joinedAt INTEGER NOT NULL,
  lastReadAt INTEGER DEFAULT 0,
  lastDeliveredAt INTEGER DEFAULT 0,
  typingAt INTEGER DEFAULT 0,
  muted INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  PRIMARY KEY (chatId, userId)
);
CREATE INDEX IF NOT EXISTS ix_cm_user ON chatMembers(userId);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chatId TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  senderId TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN
    ('text','image','video','audio','voice','file','sticker','gif','system','poll','game','snap','location','contact')),
  body TEXT DEFAULT '',
  meta TEXT DEFAULT '{}',               -- json: {fileId, name, size, mime, snapId, pollTitle, options, votes, game:{...}, durationMs, forwardedFrom,...}
  replyTo TEXT REFERENCES messages(id) ON DELETE SET NULL,
  editedAt INTEGER,
  editHistory TEXT DEFAULT '[]',
  pinned INTEGER DEFAULT 0,
  disappears INTEGER DEFAULT 0,         -- seconds after read
  expiresAt INTEGER,                    -- absolute, set server-side when first read (backend-enforced)
  scheduledFor INTEGER,                 -- future delivery
  deletedAt INTEGER,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_msg_chat ON messages(chatId, createdAt DESC);

CREATE TABLE IF NOT EXISTS reactions (
  messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  PRIMARY KEY (messageId, userId, emoji)
);

CREATE TABLE IF NOT EXISTS stars (
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  createdAt INTEGER NOT NULL,
  PRIMARY KEY (userId, messageId)
);

CREATE TABLE IF NOT EXISTS messageViews (
  messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewDuration INTEGER NOT NULL,        -- seconds user chose to keep the view open
  openedAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,           -- absolute expiry enforced by backend
  PRIMARY KEY (messageId, userId)
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL,
  originalName TEXT NOT NULL,
  ext TEXT DEFAULT '',
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','video','audio','document','archive','code','other')),
  storedName TEXT NOT NULL,             -- on-disk name under files dir (never served directly)
  createdAt INTEGER NOT NULL,
  ttl INTEGER DEFAULT 0,                -- seconds; >0 => backend-deleted after expiry (snaps)
  expiresAt INTEGER DEFAULT 0,
  deletedAt INTEGER
);
CREATE INDEX IF NOT EXISTS ix_files_owner ON files(ownerId, createdAt DESC);

CREATE TABLE IF NOT EXISTS snapRecipients (
  snapId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state TEXT DEFAULT 'delivered' CHECK (state IN ('delivered','opened','replayed','expired')),
  openedAt INTEGER,
  PRIMARY KEY (snapId, userId)
);

CREATE TABLE IF NOT EXISTS snaps (
  id TEXT PRIMARY KEY,
  senderId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fileId TEXT NOT NULL REFERENCES files(id),
  caption TEXT DEFAULT '',
  duration INTEGER DEFAULT 10,          -- seconds
  singleView INTEGER DEFAULT 1,
  expiresAt INTEGER NOT NULL,           -- backend-enforced
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('text','photo','video')),
  body TEXT DEFAULT '',
  bgColor TEXT DEFAULT '',
  fileId TEXT REFERENCES files(id) ON DELETE SET NULL,
  visibility TEXT DEFAULT 'contacts' CHECK (visibility IN ('contacts','custom','public')),
  audience TEXT DEFAULT '[]',           -- json array of allowed userIds (custom)
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_stories_user ON stories(userId, expiresAt);

CREATE TABLE IF NOT EXISTS storyViews (
  storyId TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  createdAt INTEGER NOT NULL,
  PRIMARY KEY (storyId, userId)
);
CREATE TABLE IF NOT EXISTS storyReactions (
  storyId TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  PRIMARY KEY (storyId, userId)
);

CREATE TABLE IF NOT EXISTS pollVotes (
  messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  optionIndex INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  PRIMARY KEY (messageId, userId)
);

CREATE TABLE IF NOT EXISTS verifications (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('email_verify','password_reset')),
  expiresAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS communities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  avatarFileId TEXT,
  ownerId TEXT NOT NULL REFERENCES users(id),
  isPublic INTEGER DEFAULT 1,
  inviteToken TEXT UNIQUE,
  createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS communityMembers (
  communityId TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joinedAt INTEGER NOT NULL,
  PRIMARY KEY (communityId, userId)
);

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  chatId TEXT REFERENCES chats(id) ON DELETE SET NULL,
  initiator TEXT NOT NULL REFERENCES users(id),
  callee TEXT NOT NULL REFERENCES users(id),
  type TEXT DEFAULT 'audio' CHECK (type IN ('audio','video')),
  status TEXT DEFAULT 'ringing' CHECK (status IN ('ringing','answered','ended','missed','declined')),
  startedAt INTEGER NOT NULL,
  answeredAt INTEGER,
  endedAt INTEGER,
  duration INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  data TEXT DEFAULT '{}',
  readAt INTEGER,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(userId, createdAt DESC);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter TEXT NOT NULL REFERENCES users(id),
  targetType TEXT NOT NULL CHECK (targetType IN ('user','message','chat','story','snap','channel','community')),
  targetId TEXT NOT NULL,
  reason TEXT DEFAULT '',
  status TEXT DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  createdAt INTEGER NOT NULL,
  resolvedAt INTEGER,
  resolvedBy TEXT
);

CREATE TABLE IF NOT EXISTS adminLogs (
  id TEXT PRIMARY KEY,
  adminId TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target TEXT DEFAULT '',
  detail TEXT DEFAULT '{}',
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT DEFAULT 'web',
  pushEndpoint TEXT,
  pushKeys TEXT,
  name TEXT DEFAULT '',
  createdAt INTEGER NOT NULL,
  UNIQUE(pushEndpoint)
);

CREATE TABLE IF NOT EXISTS aiMessages (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ai_user ON aiMessages(userId, createdAt);

CREATE TABLE IF NOT EXISTS specials (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  username TEXT NOT NULL,
  displayName TEXT NOT NULL,
  password TEXT NOT NULL,     -- plaintext retained ONLY until first login hashes it, then cleared
  role TEXT DEFAULT 'admin',
  createdAt INTEGER
);
CREATE TABLE IF NOT EXISTS chatMembers_filesMap (x TEXT); -- reserved, cleanup below
DROP TABLE IF EXISTS chatMembers_filesMap;
`);

/* small migrations for databases created before privDM existed */
try {
  const hasPrivDM = db.prepare(`PRAGMA table_info(users)`).all().some((c) => c.name === 'privDM');
  if (!hasPrivDM) db.exec(`ALTER TABLE users ADD COLUMN privDM TEXT DEFAULT 'everyone'`);
} catch {}

/* databases created before delivery receipts existed */
try {
  const hasDelivered = db.prepare(`PRAGMA table_info(chatMembers)`).all().some((c) => c.name === 'lastDeliveredAt');
  if (!hasDelivered) db.exec(`ALTER TABLE chatMembers ADD COLUMN lastDeliveredAt INTEGER DEFAULT 0`);
} catch {}

/* ---------- query helpers ---------- */
export const q = {
  get: (sql, ...p) => db.prepare(sql).get(...p),
  all: (sql, ...p) => db.prepare(sql).all(...p),
  run: (sql, ...p) => {
    try { return db.prepare(sql).run(...p); }
    catch (e) { const x = new Error(`${e.message} :: sql=${sql.slice(0, 200)} :: args=${JSON.stringify(p).slice(0, 300)}`); x.stack = `${x.name}: ${x.message}\n` + e.stack; throw x; }
  },
};
export default db;
