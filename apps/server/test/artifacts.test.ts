import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { ZodError } from 'zod';
import { initDb, closeDb } from '../src/db/database.js';
import { conversationsRepo } from '../src/db/repos/conversations.js';
import { messagesRepo } from '../src/db/repos/messages.js';
import { artifactsRepo } from '../src/db/repos/artifacts.js';
import { conversationsRoute } from '../src/routes/conversations.js';
import { buildSystemPrompt } from '../src/agent/systemPrompt.js';

beforeEach(() => initDb(':memory:'));
afterEach(() => closeDb());
const app = new Hono().route('/conversations', conversationsRoute).onError((e, c) => c.json({ message: e.message }, e instanceof ZodError ? 400 : 404));
function fixture() {
  const conversation = conversationsRepo.create({ title: 'Artifacts' });
  const message = messagesRepo.create({ conversationId: conversation.id, role: 'assistant', content: [{ type: 'text', text: '```html artifact id="timer" title="Timer"\n<h1>V1</h1>\n```' }] });
  return { conversation, message };
}

describe('artifact edits API', () => {
  it('saves separate revisions without rewriting messages and reloads them', async () => {
    const { conversation: c, message: m } = fixture();
    const url = `/conversations/${c.id}/artifacts`;
    for (const code of ['<h1>V2</h1>', '<h1>V3</h1>']) {
      const res = await app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: m.id, artifactId: 'timer', code }) });
      expect(res.status).toBe(201);
    }
    const list = await (await app.request(url)).json() as { code: string }[];
    expect(list.map((v: { code: string }) => v.code)).toEqual(['<h1>V2</h1>', '<h1>V3</h1>']);
    expect(messagesRepo.get(m.id)?.content).toEqual(m.content);
  });
  it('rejects foreign conversations, missing artifacts and invalid payloads', async () => {
    const { conversation: c, message: m } = fixture();
    const other = conversationsRepo.create({});
    const post = (id: string, artifactId: string, code: unknown = 'hello') => app.request(`/conversations/${id}/artifacts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: m.id, artifactId, code }) });
    expect((await post(other.id, 'timer')).status).toBe(404);
    expect((await post(c.id, 'missing')).status).toBe(404);
    expect((await post(c.id, 'timer', 42)).status).toBe(400);
    expect(artifactsRepo.list(c.id)).toEqual([]);
  });
  it('cascades revisions on regeneration or conversation deletion', () => {
    const { conversation: c, message: m } = fixture();
    artifactsRepo.create(c.id, { messageId: m.id, artifactId: 'timer', code: 'changed' });
    messagesRepo.deleteFrom(c.id, m.seq);
    expect(artifactsRepo.list(c.id)).toEqual([]);
    const next = fixture();
    artifactsRepo.create(next.conversation.id, { messageId: next.message.id, artifactId: 'timer', code: 'changed' });
    conversationsRepo.delete(next.conversation.id);
    expect(artifactsRepo.list(next.conversation.id)).toEqual([]);
  });
  it('adds model-independent instructions even with a custom system prompt and no tools', () => {
    const c = conversationsRepo.create({ systemPrompt: '自定义说明' });
    const prompt = buildSystemPrompt(c, { hasTools: false });
    expect(prompt).toContain('自定义说明');
    expect(prompt).toContain('artifact id="stable-slug"');
    expect(prompt).toContain('recharts');
  });
});
