import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Block, McpServer, McpStatus, McpToolInfo, ToolDef } from '@aichat/shared';
import { mcpServersRepo, type McpServerRecord } from '../db/repos/mcpServers.js';
import { createTransport } from './transport.js';
import { sanitizeToolName, ensureObjectSchema } from '../llm/tools.js';
import { config } from '../config.js';

interface Conn {
  rec: McpServerRecord;
  client: Client | null;
  status: McpStatus;
  error: string | null;
  tools: McpToolInfo[];
  log: string[];
  connecting: Promise<void> | null;
}

const MAX_LOG = 200;

export function mcpToolFullName(server: string, tool: string): string {
  return sanitizeToolName(`mcp__${server}__${tool}`);
}

class McpManager {
  private conns = new Map<string, Conn>();

  /** Connect every enabled server from DB (at startup). */
  async init() {
    for (const rec of mcpServersRepo.list()) {
      this.ensureConn(rec);
      if (rec.enabled) void this.connect(rec.id);
    }
  }

  private ensureConn(rec: McpServerRecord): Conn {
    let c = this.conns.get(rec.id);
    if (!c) {
      c = { rec, client: null, status: 'disconnected', error: null, tools: [], log: [], connecting: null };
      this.conns.set(rec.id, c);
    } else {
      c.rec = rec;
    }
    return c;
  }

  private pushLog(c: Conn, line: string) {
    c.log.push(`[${new Date().toISOString()}] ${line}`);
    if (c.log.length > MAX_LOG) c.log.splice(0, c.log.length - MAX_LOG);
  }

  async connect(id: string): Promise<void> {
    const rec = mcpServersRepo.get(id);
    if (!rec) throw new Error('mcp server not found');
    const c = this.ensureConn(rec);
    if (c.connecting) return c.connecting;
    c.connecting = (async () => {
      await this.disconnectInternal(c);
      c.status = 'connecting';
      c.error = null;
      try {
        const transport = createTransport(rec);
        if (transport instanceof StdioClientTransport && transport.stderr) {
          transport.stderr.on('data', (d: Buffer) => {
            for (const line of d.toString().split('\n')) if (line.trim()) this.pushLog(c, `stderr: ${line}`);
          });
        }
        const client = new Client({ name: 'aichat', version: '0.1.0' }, { capabilities: {} });
        client.onclose = () => {
          if (c.client === client) {
            c.status = c.error ? 'error' : 'disconnected';
            c.client = null;
            this.pushLog(c, 'connection closed');
          }
        };
        client.onerror = (err) => {
          c.error = err.message;
          this.pushLog(c, `error: ${err.message}`);
        };
        await client.connect(transport);
        c.client = client;
        c.status = 'connected';
        this.pushLog(c, 'connected');
        try {
          client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
            await this.refreshTools(c);
          });
        } catch {
          /* server may not support */
        }
        await this.refreshTools(c);
      } catch (e) {
        c.status = 'error';
        c.error = e instanceof Error ? e.message : String(e);
        c.client = null;
        this.pushLog(c, `connect failed: ${c.error}`);
      } finally {
        c.connecting = null;
      }
    })();
    return c.connecting;
  }

  private async refreshTools(c: Conn) {
    if (!c.client) return;
    try {
      const res = await c.client.listTools();
      c.tools = res.tools.map((t) => ({
        server: c.rec.name,
        name: t.name,
        fullName: mcpToolFullName(c.rec.name, t.name),
        description: t.description ?? '',
        inputSchema: t.inputSchema,
      }));
      this.pushLog(c, `tools: ${c.tools.map((t) => t.name).join(', ') || '(none)'}`);
    } catch (e) {
      this.pushLog(c, `listTools failed: ${e instanceof Error ? e.message : String(e)}`);
      c.tools = [];
    }
  }

  private async disconnectInternal(c: Conn) {
    if (c.client) {
      const client = c.client;
      c.client = null;
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
    c.status = 'disconnected';
    c.tools = [];
  }

  async disconnect(id: string) {
    const c = this.conns.get(id);
    if (c) {
      await this.disconnectInternal(c);
      c.error = null;
      this.pushLog(c, 'disconnected');
    }
  }

  async remove(id: string) {
    await this.disconnect(id);
    this.conns.delete(id);
  }

  /** Called after a DB update: reconnect if enabled, else disconnect. */
  async sync(id: string) {
    const rec = mcpServersRepo.get(id);
    if (!rec) return this.remove(id);
    this.ensureConn(rec);
    if (rec.enabled) await this.connect(id);
    else await this.disconnect(id);
  }

  async shutdown() {
    for (const c of this.conns.values()) await this.disconnectInternal(c);
  }

  list(): McpServer[] {
    const out: McpServer[] = [];
    for (const rec of mcpServersRepo.list()) {
      const c = this.ensureConn(rec);
      out.push({
        ...rec,
        status: c.status,
        error: c.error,
        toolCount: c.tools.length,
      });
    }
    return out;
  }

  logs(id: string): string[] {
    return this.conns.get(id)?.log ?? [];
  }

  toolsOf(id: string): McpToolInfo[] {
    return this.conns.get(id)?.tools ?? [];
  }

  /** Tool definitions for the given server names ('all' = every connected). */
  toolDefs(enabled: string[] | 'all' = 'all'): ToolDef[] {
    const defs: ToolDef[] = [];
    for (const c of this.conns.values()) {
      if (c.status !== 'connected') continue;
      if (enabled !== 'all' && !enabled.includes(c.rec.name)) continue;
      for (const t of c.tools) {
        defs.push({
          name: t.fullName,
          description: `[${c.rec.name}] ${t.description}`,
          inputSchema: ensureObjectSchema(t.inputSchema),
        });
      }
    }
    return defs;
  }

  findTool(fullName: string): { conn: Conn; tool: McpToolInfo } | null {
    for (const c of this.conns.values()) {
      const tool = c.tools.find((t) => t.fullName === fullName);
      if (tool) return { conn: c, tool };
    }
    return null;
  }

  async callTool(fullName: string, args: unknown, signal?: AbortSignal): Promise<{ content: Block[]; isError: boolean }> {
    const found = this.findTool(fullName);
    if (!found || !found.conn.client) throw new Error(`MCP tool not available: ${fullName}`);
    const res = await found.conn.client.callTool(
      { name: found.tool.name, arguments: (args ?? {}) as Record<string, unknown> },
      undefined,
      { timeout: config.toolTimeoutMs, signal },
    );
    const blocks: Block[] = [];
    const items = (res.content ?? []) as Array<Record<string, unknown>>;
    for (const item of items) {
      switch (item.type) {
        case 'text':
          blocks.push({ type: 'text', text: String(item.text ?? '') });
          break;
        case 'image':
          blocks.push({ type: 'image', mime: String(item.mimeType ?? 'image/png'), data: String(item.data ?? '') });
          break;
        case 'resource': {
          const r = item.resource as { text?: string; uri?: string; blob?: string; mimeType?: string } | undefined;
          if (r?.text) blocks.push({ type: 'text', text: `<resource uri="${r.uri ?? ''}">\n${r.text}\n</resource>` });
          else if (r?.blob) blocks.push({ type: 'text', text: `[binary resource ${r.uri ?? ''} (${r.mimeType ?? 'unknown'})]` });
          break;
        }
        case 'resource_link':
          blocks.push({ type: 'text', text: `[resource link: ${String(item.uri ?? '')} ${String(item.name ?? '')}]` });
          break;
        default:
          blocks.push({ type: 'text', text: JSON.stringify(item) });
      }
    }
    if (res.structuredContent && !blocks.length) blocks.push({ type: 'text', text: JSON.stringify(res.structuredContent, null, 2) });
    return { content: blocks, isError: !!res.isError };
  }
}

export const mcpManager = new McpManager();
