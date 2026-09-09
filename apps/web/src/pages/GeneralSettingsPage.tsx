import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAllModels, useSettings } from '../store/settings';
import { Field, Select } from '../components/ui/Field';
import { Button } from '../components/ui/Button';

export function GeneralSettingsPage() {
  const models = useAllModels();
  const loadProviders = useSettings(s => s.loadProviders);
  const [selected, setSelected] = useState('');
  const [saved, setSaved] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError(''); setLoaded(false);
    void Promise.all([api.settings.get(), loadProviders()]).then(([settings]) => {
      if (active) { setSelected(settings.titleModelId ?? ''); setSaved(settings.titleModelId ?? ''); setLoaded(true); }
    }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [loadProviders, reload]);
  const missing = selected !== '' && !models.some(m => m.id === selected);
  const save = async () => {
    setBusy(true); setError(''); setStatus('');
    try { const result = await api.settings.update({ titleModelId: selected || null }); setSaved(result.titleModelId ?? ''); setStatus('已保存，新会话将使用此设置生成标题。'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="max-w-2xl space-y-5">
    <div><h1 className="text-xl font-semibold">通用设置</h1><p className="mt-1 text-sm text-zinc-500">为辅助任务选择合适的模型。</p></div>
    <div className="card space-y-5 p-5 sm:p-6">
      <Field label="标题生成模型" hint="可以选择费用较低的模型自动生成标题，不影响聊天使用的模型。">
        <Select aria-label="标题生成模型" disabled={!loaded || busy} value={selected} onChange={e => { setSelected(e.target.value); setStatus(''); }}>
          <option value="">跟随当前聊天模型</option>
          {missing && <option value={selected}>原标题模型已删除，请重新选择</option>}
          {models.map(m => <option key={m.id} value={m.id}>{m.providerName} / {m.displayName}</option>)}
        </Select>
      </Field>
      <p className="text-xs leading-6 text-zinc-500">需要其他模型时，先到<Link to="/settings/providers" className="mx-1 text-accent-600 underline">模型服务中添加供应商或自定义模型</Link>，再回来选择。标题生成失败或模型被删除时，使用首条消息作为标题。</p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {status && <p role="status" className="text-sm text-accent-600">{status}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={!loaded || busy || missing || selected === saved} onClick={() => void save()}>{busy ? '保存中…' : '保存设置'}</Button>
        {!loaded && error && <Button onClick={() => setReload(n => n + 1)}>重试加载</Button>}
        {loaded && selected !== saved && <span className="text-xs text-accent-600">有未保存的更改</span>}
      </div>
    </div>
  </section>;
}
