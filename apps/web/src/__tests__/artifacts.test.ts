import { describe, expect, it } from 'vitest';
import { collectArtifacts, parseArtifacts, type Message } from '@aichat/shared';
import { buildArtifactPreview } from '../lib/artifact-preview.js';

describe('artifact parsing and versions', () => {
  it('extracts multiple blocks and preserves surrounding prose offsets', () => {
    const text = 'Before\n```html artifact id="timer" title="计时器"\n<h1>Hi</h1>\n```\nBetween\n```svg\n<svg/>\n```\nAfter';
    const artifacts = parseArtifacts(text);
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]).toMatchObject({ id: 'timer', title: '计时器', code: '<h1>Hi</h1>', kind: 'html', complete: true });
    expect(text.slice(artifacts[1]!.end)).toBe('After');
  });
  it('handles streaming and nested fences without executing partial source', () => {
    expect(parseArtifacts('```tsx artifact id="a"\nexport default')).toMatchObject([{ complete: false, kind: 'react' }]);
    const nested = '````markdown artifact id="doc"\n# Doc\n```html\n<h1>Example</h1>\n```\n````';
    expect(parseArtifacts(nested)).toHaveLength(1);
    expect(parseArtifacts(nested)[0]!.code).toContain('```html');
    expect(parseArtifacts('````text\n```html\n<p>example</p>\n```\n````')).toEqual([]);
  });
  it('leaves ordinary snippets alone and supports CRLF and tilde fences', () => {
    expect(parseArtifacts('```js\nconst x = 1\n```\n```markdown\n# note\n```')).toEqual([]);
    expect(parseArtifacts('~~~svg\r\n<svg/>\r\n~~~')).toMatchObject([{ code: '<svg/>', complete: true }]);
  });
  it('groups explicit IDs but keeps anonymous messages separate and ignores user examples', () => {
    const msg = (id: string, role: 'user' | 'assistant', text: string): Message => ({ id, role, conversationId: 'c', seq: 1, createdAt: '2026-09-08', content: [{ type: 'text', text }] });
    const versions = collectArtifacts([msg('a', 'assistant', '```html artifact id="block-timer"\n1\n```'), msg('b', 'assistant', '```html artifact id="block-timer"\n2\n```'), msg('c', 'assistant', '```html\n3\n```'), msg('d', 'assistant', '```html\n4\n```'), msg('u', 'user', '```html\n5\n```')]);
    expect(versions.map(v => v.id)).toEqual(['block-timer', 'block-timer', 'c:0:0', 'd:0:0']);
  });
});

describe('preview document', () => {
  it('puts CSP before untrusted HTML and denies API requests, embedding and forms', () => {
    const html = buildArtifactPreview({ kind: 'html', code: '<!doctype html><script>fetch("/api/settings")</script>' }, 'http://localhost:3000');
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('fetch('));
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("frame-src 'none'");
    expect(html).toContain("form-action 'none'");
  });
  it('cannot escape the React source JSON script', () => {
    const html = buildArtifactPreview({ kind: 'react', code: '</script><script>alert(1)</script>' }, 'http://localhost:3000');
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script>');
    expect(html).toContain('/artifact-runtime.js');
  });
});
