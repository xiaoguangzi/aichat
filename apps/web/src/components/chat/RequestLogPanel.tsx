import { useEffect, useMemo, useState } from 'react';
import type { ApiTrace, ApiTraceDetail } from '@aichat/shared';
import { Activity, Check, Copy, Loader2, RefreshCw, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { useChat } from '../../store/chat';
import { copyText, cn } from '../../lib/utils.js';
import { traceResponse } from '../../lib/trace-response.js';

const statusText = { running: '进行中', complete: '完成', error: '失败', interrupted: '已中止' };
const statusColor = { running: 'text-accent-500', complete: 'text-emerald-600 dark:text-emerald-400', error: 'text-red-500', interrupted: 'text-amber-600 dark:text-amber-400' };
const tabs = [['summary', '概要'], ['request', '请求 JSON'], ['output', '响应内容'], ['response', '原始响应'], ['usage', '用量']] as const;
type Tab = typeof tabs[number][0];
const DISPLAY_CHARS = 512 * 1024;
const smallButton = 'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800';

const duration = (ms: number) => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
const compact = (n: number) => n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour12: false });
const number = (value: unknown) => typeof value === 'number' ? value : undefined;

/** Both protocols report usage differently; show the common trio without hiding the raw object. */
function tokens(usage: Record<string, unknown> | undefined) {
  if (!usage) return null;
  const details = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  const input = number(usage.prompt_tokens) ?? number(usage.input_tokens);
  const output = number(usage.completion_tokens) ?? number(usage.output_tokens);
  const cached = number(details?.cached_tokens) ?? number(usage.prompt_cache_hit_tokens) ?? number(usage.cache_read_input_tokens);
  if (input === undefined && output === undefined) return null;
  return `${input === undefined ? '?' : compact(input)}↑ ${output === undefined ? '?' : compact(output)}↓${cached ? ` · 缓存 ${compact(cached)}` : ''}`;
}

export function RequestLogPanel({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const messages = useChat((s) => s.messages);
  const running = useChat((s) => s.running);
  const [records, setRecords] = useState<ApiTrace[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await api.traces.list(conversationId);
        if (!disposed) { setRecords(next); setLoaded(true); setError(''); }
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : '请求日志加载失败'); }
      if (!disposed && running) timer = setTimeout(() => void refresh(), 1500);
    };
    void refresh();
    return () => { disposed = true; clearTimeout(timer); };
  }, [conversationId, running, revision]);

  // Group attempts under the user message that started their loop, in conversation order.
  const turns = useMemo(() => messages.filter(m => m.role === 'user' && m.content.some(b => b.type !== 'tool_result')), [messages]);
  const prompt = (turnId: string) => turns.find(t => t.id === turnId)?.content.flatMap(b => b.type === 'text' ? [b.text] : []).join(' ').trim() || '附件消息';
  const q = query.trim().toLowerCase();
  const shown = records.filter(r => (!failedOnly || r.status === 'error' || r.status === 'interrupted') &&
    (!q || [r.model, r.providerName, r.url, r.error ?? '', String(r.httpStatus ?? ''), r.requestId ?? ''].some(v => v.toLowerCase().includes(q))));
  const groups: [string, ApiTrace[]][] = [];
  for (const record of shown) {
    const group = groups.find(([id]) => id === record.turnId);
    if (group) group[1].push(record); else groups.push([record.turnId, [record]]);
  }
  groups.sort(([a], [b]) => turns.findIndex(t => t.id === a) - turns.findIndex(t => t.id === b));
  const selected = records.find(r => r.id === selectedId) ?? null;
  const failed = records.filter(r => r.status === 'error' || r.status === 'interrupted').length;
  const total = records.reduce((sum, r) => sum + r.durationMs, 0);

  return (
    <aside aria-label="请求日志" className="request-log-panel z-10 flex h-full w-[32rem] max-w-full shrink-0 flex-col border-l border-zinc-200/80 bg-white/95 text-sm shadow-xl backdrop-blur-md dark:border-zinc-800/80 dark:bg-[#0c0d14]/95">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800/80">
        <Activity size={15} className="text-accent-500" />
        <span className="font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">请求日志</span>
        <span className="min-w-0 truncate text-[11px] text-zinc-400">{records.length} 次请求{failed > 0 && ` · ${failed} 次失败`} · {duration(total)}</span>
        <button type="button" className={cn(smallButton, 'ml-auto')} aria-label="刷新请求日志" onClick={() => setRevision(v => v + 1)}><RefreshCw size={13} /></button>
        <button type="button" className={smallButton} aria-label="关闭请求日志" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2 dark:border-zinc-800/80">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="筛选模型、供应商、URL、状态…" aria-label="筛选请求" className="min-w-0 flex-1 rounded-md bg-zinc-100 px-2.5 py-1.5 text-xs outline-none placeholder:text-zinc-400 focus:ring-2 focus:ring-accent-400 dark:bg-zinc-800" />
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-500"><input type="checkbox" checked={failedOnly} onChange={e => setFailedOnly(e.target.checked)} />仅失败</label>
      </div>
      <div className={cn('min-h-0 overflow-y-auto', selected ? 'flex-none max-h-[45%]' : 'flex-1')}>
        {error && <p role="alert" className="px-4 py-3 text-xs text-red-500">{error}</p>}
        {!loaded && !error && <p className="px-4 py-8 text-center text-xs text-zinc-500">正在读取请求日志…</p>}
        {loaded && records.length === 0 && <p className="px-4 py-8 text-xs leading-5 text-zinc-500">{running ? '等待本轮 API 请求…' : '本会话没有保留的 API 请求记录。历史正文无法补录，新增请求会自动采集。'}</p>}
        {loaded && records.length > 0 && shown.length === 0 && <p className="px-4 py-8 text-center text-xs text-zinc-500">没有匹配的请求</p>}
        {groups.map(([turnId, items]) => <section key={turnId} className="border-b border-zinc-100 dark:border-zinc-800/60">
          <h3 className="sticky top-0 truncate bg-zinc-50/95 px-4 py-1.5 text-[11px] text-zinc-500 backdrop-blur dark:bg-zinc-900/95">{prompt(turnId)}</h3>
          {items.map(record => <button key={record.id} type="button" aria-pressed={record.id === selectedId} onClick={() => setSelectedId(record.id === selectedId ? null : record.id)}
            className={cn('flex w-full flex-col gap-0.5 px-4 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40', record.id === selectedId && 'bg-accent-500/10 hover:bg-accent-500/10')}>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono text-[11px] text-zinc-400">{clock(record.startedAt)}</span>
              <span className={cn('flex items-center gap-1', statusColor[record.status])}>
                {record.status === 'running' ? <Loader2 size={11} className="animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                {statusText[record.status]}
              </span>
              <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">{record.providerName && `${record.providerName} / `}{record.model}</span>
              {record.httpStatus && <span className="font-mono text-[11px] text-zinc-400">{record.httpStatus}</span>}
              <span className="shrink-0 font-mono text-[11px] text-zinc-400">{duration(record.status === 'running' ? Math.max(0, Date.now() - Date.parse(record.startedAt)) : record.durationMs)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-400">
              {record.purpose === 'title' && <span className="rounded bg-zinc-100 px-1 text-zinc-500 dark:bg-zinc-800">标题</span>}
              {record.attempt > 1 && <span className="text-amber-600">重试 {record.attempt - 1}</span>}
              <span>{tokens(record.rawUsage) ?? (record.status === 'running' ? '' : '用量未报告')}</span>
              {record.error && <span className="truncate text-red-500">{record.error}</span>}
            </div>
          </button>)}
        </section>)}
      </div>
      {selected && <TraceDetail key={selected.id} record={selected} />}
    </aside>
  );
}

function TraceDetail({ record }: { record: ApiTrace }) {
  const [tab, setTab] = useState<Tab>('output');
  const [detail, setDetail] = useState<ApiTraceDetail | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!record.bodyAvailable) return;
    let disposed = false;
    void api.traces.get(record.conversationId, record.id).then(data => {
      if (!disposed) { setDetail(data); setError(''); }
    }).catch(e => { if (!disposed) setError(e instanceof Error ? e.message : '请求详情加载失败'); });
    return () => { disposed = true; };
  }, [record.conversationId, record.id, record.bodyAvailable, record.status, record.responseBytes, revision]);

  const notes = [...new Set([...record.notes, ...(detail?.notes ?? [])])];
  const summary = {
    status: record.status, httpStatus: record.httpStatus, error: record.error, method: record.method, url: record.url,
    provider: record.providerName, model: record.model, protocol: record.protocol, purpose: record.purpose, attempt: record.attempt,
    startedAt: record.startedAt, durationMs: record.durationMs, requestId: record.requestId, responseId: record.responseId,
    requestHeaders: detail?.requestHeaders, responseHeaders: detail?.responseHeaders,
  };
  const raw = detail?.responseBody ?? null;
  const output = useMemo(() => traceResponse(raw), [raw]);
  const text = tab === 'summary' ? JSON.stringify(summary, null, 2)
    : tab === 'request' ? (detail ? JSON.stringify(detail.requestBody, null, 2) : '')
      : tab === 'output' ? (output ? JSON.stringify(output.value, null, 2) : '')
      : tab === 'usage' ? JSON.stringify(record.rawUsage ?? null, null, 2)
        : raw === null ? '' : raw.length > DISPLAY_CHARS ? raw.slice(0, DISPLAY_CHARS) : raw;
  const pending = record.bodyAvailable && !detail && !error;
  const hint = tab === 'request' ? (!record.bodyAvailable ? '未采集请求正文' : '这是发送前的上下文；本次生成的 thinking 和正文请查看「响应内容」。')
    : tab === 'output' ? (output ? `由本次原始响应拼接，包含上游返回的 thinking、正文及工具调用。${output.partial ? '响应可能不完整，请结合状态和原始响应核对。' : ''}`
      : record.status === 'running' ? '等待本次响应内容…' : '没有可解析的响应内容，请查看「原始响应」或「概要」。')
    : tab === 'response' && detail && raw === null ? (record.status === 'running' ? '等待上游响应…' : '未采集原始响应')
      : tab === 'response' && raw !== null && raw.length > DISPLAY_CHARS ? `原始响应共 ${raw.length} 字符，仅显示开头 ${DISPLAY_CHARS} 字符，可复制完整内容`
        : tab === 'usage' && !record.rawUsage ? '上游未报告用量' : '';

  return <div className="flex min-h-0 flex-1 flex-col border-t border-zinc-200 dark:border-zinc-700">
    <div className="flex flex-wrap items-center gap-1 px-3 py-2">
      {tabs.map(([key, label]) => <button type="button" key={key} onClick={() => { setTab(key); setCopied(false); }} className={cn(smallButton, tab === key && 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100')}>{label}</button>)}
      <button type="button" className={cn(smallButton, 'ml-auto')} disabled={!text && raw === null} onClick={async () => setCopied(await copyText(tab === 'response' && raw !== null ? raw : text))}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? '已复制' : '复制'}</button>
    </div>
    <div className="px-3 text-[11px] leading-5 text-zinc-500">
      {(tab === 'summary' || tab === 'output') && notes.map(note => <p key={note}>{note}</p>)}
      {hint && <p>{hint}</p>}
      {error && <p role="alert" className="text-red-500">{error} <button type="button" className={smallButton} onClick={() => setRevision(v => v + 1)}>重试加载</button></p>}
      {pending && tab !== 'usage' && <p>正在读取正文…</p>}
    </div>
    {text && <pre tabIndex={0} className="mx-3 mb-3 min-h-0 flex-1 overflow-auto rounded-lg bg-zinc-50 p-3 font-mono text-[11px] leading-5 text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 whitespace-pre-wrap break-all">{text}</pre>}
  </div>;
}
