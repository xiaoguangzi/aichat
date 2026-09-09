import { Hono } from 'hono';
import { appSettingsSchema } from '@aichat/shared';
import { settingsRepo } from '../db/repos/settings.js';
import { modelsRepo } from '../db/repos/providers.js';
import { badRequest } from '../util/errors.js';

export const settingsRoute = new Hono();
settingsRoute.get('/', c => c.json({ titleModelId: settingsRepo.get<string | null>('title.modelId', null) }));
settingsRoute.put('/', async c => {
  const input = appSettingsSchema.parse(await c.req.json());
  if (input.titleModelId && !modelsRepo.get(input.titleModelId)) throw badRequest('标题模型不存在，请先在模型服务中添加。');
  settingsRepo.set('title.modelId', input.titleModelId);
  return c.json(input);
});
