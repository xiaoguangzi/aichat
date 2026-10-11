import { Hono } from 'hono';
import { searchQuerySchema } from '@aichat/shared';
import { searchIndex, searchMessages } from '../search.js';

export const searchRoute = new Hono();

/** Message-level search across conversations, with optional filters. */
searchRoute.get('/', (c) => {
  const options = searchQuerySchema.parse({
    q: c.req.query('q') ?? '',
    conversationId: c.req.query('conversationId') || undefined,
    groupId: c.req.query('groupId') || undefined,
    role: c.req.query('role') || undefined,
    since: c.req.query('since') || undefined,
    limit: c.req.query('limit') || undefined,
  });
  const { q, ...filters } = options;
  return c.json(searchMessages(q, filters));
});

/**
 * Backfill rows the index never saw (fresh migration, interrupted write). Cheap when there is
 * nothing to do, so it is safe to call on demand from the settings page.
 */
searchRoute.post('/reindex', (c) => c.json({ indexed: searchIndex.reindexMissing(), total: searchIndex.count() }));
