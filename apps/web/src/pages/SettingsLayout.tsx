import { NavLink, Outlet, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import { LogoMark } from '../components/ui/Logo';
import { useChat } from '../store/chat.js';

const tabs = [
  { to: '/settings/general', label: '通用' },
  { to: '/settings/providers', label: '模型服务' },
  { to: '/settings/mcp', label: 'MCP Servers' },
  { to: '/settings/skills', label: 'Skills' },
];

export function SettingsLayout() {
  const currentId = useChat((s) => s.current?.id);
  return (
    <div className="flex h-full flex-col bg-zinc-50 dark:bg-[#090a0f]">
      <header className="glass-header">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3.5">
          <Link
            to={currentId ? `/c/${currentId}` : '/'}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 transition-colors hover:bg-zinc-200/60 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <ArrowLeft size={14} /> Back to chat
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <LogoMark size="sm" />
            <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Settings</span>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-6">
          <nav className="flex flex-wrap gap-1.5 pb-3">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-xl px-3.5 py-1.5 text-xs font-medium transition-all duration-150',
                    isActive
                      ? 'bg-accent-600 text-white shadow-xs shadow-accent-600/30'
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/80 hover:text-zinc-900 dark:hover:text-zinc-100',
                  )
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
