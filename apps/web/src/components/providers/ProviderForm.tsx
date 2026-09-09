import { useEffect, useState } from 'react';
import type { Provider, ProviderInput } from '@aichat/shared';
import { providerInputSchema } from '@aichat/shared';
import { Check, Eye, EyeOff } from 'lucide-react';
import { api } from '../../api/client.js';
import { Button } from '../ui/Button.js';
import { Field, Input, Select, Toggle, Textarea } from '../ui/Field.js';
import { cn } from '../../lib/utils.js';

const presets: { id: string; label: string; description: string; config: ProviderInput }[] = [
  { id: 'custom', label: '自定义', description: '中转服务 / 私有部署', config: { name: '', type: 'openai', baseUrl: '', compat: {} } },
  { id: 'openai', label: 'OpenAI', description: 'Chat Completions', config: { name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', compat: {} } },
  { id: 'anthropic', label: 'Anthropic', description: 'Messages API', config: { name: 'Anthropic', type: 'anthropic', baseUrl: 'https://api.anthropic.com', compat: {} } },
  { id: 'deepseek', label: 'DeepSeek', description: 'OpenAI 兼容', config: { name: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com/v1', compat: { thinkingFormat: 'deepseek' } } },
  { id: 'openrouter', label: 'OpenRouter', description: '多模型聚合', config: { name: 'OpenRouter', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', compat: { thinkingFormat: 'openrouter' } } },
  { id: 'ollama', label: 'Ollama', description: '本地模型', config: { name: 'Ollama', type: 'openai', baseUrl: 'http://localhost:11434/v1', compat: {} } },
];

export function ProviderForm({ initial, onDone, onCancel, onDirtyChange, onBusyChange }: {
  initial?: Provider; onDone: (p: Provider) => void; onCancel?: () => void; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [preset, setPreset] = useState('custom');
  const [f, setForm] = useState<ProviderInput>({ name: initial?.name ?? '', type: initial?.type ?? 'openai', baseUrl: initial?.baseUrl ?? '', extraHeaders: initial?.extraHeaders ?? {}, compat: initial?.compat ?? {} });
  const [headers, setHeaders] = useState(JSON.stringify(initial?.extraHeaders ?? {}, null, 2));
  const [showKey, setShowKey] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const [saved, setSaved] = useState(false);
  const changed = () => { setSaved(false); onDirtyChange?.(true); };
  const setF = (next: ProviderInput) => { setForm(next); changed(); };
  const save = async () => {
    if (busy) return;
    setBusy(true); setErr(''); setSaved(false);
    try {
      let extraHeaders: unknown;
      try { extraHeaders = headers.trim() ? JSON.parse(headers) : {}; } catch { throw new Error('自定义请求头必须是有效的 JSON 对象。'); }
      const baseUrl = f.baseUrl.trim().replace(/\/+$/, '');
      let url: URL;
      try { url = new URL(baseUrl); } catch { throw new Error('请输入完整的 API 地址，以 https:// 或 http:// 开头。'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) throw new Error('API 地址须使用 HTTP / HTTPS，且不包含查询参数或 #。');
      if (/\/(chat\/completions|messages)$/.test(url.pathname)) throw new Error('请填写基础地址，去掉末尾的 /chat/completions 或 /v1/messages。');
      const result = providerInputSchema.safeParse({ ...f, name: f.name.trim(), baseUrl, apiKey: clearKey ? '' : f.apiKey?.trim() || undefined, extraHeaders });
      if (!result.success) throw new Error('请检查名称（1–100 字）及请求头（JSON 对象，值为字符串）。');
      const provider = initial ? await api.providers.update(initial.id, result.data) : await api.providers.create(result.data);
      setForm((cur) => ({ ...cur, name: provider.name, baseUrl: provider.baseUrl, apiKey: undefined }));
      setClearKey(false); setSaved(true); onDirtyChange?.(false); onDone(provider);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="space-y-5" onChange={changed} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <fieldset disabled={busy} className="min-w-0 space-y-5">
      {!initial && <div>
        <p className="mb-3 text-xs text-zinc-500">选择服务模板，或连接自己的 API 服务。</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {presets.map((p) => <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => { setPreset(p.id); setF({ ...p.config, apiKey: f.apiKey }); changed(); }} className={cn('rounded-xl border p-3 text-left transition-colors', preset === p.id ? 'border-accent-500 bg-accent-50 text-accent-700 dark:bg-accent-950/40 dark:text-accent-300' : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800')}>
            <span className="block text-xs font-semibold">{p.label}</span><span className="mt-1 block text-[10px] text-zinc-500">{p.description}</span>
          </button>)}
        </div>
      </div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="供应商名称"><Input aria-label="供应商名称" required maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例如：我的 API 服务" /></Field>
        <Field label="接口协议"><Select aria-label="接口协议" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as ProviderInput['type'] })}>
          <option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic 兼容</option>
        </Select></Field>
      </div>
      <Field label="API 地址" hint={f.type === 'openai' ? '填写基础地址，通常以 /v1 结尾；不要包含 /chat/completions。' : '填写基础地址，例如 https://api.anthropic.com；不要包含 /v1/messages。'}>
        <Input aria-label="API 地址" required type="url" value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} placeholder={f.type === 'openai' ? 'https://api.example.com/v1' : 'https://api.example.com'} />
      </Field>
      <Field label="API 密钥" hint={initial?.hasApiKey ? `已保存 ${initial.apiKeyMasked}，留空保留原密钥。` : '由供应商提供。本地服务无需密钥时可留空。'}>
        <div className="flex gap-2"><Input aria-label="API 密钥" type={showKey ? 'text' : 'password'} disabled={clearKey} value={f.apiKey ?? ''} onChange={(e) => setF({ ...f, apiKey: e.target.value })} placeholder={initial?.hasApiKey ? '输入新密钥以替换' : 'sk-…'} autoComplete="off" />
          <Button type="button" aria-label={showKey ? '隐藏密钥' : '显示密钥'} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</Button></div>
        {initial?.hasApiKey && <label className="mt-2 flex items-center gap-2 text-xs text-zinc-500"><input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} />清除已保存的密钥</label>}
      </Field>
      <details className="rounded-xl border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-zinc-600 dark:text-zinc-300">高级设置 <span className="ml-2 font-normal text-zinc-400">请求头与协议兼容</span></summary>
        <div className="space-y-4 border-t border-zinc-100 p-4 dark:border-zinc-800">
          <Field label="自定义请求头（JSON）"><Textarea aria-label="自定义请求头" rows={3} value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder='{"X-Custom": "value"}' /></Field>
      {f.type === 'anthropic' && (
        <div className="space-y-2.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40 p-3 text-sm">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">协议兼容</div>
          <Field label="提示缓存" hint="自动适配已确认支持的接口；其他兼容服务按其原有方式处理。">
            <Select aria-label="提示缓存" value={f.compat?.promptCaching ?? 'auto'} onChange={(e) => setF({ ...f, compat: { ...f.compat, promptCaching: e.target.value as 'auto' | 'on' | 'off' } })}>
              <option value="auto">自动</option><option value="on">发送 5 分钟缓存标记</option><option value="off">不发送缓存标记</option>
            </Select>
          </Field>
          <Toggle checked={f.compat?.thinkingDisplay !== false} onChange={(v) => setF({ ...f, compat: { ...f.compat, thinkingDisplay: v } })} label='发送 thinking.display（端点报错时关闭）' />
          <Field label="推理参数位置" hint="按供应商文档选择；官方接口通常使用 output_config.effort。">
            <Select value={f.compat?.effortParam ?? 'output_config'} onChange={(e) => setF({ ...f, compat: { ...f.compat, effortParam: e.target.value as 'output_config' | 'reasoning_effort' } })}>
              <option value="output_config">output_config.effort</option>
              <option value="reasoning_effort">reasoning_effort (top-level)</option>
            </Select>
          </Field>
          <Toggle checked={!!f.compat?.allowEmptySignature} onChange={(v) => setF({ ...f, compat: { ...f.compat, allowEmptySignature: v } })} label="允许回传不带签名的思考内容" />
          <Toggle checked={f.compat?.inlineThinkTags !== false} onChange={(v) => setF({ ...f, compat: { ...f.compat, inlineThinkTags: v } })} label="将回答中的 <think> 标签内容显示为思考过程" />
        </div>
      )}
      {f.type === 'openai' && (
        <div className="space-y-2.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40 p-3 text-sm">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">协议兼容</div>
          <Toggle checked={f.compat?.streamOptions !== false} onChange={(v) => setF({ ...f, compat: { ...f.compat, streamOptions: v } })} label="获取流式 token 用量（stream_options）" />
          <Toggle checked={!!f.compat?.maxCompletionTokens} onChange={(v) => setF({ ...f, compat: { ...f.compat, maxCompletionTokens: v } })} label="使用 max_completion_tokens 参数" />
          <Toggle checked={f.compat?.sendTemperature !== false} onChange={(v) => setF({ ...f, compat: { ...f.compat, sendTemperature: v } })} label="发送温度参数" />
          <Field label="推理参数格式" hint="仅在供应商要求不同的参数格式时修改。">
            <Select value={f.compat?.thinkingFormat ?? (f.compat?.openaiThinkingObject ? 'zai' : 'openai')} onChange={(e) => setF({ ...f, compat: { ...f.compat, thinkingFormat: e.target.value as 'openai' | 'openrouter' | 'zai' | 'qwen' | 'deepseek' } })}>
              <option value="openai">openai (reasoning_effort)</option>
              <option value="openrouter">openrouter (reasoning object)</option>
              <option value="zai">zai / GLM (thinking object)</option>
              <option value="qwen">qwen (enable_thinking)</option>
              <option value="deepseek">deepseek (thinking object, no off)</option>
            </Select>
          </Field>
          <Toggle checked={f.compat?.inlineThinkTags !== false} onChange={(v) => setF({ ...f, compat: { ...f.compat, inlineThinkTags: v } })} label="将回答中的 <think> 标签内容显示为思考过程" />
        </div>
      )}
        </div>
      </details>
      </fieldset>
      {err && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{err}</p>}
      <div className="flex items-center justify-end gap-3">
        {saved && <span role="status" className="mr-auto flex items-center gap-1 text-xs text-accent-600 dark:text-accent-400"><Check size={14} />已保存</span>}
        {onCancel && <Button type="button" disabled={busy} onClick={onCancel}>取消</Button>}
        <Button type="submit" variant="primary" disabled={busy || !f.name.trim() || !f.baseUrl.trim()}>{busy ? '保存中…' : initial ? '保存连接设置' : '创建供应商'}</Button>
      </div>
    </form>
  );
}
