import { useEffect, useMemo, useState } from 'react';
import type { ArtifactVersion } from '@aichat/shared';
import { Check, Copy, Download, Maximize2, Minimize2, RefreshCw, X } from 'lucide-react';
import { Markdown } from '../ui/Markdown.js';
import { buildArtifactPreview } from '../../lib/artifact-preview.js';
import { cn, copyText } from '../../lib/utils.js';
import { useArtifactResize } from './useArtifactResize.js';
import { useChat } from '../../store/chat.js';

interface Props {
  artifact: ArtifactVersion;
  versions: ArtifactVersion[];
  loadError: string;
  onSelect: (key: string) => void;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
  onSave: (code: string) => Promise<void>;
}
export function ArtifactPanel({ artifact, versions, loadError, onSelect, onClose, onSave, onDirty }: Props) {
  const [tab, setTab] = useState<'preview' | 'code'>(artifact.kind === 'code' ? 'code' : 'preview');
  const [draft, setDraft] = useState(artifact.code);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [full, setFull] = useState(false);
  const resize = useArtifactResize(full);
  const [mobile, setMobile] = useState(false);
  const [run, setRun] = useState(0);
  const [instruction, setInstruction] = useState('');
  const running = useChat(s => s.running);
  const send = useChat(s => s.send);
  const source = editing ? draft : artifact.code;
  const dirty = editing && draft !== artifact.code;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  const preview = useMemo(() => buildArtifactPreview({ kind: artifact.kind, code: source }, window.location.origin), [artifact.kind, source]);
  const btn = 'rounded-md px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40';
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const leave = (action: () => void) => {
    if (dirty) { setError('请先保存修改或点击「取消编辑」，再关闭或切换版本。'); return; }
    action();
  };
  const download = () => {
    const ext = ({ react: artifact.language === 'tsx' ? 'tsx' : 'jsx', markdown: 'md', mermaid: 'mmd', code: artifact.language || 'txt', html: 'html', svg: 'svg' })[artifact.kind];
    const mime = artifact.kind === 'html' ? 'text/html' : artifact.kind === 'svg' ? 'image/svg+xml' : 'text/plain';
    const url = URL.createObjectURL(new Blob([source], { type: `${mime};charset=utf-8` }));
    const a = document.createElement('a'); a.href = url; a.download = `${artifact.title.replace(/[^\p{L}\p{N}._-]/gu, '-').slice(0, 80)}.${ext.replace(/[^a-z0-9]/gi, '')}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <aside ref={resize.panelRef} style={resize.style} aria-label="Artifact 工作区" className={cn('flex flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#101116]',
    full ? 'fixed inset-0 z-50' : 'fixed inset-0 z-40 lg:relative lg:inset-auto lg:z-auto lg:w-[var(--artifact-panel-width)] lg:min-w-0 lg:shrink-0')}>
    {!full && <div {...resize.separatorProps} className="group absolute inset-y-0 -left-1.5 z-30 hidden w-3 touch-none cursor-col-resize items-center justify-center outline-none lg:flex">
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent-400 group-focus-visible:bg-accent-500" />
      <span className="relative h-9 w-1 rounded-full bg-zinc-300 group-hover:bg-accent-500 group-focus-visible:bg-accent-500 dark:bg-zinc-600" />
    </div>}
    {resize.dragging && <div className="fixed inset-0 z-[100] cursor-col-resize" aria-hidden="true" />}
    <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{artifact.title}</h2><p className="mt-0.5 text-[11px] text-zinc-500">{artifact.language.toUpperCase()} · {artifact.edited ? '手动编辑' : 'AI 生成'}{!artifact.complete && ' · 内容未完成'}</p></div>
      <button className={btn} title={full ? '退出全屏' : '全屏'} onClick={() => setFull(!full)}>{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
      <button className={btn} title="关闭作品" onClick={() => leave(onClose)}><X size={18} /></button>
    </header>
    <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
      {(['preview', 'code'] as const).map(value => <button key={value} disabled={value === 'preview' && artifact.kind === 'code'} onClick={() => setTab(value)} className={cn(btn, tab === value && 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white')}>{value === 'preview' ? '预览' : '源码'}</button>)}
      <span className="flex-1" />
      <select aria-label="作品版本" value={artifact.key} onChange={e => leave(() => onSelect(e.target.value))} className="max-w-36 rounded bg-transparent p-1 text-xs">
        {versions.map((version, i) => <option key={version.key} value={version.key}>版本 {i + 1}{version.edited ? ' · 编辑' : ''}</option>)}
      </select>
      <button className={btn} title="复制源码" onClick={async () => { if (await copyText(source)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>
      <button className={btn} title="下载作品" onClick={download}><Download size={15} /></button>
    </div>
    {(error || loadError) && <div role="alert" className="bg-red-50 px-4 py-2 text-xs text-red-700 dark:bg-red-950/30">{error || loadError}</div>}
    {tab === 'code' ? <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-4 py-2 text-xs text-zinc-500"><span>{source.length.toLocaleString()} 字符{dirty ? ' · 未保存' : ''}</span>
        {editing ? <div><button disabled={saving} className={btn} onClick={() => { setEditing(false); setError(''); }}>取消编辑</button><button disabled={!dirty || saving} className={btn} onClick={async () => { setSaving(true); setError(''); try { await onSave(draft); } catch (e) { setError(String(e)); } finally { setSaving(false); } }}>{saving ? '保存中…' : '保存新版本'}</button></div>
          : <button disabled={!artifact.complete} className={btn} onClick={() => { setDraft(artifact.code); setEditing(true); }}>编辑源码</button>}
      </div>
      <textarea aria-label="作品源码" spellCheck={false} readOnly={!editing} value={source} onChange={e => setDraft(e.target.value)} className="min-h-0 flex-1 resize-none border-0 bg-[#0d1117] p-4 font-mono text-xs leading-6 text-zinc-200 outline-none" />
    </div> : <>
      <div className="flex items-center justify-between px-3 py-1 text-xs text-zinc-500"><button className={btn} onClick={() => setMobile(!mobile)}>{mobile ? '手机宽度 · 375px' : '自适应宽度'}</button><button className={btn} title="重新运行" onClick={() => setRun(run + 1)}><RefreshCw size={14} /></button></div>
      <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-zinc-100 p-2 dark:bg-zinc-950">
        {!artifact.complete ? <div className="m-auto px-6 text-center text-sm text-zinc-500">源码仍未完成，可在「源码」中查看生成进度。完成后自动运行预览。</div>
          : artifact.kind === 'markdown' ? <div className={cn('h-full overflow-auto bg-white p-6 dark:bg-zinc-900', mobile ? 'w-[375px] max-w-full' : 'w-full')}><Markdown text={source} /></div>
          : <iframe key={run} title={`${artifact.title} 预览`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={preview} className={cn('h-full border-0 bg-white shadow-sm', mobile ? 'w-[375px] max-w-full' : 'w-full')} />}
      </div>
    </>}
    <form className="border-t border-zinc-200 p-3 dark:border-zinc-800" onSubmit={event => {
      event.preventDefault();
      if (!instruction.trim() || running || !artifact.complete || dirty) return;
      // Include the selected version, including local edits, so the model sees exactly what is being revised.
      const fence = '`'.repeat(Math.max(3, ...Array.from(source.matchAll(/`+/g), m => m[0].length + 1)));
      void send(`请修改下面的作品，保持 artifact id 不变并输出完整新版本。要求：${instruction.trim()}\n\n${fence}${artifact.language} artifact id="${artifact.id}" title="${artifact.title.replace(/"/g, '')}"\n${source}\n${fence}`);
      setInstruction('');
    }}>
      <div className="flex gap-2"><input aria-label="让 AI 修改作品" placeholder="让 AI 修改这个版本…" value={instruction} onChange={e => setInstruction(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent-400 dark:border-zinc-700" /><button disabled={running || !instruction.trim() || !artifact.complete || dirty} className="rounded-lg bg-accent-600 px-3 text-xs text-white disabled:opacity-40">发送</button></div>
      <p className="mt-2 text-[10px] text-zinc-500">本地隔离预览 · 修改时发送当前源码给所选模型 · 下载保留源文件</p>
    </form>
  </aside>;
}
