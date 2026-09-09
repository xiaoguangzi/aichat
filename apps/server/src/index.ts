import { serve } from '@hono/node-server';
import { config, ensureDirs } from './config.js';
import { initDb, closeDb } from './db/database.js';
import { mcpManager } from './mcp/manager.js';
import { skillRegistry } from './skills/registry.js';
import { createApp } from './app.js';
import { stopAllRuns } from './agent/runs.js';

ensureDirs();
initDb();
skillRegistry.scan();
skillRegistry.watch();
void mcpManager.init();

const app = createApp();
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  const shown = info.address === '0.0.0.0' || info.address === '::' ? 'localhost' : info.address;
  console.log(`aichat server listening on http://${shown}:${info.port}`);
  console.log(`data: ${config.dataDir}\nskills: ${config.skillsDir}`);
});

async function shutdown() {
  console.log('\nshutting down...');
  await stopAllRuns();
  await mcpManager.shutdown();
  await skillRegistry.close();
  closeDb();
  server.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
