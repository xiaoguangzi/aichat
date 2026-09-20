import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { jevRequestSchema, jevSettingsSchema, type JevSettings } from '@aichat/shared';
import { settingsRepo } from '../db/repos/settings.js';
import { evaluateJev } from '../decisions/jev.js';
import { badRequest } from '../util/errors.js';

interface JevSecret { model: string; apiKey: string }
const read = () => settingsRepo.get<JevSecret>('decisions.jev', { model: 'jev-latest', apiKey: '' });
const publicSettings = (secret: JevSecret): JevSettings => ({ model: secret.model, hasApiKey: !!secret.apiKey });
export const jevRoute = new Hono();
jevRoute.use('*', bodyLimit({ maxSize: 1024 * 1024, onError: c => c.json({ code: 'too_large', message: 'Jev 请求不能超过 1 MiB' }, 413) }));
jevRoute.get('/settings', c => c.json(publicSettings(read())));
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
