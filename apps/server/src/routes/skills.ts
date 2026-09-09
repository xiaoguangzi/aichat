import { Hono } from 'hono';
import { skillRegistry } from '../skills/registry.js';
import { notFound } from '../util/errors.js';
import { config } from '../config.js';

export const skillsRoute = new Hono();

const info = (s: ReturnType<typeof skillRegistry.list>[number]) => {
  const { body: _body, ...rest } = s;
  return rest;
};

skillsRoute.get('/', (c) => c.json({ dir: config.skillsDir, skills: skillRegistry.list().map(info), warnings: skillRegistry.getWarnings() }));

skillsRoute.post('/rescan', (c) => {
  skillRegistry.scan();
  return c.json({ skills: skillRegistry.list().map(info), warnings: skillRegistry.getWarnings() });
});

skillsRoute.get('/:name', (c) => {
  const s = skillRegistry.get(c.req.param('name'));
  if (!s) throw notFound('skill');
  return c.json(s);
});

skillsRoute.put('/:name/auto-approve', async (c) => {
  const s = skillRegistry.get(c.req.param('name'));
  if (!s) throw notFound('skill');
  const body = (await c.req.json()) as { autoApprove: boolean };
  skillRegistry.setAutoApprove(s.name, !!body.autoApprove);
  return c.json(info(skillRegistry.get(s.name)!));
});
