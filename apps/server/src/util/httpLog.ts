import type { MiddlewareHandler } from 'hono';

/**
 * One line per request, and by default only for the ones worth reading.
 *
 * hono/logger prints two lines for every request, which drowns the terminal: the UI polls
 * `GET /api/mcp` every few seconds and re-runs `loadAll` on each route change, so a session
 * that is doing nothing still scrolls. Successful reads are therefore silent unless they are
 * slow; writes, errors and slow requests always print.
 *
 * LOG_HTTP=all logs every request, LOG_HTTP=off logs none.
 */
const SLOW_MS = 1000;

const colour = (code: number) => (code >= 500 ? 31 : code >= 400 ? 33 : 32);

export function httpLog(): MiddlewareHandler {
  const mode = process.env.LOG_HTTP ?? 'normal';
  if (mode === 'off') return async (_c, next) => next();
  const all = mode === 'all';

  return async (c, next) => {
    const started = performance.now();
    await next();
    const ms = Math.round(performance.now() - started);
    const status = c.res.status;
    const interesting = all || status >= 400 || ms >= SLOW_MS || c.req.method !== 'GET';
    if (!interesting) return;
    const path = c.req.path + (c.req.url.includes('?') ? '?…' : '');
    console.log(`${c.req.method} ${path} \x1b[${colour(status)}m${status}\x1b[0m ${ms}ms`);
  };
}
