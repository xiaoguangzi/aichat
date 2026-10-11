-- Full-text index over message text, for "where did I discuss this" searches.
--
-- The `trigram` tokenizer is required rather than the default `unicode61`: unicode61 treats a run of
-- Chinese characters as one token, so MATCH '上下文' finds nothing in a Chinese conversation, which
-- is the main thing this index exists for. Trigram indexes 3-character windows and therefore needs
-- queries of at least 3 characters; shorter needles fall back to a LIKE scan in the search route.
--
-- Only text is indexed: thinking and tool arguments are noise for a human search. Tool *results*
-- are included because the useful part of a web search often lives there.
--
-- Deliberately a regular FTS5 table, not contentless: the indexed body is derived from the block
-- JSON rather than being a column of `messages`, so an external-content table has nothing to read,
-- and a contentless one cannot DELETE (which message deletion, edits and orphan pruning all need).
-- The cost is one extra copy of the message text, which is small next to the request log.
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  body,
  tokenize='trigram'
);
