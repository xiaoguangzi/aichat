import type { McpServer } from './types.js';

type ServerShape = Pick<McpServer, 'name' | 'transport' | 'command' | 'args' | 'url'>;

/**
 * Exa is the primary web search backend. Recognized by a standalone `exa` name segment, the
 * `exa.ai` domain, or the `exa-mcp-server` package — not by arbitrary substrings.
 */
export function isExaServer(server: ServerShape): boolean {
  if (/(^|[-_])exa($|[-_])/i.test(server.name)) return true;
  if (server.transport === 'stdio') return [server.command, ...server.args].some((arg) => /(?:^|[/@])exa-mcp-server(?:@[^/]+)?$/.test(arg ?? ''));
  try {
    const host = new URL(server.url ?? '').hostname;
    return host === 'exa.ai' || host.endsWith('.exa.ai');
  } catch { return false; }
}

/**
 * DeepSeek's official API host. Its Search / Fetch API takes the same Bearer key as chat, so any
 * provider on this origin (OpenAI or Anthropic protocol) can supply the fallback search key.
 */
export function isOfficialDeepSeekOrigin(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.origin === 'https://api.deepseek.com' && !url.username && !url.password;
  } catch {
    return false;
  }
}
