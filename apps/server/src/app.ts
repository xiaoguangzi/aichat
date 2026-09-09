import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { providersRoute } from './routes/providers.js';
import { conversationsRoute } from './routes/conversations.js';
import { groupsRoute } from './routes/groups.js';
import { chatRoute } from './routes/chat.js';
import { mcpRoute } from './routes/mcp.js';
import { skillsRoute } from './routes/skills.js';
import { uploadsRoute } from './routes/uploads.js';
import { errorToPayload } from './util/errors.js';
import { httpLog } from './util/httpLog.js';
import { config } from './config.js';
import { settingsRoute } from './routes/settings.js';

export function createApp() {
  const app = new Hono();
  if (process.env.NODE_ENV !== 'test') app.use(httpLog());

  app.get('/api/health', (c) => c.json({ ok: true, version: '0.1.0' }));
  app.route('/api/providers', providersRoute);
  app.route('/api/settings', settingsRoute);
  app.route('/api/conversations', conversationsRoute);
  app.route('/api/groups', groupsRoute);
  app.route('/api', chatRoute);
  app.route('/api/mcp', mcpRoute);
  app.route('/api/skills', skillsRoute);
  app.route('/api/uploads', uploadsRoute);

  app.onError((err, c) => {
    if (err instanceof ZodError) {
      return c.json({ code: 'validation', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    }
    const p = errorToPayload(err);
    if (p.status >= 500) console.error(err);
    return c.json({ code: p.code, message: p.message }, p.status as 400);
  });

  // Production: serve the built web app with SPA fallback.
  if (fs.existsSync(config.webDist)) {
    const root = path.relative(process.cwd(), config.webDist) || '.';
    app.use('/*', serveStatic({ root }));
    app.get('*', (c) => {
      if (c.req.path.startsWith('/api/')) return c.notFound();
      return c.html(fs.readFileSync(path.join(config.webDist, 'index.html'), 'utf8'));
    });
  }
  return app;
}
