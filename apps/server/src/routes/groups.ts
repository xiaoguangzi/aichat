import { Hono } from 'hono';
import { groupInputSchema, groupPatchSchema, groupReorderSchema } from '@aichat/shared';
import { groupsRepo } from '../db/repos/groups.js';
import { notFound } from '../util/errors.js';

export const groupsRoute = new Hono();

groupsRoute.get('/', (c) => c.json(groupsRepo.list()));

groupsRoute.post('/', async (c) => {
  const input = groupInputSchema.parse(await c.req.json());
  return c.json(groupsRepo.create(input), 201);
});

groupsRoute.post('/reorder', async (c) => {
  const { ids } = groupReorderSchema.parse(await c.req.json());
  groupsRepo.reorder(ids);
  return c.json(groupsRepo.list());
});

groupsRoute.put('/:id', async (c) => {
  const input = groupPatchSchema.parse(await c.req.json());
  const g = groupsRepo.update(c.req.param('id'), input);
  if (!g) throw notFound('group');
  return c.json(g);
});

/** Deletes the group only — the conversations inside it become ungrouped. */
groupsRoute.delete('/:id', (c) => {
  if (!groupsRepo.delete(c.req.param('id'))) throw notFound('group');
  return c.json({ ok: true });
});
