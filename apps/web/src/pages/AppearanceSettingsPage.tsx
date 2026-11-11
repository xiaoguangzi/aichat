import { Check, Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
import { DEFAULT_SKIN, SKINS, type Skin } from '../lib/skins.js';
import { useAppearance } from '../lib/use-appearance.js';
import { cn } from '../lib/utils.js';
import { Button } from '../components/ui/Button.js';
import { SkinPreview } from '../components/settings/SkinPreview.js';

const modes = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
] as const;

export function AppearanceSettingsPage() {
  const { theme, skin, resolved, setTheme, setSkin } = useAppearance();
  return (
    <section className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">外观</h1>
        <p className="mt-1 text-sm text-zinc-500">选择配色主题与明暗模式，更改立即生效，仅保存在此浏览器。</p>
      </div>

      <div className="card space-y-4 p-5 sm:p-6">
        <div>
          <h2 className="text-sm font-semibold">明暗模式</h2>
          <p className="mt-0.5 text-xs text-zinc-500">「跟随系统」会随操作系统的深浅色设置自动切换。</p>
        </div>
        <div role="group" aria-label="明暗模式" className="inline-flex flex-wrap gap-1 rounded-xl border border-zinc-200/90 bg-zinc-100/70 p-1 dark:border-zinc-700/80 dark:bg-zinc-900/60">
          {modes.map(({ value, label, icon: Icon }) => (
            <button key={value} type="button" aria-pressed={theme === value} onClick={() => setTheme(value)}
              className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150 focus-visible:outline-2 focus-visible:outline-accent-500',
                theme === value
                  ? 'bg-white text-accent-700 shadow-xs dark:bg-zinc-800 dark:text-accent-300'
                  : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100')}>
              <Icon size={14} />{label}
            </button>
          ))}
        </div>
      </div>

      <div className="card space-y-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">配色主题</h2>
            <p className="mt-0.5 text-xs text-zinc-500">共 {SKINS.length} 套，均为纯色设计、不含渐变。只作用于浅色模式。</p>
          </div>
          <Button size="sm" variant="ghost" disabled={skin === DEFAULT_SKIN} onClick={() => setSkin(DEFAULT_SKIN)}>
            <RotateCcw size={13} />恢复默认
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {SKINS.map((s) => <SkinCard key={s.id} skin={s} selected={s.id === skin} variant={s.light} onSelect={() => setSkin(s.id)} />)}
        </div>
        <p className="text-xs leading-6 text-zinc-500">深色模式统一为中性黑，不随主题变化{resolved === 'dark' && '；当前为深色模式，所选主题会在切回浅色时生效'}。选择会记住，下次打开自动应用。</p>
      </div>
    </section>
  );
}

function SkinCard({ skin, selected, variant, onSelect }: { skin: Skin; selected: boolean; variant: Skin['light']; onSelect: () => void }) {
  return (
    <button type="button" aria-pressed={selected} aria-label={`${skin.name}主题`} onClick={onSelect}
      className={cn('group relative space-y-3 rounded-2xl border p-3 text-left transition-all duration-150 focus-visible:outline-2 focus-visible:outline-accent-500',
        selected
          ? 'border-accent-500 ring-2 ring-accent-500/25'
          : 'border-zinc-200/90 hover:border-accent-400 hover:shadow-xs dark:border-zinc-700/70 dark:hover:border-accent-500')}>
      <div className="relative">
        <SkinPreview variant={variant} />
        {selected && (
          <span className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent-600 text-white shadow-xs">
            <Check size={14} />
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <span className={cn('text-sm font-semibold', selected ? 'text-accent-700 dark:text-accent-300' : 'text-zinc-900 dark:text-zinc-100')}>{skin.name}</span>
        {selected && <span className="text-[11px] font-medium text-accent-600 dark:text-accent-400">使用中</span>}
      </div>
      <p className="px-0.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{skin.tagline}</p>
    </button>
  );
}
