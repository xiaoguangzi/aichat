-- Pinned conversations sort to the top of their section. Separate from group/sort because a pin is
-- about attention, not filing: it must not move a chat out of its project.
ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_conversations_pinned ON conversations(pinned, updated_at);
