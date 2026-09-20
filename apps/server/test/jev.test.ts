import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jevRequestSchema } from '@aichat/shared';
import { closeDb, getDb, initDb } from '../src/db/database.js';
import { createApp } from '../src/app.js';
import { evaluateJev, JEV_ENDPOINT } from '../src/decisions/jev.js';

let dir: string;
const input = {
  model: 'jev-latest', state: { message: 'Refund please', items: [1, true] },
  questions: {
    refund: { type: 'noul' as const, instructions: 'Requesting refund?' },
    team: { type: 'choice' as const, instructions: { task: 'Pick team' }, criteria: { billing: null, other: ['Anything else'] } },
    urgency: { type: 'score' as const, instructions: 'Urgency?', criteria: ['Low', { level: 'High' }] },
  },
};
const response = {
  model: 'jev-1.13.0', answers: {
    refund: { type: 'noul', noul: 0.95 },
    team: { type: 'choice', choice: 'billing', probabilities: { billing: 0.9, other: 0.1 }, confidence: 0.8 },
    urgency: { type: 'score', score: 0.7, probabilities: { '0': 0.3, '1': 0.7 }, confidence: 0.5, legend: { '0': 'Low', '1': { level: 'High' } } },
  }, usage: { input_tokens: 124, output_tokens: 8 },
};
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-jev-')); initDb(path.join(dir, 'test.db')); });
afterEach(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const call = (url: string, method: string, body: unknown) => createApp().request(`/api/jev/${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const save = (body: unknown = { model: 'jev-latest', apiKey: 'test-jev-credential' }) => call('settings', 'PUT', body);

it('persists isolated settings without exposing credentials or adding chat models', async () => {
  expect(await (await save()).json()).toEqual({ model: 'jev-latest', hasApiKey: true });
  await save({ model: 'jev-1.13.0' });
  closeDb(); initDb(path.join(dir, 'test.db'));
  expect(await (await createApp().request('/api/jev/settings')).json()).toEqual({ model: 'jev-1.13.0', hasApiKey: true });
  for (const table of ['providers', 'models', 'conversations', 'messages']) {
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toMatchObject({ n: 0 });
  }
  expect(await (await save({ model: 'jev-latest', apiKey: null })).json()).toEqual({ model: 'jev-latest', hasApiKey: false });
});
it('sends the exact native contract and server credential once, outside the LLM loop', async () => {
  await save();
  const fetcher = vi.fn().mockResolvedValue(Response.json(response)); vi.stubGlobal('fetch', fetcher);
  const res = await call('evaluate', 'POST', input);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ response, elapsedMs: expect.any(Number) });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, options] = fetcher.mock.calls[0]!;
  expect(url).toBe(JEV_ENDPOINT);
  expect(options.headers.Authorization).toBe('Bearer test-jev-credential');
  expect(options.redirect).toBe('error');
  expect(JSON.parse(options.body)).toEqual(input);
  expect(getDb().prepare('SELECT COUNT(*) AS n FROM api_traces').get()).toMatchObject({ n: 0 });
});
it('validates question types, JSON state and rubric limits without discarding fields', () => {
  expect(jevRequestSchema.parse(input)).toEqual(input);
  for (const invalid of [
    { ...input, messages: [] }, { ...input, state: null }, { ...input, questions: {} },
    { ...input, questions: { q: { type: 'score', instructions: '', criteria: ['single'] } } },
    { ...input, questions: { q: { type: 'score', instructions: '', criteria: Array(11).fill('x') } } },
    { ...input, questions: { q: { type: 'choice', instructions: '', criteria: {} } } },
    { ...input, questions: { q: { type: 'noul', instructions: '', criteria: { yes: 'invalid' } } } },
    { ...input, questions: { q: { type: 'noul' } } },
  ]) expect(jevRequestSchema.safeParse(invalid).success).toBe(false);
});
it('requires a configured key and rejects invalid input before a network request', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect((await call('evaluate', 'POST', input)).status).toBe(400);
  await save();
  expect((await call('evaluate', 'POST', { ...input, questions: {} })).status).toBe(400);
  expect((await call('evaluate', 'POST', { ...input, state: 'x'.repeat(1024 * 1024) })).status).toBe(413);
  expect(fetcher).not.toHaveBeenCalled();
});
it('does not expose malformed JSON containing credentials in parser errors', async () => {
  const res = await createApp().request('/api/jev/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"apiKey":"test-jev-credential", invalid' });
  expect(res.status).toBe(400);
  expect(await res.text()).not.toContain('test-jev-credential');
});
it('preserves upstream status, redacts the credential and avoids implicit paid retries', async () => {
  await save();
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { message: 'invalid test-jev-credential' } }, { status: 401 }));
  vi.stubGlobal('fetch', fetcher);
  const res = await call('evaluate', 'POST', input);
  expect(res.status).toBe(401);
  const body = await res.text();
  expect(body).toContain('[REDACTED]'); expect(body).not.toContain('test-jev-credential');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects invalid JSON, malformed answers, missing questions and oversized responses', async () => {
  for (const upstream of [
    new Response('<html>Bad gateway</html>'),
    Response.json({ ...response, answers: {} }),
    Response.json({ ...response, answers: { ...response.answers, refund: { type: 'noul', noul: 9 } } }),
    new Response('x'.repeat(2 * 1024 * 1024 + 1)),
  ]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream));
    await expect(evaluateJev(input, 'test-jev-credential')).rejects.toMatchObject({ code: 'jev_response', status: 502 });
  }
});
it('handles network failure, cancellation and timeout without leaking fetch error details', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('test-jev-credential')));
  await expect(evaluateJev(input, 'test-jev-credential')).rejects.toMatchObject({ code: 'jev_network' });
  await expect(evaluateJev(input, 'test-jev-credential', AbortSignal.abort())).rejects.toMatchObject({ code: 'aborted' });
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
  await expect(evaluateJev(input, 'test-jev-credential')).rejects.toMatchObject({ code: 'jev_timeout' });
});
it('does not invent missing usage', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ model: response.model, answers: response.answers })));
  expect((await evaluateJev(input, 'test-jev-credential')).response.usage).toBeUndefined();
});
it('redacts JSON-escaped credential echoes on success', async () => {
  const body = JSON.stringify({ ...response, model: 'test-jev-credential' }).replace('test-jev-credential', '\\u0074est-jev-credential');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
  expect((await evaluateJev(input, 'test-jev-credential')).response.model).toBe('[REDACTED]');
});
