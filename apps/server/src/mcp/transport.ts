import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServerRecord } from '../db/repos/mcpServers.js';

const ENV_WHITELIST = ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'NVM_DIR'];

function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ENV_WHITELIST) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}

export function createTransport(rec: McpServerRecord): Transport {
  switch (rec.transport) {
    case 'stdio': {
      if (!rec.command) throw new Error(`MCP server "${rec.name}": command is required for stdio`);
      return new StdioClientTransport({
        command: rec.command,
        args: rec.args,
        env: { ...baseEnv(), ...rec.env },
        cwd: rec.cwd ?? undefined,
        stderr: 'pipe',
      });
    }
    case 'http': {
      if (!rec.url) throw new Error(`MCP server "${rec.name}": url is required`);
      return new StreamableHTTPClientTransport(new URL(rec.url), { requestInit: { headers: rec.headers } });
    }
    case 'sse': {
      if (!rec.url) throw new Error(`MCP server "${rec.name}": url is required`);
      return new SSEClientTransport(new URL(rec.url), {
        requestInit: { headers: rec.headers },
        eventSourceInit: { fetch: (url, init) => fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), ...rec.headers } }) },
      });
    }
  }
}
