import type { ContextEstimate } from '@aichat/shared';
import { cn } from '../../lib/utils';

/**
 * Occupancy of the next request, estimated from the payload the server assembled. Without a
 * declared context window there is no denominator, so the raw count is shown and no bar is drawn —
 * a percentage against a guessed window would look precise while being wrong.
 */
export function ContextMeter({ estimate, className }: { estimate: ContextEstimate | null; className?: string }) {
  if (!estimate || estimate.total <= 0) return null;
  const ratio = estimate.ratio;
  const percent = ratio == null ? null : Math.round(ratio * 100);
  const level = ratio == null ? 'unknown' : ratio >= 0.9 ? 'high' : ratio >= 0.7 ? 'medium' : 'low';
  const tone = {
    low: 'bg-zinc-300 dark:bg-zinc-600',
    medium: 'bg-amber-400',
    high: 'bg-red-500',
    unknown: 'bg-zinc-300 dark:bg-zinc-600',
  }[level];

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500', className)}
      title={[
        `已组装请求估算：约 ${estimate.total.toLocaleString()} tokens`,
        `历史 ${estimate.history.toLocaleString()} · 工具 ${estimate.tools.toLocaleString()} · 系统提示 ${estimate.system.toLocaleString()}`,
        `为本轮输出预留 ${estimate.reservedOutput.toLocaleString()}`,
        estimate.budget
          ? `模型声明的上下文窗口 ${estimate.budget.toLocaleString()}（占 ${percent}%）`
          : '该模型未填写上下文窗口，仅显示估算值，不显示比例',
        '按字符类型估算（ASCII 约 4 字符/token，中文约 1.5 字符/token），不是上游的精确计数；上下文超限时服务端会清理旧工具结果后重试一次。',
      ].join('\n')}
    >
      {percent != null && (
        <span className="h-1 w-10 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
          <span className={cn('block h-full rounded-full transition-[width] duration-300', tone)} style={{ width: `${Math.max(2, percent)}%` }} />
        </span>
      )}
      <span>{estimate.total >= 1_000 ? `${(estimate.total / 1_000).toFixed(1)}k` : estimate.total}{percent != null ? ` · ${percent}%` : ''}</span>
    </span>
  );
}
