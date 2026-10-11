import { expect, it, vi } from 'vitest';
import type { Conversation } from '@aichat/shared';
import { compileUi } from '@aichat/shared';
vi.mock('../src/skills/registry.js', () => ({ skillRegistry: { indexText: () => '' } }));
const { buildSystemPrompt } = await import('../src/agent/systemPrompt.js');

it('offers the same inline UI contract without tools and preserves project/user instructions and artifact support', () => {
  const conv = { systemPrompt: 'Answer in Chinese.', settings: {} } as Conversation;
  for (const hasTools of [false, true]) {
    const prompt = buildSystemPrompt(conv, { hasTools, projectInstructions: 'Use evidence.' });
    expect(prompt).toContain('Use evidence.'); expect(prompt).toContain('Answer in Chinese.');
    expect(prompt).toContain('aichat-ui'); expect(prompt).toContain('one complete JSON object per line');
    expect(prompt).toContain('Simple answers stay ordinary Markdown'); expect(prompt).toContain('```html artifact');
    const sample = prompt.slice(prompt.indexOf('{"type":"view","title":"Dinner bill splitter"'), prompt.indexOf('\n\nCurrent date:'));
    const compiled = compileUi(sample, true);
    expect(compiled.errors).toEqual([]); expect(compiled.nodes).toHaveLength(5);
  }
});
