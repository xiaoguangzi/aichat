import { useEffect, useRef, useState } from 'react';
import { Globe2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { McpServer } from '@aichat/shared';
import { api } from '../../api/client.js';
import { useChat } from '../../store/chat.js';
import { useSettings } from '../../store/settings.js';
import { cn } from '../../lib/utils.js';

export function isExaServer(server: McpServer): boolean {
  if (/(^|[-_])exa($|[-_])/i.test(server.name)) return true;
  if (server.transport === 'stdio') return [server.command, ...server.args].some((arg) => /(?:^|[/@])exa-mcp-server(?:@[^/]+)?$/.test(arg ?? ''));
  try {
    const host = new URL(server.url ?? '').hostname;
    return host === 'exa.ai' || host.endsWith('.exa.ai');
  } catch { return false; }
}

/** A shortcut to the persisted MCP setting, not a separate chat preference. */
export function WebSearchToggle() {
  const servers = useSettings((s) => s.mcpServers);
  const loadMcp = useSettings((s) => s.loadMcp);
  const running = useChat((s) => s.running);
  const allowed = useChat((s) => s.current?.settings.enabledMcpServers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const exa = servers.filter(isExaServer);
  const enabled = exa.some((s) => s.enabled);
  const connecting = exa.some((s) => s.status === 'connecting');
  const unavailable = exa.some((s) => s.enabled && s.status !== 'connected');
  const excluded = enabled && Array.isArray(allowed) && !exa.some((s) => s.enabled && allowed.includes(s.name));

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void loadMcp().catch(() => {}); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadMcp]);

  useEffect(() => {
    if (!connecting) return;
    const timer = setInterval(() => { void loadMcp().catch(() => {}); }, 2000);
    return () => clearInterval(timer);
  }, [connecting, loadMcp]);

  const toggle = async () => {
    if (pending.current || running) return;
    pending.current = true;
    const nextState = !enabled;
    const previousServers = useSettings.getState().mcpServers;
    setError('');

    // 乐观更新：立刻在前端响应切换，零延迟拨动开关
    useSettings.setState((state) => ({
      mcpServers: state.mcpServers.map((s) =>
        isExaServer(s)
          ? { ...s, enabled: nextState, status: nextState ? (s.status === 'connected' ? 'connected' : 'connecting') : 'disconnected' }
          : s,
      ),
    }));

    setBusy(true);
    try {
      const results = await Promise.allSettled(
        exa.map(async (server) => {
          const updated = await api.mcp.update(server.id, { enabled: nextState });
          useSettings.setState((state) => ({
            mcpServers: state.mcpServers.map((s) => (s.id === updated.id ? updated : s)),
          }));
        }),
      );

      if (results.some((r) => r.status === 'rejected')) {
        useSettings.setState({ mcpServers: previousServers });
        setError('切换失败，请重试');
        await loadMcp();
      }
    } catch {
      useSettings.setState({ mcpServers: previousServers });
      setError('状态刷新失败，请重试');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const note = error || (excluded ? '当前会话未允许 Exa' : unavailable && !connecting ? 'Exa 未连接' : '');
  return (
    <div className="relative inline-flex items-center gap-2">
      {exa.length ? (
        <button
          type="button"
          role="switch"
          aria-label="联网搜索"
          aria-checked={enabled}
          disabled={busy || running}
          onClick={() => void toggle()}
          title="同步 Exa MCP 的全局启用设置，适用于所有会话"
          className={cn('search-toggle', enabled && 'is-enabled', connecting && 'is-connecting')}
        >
          <Globe2 size={14} className={cn('transition-opacity', connecting && 'opacity-60')} />
          <span>联网搜索</span>
          <span className="search-switch" aria-hidden="true">
            <span />
          </span>
        </button>
      ) : (
        <Link to="/settings/mcp" className="search-toggle" title="添加 Exa MCP 后即可启用联网搜索">
          <Globe2 size={14} />
          <span>联网搜索</span>
          <span className="text-[10px] opacity-60">未配置</span>
        </Link>
      )}
      {note && <span role="status" className="search-status text-[11px] text-accent-700 dark:text-accent-300">{note}</span>}
    </div>
  );
}
