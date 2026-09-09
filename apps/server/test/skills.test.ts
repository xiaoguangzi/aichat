import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSkillDir } from '../src/skills/registry.js';
import { parseSlash } from '../src/skills/slash.js';

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-'));
  const s = path.join(dir, 'demo');
  fs.mkdirSync(path.join(s, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(s, 'SKILL.md'), '---\nname: demo\ndescription: A demo\nallowed-tools: Bash, Read\n---\n\n# Body\n');
  fs.writeFileSync(path.join(s, 'scripts', 'x.sh'), 'echo hi');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('parseSkillDir', () => {
  it('reads frontmatter, body and files', () => {
    const s = parseSkillDir(path.join(dir, 'demo'), false)!;
    expect(s.name).toBe('demo');
    expect(s.description).toBe('A demo');
    expect(s.allowedTools).toEqual(['Bash', 'Read']);
    expect(s.body).toBe('# Body');
    expect(s.files).toEqual(['scripts/x.sh']);
    expect(s.hasScripts).toBe(true);
  });
  it('returns null without SKILL.md', () => {
    expect(parseSkillDir(dir, false)).toBeNull();
  });
});

describe('parseSlash', () => {
  it('parses /name rest', () => {
    expect(parseSlash('/demo  write a haiku\nabout rain')).toEqual({ name: 'demo', rest: 'write a haiku\nabout rain' });
    expect(parseSlash('/demo')).toEqual({ name: 'demo', rest: '' });
    expect(parseSlash('not a slash')).toBeNull();
    expect(parseSlash('/bad name!')).toEqual({ name: 'bad', rest: 'name!' });
  });
});
