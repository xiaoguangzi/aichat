import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useChat } from '../../store/chat.js';
import { useSettings } from '../../store/settings.js';
import { Toggle } from '../ui/Field.js';

/** Whether the current chat (or the draft) opts into first-message routing. */
export function useAutoRouteOn() {
  const current = useChat(s => s.current);
  const draftAutoRoute = useChat(s => s.draftSettings.autoRoute);
  const routingDefault = useSettings(s => s.routingDefault);
  return current ? !!current.settings.autoRoute : draftAutoRoute ?? routingDefault;
}

export function AutoRouting() {
  const current = useChat(s => s.current);
  const messages = useChat(s => s.messages);
  const running = useChat(s => s.running);
  const draftSettings = useChat(s => s.draftSettings);
  const setDraftSettings = useChat(s => s.setDraftSettings);
  const updateConversation = useChat(s => s.updateConversation);
  const loaded = useSettings(s => s.routingLoaded);
  const loadRouting = useSettings(s => s.loadRouting);
  const checked = useAutoRouteOn();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    loadRouting().catch(() => setError('自动路由配置加载失败，请刷新后重试'));
  }, [loadRouting]);
  const route = current?.routing;
  if (route) return <div className="mb-2 rounded-xl bg-accent-500/5 px-3 py-2 text-xs" role="status">
    <span className="font-medium text-accent-600">{route.status === 'routing' ? 'Jev 正在路由…' : route.status === 'fallback' ? 'Jev 兜底已固定' : 'Jev 路由已固定'}</span>
    <span className="ml-2">{route.modelName} · {route.reasoning}</span>
    <details className="mt-1 text-zinc-500"><summary className="cursor-pointer">路由详情</summary><p className="mt-1 leading-5">{route.profileName} · {route.reason}{route.confidence !== undefined ? ` · 置信度 ${(route.confidence * 100).toFixed(1)}%` : ''}{route.elapsedMs !== undefined ? ` · ${route.elapsedMs} ms` : ''}</p></details>
  </div>;
  if (current && messages.length) return null;
  if (!loaded && !current) return <p className="mb-2 px-1 text-xs text-zinc-500">{error || '正在加载自动路由设置…'}</p>;
  const toggle = async (value: boolean) => {
    setSaving(true); setError('');
    try {
      if (current) await updateConversation(current.id, { settings: { autoRoute: value } });
      else setDraftSettings({ ...draftSettings, autoRoute: value });
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };
  return <div className="mb-2 px-1 text-xs text-zinc-500">
    <div className="flex flex-wrap items-center gap-3"><Toggle label="Jev 自动路由" checked={checked} disabled={running || saving || !loaded} onChange={value => void toggle(value)} /><span>{checked ? '首条消息选择模型与 effort，后续固定' : '使用手动选择的模型与 effort'}</span><Link to="/settings/jev-routing" className="text-accent-600 underline">配置路由</Link></div>
    {error && <p role="alert" className="mt-1 text-red-600">{error}</p>}
  </div>;
}
