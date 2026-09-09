import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import type { SkillInfo } from '@aichat/shared';
import { config } from '../config.js';
import { settingsRepo } from '../db/repos/settings.js';

export interface Skill extends SkillInfo {
  body: string;
}

function walk(dir: string, base = ''): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else out.push(rel);
    if (out.length > 500) break;
  }
  return out;
}

export function parseSkillDir(dir: string, autoApprove: boolean): Skill | null {
  const file = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  const { data, content } = matter(raw);
  const dirName = path.basename(dir);
  const name = String(data.name ?? dirName).trim();
  const description = String(data.description ?? '').trim();
  const allowedRaw = data['allowed-tools'] ?? data.allowedTools ?? [];
  const allowedTools = Array.isArray(allowedRaw) ? allowedRaw.map(String) : String(allowedRaw).split(/[\s,]+/).filter(Boolean);
  const files = walk(dir).filter((f) => f !== 'SKILL.md');
  return {
    name,
    description,
    dir,
    allowedTools,
    files,
    hasScripts: files.some((f) => f.startsWith('scripts/')),
    autoApprove,
    body: content.trim(),
  };
}

class SkillRegistry {
  private skills = new Map<string, Skill>();
  private watcher: FSWatcher | null = null;
  private warnings: string[] = [];

  scan() {
    this.skills.clear();
    this.warnings = [];
    const auto = settingsRepo.get<string[]>('skills.autoApprove', []);
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(config.skillsDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const dir = path.join(config.skillsDir, e.name);
      try {
        const s = parseSkillDir(dir, auto.includes(e.name));
        if (!s) continue;
        if (s.name !== e.name) this.warnings.push(`skill "${e.name}": frontmatter name "${s.name}" differs from directory name; using directory name`);
        s.name = e.name;
        this.skills.set(s.name, s);
      } catch (err) {
        this.warnings.push(`skill "${e.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  watch() {
    if (this.watcher) return;
    this.watcher = chokidarWatch(config.skillsDir, { ignoreInitial: true, depth: 4, ignored: /(^|[\/\\])\../ });
    let t: NodeJS.Timeout | null = null;
    const rescan = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => this.scan(), 300);
    };
    this.watcher.on('add', rescan).on('change', rescan).on('unlink', rescan).on('addDir', rescan).on('unlinkDir', rescan);
  }

  async close() {
    await this.watcher?.close();
    this.watcher = null;
  }

  list(): Skill[] {
    return [...this.skills.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  get(name: string): Skill | null {
    return this.skills.get(name) ?? null;
  }
  getWarnings() {
    return this.warnings;
  }

  setAutoApprove(name: string, value: boolean) {
    const auto = new Set(settingsRepo.get<string[]>('skills.autoApprove', []));
    if (value) auto.add(name);
    else auto.delete(name);
    settingsRepo.set('skills.autoApprove', [...auto]);
    const s = this.skills.get(name);
    if (s) s.autoApprove = value;
  }

  /** Resolve a relative path inside a skill directory, rejecting traversal. */
  resolveFile(name: string, rel: string): string {
    const s = this.get(name);
    if (!s) throw new Error(`skill not found: ${name}`);
    const abs = path.resolve(s.dir, rel);
    const root = path.resolve(s.dir) + path.sep;
    if (!abs.startsWith(root)) throw new Error('path escapes skill directory');
    return abs;
  }

  /** Index text injected into the system prompt (progressive disclosure step 1). */
  indexText(enabled: string[] | 'all' = 'all'): string {
    const list = this.list().filter((s) => enabled === 'all' || enabled.includes(s.name));
    if (!list.length) return '';
    const lines = list.map((s) => `- ${s.name}: ${s.description || '(no description)'}`);
    return [
      '# Skills',
      'The following skills are available. Each skill is a folder of instructions and resources.',
      'When a user request matches a skill, call `skill__load` with its name to read the full instructions before proceeding.',
      'Use `skill__read_file` for files referenced by a skill, and `skill__run_script` to run scripts under its scripts/ folder.',
      '',
      ...lines,
    ].join('\n');
  }
}

export const skillRegistry = new SkillRegistry();
