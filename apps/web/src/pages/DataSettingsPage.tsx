import { useCallback, useEffect, useState } from 'react';
import type { BackupInfo, PruneResult, StorageStats, TraceRetention, TraceRetentionInput } from '@aichat/shared';
import { api } from '../api/client';
import { Button } from '../components/ui/Button';
import { Field, Input, Toggle } from '../components/ui/Field';

const MB = 1024 * 1024;

function human(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * MB) return `${Math.round((bytes / MB) * 10) / 10} MB`;
  return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
}

/** Text inputs keep the user's raw string so "empty" stays distinct from an explicit 0. */
interface RetentionForm {
  autoPrune: boolean;
  vacuumOnPrune: boolean;
  maxCount: string;
  maxTotalMb: string;
  maxAgeDays: string;
}

const toForm = (input: TraceRetentionInput, resolved: TraceRetention): RetentionForm => ({
  autoPrune: resolved.autoPrune,
  vacuumOnPrune: resolved.vacuumOnPrune,
  // An unset limit stays an empty box and is announced as a placeholder instead, so saving without
  // touching it keeps following the server default rather than freezing today's number.
  maxCount: input.maxCount === undefined || input.maxCount === null ? '' : String(input.maxCount),
  maxTotalMb: input.maxTotalBytes === undefined || input.maxTotalBytes === null ? '' : String(Math.round((input.maxTotalBytes / MB) * 10) / 10),
  maxAgeDays: input.maxAgeDays === undefined || input.maxAgeDays === null ? '' : String(input.maxAgeDays),
});

/** Empty = keep the server default; a finite number = enforce exactly that (0 means "no limit"). */
function parseField(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

function toInput(form: RetentionForm): TraceRetentionInput {
  const mbValue = Number(form.maxTotalMb.trim());
  return {
    autoPrune: form.autoPrune,
    vacuumOnPrune: form.vacuumOnPrune,
    maxCount: parseField(form.maxCount) ?? null,
    maxTotalBytes: form.maxTotalMb.trim() && Number.isFinite(mbValue) && mbValue >= 0 ? Math.floor(mbValue * MB) : null,
    maxAgeDays: parseField(form.maxAgeDays) ?? null,
  };
}

export function DataSettingsPage() {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [titleModelId, setTitleModelId] = useState<string | null>(null);
  const [form, setForm] = useState<RetentionForm | null>(null);
  /** The effective values, used as placeholders so an unset box still shows what is enforced. */
  const [effective, setEffective] = useState<TraceRetention | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [reload, setReload] = useState(0);
  const [backups, setBackups] = useState<{ dir: string; max: number; dbBytes: number; backups: BackupInfo[] } | null>(null);

  const load = useCallback(async () => {
    const [storage, settings, snapshots] = await Promise.all([
      api.settings.storage(), api.settings.get(), api.settings.backups(),
    ]);
    setStats(storage);
    setForm(toForm(storage.retentionInput, storage.retention));
    setEffective(storage.retention);
    setTitleModelId(settings.titleModelId);
    setBackups(snapshots);
  }, []);

  useEffect(() => {
    let active = true;
    setError('');
    void load().catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [load, reload]);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label); setError(''); setStatus('');
    try {
      setStatus(await fn());
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const save = () => form && run('save', async () => {
    // The settings endpoint replaces the whole object, so the title model must be sent back too.
    await api.settings.update({ titleModelId, traceRetention: toInput(form) });
    return '已保存。超出限制的请求日志会在下一次生成开始时清理。';
  });

  const prune = (mode: 'keep' | 'hard') => run(mode, async () => {
    const result = await api.settings.prune({ mode, vacuum: form?.vacuumOnPrune });
    return describe(result);
  });

  const backup = () => run('backup', async () => {
    const created = await api.settings.backup();
    return `已创建快照 ${created.name}（${human(created.bytes)}）。恢复方法见备份目录中的 README.txt。`;
  });

  const vacuum = () => run('vacuum', async () => {
    const { reclaimedBytes } = await api.settings.vacuum();
    return reclaimedBytes > 0 ? `已回收 ${human(reclaimedBytes)} 数据库空间。` : '没有可回收的空闲页。';
  });

  const traces = stats?.traces;
  const dirty = !!form;

  return <section className="max-w-2xl space-y-5">
    <div>
      <h1 className="text-xl font-semibold">数据与日志</h1>
      <p className="mt-1 text-sm text-zinc-500">请求日志保存每次上游请求与响应，是排查缓存、用量和供应商行为的主要依据，也是本地数据库占比最大的部分。这里可以查看占用、限制它的增长并回收空间。</p>
    </div>

    <div className="card space-y-4 p-5 sm:p-6">
      <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">当前占用</h2>
      {!stats ? <p className="text-xs text-zinc-500">{error ? '无法读取占用信息。' : '读取中…'}</p> : <>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-xs">
          <Row label="数据库文件" value={human(stats.db.bytes)} hint={stats.db.freePages > 0 ? `含空闲页 ${human(stats.db.reclaimableBytes)}` : undefined} />
          <Row label="请求日志" value={`${traces!.count} 条 · ${human(traces!.bytes)}`} hint={`来自 ${traces!.conversations} 个会话`} />
          <Row label="消息正文" value={`${stats.messages.count} 条 · ${human(stats.messages.bytes)}`} />
          <Row label="工具结果原文" value={`${stats.toolResults.count} 条 · ${human(stats.toolResults.bytes)}`} hint="供模型用 context__read_result 回读" />
          <Row label="上传文件" value={`${stats.uploads.count} 个 · ${human(stats.uploads.bytes)}`} hint={stats.uploads.orphaned > 0 ? `其中 ${stats.uploads.orphaned} 个已无消息引用（${human(stats.uploads.orphanedBytes)}）` : undefined} />
        </dl>
      </>}
    </div>

    <div className="card space-y-5 p-5 sm:p-6">
      <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">保留策略</h2>
      {!form ? <p className="text-xs text-zinc-500">读取中…</p> : <>
        <Toggle checked={form.autoPrune} onChange={v => setForm({ ...form, autoPrune: v })} label="自动清理超出限制的日志" />
        <p className="text-[11px] leading-4 text-zinc-500">每次开始生成时检查一次（最多 5 分钟一次）。关闭后日志只受单条正文 16 MiB 的上限约束，会持续增长，但仍可用下方按钮手动清理。</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="最多保留条数" hint="默认 500">
            <Input aria-label="最多保留条数" inputMode="numeric" placeholder={String(effective?.maxCount ?? '')} value={form.maxCount} onChange={e => setForm({ ...form, maxCount: e.target.value })} />
          </Field>
          <Field label="正文总量上限（MB）" hint="默认 128">
            <Input aria-label="正文总量上限" inputMode="decimal" placeholder={String(Math.round(((effective?.maxTotalBytes ?? 0) / MB) * 10) / 10)} value={form.maxTotalMb} onChange={e => setForm({ ...form, maxTotalMb: e.target.value })} />
          </Field>
          <Field label="保留天数" hint="默认 30">
            <Input aria-label="保留天数" inputMode="numeric" placeholder={String(effective?.maxAgeDays ?? '')} value={form.maxAgeDays} onChange={e => setForm({ ...form, maxAgeDays: e.target.value })} />
          </Field>
        </div>
        <p className="text-[11px] leading-4 text-zinc-500">三项都按「最早的先删」执行。灰色数字是当前生效值：留空表示跟随默认值（默认值随版本更新），填 0 表示该项不限制。</p>
        <Toggle checked={form.vacuumOnPrune} onChange={v => setForm({ ...form, vacuumOnPrune: v })} label="手动清理后回收数据库空间" />
        <p className="text-[11px] leading-4 text-zinc-500">删除记录只是把数据页标记为空闲，数据库文件不会因此变小；回收需要重写整个文件，所以只在手动清理时执行，自动清理不会触发。</p>
        <p className="text-[11px] leading-4 text-zinc-500">正在生成的会话整体跳过，等这一轮结束后才参与判断。日志清空后无法恢复，正文也不会补录。</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={!!busy || !dirty} onClick={() => void save()}>{busy === 'save' ? '保存中…' : '保存策略'}</Button>
          <span className="text-[11px] text-zinc-500">保存后立即按新限制清理一次。</span>
        </div>
      </>}
    </div>

    <div className="card space-y-4 p-5 sm:p-6">
      <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">备份</h2>
      <p className="text-xs leading-5 text-zinc-500">
        用 SQLite 的 <code className="font-mono">VACUUM INTO</code> 生成一致快照，服务运行中即可执行；手工复制
        <code className="mx-1 font-mono">aichat.db</code> 在 WAL 模式下可能丢失最新提交。上传的附件不在快照内。
      </p>
      {backups && <>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-xs">
          <Row label="数据库当前大小" value={human(backups.dbBytes)} />
          <Row label="保留快照" value={`${backups.backups.length} / ${backups.max}`} hint={backups.backups[0] ? `最近：${new Date(backups.backups[0].createdAt).toLocaleString()}` : '还没有快照'} />
        </dl>
        <p className="break-all font-mono text-[11px] text-zinc-400">{backups.dir}</p>
      </>}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={!!busy} onClick={() => void backup()}>{busy === 'backup' ? '备份中…' : '立即创建快照'}</Button>
        <span className="text-[11px] text-zinc-500">最多保留 {backups?.max ?? 10} 份，更旧的自动删除。</span>
      </div>
    </div>

    <div className="card space-y-4 p-5 sm:p-6">
      <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">立即清理</h2>
      <p className="text-xs leading-5 text-zinc-500">按保留策略清理一次，或清空全部请求日志。两者都不会删除会话、消息、工具结果原文或上传文件。</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!!busy} onClick={() => void prune('keep')}>{busy === 'keep' ? '清理中…' : '按策略清理'}</Button>
        <Button variant="danger" disabled={!!busy} onClick={() => { if (confirm('清空全部请求日志？此操作不可撤销，之后无法再查看历史请求与响应正文。')) void prune('hard'); }}>{busy === 'hard' ? '清空中…' : '清空请求日志'}</Button>
        <Button disabled={!!busy || !stats?.db.freePages} onClick={() => void vacuum()}>{busy === 'vacuum' ? '回收中…' : `回收空间${stats?.db.freePages ? `（${human(stats.db.reclaimableBytes)}）` : ''}`}</Button>
      </div>
      {status && <p role="status" className="text-sm text-accent-600">{status}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!stats && error && <Button onClick={() => setReload(n => n + 1)}>重试加载</Button>}
    </div>
  </section>;
}

function describe(r: PruneResult): string {
  if (r.deleted === 0) return r.protectedConversations > 0 ? '没有可清理的记录；正在生成的会话未参与清理。' : '没有超出保留策略的记录。';
  const parts = [`已删除 ${r.deleted} 条请求日志`];
  if (r.reclaimedBytes > 0) parts.push(`回收 ${human(r.reclaimedBytes)} 空间`);
  parts.push(`剩余 ${r.remaining} 条`);
  if (r.protectedConversations > 0) parts.push(`${r.protectedConversations} 个正在生成的会话已跳过`);
  return `${parts.join('，')}。`;
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <>
    <dt className="text-zinc-600 dark:text-zinc-400">
      {label}
      {hint && <span className="ml-2 text-[11px] text-zinc-400 dark:text-zinc-500">{hint}</span>}
    </dt>
    <dd className="text-right font-mono tabular-nums text-zinc-800 dark:text-zinc-200">{value}</dd>
  </>;
}
