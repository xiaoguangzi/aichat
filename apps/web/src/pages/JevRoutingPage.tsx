import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { resolveReasoningLevel, supportedReasoningLevels, type JevRoutingSettings, type JevRoutingProfile, type ReasoningLevel } from '@aichat/shared';
import { api } from '../api/client.js';
import { useAllModels, useSettings } from '../store/settings.js';
import { Button } from '../components/ui/Button.js';
import { Field, Input, Select, Textarea, Toggle } from '../components/ui/Field.js';

export function JevRoutingPage() {
  const models = useAllModels();
  const loadProviders = useSettings(s => s.loadProviders);
  const [settings, setSettings] = useState<JevRoutingSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void Promise.all([api.jev.routing(), loadProviders()]).then(([data]) => { if (active) setSettings(data); })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [reload, loadProviders]);
  const update = (patch: Partial<JevRoutingSettings>) => { setSettings(s => s ? { ...s, ...patch } : s); setStatus(''); };
  const profile = (id: string, patch: Partial<JevRoutingProfile>) => update({ profiles: settings!.profiles.map(p => p.id === id ? { ...p, ...patch } : p) });
  const add = () => {
    const model = models[0];
    if (!model || !settings) return;
    const id = crypto.randomUUID();
    update({ profiles: [...settings.profiles, { id, modelId: model.id, name: `候选 ${settings.profiles.length + 1}`, speed: 3, intelligence: 3, reasoning: resolveReasoningLevel(model, 'medium'), description: '' }], fallbackProfileId: settings.fallbackProfileId || id });
  };
  const save = async () => {
    if (!settings) return;
    setBusy(true); setError(''); setStatus('');
    try {
      const saved = await api.jev.saveRouting(settings);
      setSettings(saved); useSettings.setState({ routingDefault: saved.enabled, routingLoaded: true });
      setStatus('路由配置已保存。已完成路由的会话保持原模型与 effort。');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="max-w-4xl space-y-5">
    <div><h1 className="text-xl font-semibold">Jev 自动路由</h1><p className="mt-1 text-sm text-zinc-500">首条消息选择一次，模型与 effort 随会话固定保存。</p></div>
    <p className="text-xs leading-6 text-zinc-500">使用<Link to="/settings/jev" className="mx-1 text-accent-600 underline">Jev 决策</Link>中保存的密钥与 Jev 模型。候选聊天模型请先在<Link to="/settings/providers" className="mx-1 text-accent-600 underline">模型服务</Link>中添加。</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {status && <p role="status" className="text-sm text-accent-600">{status}</p>}
    {!settings && error && <Button onClick={() => setReload(n => n + 1)}>重试加载</Button>}
    {settings && <fieldset disabled={busy} className="space-y-5">
      <div className="card space-y-4 p-5">
        <Toggle label="默认对新会话启用自动路由" checked={settings.enabled} onChange={enabled => update({ enabled })} />
        <Field label="路由策略" hint="告诉 Jev 怎样权衡速度、智能和思考深度。首条消息会作为判断依据发送到 TypeSafe。">
          <Textarea aria-label="路由策略" rows={4} value={settings.instructions} onChange={e => update({ instructions: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="兜底候选项" hint="路由失败、10 秒超时或置信度不足时使用，并固定到会话。"><Select aria-label="兜底候选项" value={settings.fallbackProfileId} onChange={e => update({ fallbackProfileId: e.target.value })}><option value="">选择兜底项</option>{settings.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="最低置信度" hint="0–1；低于此值使用兜底项。"><Input aria-label="最低置信度" type="number" min={0} max={1} step={0.05} value={settings.minConfidence} onChange={e => update({ minConfidence: Number(e.target.value) })} /></Field>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">候选模型与 effort</h2><Button disabled={!models.length || settings.profiles.length >= 32} onClick={add}>添加候选项</Button></div>
      <p className="text-xs text-zinc-500">速度：1 最慢，5 最快；智能：1 最低，5 最高。评分由你按实际使用体验填写。同一模型可添加多个 effort，分别评估速度和能力。</p>
      {!settings.profiles.length && <div className="card p-5 text-sm text-zinc-500">添加候选项后，Jev 才能在你提供的选项中进行选择。</div>}
      {settings.profiles.map((p, i) => {
        const model = models.find(m => m.id === p.modelId);
        const levels: ReasoningLevel[] = model?.caps.thinking ? supportedReasoningLevels(model) : ['off'];
        return <div key={p.id} className="card space-y-4 p-5">
          <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">候选 {i + 1}{p.id === settings.fallbackProfileId && <span className="ml-2 text-xs text-accent-600">兜底</span>}</h3><Button size="sm" variant="ghost" aria-label={`删除候选 ${i + 1}`} onClick={() => update({ profiles: settings.profiles.filter(item => item.id !== p.id), fallbackProfileId: settings.fallbackProfileId === p.id ? '' : settings.fallbackProfileId })}>删除</Button></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="名称"><Input aria-label={`候选 ${i + 1} 名称`} value={p.name} onChange={e => profile(p.id, { name: e.target.value })} /></Field>
            <Field label="聊天模型"><Select aria-label={`候选 ${i + 1} 模型`} value={p.modelId} onChange={e => { const m = models.find(m => m.id === e.target.value)!; profile(p.id, { modelId: m.id, reasoning: resolveReasoningLevel(m, p.reasoning) }); }}>{!model && <option value={p.modelId}>模型已删除，请重新选择</option>}{models.map(m => <option key={m.id} value={m.id}>{m.providerName} / {m.displayName}</option>)}</Select></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="速度"><Select aria-label={`候选 ${i + 1} 速度`} value={p.speed} onChange={e => profile(p.id, { speed: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map(v => <option key={v}>{v}</option>)}</Select></Field>
            <Field label="智能程度"><Select aria-label={`候选 ${i + 1} 智能`} value={p.intelligence} onChange={e => profile(p.id, { intelligence: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map(v => <option key={v}>{v}</option>)}</Select></Field>
            <Field label="思考 effort"><Select aria-label={`候选 ${i + 1} effort`} value={p.reasoning} onChange={e => profile(p.id, { reasoning: e.target.value as ReasoningLevel })}>{!levels.includes(p.reasoning) && <option value={p.reasoning}>{p.reasoning}（已不支持）</option>}{levels.map(v => <option key={v}>{v}</option>)}</Select></Field>
          </div>
          <Field label="适用场景" hint="例如：简单问答和翻译；复杂代码与长程推理。"><Textarea aria-label={`候选 ${i + 1} 适用场景`} rows={2} value={p.description} onChange={e => profile(p.id, { description: e.target.value })} /></Field>
        </div>;
      })}
      <Button variant="primary" onClick={() => void save()}>{busy ? '保存中…' : '保存路由配置'}</Button>
      <p className="text-xs leading-6 text-zinc-500">配置变更不会影响已路由的会话。后续追问、重生成和编辑首条消息都不会再次调用 Jev。固定模型与 effort 可避免自动切换破坏缓存条件，实际命中仍由上游决定。</p>
    </fieldset>}
  </section>;
}
