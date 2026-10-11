-- Attribute each assistant message to the model that produced it. A conversation keeps one model
-- at a time but that model can be switched between turns, so the existing conversation-level
-- model_id cannot answer "which model wrote this reply" after the fact.
-- Stored as one JSON snapshot (id / endpoint model / provider name / display label) so history
-- stays readable after a model is renamed or deleted; no backfill is possible for old messages.
ALTER TABLE messages ADD COLUMN model_json TEXT;
