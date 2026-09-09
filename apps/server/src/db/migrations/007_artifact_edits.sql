CREATE TABLE artifact_edits (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX artifact_edits_conversation ON artifact_edits(conversation_id, created_at);
