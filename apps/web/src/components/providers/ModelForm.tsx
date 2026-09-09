import { useEffect, useState } from 'react';
import type { Model, Provider, ReasoningLevel, ReasoningMap } from '@aichat/shared';
import { modelInputSchema, REASONING_LEVELS } from '@aichat/shared';
import { api } from '../../api/client.js';
import { Button } from '../ui/Button.js';
import { Field, Input, Toggle } from '../ui/Field.js';

// Defaults depend on protocol only. Never infer capabilities from a model name.
export const defaultModelCaps = (p: Provider) => ({ image: true, pdf: true, tools: true, thinking: p.type === 'anthropic' });

export function ModelForm({ p, m, onDone, onCancel, onBusyChange }: { p: Provider; m?: Model; onDone: () => void; onCancel: () => void; onBusyChange?: (busy: boolean) => void }) {
  const [modelId, setModelId] = useState(m?.modelId ?? '');
  const [name, setName] = useState(m?.displayName ?? '');
  const [maxOutput, setMaxOutput] = useState(m?.maxOutput?.toString() ?? '');
  const [caps, setCaps] = useState(m?.caps ?? defaultModelCaps(p));
  const [adaptive, setAdaptive] = useState(m?.adaptive ?? p.type === 'anthropic');
  const [map, setMap] = useState<ReasoningMap>(m?.reasoningMap ?? {});
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const [error, setError] = useState('');
  const supported = (l: ReasoningLevel) => map[l] !== null;
  const save = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (!m && p.models.some((item) => item.modelId === modelId.trim())) throw new Error('该模型已添加，请在模型列表中编辑。');
      if (caps.thinking && REASONING_LEVELS.every((l) => !supported(l))) throw new Error('请至少保留一个支持的推理档位。');
      const result = modelInputSchema.safeParse({ modelId: modelId.trim(), displayName: name.trim() || modelId.trim(), caps, adaptive, maxOutput: maxOutput ? Number(maxOutput) : null, reasoningMap: Object.keys(map).length ? map : null });
      if (!result.success) throw new Error('请填写模型 ID；最大输出须为正整数或留空。');
      if (m) await api.providers.updateModel(p.id, m.id, result.data);
      else await api.providers.addModel(p.id, result.data);
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <fieldset disabled={busy} className="min-w-0 space-y-5">
      <Field label="模型 ID" hint="填写供应商提供的完整模型标识，须与 API 中一致。">
        <Input aria-label="模型 ID" required readOnly={!!m} value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="例如：my-chat-model" className="font-mono" />
      </Field>
      <Field label="显示名称（可选）" hint="用于聊天页的模型选择器，留空使用模型 ID。"><Input aria-label="显示名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="给模型起一个易认的名字" /></Field>
      <div className="rounded-xl bg-zinc-50 p-4 dark:bg-zinc-800/40">
        <p className="mb-3 text-xs font-medium">模型能力</p>
        <div className="grid grid-cols-2 gap-4">
          <Toggle checked={caps.image} onChange={(v) => setCaps({ ...caps, image: v })} label="图片理解" />
          <Toggle checked={caps.pdf} onChange={(v) => setCaps({ ...caps, pdf: v })} label="PDF 输入" />
          <Toggle checked={caps.tools} onChange={(v) => setCaps({ ...caps, tools: v })} label="工具调用" />
          <Toggle checked={caps.thinking} onChange={(v) => setCaps({ ...caps, thinking: v })} label="深度思考" />
        </div>
        <p className="mt-3 text-[11px] leading-5 text-zinc-500">请按供应商说明确认能力。思考强度在聊天输入框中选择。</p>
      </div>
      <details className="rounded-xl border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer p-3 text-xs font-medium text-zinc-600 dark:text-zinc-300">高级设置 · 输出限制{caps.thinking && '与推理兼容'}</summary>
        <div className="space-y-4 border-t border-zinc-100 p-4 dark:border-zinc-800">
          <Field label="最大输出 token 数" hint="留空使用应用默认值 64000。"><Input aria-label="最大输出 token 数" type="number" min={1} step={1} value={maxOutput} onChange={(e) => setMaxOutput(e.target.value)} placeholder="64000" /></Field>
          {caps.thinking && <>
            {p.type === 'anthropic' && <Field label="思考模式" hint="开启发送 adaptive；关闭发送 enabled，适用于要求此格式的网关。"><Toggle checked={adaptive} onChange={setAdaptive} label="自适应思考（adaptive）" /></Field>}
            <p className="text-xs leading-5 text-zinc-500">勾选模型支持的档位。仅在接口使用不同名称时填写映射值；取消 off 表示无法关闭思考。</p>
            <div className="space-y-3">{REASONING_LEVELS.map((l) => <div key={l} className="flex items-center gap-3">
              <label className="flex w-28 shrink-0 items-center gap-2 text-xs"><input type="checkbox" checked={supported(l)} onChange={(e) => setMap((cur) => { const n = { ...cur }; if (e.target.checked) delete n[l]; else n[l] = null; return n; })} />{l === 'off' ? 'off（关闭）' : l}</label>
              {l !== 'off' && <Input aria-label={`${l} 映射值`} disabled={!supported(l)} value={map[l] ?? ''} onChange={(e) => setMap((cur) => { const n = { ...cur }; if (e.target.value.trim()) n[l] = e.target.value.trim(); else delete n[l]; return n; })} placeholder={`默认：${l}`} />}
            </div>)}</div>
          </>}
        </div>
      </details>
    </fieldset>
    {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    <div className="flex justify-end gap-2"><Button type="button" disabled={busy} onClick={onCancel}>取消</Button><Button type="submit" variant="primary" disabled={busy || !modelId.trim()}>{busy ? '保存中…' : m ? '保存模型' : '添加模型'}</Button></div>
  </form>;
}
