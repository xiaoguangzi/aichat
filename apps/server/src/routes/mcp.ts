import { Hono } from 'hono';
import { mcpServerInputSchema, mcpImportSchema } from '@aichat/shared';
import { mcpServersRepo } from '../db/repos/mcpServers.js';
import { mcpManager } from '../mcp/manager.js';
import { notFound } from '../util/errors.js';

export const mcpRoute = new Hono();

mcpRoute.get('/', (c) => c.json(mcpManager.list()));

mcpRoute.post('/', async (c) => {
  const input = mcpServerInputSchema.parse(await c.req.json());
  const rec = mcpServersRepo.create(input);
  await mcpManager.sync(rec.id);
  return c.json(mcpManager.list().find((s) => s.id === rec.id), 201);
});

mcpRoute.post('/import', async (c) => {
  const input = mcpImportSchema.parse(await c.req.json());
  const created: string[] = [];
  for (const [name, cfg] of Object.entries(input.mcpServers)) {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (mcpServersRepo.getByName(safe)) continue;
    const transport = cfg.url ? (cfg.type === 'sse' ? 'sse' : 'http') : 'stdio';
    const rec = mcpServersRepo.create({
      name: safe,
      transport,
      command: cfg.command ?? null,
      args: cfg.args ?? [],
      env: cfg.env ?? {},
      cwd: cfg.cwd ?? null,
      url: cfg.url ?? null,
      headers: cfg.headers ?? {},
      enabled: !cfg.disabled,
    });
    created.push(rec.id);
    void mcpManager.sync(rec.id);
  }
  return c.json({ created: created.length });
});

mcpRoute.put('/:id', async (c) => {
  const input = mcpServerInputSchema.partial().parse(await c.req.json());
  const rec = mcpServersRepo.update(c.req.param('id'), input);
  if (!rec) throw notFound('mcp server');
  await mcpManager.sync(rec.id);
  return c.json(mcpManager.list().find((s) => s.id === rec.id));
});

mcpRoute.delete('/:id', async (c) => {
  await mcpManager.remove(c.req.param('id'));
  if (!mcpServersRepo.delete(c.req.param('id'))) throw notFound('mcp server');
  return c.json({ ok: true });
});

mcpRoute.post('/:id/connect', async (c) => {
  await mcpManager.connect(c.req.param('id'));
  return c.json(mcpManager.list().find((s) => s.id === c.req.param('id')));
});

mcpRoute.post('/:id/disconnect', async (c) => {
  await mcpManager.disconnect(c.req.param('id'));
  return c.json(mcpManager.list().find((s) => s.id === c.req.param('id')));
});

mcpRoute.get('/:id/tools', (c) => c.json(mcpManager.toolsOf(c.req.param('id'))));
mcpRoute.get('/:id/logs', (c) => c.json(mcpManager.logs(c.req.param('id'))));
