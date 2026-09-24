CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE CHECK (username IN ('Amir', 'Nazi')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  ip_hash TEXT,
  user_agent_hash TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  room_id TEXT NOT NULL CHECK (room_id = 'private-main'),
  text TEXT,
  message_type TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'video')),
  media_id TEXT,
  reply_to_id TEXT,
  client_message_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'deleted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  deleted_at INTEGER,
  FOREIGN KEY (sender_id) REFERENCES users(id),
  FOREIGN KEY (reply_to_id) REFERENCES messages(id),
  UNIQUE (sender_id, client_message_id)
);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reaction TEXT NOT NULL CHECK (reaction = 'heart'),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS message_reads (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media_files (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  room_id TEXT NOT NULL CHECK (room_id = 'private-main'),
  r2_key TEXT NOT NULL UNIQUE,
  thumb_r2_key TEXT UNIQUE,
  declared_mime_type TEXT NOT NULL,
  detected_mime_type TEXT,
  size INTEGER NOT NULL,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'video')),
  original_uploaded INTEGER NOT NULL DEFAULT 0,
  thumbnail_uploaded INTEGER NOT NULL DEFAULT 0,
  linked_message_id TEXT,
  created_at INTEGER NOT NULL,
  uploaded_at INTEGER,
  FOREIGN KEY (owner_id) REFERENCES users(id),
  FOREIGN KEY (linked_message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key_hash TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  first_failure_at INTEGER NOT NULL,
  blocked_until INTEGER
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  event_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  metadata_code TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Initial credentials use a lightweight salted SHA-256 hash for Workers Free, never plaintext.
-- Re-applying this migration does not overwrite changed passwords or delete data.
INSERT OR IGNORE INTO users
  (id, username, password_hash, password_salt, password_iterations, created_at, updated_at)
VALUES
  ('user_amir', 'Amir', 'Z2iXvrROPSb7zo4-kFGM0UWDSbYQ6f5loumREcDuiuU', 'fB9XiJ_j4V2O2WvIUQMpWQ', 0, unixepoch() * 1000, unixepoch() * 1000),
  ('user_nazi', 'Nazi', 'CPDOhHE-br4mf0M_LIQl1NivWpGbPKB9D5Rbp58p--c', 'I92XB30FwyWlR42Ta-1SpQ', 0, unixepoch() * 1000, unixepoch() * 1000);
