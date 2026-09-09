CREATE TABLE request_diagnostics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  data_json TEXT NOT NULL
);
CREATE INDEX idx_request_diagnostics_conv ON request_diagnostics(conversation_id, id);
