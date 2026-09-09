import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Block, ToolDef } from '@aichat/shared';
import { skillRegistry } from './registry.js';
import { config } from '../config.js';

export const SKILL_TOOL_NAMES = ['skill__load', 'skill__read_file', 'skill__run_script'] as const;

export function skillToolDefs(enabled: string[] | 'all'): ToolDef[] {
  const names = skillRegistry
    .list()
    .filter((s) => enabled === 'all' || enabled.includes(s.name))
    .map((s) => s.name);
  if (!names.length) return [];
  return [
    {
      name: 'skill__load',
      description: 'Load the full SKILL.md instructions for a skill. Call this before using a skill.',
      inputSchema: { type: 'object', properties: { name: { type: 'string', enum: names, description: 'Skill name' } }, required: ['name'] },
    },
    {
      name: 'skill__read_file',
      description: 'Read a file inside a skill folder (e.g. references/guide.md). Path is relative to the skill directory.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', enum: names }, path: { type: 'string', description: 'Relative file path inside the skill' } },
        required: ['name', 'path'],
      },
    },
    {
      name: 'skill__run_script',
      description:
        'Run a script from a skill\'s scripts/ folder. Requires user approval unless the skill is marked auto-approve. Returns stdout/stderr. Scripts run with the skill directory as cwd.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', enum: names },
          script: { type: 'string', description: 'Script path relative to the skill directory, e.g. scripts/build.sh' },
          args: { type: 'array', items: { type: 'string' }, description: 'Command line arguments' },
          stdin: { type: 'string', description: 'Optional text piped to stdin' },
        },
        required: ['name', 'script'],
      },
    },
  ];
}

export function isSkillTool(name: string): boolean {
  return (SKILL_TOOL_NAMES as readonly string[]).includes(name);
}

function text(t: string): Block[] {
  return [{ type: 'text', text: t }];
}

function interpreterFor(file: string): string[] {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case '.py':
      return ['python3'];
    case '.js':
    case '.mjs':
    case '.cjs':
      return ['node'];
    case '.ts':
      return ['node'];
    case '.sh':
      return ['bash'];
    default:
      return [];
  }
}

export async function runSkillScript(
  input: { name: string; script: string; args?: string[]; stdin?: string },
  signal?: AbortSignal,
): Promise<{ content: Block[]; isError: boolean }> {
  const skill = skillRegistry.get(input.name);
  if (!skill) return { content: text(`skill not found: ${input.name}`), isError: true };
  const abs = skillRegistry.resolveFile(input.name, input.script);
  if (!fs.existsSync(abs)) return { content: text(`script not found: ${input.script}`), isError: true };
  const interp = interpreterFor(abs);
  const cmd = interp.length ? interp[0]! : abs;
  const args = interp.length ? [...interp.slice(1), abs, ...(input.args ?? [])] : [...(input.args ?? [])];
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: skill.dir, env: process.env, signal });
    let out = '';
    let err = '';
    const cap = (s: string, add: string) => (s.length > 20_000 ? s : s + add);
    child.stdout.on('data', (d) => (out = cap(out, d.toString())));
    child.stderr.on('data', (d) => (err = cap(err, d.toString())));
    const timer = setTimeout(() => child.kill('SIGKILL'), config.scriptTimeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ content: text(`failed to start: ${e.message}`), isError: true });
    });
    child.on('close', (code, sig) => {
      clearTimeout(timer);
      const parts = [];
      if (out) parts.push(`stdout:\n${out.slice(0, 20_000)}`);
      if (err) parts.push(`stderr:\n${err.slice(0, 20_000)}`);
      parts.push(`exit: ${sig ? `signal ${sig}` : code}`);
      resolve({ content: text(parts.join('\n\n')), isError: code !== 0 });
    });
    if (input.stdin) child.stdin.write(input.stdin);
    child.stdin.end();
  });
}

export async function executeSkillTool(name: string, input: unknown, signal?: AbortSignal): Promise<{ content: Block[]; isError: boolean }> {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'skill__load': {
      const s = skillRegistry.get(String(args.name ?? ''));
      if (!s) return { content: text(`skill not found: ${String(args.name)}`), isError: true };
      const files = s.files.length ? `\n\nFiles in this skill:\n${s.files.map((f) => `- ${f}`).join('\n')}` : '';
      return { content: text(`<skill name="${s.name}">\n${s.body}\n</skill>${files}`), isError: false };
    }
    case 'skill__read_file': {
      try {
        const abs = skillRegistry.resolveFile(String(args.name ?? ''), String(args.path ?? ''));
        const stat = fs.statSync(abs);
        if (stat.size > 200_000) return { content: text('file too large (>200KB)'), isError: true };
        return { content: text(fs.readFileSync(abs, 'utf8')), isError: false };
      } catch (e) {
        return { content: text(e instanceof Error ? e.message : String(e)), isError: true };
      }
    }
    case 'skill__run_script':
      return runSkillScript(
        { name: String(args.name ?? ''), script: String(args.script ?? ''), args: Array.isArray(args.args) ? args.args.map(String) : [], stdin: args.stdin ? String(args.stdin) : undefined },
        signal,
      );
    default:
      return { content: text(`unknown skill tool ${name}`), isError: true };
  }
}
