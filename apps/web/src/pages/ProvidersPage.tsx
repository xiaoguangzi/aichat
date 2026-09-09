import { useEffect, useState } from 'react';
import type { Model, Provider } from '@aichat/shared';
import { Box, Check, ChevronRight, Circle, Pencil, PlugZap, Plus, Search, Server, Star, Trash2 } from 'lucide-react';
import { api } from '../api/client.js';
import { useSettings } from '../store/settings.js';
import { Button } from '../components/ui/Button.js';
import { Input, Select } from '../components/ui/Field.js';
import { Modal } from '../components/ui/Modal.js';
import { ProviderForm } from '../components/providers/ProviderForm.js';
import { ModelForm } from '../components/providers/ModelForm.js';
import { AddModels } from '../components/providers/AddModels.js';
import { cn } from '../lib/utils.js';

const protocol = (p: Provider) => p.type === 'openai' ? 'OpenAI 兼容' : 'Anthropic 兼容';
const badge = 'rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400';

function ProviderDetail({ p, reload, onDirtyChange, onBusyChange }: { p: Provider; reload: () => Promise<void>; onDirtyChange: (v: boolean) => void; onBusyChange: (v: boolean) => void }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Model | null>(null);
  const [query, setQuery] = useState('');
  const [testModel, setTestModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [modalBusy, setModalBusy] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  useEffect(() => { onBusyChange(busy || modalBusy || connectionBusy); }, [busy, modalBusy, connectionBusy, onBusyChange]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [deleting, setDeleting] = useState<Model | 'provider' | null>(null);
  const models = p.models.filter((m) => `${m.modelId} ${m.displayName}`.toLowerCase().includes(query.toLowerCase()));
  const selectedTest = p.models.find((m) => m.modelId === testModel)?.modelId ?? p.models.find((m) => m.isDefault)?.modelId ?? p.models[0]?.modelId ?? '';
  const run = async (action: () => Promise<unknown>, message?: string) => {
    if (busy) return;
    setBusy(true); setError(''); setStatus('');
    try { await action(); if (message) setStatus(message); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const refresh = () => { void reload().catch((e: Error) => setError(e.message)); };
  const doneModel = () => { setAdding(false); setEditing(null); setModalBusy(false); setStatus('模型已保存，可在聊天页选择使用。'); refresh(); };
  return <section className="min-w-0 space-y-5">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="break-words text-xl font-semibold tracking-tight">{p.name}</h2><p className="mt-1 text-xs text-zinc-500">{protocol(p)}<span className="mx-2 text-zinc-300">/</span>{p.models.length} 个模型</p></div>
      <Button variant="ghost" aria-label={`删除供应商 ${p.name}`} disabled={busy} onClick={() => { setError(''); setDeleting('provider'); }}><Trash2 size={15} /></Button>
    </div>
    <div className="card p-5 sm:p-6">
      <div className="mb-5 flex items-center gap-2"><PlugZap size={16} className="text-zinc-400" /><h3 className="text-sm font-semibold">连接设置</h3></div>
      <ProviderForm initial={p} onBusyChange={setConnectionBusy} onDirtyChange={(v) => { setDirty(v); onDirtyChange(v); setStatus(''); }} onDone={() => { setStatus(''); refresh(); }} />
    </div>
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:px-6">
        <div><h3 className="flex items-center gap-2 text-sm font-semibold"><Box size={16} className="text-zinc-400" />模型<span className={badge}>{p.models.length}</span></h3><p className="mt-1.5 text-xs text-zinc-500">添加的模型会出现在聊天页的选择器中。</p></div>
        <Button variant="primary" disabled={dirty} title={dirty ? '请先保存连接设置' : undefined} onClick={() => setAdding(true)}><Plus size={14} />添加模型</Button>
      </div>
      {dirty && <p className="px-6 pb-3 text-xs text-accent-600 dark:text-accent-400">连接设置有未保存的更改，保存后即可获取模型或测试连接。</p>}
      {p.models.length > 0 ? <>
        <div className="px-5 pb-4 sm:px-6"><div className="relative"><Search size={14} className="pointer-events-none absolute left-3 top-2 text-zinc-400" /><Input className="pl-9" aria-label="搜索已添加模型" placeholder="搜索模型名称或 ID" value={query} onChange={(e) => setQuery(e.target.value)} /></div></div>
        <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">{models.map((m) => <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-zinc-50/60 dark:hover:bg-zinc-800/20 sm:px-6">
          <div className="min-w-0 flex-1 basis-40"><div className="flex flex-wrap items-center gap-2"><span className="break-all text-sm font-medium">{m.displayName}</span>{m.isDefault && <span className="rounded-md bg-accent-100 px-1.5 py-0.5 text-[10px] text-accent-700 dark:bg-accent-950/40 dark:text-accent-300">默认</span>}</div><p className="mt-1 break-all font-mono text-[11px] text-zinc-400">{m.modelId}</p>
            <div className="mt-2 flex flex-wrap gap-1">{[[m.caps.image, '图片'], [m.caps.pdf, 'PDF'], [m.caps.tools, '工具'], [m.caps.thinking, '思考']].filter(([on]) => on).map(([, label]) => <span key={String(label)} className={badge}>{label}</span>)}</div>
          </div>
          <div className="flex items-center gap-0.5"><Button variant="ghost" disabled={busy || m.isDefault} title={m.isDefault ? '默认模型' : '设为默认模型'} aria-label={`设为默认模型 ${m.displayName}`} onClick={() => void run(async () => { await api.providers.updateModel(p.id, m.id, { isDefault: true }); await reload(); }, '已设为默认模型。')}><Star size={15} className={m.isDefault ? 'text-accent-500' : ''} fill={m.isDefault ? 'currentColor' : 'none'} /></Button><Button variant="ghost" title="编辑模型" aria-label={`编辑模型 ${m.displayName}`} onClick={() => setEditing(m)}><Pencil size={14} /></Button><Button variant="ghost" title="删除模型" aria-label={`删除模型 ${m.displayName}`} disabled={busy} onClick={() => { setError(''); setDeleting(m); }}><Trash2 size={14} /></Button></div>
        </li>)}</ul>
        {!models.length && <p className="p-8 text-center text-xs text-zinc-500">没有匹配的模型。</p>}
        <div className="space-y-2 border-t border-zinc-100 bg-zinc-50/60 p-5 dark:border-zinc-800 dark:bg-zinc-900/40 sm:px-6"><div className="flex flex-wrap items-center gap-2"><Select aria-label="测试连接使用的模型" className="min-w-0 flex-1 basis-40" value={selectedTest} onChange={(e) => { setTestModel(e.target.value); setStatus(''); }} disabled={busy || dirty}>{p.models.map((m) => <option key={m.id} value={m.modelId}>{m.displayName}</option>)}</Select><Button disabled={busy || dirty} onClick={() => void run(async () => { const r = await api.providers.test(p.id, selectedTest); if (!r.ok) throw new Error('连接测试失败。'); setStatus(`连接成功 · ${r.ms} ms${r.text.trim() ? ` · ${r.text.trim()}` : ''}`); })}><PlugZap size={14} />{busy ? '处理中…' : '测试连接'}</Button></div><p className="text-[10px] text-zinc-400">发送一条简短消息，检查所选模型是否可用。</p></div>
      </> : <div className="mx-5 mb-5 rounded-xl border border-dashed border-zinc-200 p-8 text-center dark:border-zinc-700 sm:mx-6"><Box size={28} className="mx-auto text-zinc-300 dark:text-zinc-600" /><p className="mt-3 text-sm font-medium">还没有添加模型</p><p className="mt-1 text-xs leading-5 text-zinc-500">连接已配置。下一步从 API 获取模型，或手动填写模型 ID。</p></div>}
    </div>
    {status && <p role="status" className="flex items-start gap-2 break-all text-xs text-accent-600 dark:text-accent-400"><Check size={14} className="shrink-0" />{status}</p>}
    {error && !deleting && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    {adding && <Modal busy={modalBusy} title={`添加模型 · ${p.name}`} onClose={() => setAdding(false)}><AddModels p={p} onBusyChange={setModalBusy} onDone={doneModel} onChanged={refresh} onCancel={() => setAdding(false)} /></Modal>}
    {editing && <Modal busy={modalBusy} title="编辑模型" onClose={() => setEditing(null)}><ModelForm p={p} m={editing} onBusyChange={setModalBusy} onDone={doneModel} onCancel={() => setEditing(null)} /></Modal>}
    {deleting && <Modal busy={busy} title={deleting === 'provider' ? '删除供应商' : '删除模型'} onClose={() => { if (!busy) setDeleting(null); }}><p className="break-words text-sm leading-6">{deleting === 'provider' ? `删除「${p.name}」及其 ${p.models.length} 个模型？已有聊天记录会保留。` : `从「${p.name}」移除模型「${deleting.displayName}」？`}</p>{error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}<div className="mt-6 flex justify-end gap-2"><Button disabled={busy} onClick={() => setDeleting(null)}>取消</Button><Button variant="danger" disabled={busy} onClick={() => void run(async () => { if (deleting === 'provider') await api.providers.remove(p.id); else await api.providers.removeModel(p.id, deleting.id); setDeleting(null); await reload(); })}>{busy ? '删除中…' : '确认删除'}</Button></div></Modal>}
  </section>;
}

export function ProvidersPage() {
  const { providers, loadProviders } = useSettings();
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [modalBusy, setModalBusy] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = async () => { setError(''); try { await loadProviders(); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } };
  useEffect(() => { void loadProviders().catch((e: Error) => setError(e.message)).finally(() => setLoading(false)); }, [loadProviders]);
  const active = providers.find((p) => p.id === selected) ?? providers[0];
  const filtered = providers.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="space-y-6">
    <div><h1 className="text-xl font-semibold tracking-tight">模型服务</h1><p className="mt-2 text-sm text-zinc-500">连接供应商，管理你在聊天中使用的模型。</p></div>
    {error && <div role="alert" className="flex items-center gap-3 text-xs text-red-600">{error}<Button onClick={() => void load()}>重试</Button></div>}
    {loading && !providers.length ? <p role="status" className="py-16 text-center text-sm text-zinc-500">正在加载供应商…</p> : providers.length ? <div className="grid items-start gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="card p-3 md:sticky md:top-0">
        <div className="mb-3 flex items-center justify-between px-2 pt-1"><span className="text-xs font-semibold text-zinc-500">供应商</span><span className="text-[11px] text-zinc-400">{providers.length}</span></div>
        <Select aria-label="选择供应商" className="mb-3 md:hidden" disabled={detailBusy} value={active?.id ?? ''} onChange={(e) => { if (dirty) setPendingProvider(e.target.value); else setSelected(e.target.value); }}>{providers.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.models.length} 个模型</option>)}</Select>
        <Input className="hidden md:block" aria-label="搜索供应商" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索供应商…" />
        <nav aria-label="供应商列表" className="my-3 hidden max-h-[55vh] space-y-1 overflow-y-auto md:block">{filtered.map((p) => <button key={p.id} aria-current={active?.id === p.id ? 'true' : undefined} disabled={detailBusy} onClick={() => { if (p.id === active?.id) return; if (dirty) setPendingProvider(p.id); else setSelected(p.id); }} className={cn('flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left transition-colors', active?.id === p.id ? 'bg-accent-50 text-accent-700 dark:bg-accent-950/40 dark:text-accent-300' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50')}><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-current/10 bg-white/60 text-xs font-semibold dark:bg-zinc-800">{p.name.slice(0, 1).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{p.name}</span><span className="mt-1 flex items-center gap-1 text-[10px] text-zinc-500"><Circle size={5} fill="currentColor" className={p.models.length ? 'text-accent-500' : 'text-zinc-400'} />{p.models.length ? `${p.models.length} 个模型` : '待添加模型'}</span></span>{active?.id === p.id && <ChevronRight size={13} className="shrink-0" />}</button>)}</nav>
        {!filtered.length && <p className="hidden py-4 text-center text-xs text-zinc-400 md:block">没有匹配的供应商</p>}
        <Button className="w-full" disabled={detailBusy || dirty} title={dirty ? '请先保存连接设置' : undefined} onClick={() => setAdding(true)}><Plus size={14} />添加供应商</Button>
      </aside>
      {active && <ProviderDetail key={active.id} p={active} reload={loadProviders} onDirtyChange={setDirty} onBusyChange={setDetailBusy} />}
    </div> : !error && <div className="card px-6 py-16 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-50 text-accent-500 dark:bg-accent-950/40"><Server size={26} /></div><h2 className="mt-5 text-base font-semibold">连接你的第一个模型服务</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-500">选择供应商，填写 API 地址与密钥，再添加模型即可开始聊天。也支持中转服务和本地部署。</p><div className="mt-6 flex justify-center"><Button variant="primary" onClick={() => setAdding(true)}><Plus size={14} />添加供应商</Button></div><p className="mt-6 text-xs text-zinc-400">01 连接供应商 <span className="mx-2">→</span> 02 添加模型 <span className="mx-2">→</span> 03 开始聊天</p></div>}
    {pendingProvider && <Modal title="有未保存的连接设置" onClose={() => setPendingProvider(null)}><p className="text-sm text-zinc-500">切换供应商会丢弃当前修改。你可以返回保存，或放弃修改后切换。</p><div className="mt-6 flex justify-end gap-2"><Button onClick={() => setPendingProvider(null)}>返回编辑</Button><Button onClick={() => { setSelected(pendingProvider); setPendingProvider(null); setDirty(false); }}>放弃修改并切换</Button></div></Modal>}
    {adding && <Modal busy={modalBusy} title="添加供应商" onClose={() => setAdding(false)}><ProviderForm onBusyChange={setModalBusy} onCancel={() => setAdding(false)} onDone={(p) => { setSelected(p.id); setDirty(false); setQuery(''); setAdding(false); setModalBusy(false); void load(); }} /></Modal>}
  </div>;
}
