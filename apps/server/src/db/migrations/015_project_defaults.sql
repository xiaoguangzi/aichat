-- A group becomes a "project": it can carry defaults that new conversations in it inherit.
-- Stored on the group rather than copied at create time, so changing the project updates what the
-- next conversation gets without rewriting existing conversations.
ALTER TABLE conversation_groups ADD COLUMN instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE conversation_groups ADD COLUMN model_id TEXT;
-- JSON: temperature / maxTokens / enabledMcpServers / enabledSkills / reasoning, the subset of
-- conversationSettings that makes sense as a project default.
ALTER TABLE conversation_groups ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}';
