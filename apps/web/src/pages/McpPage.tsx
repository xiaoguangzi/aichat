import { useEffect, useState } from 'react';
import type { McpServer, McpServerInput, McpToolInfo } from '@aichat/shared';
import { Plus, Trash2, Pencil, Plug, Unplug, RefreshCw, FileJson, ScrollText, Wrench } from 'lucide-react';
import { api } from '../api/client';
import { useSettings } from '../store/settings';
import { Button } from '../components/ui/Button';
import { Field, Input, Select, Textarea, Toggle } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { cn } from '../lib/utils';

function ServerForm({ initial, onDone }: { initial?: McpServer; onDone: () => void }) {
  const [f, setF] = useState<McpServerInput>({
    name: initial?.name ?? '',
    transport: initial?.transport ?? 'stdio',
    command: initial?.command ?? 'npx',
    args: initial?.args ?? [],
    env: initial?.env ?? {},
    cwd: initial?.cwd ?? null,
    url: initial?.url ?? '',
    headers: initial?.headers ?? {},
    enabled: initial?.enabled ?? true,
  });
  const [args, setArgs] = useState((initial?.args ?? []).join('\n'));
  const [env, setEnv] = useState(JSON.stringify(initial?.env ?? {}, null, 2));
  const [headers, setHeaders] = useState(JSON.stringify(initial?.headers ?? {}, null, 2));
  const [err, setErr] = useState('');
  const save = async () => {
    setErr('');
    try {
      const body: McpServerInput = { ...f, args: args.split('\n').map((s) => s.trim()).filter(Boolean), env: JSON.parse(env || '{}'), headers: JSON.parse(headers || '{}') };
      if (initial) await api.mcp.update(initial.id, body);
      else await api.mcp.create(body);
      onDone();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="space-y-3">
      <Field label="Name" hint="letters, digits, _ and - only; becomes the tool prefix mcp__name__tool"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Transport">
        <Select value={f.transport} onChange={(e) => setF({ ...f, transport: e.target.value as McpServerInput['transport'] })}>
          <option value="stdio">stdio (local process)</option>
          <option value="http">Streamable HTTP</option>
          <option value="sse">SSE (legacy)</option>
        </Select>
      </Field>
      {f.transport === 'stdio' ? (
        <>
          <Field label="Command"><Input value={f.command ?? ''} onChange={(e) => setF({ ...f, command: e.target.value })} placeholder="npx" /></Field>
          <Field label="Arguments (one per line)"><Textarea rows={3} value={args} onChange={(e) => setArgs(e.target.value)} placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/Users/me/docs'} /></Field>
          <Field label="Working directory (optional)"><Input value={f.cwd ?? ''} onChange={(e) => setF({ ...f, cwd: e.target.value || null })} /></Field>
          <Field label="Environment (JSON)" hint="Only PATH/HOME etc. are inherited; add what the server needs"><Textarea rows={3} value={env} onChange={(e) => setEnv(e.target.value)} /></Field>
        </>
      ) : (
        <>
          <Field label="URL"><Input value={f.url ?? ''} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://example.com/mcp" /></Field>
          <Field label="Headers (JSON)"><Textarea rows={3} value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder='{"Authorization":"Bearer ..."}' /></Field>
        </>
      )}
      <Toggle checked={f.enabled !== false} onChange={(v) => setF({ ...f, enabled: v })} label="Enabled (connect on startup)" />
      {err && <div className="text-sm text-red-600">{err}</div>}
      <div className="flex justify-end"><Button variant="primary" onClick={() => void save()} disabled={!f.name}>Save</Button></div>
    </div>
  );
}

function ServerCard({ s, reload }: { s: McpServer; reload: () => void }) {
  const [edit, setEdit] = useState(false);
  const [tools, setTools] = useState<McpToolInfo[] | null>(null);
  const [logs, setLogs] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); reload(); } };
  const dot = { connected: 'bg-accent-500', connecting: 'bg-accent-400 animate-pulse', error: 'bg-red-500', disconnected: 'bg-zinc-400' }[s.status];
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', dot)} />
        <div className="flex-1">
          <div className="font-semibold">{s.name} <span className="ml-1 text-xs font-normal text-zinc-500">{s.transport} · {s.status} · {s.toolCount} tools</span></div>
          <div className="truncate font-mono text-xs text-zinc-500">{s.transport === 'stdio' ? `${s.command} ${s.args.join(' ')}` : s.url}</div>
          {s.error && <div className="mt-1 text-xs text-red-600">{s.error}</div>}
        </div>
        {s.status === 'connected' ? (
          <Button size="sm" disabled={busy} onClick={() => void act(() => api.mcp.disconnect(s.id))}><Unplug size={14} /> Disconnect</Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => void act(() => api.mcp.connect(s.id))}><Plug size={14} /> Connect</Button>
        )}
        <Button size="sm" onClick={async () => setTools(tools ? null : await api.mcp.tools(s.id))}><Wrench size={14} /> Tools</Button>
        <Button size="sm" onClick={async () => setLogs(logs ? null : await api.mcp.logs(s.id))}><ScrollText size={14} /> Logs</Button>
        <Button size="sm" onClick={() => setEdit(true)}><Pencil size={14} /></Button>
        <Button size="sm" variant="danger" onClick={() => { if (confirm(`Delete MCP server ${s.name}?`)) void act(() => api.mcp.remove(s.id)); }}><Trash2 size={14} /></Button>
      </div>
      {tools && (
        <div className="mt-3 space-y-1 text-sm">
          {tools.length === 0 && <div className="text-zinc-500">No tools</div>}
          {tools.map((t) => (
            <div key={t.fullName} className="rounded border border-zinc-200 dark:border-zinc-800 px-2 py-1">
              <span className="font-mono text-xs">{t.name}</span>
              <div className="text-xs text-zinc-500">{t.description}</div>
            </div>
          ))}
        </div>
      )}
      {logs && <pre className="mt-3 max-h-60 overflow-auto rounded bg-zinc-100 dark:bg-zinc-950 p-2 text-[11px]">{logs.join('\n') || '(empty)'}</pre>}
      {edit && <Modal title="Edit MCP server" onClose={() => setEdit(false)}><ServerForm initial={s} onDone={() => { setEdit(false); reload(); }} /></Modal>}
    </div>
  );
}

export function McpPage() {
  const { mcpServers, loadMcp } = useSettings();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [json, setJson] = useState('');
  const [err, setErr] = useState('');
  // Poll only while something can still change on its own: a server that is mid-handshake
  // settles into connected/error within a few seconds, and after that the list only moves in
  // response to a click, which reloads it anyway. A blanket 5s interval kept hitting
  // /api/mcp forever — including in a background tab — for a list that never changed.
  const settling = mcpServers.some((s) => s.status === 'connecting');
  useEffect(() => {
    void loadMcp();
    if (!settling) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void loadMcp();
    }, 2000);
    return () => clearInterval(t);
  }, [loadMcp, settling]);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h1 className="text-lg font-semibold tracking-tight">MCP Servers</h1>
          <p className="text-sm text-zinc-400">Tools exposed to the model as <span className="font-mono text-xs">mcp__server__tool</span>.</p>
        </div>
        <Button onClick={() => void loadMcp()}><RefreshCw size={14} /></Button>
        <Button onClick={() => setImporting(true)}><FileJson size={14} /> Import JSON</Button>
        <Button variant="primary" onClick={() => setAdding(true)}><Plus size={14} /> Add server</Button>
      </div>
      {mcpServers.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center">
          <p className="text-sm font-medium text-zinc-500">No MCP servers</p>
          <p className="mt-1 text-xs text-zinc-400">Try adding <code className="font-mono">npx -y @modelcontextprotocol/server-filesystem /path</code>.</p>
        </div>
      )}
      {mcpServers.map((s) => <ServerCard key={s.id} s={s} reload={() => void loadMcp()} />)}
      {adding && <Modal title="Add MCP server" onClose={() => setAdding(false)}><ServerForm onDone={() => { setAdding(false); void loadMcp(); }} /></Modal>}
      {importing && (
        <Modal title="Import mcpServers JSON" onClose={() => setImporting(false)}>
          <div className="space-y-3">
            <div className="text-xs text-zinc-500">Paste a Claude Desktop / Cursor style config: {'{ "mcpServers": { "name": { "command": "...", "args": [...] } } }'}</div>
            <Textarea rows={10} value={json} onChange={(e) => setJson(e.target.value)} />
            {err && <div className="text-sm text-red-600">{err}</div>}
            <div className="flex justify-end"><Button variant="primary" onClick={async () => { setErr(''); try { const r = await api.mcp.import(JSON.parse(json)); setImporting(false); setJson(''); void loadMcp(); alert(`Imported ${r.created} server(s)`); } catch (e) { setErr((e as Error).message); } }}>Import</Button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
