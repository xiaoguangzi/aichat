import { Hono } from 'hono';
import { appSettingsSchema, traceRetentionSchema } from '@aichat/shared';
import { settingsRepo } from '../db/repos/settings.js';
import { modelsRepo } from '../db/repos/providers.js';
import { badRequest } from '../util/errors.js';
import { pruneTraces, storageStats, vacuumDb, writeRetention } from '../db/maintenance.js';
import { readRetention } from '../db/retention.js';
import { activeRuns } from '../agent/runs.js';
import { backupList, createBackup } from '../db/backup.js';

export const settingsRoute = new Hono();

/** A generating conversation is never pruned: its log is live evidence for the open run. */
const protectedIds = () => [...activeRuns.keys()];

settingsRoute.get('/', c => c.json({
  titleModelId: settingsRepo.get<string | null>('title.modelId', null),
  traceRetention: readRetention(),
}));

settingsRoute.put('/', async c => {
  const input = appSettingsSchema.parse(await c.req.json());
  if (input.titleModelId && !modelsRepo.get(input.titleModelId)) throw badRequest('标题模型不存在，请先在模型服务中添加。');
  settingsRepo.set('title.modelId', input.titleModelId);
  let retention = readRetention();
  if (input.traceRetention) {
    retention = writeRetention(traceRetentionSchema.parse(input.traceRetention));
    // Lowering a limit takes effect now, not at the next request.
    pruneTraces({ retention, protectedConversationIds: protectedIds(), force: true, vacuum: false });
  }
  return c.json({ titleModelId: input.titleModelId, traceRetention: retention });
});

settingsRoute.get('/storage', c => c.json(storageStats()));

settingsRoute.post('/storage/prune', c => {
  // `keep` (default) honours retention; `hard` is the explicit "clear the log" action.
  const hard = c.req.query('mode') === 'hard';
  const vacuum = c.req.query('vacuum') === 'true';
  const retention = readRetention();
  return c.json(pruneTraces({
    retention: hard ? { ...retention, maxCount: 0 } : retention,
    protectedConversationIds: protectedIds(),
    force: true,
    vacuum,
  }));
});

settingsRoute.post('/storage/vacuum', c => c.json({ reclaimedBytes: vacuumDb() }));

/** Online snapshots of the whole database; see db/backup.ts for why VACUUM INTO is used. */
settingsRoute.get('/backups', c => c.json(backupList()));
settingsRoute.post('/backups', c => c.json(createBackup(), 201));
