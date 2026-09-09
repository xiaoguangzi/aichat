-- Sidebar groups: named folders a conversation can be dragged in and out of.
CREATE TABLE IF NOT EXISTS conversation_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  collapsed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- No REFERENCES clause: ALTER TABLE ADD COLUMN with a foreign key is restricted while
-- foreign_keys=ON, so groupsRepo.delete() clears the column itself.
ALTER TABLE conversations ADD COLUMN group_id TEXT;
CREATE INDEX IF NOT EXISTS idx_conversations_group ON conversations(group_id);
