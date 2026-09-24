CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(
  message_id UNINDEXED,
  room_id UNINDEXED,
  text,
  tokenize='trigram'
);

INSERT INTO message_search (message_id, room_id, text)
SELECT m.id, m.room_id, m.text
FROM messages m
WHERE m.deleted_at IS NULL AND m.text IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM message_search s WHERE s.message_id = m.id);

CREATE TRIGGER IF NOT EXISTS messages_search_insert
AFTER INSERT ON messages
WHEN NEW.deleted_at IS NULL AND NEW.text IS NOT NULL
BEGIN
  INSERT INTO message_search(message_id, room_id, text) VALUES (NEW.id, NEW.room_id, NEW.text);
END;

CREATE TRIGGER IF NOT EXISTS messages_search_update
AFTER UPDATE OF text, deleted_at ON messages
BEGIN
  DELETE FROM message_search WHERE message_id = OLD.id;
  INSERT INTO message_search(message_id, room_id, text)
  SELECT NEW.id, NEW.room_id, NEW.text
  WHERE NEW.deleted_at IS NULL AND NEW.text IS NOT NULL;
END;

CREATE TRIGGER IF NOT EXISTS messages_search_delete
AFTER DELETE ON messages
BEGIN
  DELETE FROM message_search WHERE message_id = OLD.id;
END;
