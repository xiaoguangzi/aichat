CREATE TABLE api_traces (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  data_json TEXT NOT NULL,
  body_json TEXT NOT NULL,
  body_bytes INTEGER NOT NULL
);
CREATE INDEX idx_api_traces_turn ON api_traces(conversation_id, turn_id, started_at);
