-- Declared context window in tokens. Optional and user-entered: it is used only to show an
-- occupancy ratio next to the composer. There is no reliable way to discover the real window for an
-- arbitrary compatible endpoint, and guessing one would produce a misleading percentage, so null
-- means "not declared" and the UI shows the raw estimate without a ratio.
ALTER TABLE models ADD COLUMN context_window INTEGER;
