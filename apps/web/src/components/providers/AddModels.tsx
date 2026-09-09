import { useEffect, useState } from 'react';
import type { Provider } from '@aichat/shared';
import { Download, RefreshCw, Search } from 'lucide-react';
import { api } from '../../api/client.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Field.js';
import { ModelForm, defaultModelCaps } from './ModelForm.js';
import { cn } from '../../lib/utils.js';

type RemoteModel = { id: string; displayName?: string };
export function AddModels({ p, onDone, onChanged, onCancel, onBusyChange }: { p: Provider; onDone: () => void; onChanged: () => void; onCancel: () => void; onBusyChange?: (busy: boolean) => void }) {
  const [tab, setTab] = useState<'remote' | 'manual'>('remote');
  const [remote, setRemote] = useState<RemoteModel[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set(p.models.map((m) => m.modelId)));
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fetchModels = async () => {
    setBusy(true); setError(''); setNotice('');
    try { const result = await api.providers.remoteModels(p.id); setRemote([...new Map(result.filter((m) => m.id.trim()).map((m) => [m.id, m])).values()]); setSelected(new Set()); }
    catch (e) { setError(`获取失败：${(e as Error).message}。可以重试，或切换到手动添加。`); }
    finally { setBusy(false); }
  };
  const addModels = async () => {
    if (busy || !selected.size) return;
    setBusy(true); setError(''); setNotice('');
    let count = 0;
    try {
      // Keep completed IDs out of retries: upsert would otherwise overwrite their capabilities.
      for (const id of selected) {
        if (added.has(id)) continue;
        const model = remote?.find((m) => m.id === id);
        await api.providers.addModel(p.id, { modelId: id, displayName: model?.displayName || id, caps: defaultModelCaps(p) });
        count++;
        setAdded((cur) => new Set(cur).add(id));
        setSelected((cur) => { const next = new Set(cur); next.delete(id); return next; });
      }
      onDone();
    } catch (e) { setError(`添加失败：${(e as Error).message}`); setNotice(`已成功添加 ${count} 个模型，可重试剩余选择。`); if (count) onChanged(); }
    finally { setBusy(false); }
  };
  const visible = (remote ?? []).filter((m) => `${m.id} ${m.displayName ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const available = visible.filter((m) => !added.has(m.id));
  const allSelected = available.length > 0 && available.every((m) => selected.has(m.id));
  return <div className="space-y-4">
    <div className="flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">{(['remote', 'manual'] as const).map((t) => <button type="button" key={t} disabled={busy} aria-pressed={tab === t} onClick={() => setTab(t)} className={cn('flex-1 rounded-lg py-2 text-xs font-medium', tab === t ? 'bg-white shadow-xs dark:bg-zinc-700' : 'text-zinc-500')}>{t === 'remote' ? '从 API 获取' : '手动添加'}</button>)}</div>
    {tab === 'manual' ? <ModelForm p={p} onBusyChange={onBusyChange} onDone={onDone} onCancel={onCancel} /> : <>
      <p className="text-xs leading-5 text-zinc-500">从 {p.name} 获取可用模型，只添加你要使用的模型。添加后可单独编辑模型能力。</p>
      {remote === null ? <div className="rounded-xl border border-dashed border-zinc-200 px-4 py-8 text-center dark:border-zinc-700"><Download size={24} className="mx-auto mb-3 text-zinc-400" /><p className="mb-4 text-xs text-zinc-500">使用已保存的连接设置获取模型列表</p><Button disabled={busy} onClick={() => void fetchModels()}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />{busy ? '获取中…' : '获取模型列表'}</Button></div> : <>
        <div className="flex items-center gap-2"><Search size={16} className="shrink-0 text-zinc-400" /><Input aria-label="搜索远程模型" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索模型名称或 ID" /><Button aria-label="刷新模型列表" disabled={busy} onClick={() => void fetchModels()}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /></Button></div>
        <div className="flex items-center justify-between text-xs text-zinc-500"><label className="flex items-center gap-2"><input type="checkbox" disabled={busy || !available.length} checked={allSelected} onChange={() => setSelected((cur) => { const next = new Set(cur); for (const m of available) { if (allSelected) next.delete(m.id); else next.add(m.id); } return next; })} />选择当前结果</label><span>{remote.length} 个可用模型</span></div>
        <div className="max-h-72 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          {visible.map((m) => <label key={m.id} className={cn('flex items-center gap-3 border-b border-zinc-100 p-3 last:border-0 dark:border-zinc-800', added.has(m.id) ? 'text-zinc-400' : 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50')}><input type="checkbox" aria-label={`选择 ${m.id}`} disabled={busy || added.has(m.id)} checked={added.has(m.id) || selected.has(m.id)} onChange={(e) => setSelected((cur) => { const next = new Set(cur); if (e.target.checked) next.add(m.id); else next.delete(m.id); return next; })} /><span className="min-w-0 flex-1"><span className="block break-all text-xs font-medium">{m.displayName || m.id}</span>{m.displayName && m.displayName !== m.id && <span className="block break-all font-mono text-[10px] text-zinc-400">{m.id}</span>}</span>{added.has(m.id) && <span className="shrink-0 text-[10px]">已添加</span>}</label>)}
          {!visible.length && <p className="p-8 text-center text-xs text-zinc-500">{remote.length ? '没有匹配的模型，试试其他关键词。' : '接口未返回模型，请使用手动添加。'}</p>}
        </div>
        <p className="text-[11px] leading-5 text-zinc-400">API 列表通常不包含完整能力信息，请在添加后确认图片、工具与思考支持情况。</p>
      </>}
      {notice && <p role="status" className="text-xs text-zinc-500">{notice}</p>}
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2"><Button disabled={busy} onClick={onCancel}>取消</Button><Button variant="primary" disabled={busy || !selected.size} onClick={() => void addModels()}>{busy && selected.size ? '添加中…' : `添加所选${selected.size ? `（${selected.size}）` : ''}`}</Button></div>
    </>}
  </div>;
}
