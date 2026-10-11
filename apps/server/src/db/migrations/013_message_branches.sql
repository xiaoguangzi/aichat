-- Conversation branching. Regenerating or editing no longer deletes the previous reply: the new
-- message becomes a sibling that shares the same parent, and the conversation records which path is
-- currently being viewed. Old rows keep parent_id NULL and simply render as one visible chain;
-- there is no attempt to reconstruct a tree for history that was already flattened by the previous
-- delete-based behaviour.
ALTER TABLE messages ADD COLUMN parent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(conversation_id, parent_id);

-- JSON array of message ids forming the visible path (root first). Not a foreign key collection:
-- stale ids are tolerated and resolved against the rows that still exist.
ALTER TABLE conversations ADD COLUMN active_branch TEXT;
