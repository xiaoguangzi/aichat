-- Unify per-model thinking/effort into a single reasoning dial.
ALTER TABLE models ADD COLUMN reasoning TEXT;
ALTER TABLE models ADD COLUMN reasoning_map TEXT;
ALTER TABLE models ADD COLUMN adaptive INTEGER;

-- Backfill: keep the old mode; 'off' stays off, effort value becomes the level, otherwise medium.
UPDATE models SET reasoning = CASE
  WHEN thinking = 'off' THEN 'off'
  WHEN effort IS NOT NULL THEN effort
  ELSE 'medium'
END;
-- adaptive=true only for models previously configured as thinking='adaptive' (exact behavior preservation).
UPDATE models SET adaptive = CASE WHEN thinking = 'adaptive' THEN 1 ELSE 0 END;
