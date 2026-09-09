import { Hono } from 'hono';
import { providerInputSchema, modelInputSchema, resolveReasoningLevel } from '@aichat/shared';
import { modelsRepo, providersRepo, toPublic } from '../db/repos/providers.js';
import { evictAdapter, getAdapter } from '../llm/registry.js';
import { notFound, badRequest } from '../util/errors.js';

export const providersRoute = new Hono();

const pub = (id: string) => {
  const p = providersRepo.get(id);
  if (!p) throw notFound('provider');
  return toPublic(p, modelsRepo.listByProvider(id));
};

providersRoute.get('/', (c) => c.json(providersRepo.list().map((p) => toPublic(p, modelsRepo.listByProvider(p.id)))));

providersRoute.post('/', async (c) => {
  const input = providerInputSchema.parse(await c.req.json());
  const p = providersRepo.create(input);
  return c.json(pub(p.id), 201);
});

providersRoute.put('/:id', async (c) => {
  const input = providerInputSchema.partial().parse(await c.req.json());
  const p = providersRepo.update(c.req.param('id'), input);
  if (!p) throw notFound('provider');
  evictAdapter(p.id);
  return c.json(pub(p.id));
});

providersRoute.delete('/:id', (c) => {
  if (!providersRepo.delete(c.req.param('id'))) throw notFound('provider');
  evictAdapter(c.req.param('id'));
  return c.json({ ok: true });
});

providersRoute.get('/:id/remote-models', async (c) => {
  const p = providersRepo.get(c.req.param('id'));
  if (!p) throw notFound('provider');
  const models = await getAdapter(p).listModels();
  return c.json(models);
});

providersRoute.post('/:id/test', async (c) => {
  const p = providersRepo.get(c.req.param('id'));
  if (!p) throw notFound('provider');
  const body = (await c.req.json().catch(() => ({}))) as { model?: string };
  const models = modelsRepo.listByProvider(p.id);
  const m = (body.model && models.find((x) => x.modelId === body.model)) || models[0];
  if (!m) throw badRequest('No model to test with. Add a model first.');
  const started = Date.now();
  let text = '';
  // Mirror a real chat request: capability-only model config, no effort chosen (auto).
  for await (const ev of getAdapter(p).stream({
    model: m.modelId,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Say "ok".' }] }],
    maxTokens: Math.min(m.maxOutput ?? 1024, 1024),
    reasoning: resolveReasoningLevel(m, null),
    adaptive: m.adaptive,
    reasoningMap: m.reasoningMap,
  })) {
    if (ev.type === 'text_delta') text += ev.text;
    if (ev.type === 'thinking_reclassify') text = '';
  }
  return c.json({ ok: true, ms: Date.now() - started, text });
});

providersRoute.post('/:id/models', async (c) => {
  const p = providersRepo.get(c.req.param('id'));
  if (!p) throw notFound('provider');
  const input = modelInputSchema.parse(await c.req.json());
  const m = modelsRepo.upsert(p.id, input);
  return c.json(m, 201);
});

providersRoute.put('/:id/models/:mid', async (c) => {
  const m = modelsRepo.get(c.req.param('mid'));
  if (!m || m.providerId !== c.req.param('id')) throw notFound('model');
  const input = modelInputSchema.partial().parse(await c.req.json());
  const updated = modelsRepo.upsert(m.providerId, { ...input, modelId: input.modelId ?? m.modelId });
  return c.json(updated);
});

providersRoute.delete('/:id/models/:mid', (c) => {
  if (!modelsRepo.delete(c.req.param('mid'))) throw notFound('model');
  return c.json({ ok: true });
});
