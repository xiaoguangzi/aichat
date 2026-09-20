import { useEffect, useState } from 'react';
import { jevRequestSchema, type JevResult, type JevSettings } from '@aichat/shared';
import { api } from '../api/client.js';
import { Button } from '../components/ui/Button.js';
import { Field, Input, Select, Textarea } from '../components/ui/Field.js';

const exampleState = 'I was charged twice for my subscription. Please refund the duplicate payment today.';
const exampleQuestions = JSON.stringify({
  department: { type: 'choice', instructions: 'Which team should handle this request?', criteria: { billing: 'Payments and refunds', technical: 'Bugs and outages', other: 'Other requests' } },
  urgency: { type: 'score', instructions: 'How urgent is this request?', criteria: ['Can wait', 'Needs attention soon', 'Needs immediate attention'] },
  refund: { type: 'noul', instructions: 'Is the customer requesting a refund?' },
}, null, 2);
const percent = (n: number) => `${(n * 100).toFixed(1)}%`;

export function JevPage() {
  const [settings, setSettings] = useState<JevSettings | null>(null);
  const [model, setModel] = useState('jev-latest');
  const [key, setKey] = useState('');
  const [state, setState] = useState(exampleState);
  const [format, setFormat] = useState('text');
  const [questions, setQuestions] = useState(exampleQuestions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<JevResult | null>(null);
  const [sentRequest, setSentRequest] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void api.jev.settings().then(data => {
      if (active) { setSettings(data); setModel(data.model); }
    }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [reload]);
  const dirty = !!settings && (settings.model !== model || key.length > 0);
  const save = async (clear = false) => {
    setBusy(true); setError(''); setStatus('');
    try {
      const data = await api.jev.saveSettings({ model, apiKey: clear ? null : key || undefined });
      setSettings(data); setModel(data.model); setKey('');
      setStatus(clear ? 'API Key 已清除。' : '连接设置已保存。');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const evaluate = async () => {
    setBusy(true); setError(''); setStatus(''); setResult(null); setSentRequest('');
    try {
      let parsedState: unknown = state;
      let parsedQuestions: unknown;
      try { if (format === 'json') parsedState = JSON.parse(state); }
      catch { throw new Error('State JSON 格式不正确，请检查后重试。'); }
      try { parsedQuestions = JSON.parse(questions); }
      catch { throw new Error('Questions JSON 格式不正确，请检查后重试。'); }
      const parsed = jevRequestSchema.safeParse({ model, state: parsedState, questions: parsedQuestions });
      if (!parsed.success) throw new Error(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('；'));
      setSentRequest(JSON.stringify(parsed.data, null, 2));
      setResult(await api.jev.evaluate(parsed.data));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold">Jev 决策</h1><p className="mt-1 text-sm text-zinc-500">TypeSafe System One · 输入状态与问题，返回分类、评分和概率。</p></div>
      <a className="text-xs text-accent-600 underline" href="https://docs.typesafe.ai/api" target="_blank" rel="noreferrer">官方 API 文档 ↗</a>
    </div>
    <div className="card space-y-4 p-5">
      <div><h2 className="text-sm font-semibold">独立连接</h2><p className="mt-1 break-all text-xs text-zinc-500">https://api.typesafe.ai/v1/systemone</p></div>
      <fieldset disabled={!settings || busy} className="grid gap-4 sm:grid-cols-2">
        <Field label="TypeSafe API Key" hint={settings?.hasApiKey ? '已保存密钥；留空保留，仅在本机后端存储。' : '从 TypeSafe 控制台获取密钥，保存在本机后端。'}>
          <Input aria-label="TypeSafe API Key" type="password" autoComplete="new-password" value={key} placeholder={settings?.hasApiKey ? '已配置，输入新密钥可替换' : '输入 TypeSafe API Key'} onChange={e => { setKey(e.target.value); setStatus(''); }} />
        </Field>
        <Field label="Jev 模型" hint="默认 jev-latest，也可填写官方支持的版本 ID。">
          <Input aria-label="Jev 模型" value={model} onChange={e => { setModel(e.target.value); setStatus(''); }} />
        </Field>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!settings || busy || !dirty || !model.trim()} onClick={() => void save()}>保存连接</Button>
        {settings?.hasApiKey && <Button disabled={busy || !model.trim()} variant="ghost" onClick={() => void save(true)}>清除密钥</Button>}
        {dirty && <span className="text-xs text-amber-600">请先保存连接再运行</span>}
        {!settings && error && <Button onClick={() => setReload(n => n + 1)}>重试加载</Button>}
      </div>
      <p className="text-xs text-zinc-500">此入口独立于聊天，不使用对话历史、工具或标题模型。每次运行只提交下方的状态与问题。</p>
    </div>
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card min-w-0 space-y-4 p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">决策请求</h2><Button size="sm" disabled={busy} onClick={() => { setState(exampleState); setQuestions(exampleQuestions); setFormat('text'); setResult(null); setSentRequest(''); setError(''); }}>载入示例</Button></div>
        <fieldset disabled={busy} className="space-y-4">
          <Field label="State 格式"><Select aria-label="State 格式" value={format} onChange={e => setFormat(e.target.value)}><option value="text">纯文本</option><option value="json">JSON 对象 / 数组</option></Select></Field>
          <Field label="State · 待评估内容"><Textarea aria-label="State" rows={5} value={state} onChange={e => setState(e.target.value)} /></Field>
          <Field label="Questions · 问题 JSON" hint="choice：分类选项；score：2–10 档评分；noul：是 / 否概率。可在同一次请求中组合。"><Textarea aria-label="Questions" rows={17} value={questions} onChange={e => setQuestions(e.target.value)} spellCheck={false} /></Field>
        </fieldset>
        <Button variant="primary" disabled={!settings?.hasApiKey || busy || dirty} onClick={() => void evaluate()}>{busy ? '处理中…' : '运行决策'}</Button>
        {!settings?.hasApiKey && settings && <p className="text-xs text-zinc-500">保存 API Key 后即可运行。</p>}
      </div>
      <div className="card min-w-0 space-y-4 p-5" aria-live="polite">
        <h2 className="text-sm font-semibold">决策结果</h2>
        {!result && <p className="text-sm text-zinc-500">{busy ? '正在处理请求…' : '运行后在这里查看每个问题的答案、概率和用量。'}</p>}
        {result && <>
          <p className="break-all text-xs text-zinc-500">{result.response.model} · {result.elapsedMs} ms</p>
          {Object.entries(result.response.answers).map(([id, answer]) => <article key={id} className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
            <div className="flex flex-wrap justify-between gap-2"><h3 className="break-all text-sm font-medium">{id}</h3><span className="text-xs text-zinc-500">{answer.type}</span></div>
            <p className="break-all text-lg font-semibold text-accent-600">{answer.type === 'noul' ? `是的概率 ${percent(answer.noul)}` : answer.type === 'choice' ? answer.choice : `评分 ${answer.score}`}</p>
            {answer.type !== 'noul' && <>
              <p className="text-xs text-zinc-500">置信度 {percent(answer.confidence)}</p>
              {Object.entries(answer.probabilities).map(([option, probability]) => <div key={option} className="space-y-1">
                <div className="flex justify-between gap-3 text-xs"><span className="min-w-0 break-all">{option}{answer.type === 'score' && Object.hasOwn(answer.legend, option) ? ` · ${typeof answer.legend[option] === 'string' ? answer.legend[option] : JSON.stringify(answer.legend[option])}` : ''}</span><span>{percent(probability)}</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div className="h-full rounded-full bg-accent-500" style={{ width: percent(probability) }} /></div>
              </div>)}
            </>}
          </article>)}
          <p className="text-xs text-zinc-500">输入 {result.response.usage?.input_tokens ?? '—'} tokens · 输出 {result.response.usage?.output_tokens ?? '—'} tokens</p>
          <details><summary className="cursor-pointer text-xs text-zinc-500">响应 JSON</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(result.response, null, 2)}</pre></details>
        </>}
        {sentRequest && <details><summary className="cursor-pointer text-xs text-zinc-500">本次请求 JSON</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{sentRequest}</pre></details>}
        {error && <p role="alert" className="break-words text-sm text-red-600">{error}</p>}
        {status && <p role="status" className="text-sm text-accent-600">{status}</p>}
      </div>
    </div>
  </section>;
}
