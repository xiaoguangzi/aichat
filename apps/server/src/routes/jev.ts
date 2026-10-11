import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { jevRequestSchema, jevSettingsSchema, jevRoutingSettingsSchema, type JevSettings } from '@aichat/shared';
import { readJevSecret as read, readRoutingSettings, validateRoutingSettings, type JevSecret } from '../decisions/routing.js';
import { settingsRepo } from '../db/repos/settings.js';
import { evaluateJev } from '../decisions/jev.js';
import { badRequest } from '../util/errors.js';

const publicSettings = (secret: JevSecret): JevSettings => ({ model: secret.model, hasApiKey: !!secret.apiKey });
export const jevRoute = new Hono();
jevRoute.use('*', bodyLimit({ maxSize: 1024 * 1024, onError: c => c.json({ code: 'too_large', message: 'Jev 请求不能超过 1 MiB' }, 413) }));
jevRoute.get('/settings', c => c.json(publicSettings(read())));
jevRoute.get('/routing', c => c.json(readRoutingSettings()));
jevRoute.put('/routing', async c => {
  const input = jevRoutingSettingsSchema.parse(await c.req.json().catch(() => { throw badRequest('请求必须是有效的 JSON'); }));
  validateRoutingSettings(input);
  settingsRepo.set('decisions.jev.routing', input);
  return c.json(input);
});
jevRoute.put('/settings', async c => {
  const input = jevSettingsSchema.parse(await c.req.json().catch(() => { throw badRequest('请求必须是有效的 JSON'); }));
  const current = read();
  const secret = { model: input.model, apiKey: input.apiKey === undefined ? current.apiKey : input.apiKey ?? '' };
  settingsRepo.set('decisions.jev', secret);
  return c.json(publicSettings(secret));
});
jevRoute.post('/evaluate', async c => {
  const input = jevRequestSchema.parse(await c.req.json().catch(() => { throw badRequest('请求必须是有效的 JSON'); }));
  const { apiKey } = read();
  if (!apiKey) throw badRequest('请先在 Jev 决策页面保存 TypeSafe API Key');
  return c.json(await evaluateJev(input, apiKey, c.req.raw.signal));
});
