CREATE INDEX IF NOT EXISTS idx_messages_room_cursor
  ON messages(room_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_messages_room_sender
  ON messages(room_id, sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_reads_user
  ON message_reads(user_id, read_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_user_expiry
  ON sessions(user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry
  ON sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_media_owner_created
  ON media_files(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_orphans
  ON media_files(linked_message_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_media_unique
  ON messages(media_id) WHERE media_id IS NOT NULL;
