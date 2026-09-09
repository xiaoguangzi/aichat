import type { McpTransport } from '@aichat/shared';
import { getDb, j } from '../database.js';
import { nowIso, uuid } from '../../util/id.js';

export interface McpServerRecord {
  id: string;
  name: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
  url: string | null;
  headers: Record<string, string>;
  enabled: boolean;
  createdAt: string;
}

interface Row {
  id: string;
  name: string;
  transport: McpTransport;
  command: string | null;
  args_json: string;
  env_json: string;
  cwd: string | null;
  url: string | null;
  headers_json: string;
  enabled: number;
  created_at: string;
}

const rowTo = (r: Row): McpServerRecord => ({
  id: r.id,
  name: r.name,
  transport: r.transport,
  command: r.command,
  args: j.parse(r.args_json, []),
  env: j.parse(r.env_json, {}),
  cwd: r.cwd,
  url: r.url,
  headers: j.parse(r.headers_json, {}),
  enabled: !!r.enabled,
  createdAt: r.created_at,
});

export type McpServerInputRecord = Omit<McpServerRecord, 'id' | 'createdAt'>;

export const mcpServersRepo = {
  list(): McpServerRecord[] {
    return (getDb().prepare('SELECT * FROM mcp_servers ORDER BY created_at').all() as unknown as Row[]).map(rowTo);
  },
  get(id: string): McpServerRecord | null {
    const r = getDb().prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as unknown as Row | undefined;
    return r ? rowTo(r) : null;
  },
  getByName(name: string): McpServerRecord | null {
    const r = getDb().prepare('SELECT * FROM mcp_servers WHERE name = ?').get(name) as unknown as Row | undefined;
    return r ? rowTo(r) : null;
  },
  create(input: Partial<McpServerInputRecord> & { name: string; transport: McpTransport }): McpServerRecord {
    const id = uuid();
    getDb()
      .prepare(
        'INSERT INTO mcp_servers(id,name,transport,command,args_json,env_json,cwd,url,headers_json,enabled,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        input.name,
        input.transport,
        input.command ?? null,
        j.str(input.args ?? []),
        j.str(input.env ?? {}),
        input.cwd ?? null,
        input.url ?? null,
        j.str(input.headers ?? {}),
        input.enabled === false ? 0 : 1,
        nowIso(),
      );
    return this.get(id)!;
  },
  update(id: string, input: Partial<McpServerInputRecord>): McpServerRecord | null {
    const cur = this.get(id);
    if (!cur) return null;
    const n = { ...cur, ...input };
    getDb()
      .prepare('UPDATE mcp_servers SET name=?, transport=?, command=?, args_json=?, env_json=?, cwd=?, url=?, headers_json=?, enabled=? WHERE id=?')
      .run(n.name, n.transport, n.command ?? null, j.str(n.args), j.str(n.env), n.cwd ?? null, n.url ?? null, j.str(n.headers), n.enabled ? 1 : 0, id);
    return this.get(id);
  },
  delete(id: string): boolean {
    return getDb().prepare('DELETE FROM mcp_servers WHERE id = ?').run(id).changes > 0;
  },
};
