import type { ToolDef } from '@aichat/shared';

const NAME_RE = /[^a-zA-Z0-9_-]/g;

/** Both protocols require ^[a-zA-Z0-9_-]{1,64}$ tool names. */
export function sanitizeToolName(name: string): string {
  const s = name.replace(NAME_RE, '_').slice(0, 64);
  return s.length ? s : 'tool';
}

export function ensureObjectSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === 'object' && (schema as { type?: string }).type === 'object') return schema as Record<string, unknown>;
  if (schema && typeof schema === 'object' && !('type' in (schema as object))) return { type: 'object', ...(schema as object) };
  return { type: 'object', properties: {} };
}

export function normalizeToolDef(t: ToolDef): ToolDef {
  return {
    name: sanitizeToolName(t.name),
    description: (t.description ?? '').slice(0, 4000),
    inputSchema: ensureObjectSchema(t.inputSchema),
  };
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, stableJson(v)]));
  }
  return value;
}

/** MCP reconnect/list order must not shuffle the tool prefix. Preserve schema arrays. */
export function stableToolDefs(tools: ToolDef[]): ToolDef[] {
  return tools.map(t => ({ ...t, inputSchema: stableJson(t.inputSchema) as ToolDef['inputSchema'] }))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
