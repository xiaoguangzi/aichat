import type { Message } from './types.js';

export type ArtifactKind = 'html' | 'react' | 'svg' | 'markdown' | 'mermaid' | 'code';
export interface Artifact {
  id: string;
  title: string;
  kind: ArtifactKind;
  language: string;
  code: string;
  complete: boolean;
  start: number;
  end: number;
}
export interface ArtifactVersion extends Artifact {
  key: string;
  messageId: string;
  createdAt: string;
  edited?: boolean;
}
export interface ArtifactEdit {
  id: string;
  messageId: string;
  artifactId: string;
  code: string;
  createdAt: string;
}

const kinds: Record<string, ArtifactKind> = {
  html: 'html', svg: 'svg', jsx: 'react', tsx: 'react', react: 'react',
  markdown: 'markdown', md: 'markdown', mermaid: 'mermaid',
};
const attr = (meta: string, name: string) => new RegExp(`(?:^|\\s)${name}=["']([^"']+)["']`).exec(meta)?.[1];

/** Scan fences, including unfinished streaming blocks. Skip nested examples in longer fences. */
export function parseArtifacts(text: string): Artifact[] {
  const out: Artifact[] = [];
  const opening = /^ {0,3}(`{3,}|~{3,})([^\n]*)\n/gm;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(text))) {
    const fence = match[1]!;
    const meta = match[2]!.trim();
    const language = meta.split(/\s/)[0]!.toLowerCase();
    const close = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*(?:\\r?\\n|$)`, 'gm');
    close.lastIndex = opening.lastIndex;
    const end = close.exec(text);
    const code = text.slice(opening.lastIndex, end?.index ?? text.length).replace(/\r?\n$/, '');
    const marked = /(?:^|\s)artifact(?:\s|$)/.test(meta);
    const kind = kinds[language];
    // Plain HTML/SVG/React/Mermaid fences in existing conversations work too.
    if (marked || (kind && kind !== 'markdown')) {
      out.push({ id: attr(meta, 'id') ?? '', title: attr(meta, 'title') ?? `${language.toUpperCase() || 'Code'} Artifact`,
        kind: kind ?? 'code', language: language || 'text', code, complete: !!end, start: match.index, end: end ? close.lastIndex : text.length });
    }
    opening.lastIndex = end ? close.lastIndex : text.length;
  }
  return out;
}

export function collectArtifacts(messages: Message[]): ArtifactVersion[] {
  return messages.filter(m => m.role === 'assistant').flatMap(m => m.content.flatMap((b, block) =>
    b.type !== 'text' ? [] : parseArtifacts(b.text).map((a, index) => ({ ...a,
      // Unnamed blocks must never accidentally merge unrelated messages into versions.
      id: a.id || `${m.id}:${block}:${index}`,
      key: `${m.id}:${block}:${index}`, messageId: m.id, createdAt: m.createdAt,
    }))));
}
