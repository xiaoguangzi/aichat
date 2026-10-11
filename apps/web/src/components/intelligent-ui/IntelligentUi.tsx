import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowUpRight, Code2, RotateCcw, Sparkles } from 'lucide-react';
import { compileUi, controlValue, evaluateUi, isUiControl, uiTemplate, type UiControl, type UiNode, type UiState } from '@aichat/shared';
import { useChat } from '../../store/chat.js';
import { Button } from '../ui/Button.js';
import { Input, Select } from '../ui/Field.js';
import './intelligent-ui.css';

type ChartNode = Extract<UiNode, { type: 'chart' }>;
const colors = ['var(--chat-accent)', 'var(--iui-series-2)', 'var(--iui-series-3)', 'var(--iui-series-4)'];
const isParameter = (node: UiNode) => node.type === 'slider' || node.type === 'number' || node.type === 'select';

function Chart({ node, state }: { node: ChartNode; state: UiState }) {
  const [probe, setProbe] = useState<number | null>(null);
  const [width, setWidth] = useState(720);
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!svg.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => { const w = entries[0]?.contentRect.width; if (w) setWidth(w < 480 ? 360 : 720); });
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  const curves = node.series.map(series => Array.from({ length: 81 }, (_, i) => {
    const x = node.min + (node.max - node.min) * i / 80;
    const y = evaluateUi(series.expr, { ...state, x });
    return { x, y: y !== undefined && Math.abs(y) <= 1e12 ? y : undefined };
  }));
  const values = curves.flatMap(points => points.flatMap(p => p.y === undefined ? [] : [p.y]));
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  const span = hi - lo || Math.max(Math.abs(hi) * 0.1, 1);
  const px = (x: number) => 65 + (x - node.min) / (node.max - node.min) * (width - 110);
  const py = (y: number) => 210 - (y - lo) / span * 170;
  const number = (n: number) => Number(n.toPrecision(4)).toLocaleString();
  return <figure className="iui-chart">
    <figcaption>{uiTemplate(node.label, state)}</figcaption>
    <svg ref={svg} role="img" aria-label={node.label} viewBox={`0 0 ${width} 255`} onPointerMove={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width) setProbe(Math.max(node.min, Math.min(node.max, node.min + ((event.clientX - rect.left) / rect.width * width - 65) / (width - 110) * (node.max - node.min))));
    }} onPointerLeave={() => setProbe(null)}>
      {[0, 0.5, 1].map(t => <g key={t}><line x1="65" x2={width - 45} y1={210 - t * 170} y2={210 - t * 170} className="iui-gridline" />
        <text x="55" y={214 - t * 170} textAnchor="end">{number(lo + t * span)}</text></g>)}
      {[node.min, (node.min + node.max) / 2, node.max].map(x => <text key={x} x={px(x)} y="232" textAnchor="middle">{number(x)}</text>)}
      {curves.map((points, index) => { let drawing = false; const path = points.map(p => {
        if (p.y === undefined) { drawing = false; return ''; }
        const command = drawing ? 'L' : 'M'; drawing = true; return `${command}${px(p.x)},${py(p.y)}`;
      }).join(' ');
        return <path key={index} d={path} fill="none" stroke={colors[index]} strokeWidth="2.5" strokeDasharray={index ? `${8 - index} ${index * 2}` : undefined} />;
      })}
      {probe !== null && <line x1={px(probe)} x2={px(probe)} y1="35" y2="210" className="iui-probe" />}
    </svg>
    <div className="iui-chart-labels"><span>{node.yLabel}</span><span>{node.xLabel}</span></div>
    <div className="iui-legend">{node.series.map((series, i) => <span key={i}><i style={{ background: colors[i] }} />{series.label}
      {probe !== null && ` · ${number(probe)} → ${evaluateUi(series.expr, { ...state, x: probe })?.toLocaleString(undefined, { maximumFractionDigits: 3 }) ?? '—'}`}</span>)}</div>
    {!values.length && <p className="iui-error">当前参数下没有可绘制的数值。</p>}
    <details className="iui-chart-data"><summary>查看图表数据</summary><div className="iui-table-scroll"><table><thead><tr><th>{node.xLabel ?? 'x'}</th>{node.series.map((s, i) => <th key={i}>{s.label}</th>)}</tr></thead>
      <tbody>{curves[0]!.filter((_, i) => i % 8 === 0).map(p => <tr key={p.x}><td>{number(p.x)}</td>{node.series.map((s, i) => <td key={i}>{evaluateUi(s.expr, { ...state, x: p.x })?.toLocaleString(undefined, { maximumFractionDigits: 3 }) ?? '—'}</td>)}</tr>)}</tbody></table></div></details>
  </figure>;
}

function Diagram({ node, state }: { node: Extract<UiNode, { type: 'diagram' }>; state: UiState }) {
  const [selected, setSelected] = useState<string | null>(null);
  const detailsId = useId();
  const detail = node.nodes.find(n => n.id === selected);
  return <section className="iui-diagram" aria-label={node.label}>
    <h4>{uiTemplate(node.label, state)}</h4>
    <div className="iui-diagram-nodes">{node.nodes.map(n => <Button variant="ghost" size="sm" type="button" key={n.id} aria-pressed={selected === n.id} aria-controls={detailsId}
      onClick={() => setSelected(n.id)}>{uiTemplate(n.label, state)}</Button>)}</div>
    <ul className="iui-connections">{node.edges.map((edge, i) => <li key={i}>
      <span>{uiTemplate(node.nodes.find(n => n.id === edge.from)!.label, state)}</span><span aria-label="连接至">→</span>
      <span>{uiTemplate(node.nodes.find(n => n.id === edge.to)!.label, state)}</span>{edge.label && <small>{uiTemplate(edge.label, state)}</small>}
    </li>)}</ul>
    <div id={detailsId} className="iui-diagram-detail">{detail ? <><strong>{uiTemplate(detail.label, state)}</strong><p>{uiTemplate(detail.text ?? '选择其他部分，查看它们之间的关系。', state)}</p></> : <p>选择一个部分，查看详细说明。</p>}</div>
  </section>;
}

function NumberInput({ node, value, onChange }: { node: Extract<UiControl, { type: 'number' }>; value: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <Input type="number" aria-label={node.label} min={node.min} max={node.max} step={node.step} value={draft}
    onChange={event => { setDraft(event.target.value); if (event.target.value !== '' && Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber); }}
    onBlur={() => { const n = controlValue(node, draft === '' ? value : Number(draft)); setDraft(String(n)); onChange(n); }} />;
}

export function IntelligentUi({ code, complete, live, instance, messageId }: { code: string; complete: boolean; live: boolean; instance: string; messageId: string }) {
  const compiled = useMemo(() => compileUi(code, complete), [code, complete]);
  const storageKey = `aichat:ui:${instance}`;
  const [saved, setSaved] = useState<UiState>(() => {
    try { const raw = sessionStorage.getItem(storageKey); return raw && raw.length < 10000 ? JSON.parse(raw) as UiState : {}; } catch { return {}; }
  });
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const current = useChat(s => s.current);
  const messages = useChat(s => s.messages);
  const streaming = useChat(s => s.streaming);
  const running = useChat(s => s.running);
  const owner = messages.find(m => m.id === messageId) ?? (streaming?.id === messageId ? streaming : undefined);
  const controls = compiled.nodes.filter(isUiControl);
  const state: UiState = Object.fromEntries(controls.map(node => [node.id, controlValue(node, saved && Object.hasOwn(saved, node.id) ? saved[node.id] : node.type === 'check' ? +node.value : node.value)]));
  const change = (node: UiControl, value: number) => {
    const next = { ...state, [node.id]: controlValue(node, value) };
    setSaved(next);
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Storage may be disabled; local interaction still works. */ }
  };
  const action = async (node: Extract<UiNode, { type: 'action' }>) => {
    const chat = useChat.getState();
    const activeOwner = chat.messages.find(m => m.id === messageId) ?? (chat.streaming?.id === messageId ? chat.streaming : undefined);
    if (!complete || live || chat.running || submitting.current || !chat.current || activeOwner?.conversationId !== chat.current.id) return;
    const snapshot = controls.filter(n => !n.when || !!evaluateUi(n.when, state)).map(n => {
      const value = n.type === 'check' ? state[n.id] ? '已勾选' : '未勾选'
        : n.type === 'choice' || n.type === 'select' ? n.options.find(o => o.value === state[n.id])?.label ?? '—'
        : `${state[n.id]}${n.unit ? ` ${n.unit.slice(0, 40)}` : ''}`;
      return `- ${uiTemplate(n.label, state).slice(0, 160)}：${uiTemplate(String(value), state).slice(0, 160)}`;
    }).join('\n');
    submitting.current = true; setPending(true); setActionError('');
    try { await chat.send(`${uiTemplate(node.prompt, state)}\n\n智能 UI「${compiled.view?.title}」的当前选择：\n${snapshot}`); }
    catch (error) { setActionError(`发送失败：${String(error)}`); }
    finally { submitting.current = false; setPending(false); }
  };
  const template = (text: string) => uiTemplate(text, state);
  const groups: UiNode[][] = [];
  for (const node of compiled.nodes.filter(n => !n.when || !!evaluateUi(n.when, state))) {
    const last = groups.at(-1);
    if ((node.type === 'metric' && last?.[0]?.type === 'metric') || (isParameter(node) && last?.[0] && isParameter(last[0]))) last.push(node);
    else groups.push([node]);
  }
  const nodeView = (node: UiNode) => {
    switch (node.type) {
      case 'text': return <p className="iui-text" data-quote-text>{template(node.text)}</p>;
      case 'slider': return <label className="iui-control"><span>{template(node.label)}<output>{state[node.id]} {node.unit}</output></span>
        <input type="range" min={node.min} max={node.max} step={node.step} value={state[node.id]} aria-label={node.label}
          style={{ '--iui-range-progress': `${(state[node.id]! - node.min) / (node.max - node.min) * 100}%` } as CSSProperties} onChange={e => change(node, Number(e.target.value))} />
        <small><span>{node.min} {node.unit}</span><span>{node.max} {node.unit}</span></small></label>;
      case 'number': return <label className="iui-control"><span>{template(node.label)}<small>{node.unit}</small></span><NumberInput node={node} value={state[node.id]!} onChange={value => change(node, value)} /></label>;
      case 'select': return <label className="iui-control"><span>{template(node.label)}</span><Select value={state[node.id]} aria-label={node.label} onChange={e => change(node, Number(e.target.value))}>
        {node.options.map((o, i) => <option key={i} value={o.value}>{template(o.label)}</option>)}</Select></label>;
      case 'choice': return <fieldset className="iui-choice"><legend>{template(node.label)}</legend><div>{node.options.map((o, i) => <Button variant="ghost" size="sm" key={i} type="button" aria-pressed={state[node.id] === o.value} onClick={() => change(node, o.value)}>{template(o.label)}</Button>)}</div></fieldset>;
      case 'check': return <label className="iui-check"><input type="checkbox" checked={!!state[node.id]} onChange={e => change(node, +e.target.checked)} /><span><strong>{template(node.label)}</strong>{node.text && <small>{template(node.text)}</small>}</span></label>;
      case 'metric': { const value = evaluateUi(node.expr, state); return <div className="iui-metric"><span>{template(node.label)}</span><output aria-live="polite">{value === undefined ? '—' : value.toLocaleString(undefined, { minimumFractionDigits: node.digits, maximumFractionDigits: node.digits })}<small>{node.unit}</small></output>{node.hint && <p>{template(node.hint)}</p>}</div>; }
      case 'cards': return <div className="iui-cards">{node.items.map((item, i) => <article key={i} data-quote-text><h4>{template(item.title)}</h4><p>{template(item.text)}</p></article>)}</div>;
      case 'table': return <div className="iui-table-scroll"><table><thead><tr>{node.columns.map((c, i) => <th key={i}>{template(c)}</th>)}</tr></thead><tbody>{node.rows.map((row, i) => <tr key={i}>{node.columns.map((_, j) => <td key={j}>{template(row[j] ?? '')}</td>)}</tr>)}</tbody></table></div>;
      case 'chart': return <Chart node={node} state={state} />;
      case 'diagram': return <Diagram node={node} state={state} />;
      case 'action': return <Button variant="secondary" type="button" className="iui-action" disabled={!complete || live || running || pending || !current || owner?.conversationId !== current.id} onClick={() => void action(node)}>{template(node.label)}<ArrowUpRight size={13} /></Button>;
    }
  };
  return <section className="intelligent-ui" aria-label={compiled.view?.title ?? '智能 UI'} data-intelligent-ui>
    <header className="iui-header">
      <div className="iui-heading" data-quote-text><h2>{compiled.view?.title ?? '交互内容'}</h2></div>
      <div className="iui-tools"><span className="iui-badge"><Sparkles size={12} />智能 UI</span>
      {!complete && <span className="iui-status">{live ? '正在构建…' : '生成已中断'}</span>}
      {controls.length > 0 && <Button variant="ghost" size="sm" type="button" className="iui-reset" title="重置交互" aria-label="重置交互" onClick={() => { setSaved({}); try { sessionStorage.removeItem(storageKey); } catch { /* optional storage */ } }}><RotateCcw size={13} /></Button>}
      </div>
    </header>
    {compiled.view?.description && <p className="iui-description" data-quote-text>{template(compiled.view.description)}</p>}
    <div className="iui-body">{groups.map(group => group[0]!.type === 'metric'
      ? <div key={group[0]!.id} className="iui-metrics">{group.map(node => <div key={node.id} className="iui-node iui-node-metric">{nodeView(node)}</div>)}</div>
      : isParameter(group[0]!) ? <div key={group[0]!.id} className="iui-control-group">{group.map(node => <div key={node.id} className={`iui-node iui-node-${node.type}`}>{nodeView(node)}</div>)}</div>
      : <div key={group[0]!.id} className={`iui-node iui-node-${group[0]!.type}`}>{nodeView(group[0]!)}</div>)}</div>
    {!compiled.nodes.length && !compiled.errors.length && <p className="iui-waiting">{live ? '正在准备交互组件…' : '未生成完整组件，可查看源码并要求 AI 重新生成。'}</p>}
    {compiled.errors.length > 0 && <div className="iui-error" role="status">部分界面无法显示，已保留源码。{compiled.errors.map((e, i) => <p key={i}>{e}</p>)}</div>}
    {actionError && <p className="iui-error" role="alert">{actionError}</p>}
    <details className="iui-source"><summary aria-label="查看界面源码"><Code2 size={12} />查看源码</summary><pre>{code}</pre></details>
  </section>;
}
