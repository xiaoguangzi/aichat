import type { Block } from '@aichat/shared';
import { skillRegistry } from './registry.js';

const SLASH_RE = /^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/;

export function parseSlash(text: string): { name: string; rest: string } | null {
  const m = SLASH_RE.exec(text.trim());
  if (!m) return null;
  return { name: m[1]!, rest: (m[2] ?? '').trim() };
}

/**
 * If the user text starts with `/skill-name`, prepend the skill body so the model follows it.
 * Returns the blocks to send (the original text is preserved for display).
 */
export function expandSlash(text: string): { blocks: Block[]; skill: string | null } {
  const p = parseSlash(text);
  if (!p) return { blocks: [{ type: 'text', text }], skill: null };
  const s = skillRegistry.get(p.name);
  if (!s) return { blocks: [{ type: 'text', text }], skill: null };
  const header = `<skill name="${s.name}">\n${s.body}\n</skill>`;
  const user = p.rest ? p.rest : `(The user invoked the "${s.name}" skill with no additional input. Follow the skill instructions.)`;
  return { blocks: [{ type: 'text', text: `${header}\n\n${user}` }], skill: s.name };
}
