import { z } from 'zod';

const text = z.string().max(4000);
const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/);
const number = z.number().finite().min(-1e12).max(1e12);
const base = { id, when: z.string().max(512).optional() };
const option = z.object({ label: text, value: number });
export const uiNodeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), ...base, text }),
  z.object({ type: z.literal('number'), ...base, label: text, value: number, min: number, max: number, step: number.positive().default(1), unit: text.optional() }),
  z.object({ type: z.literal('slider'), ...base, label: text, value: number, min: number, max: number, step: number.positive().default(1), unit: text.optional() }),
  z.object({ type: z.literal('select'), ...base, label: text, value: number, options: z.array(option).min(1).max(20) }),
  z.object({ type: z.literal('choice'), ...base, label: text, value: number, options: z.array(option).min(1).max(10) }),
  z.object({ type: z.literal('check'), ...base, label: text, value: z.boolean().default(false), text: text.optional() }),
  z.object({ type: z.literal('metric'), ...base, label: text, expr: z.string().max(512), digits: z.number().int().min(0).max(6).default(2), unit: text.optional(), hint: text.optional() }),
  z.object({ type: z.literal('cards'), ...base, items: z.array(z.object({ title: text, text })).min(1).max(12) }),
  z.object({ type: z.literal('table'), ...base, columns: z.array(text).min(1).max(10), rows: z.array(z.array(text).max(10)).max(100) }),
  z.object({ type: z.literal('chart'), ...base, label: text, xLabel: text.optional(), yLabel: text.optional(), min: number, max: number, series: z.array(z.object({ label: text, expr: z.string().max(512) })).min(1).max(4) }),
  z.object({ type: z.literal('diagram'), ...base, label: text, nodes: z.array(z.object({ id, label: text, text: text.optional() })).min(1).max(12), edges: z.array(z.object({ from: id, to: id, label: text.optional() })).max(24) }),
  z.object({ type: z.literal('action'), ...base, label: text, prompt: text }),
]);
export type UiNode = z.infer<typeof uiNodeSchema>;
export type UiControl = Extract<UiNode, { type: 'number' | 'slider' | 'select' | 'choice' | 'check' }>;
export type UiState = Record<string, number>;
export const isUiControl = (node: UiNode): node is UiControl => ['number', 'slider', 'select', 'choice', 'check'].includes(node.type);

export interface UiFence { start: number; end: number; code: string; complete: boolean }
/** Scan whole fences so examples nested inside longer Markdown fences stay ordinary code. */
export function parseUiFences(source: string): UiFence[] {
  const out: UiFence[] = [];
  const opening = /^ {0,3}(`{3,}|~{3,})([^\n]*)\n/gm;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(source))) {
    const fence = match[1]!;
    const close = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*(?:\\r?\\n|$)`, 'gm');
    close.lastIndex = opening.lastIndex;
    const end = close.exec(source);
    if (match[2]!.trim().toLowerCase() === 'aichat-ui') out.push({ start: match.index, end: end ? close.lastIndex : source.length,
      code: source.slice(opening.lastIndex, end?.index ?? source.length).replace(/\r?\n$/, ''), complete: !!end });
    opening.lastIndex = end ? close.lastIndex : source.length;
  }
  return out;
}

const viewSchema = z.object({ type: z.literal('view'), title: text.min(1), description: text.optional() });
export function compileUi(code: string, complete: boolean) {
  const nodes: UiNode[] = [];
  const errors: string[] = [];
  let view: z.infer<typeof viewSchema> | undefined;
  if (code.length > 150_000) return { view, nodes, errors: ['界面内容超过大小限制。'] };
  const lines = code.split(/\r?\n/);
  const ids = new Set<string>();
  if (lines.length > 81) errors.push('界面最多支持 80 个组件。');
  for (const [index, line] of lines.slice(0, 81).entries()) {
    if (!line.trim()) continue;
    let raw: unknown;
    try { raw = JSON.parse(line); }
    catch { if (complete || index < lines.length - 1) errors.push(`第 ${index + 1} 行不是有效 JSON。`); continue; }
    if (!view && !nodes.length && !errors.length) {
      const parsed = viewSchema.safeParse(raw);
      if (!parsed.success) { errors.push('首行需要 view 标题。'); continue; }
      view = parsed.data;
      continue;
    }
    if (!view) continue;
    const parsed = uiNodeSchema.safeParse(raw);
    if (!parsed.success) { errors.push(`第 ${index + 1} 行的组件不受支持或参数无效。`); continue; }
    const node = parsed.data;
    if (ids.has(node.id)) { errors.push(`第 ${index + 1} 行的组件 ID 重复。`); continue; }
    if ((node.type === 'slider' || node.type === 'number' || node.type === 'chart') && node.min >= node.max) {
      errors.push(`第 ${index + 1} 行的范围无效。`); continue;
    }
    if (node.type === 'diagram') {
      const keys = new Set(node.nodes.map(n => n.id));
      if (keys.size !== node.nodes.length || node.edges.some(e => !keys.has(e.from) || !keys.has(e.to))) {
        errors.push(`第 ${index + 1} 行的图示连接无效。`); continue;
      }
    }
    ids.add(node.id); nodes.push(node);
  }
  if (complete && !view && !errors.length) errors.push('界面缺少 view 标题。');
  return { view, nodes, errors };
}

export function controlValue(node: UiControl, value: unknown): number {
  if (node.type === 'check') return value === 1 || value === true ? 1 : 0;
  const fallback = node.value;
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  if (node.type === 'choice' || node.type === 'select') return node.options.some(o => o.value === n) ? n : node.options[0]!.value;
  return Math.min(node.max, Math.max(node.min, n));
}

/** A bounded arithmetic interpreter. No eval, property access, JS, or external calls. */
export function evaluateUi(expression: string, state: UiState): number | undefined {
  if (expression.length > 512) return undefined;
  const tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[a-zA-Z_][a-zA-Z0-9_]*|==|!=|<=|>=|&&|\|\||[+*/%^(),?:!<>-]/g) ?? [];
  if (tokens.length > 160 || tokens.join('') !== expression.replace(/\s/g, '')) return undefined;
  let pos = 0; let depth = 0;
  const funcs: Record<string, (...args: number[]) => number> = { min: Math.min, max: Math.max, abs: Math.abs, round: Math.round,
    floor: Math.floor, ceil: Math.ceil, sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log, exp: Math.exp, pow: Math.pow };
  const precedence: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '^': 7 };
  const binary = (op: string, a: number, b: number) => {
    switch (op) {
      case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b;
      case '%': return a % b; case '^': return a ** b; case '==': return +(a === b); case '!=': return +(a !== b);
      case '<': return +(a < b); case '>': return +(a > b); case '<=': return +(a <= b); case '>=': return +(a >= b);
      case '&&': return +(!!a && !!b); case '||': return +(!!a || !!b); default: throw Error('operator');
    }
  };
  const take = (expected: string) => { if (tokens[pos++] !== expected) throw Error('syntax'); };
  const parse = (level = 0): number => {
    if (++depth > 32) throw Error('depth');
    const token = tokens[pos++];
    let value: number;
    if (token === '(') { value = parse(); take(')'); }
    else if (token === '-' || token === '+' || token === '!') { const n = parse(8); value = token === '-' ? -n : token === '!' ? +!n : n; }
    else if (token && /^\d|^\./.test(token)) value = Number(token);
    else if (token && tokens[pos] === '(' && Object.hasOwn(funcs, token)) {
      pos++; const args: number[] = [];
      if (tokens[pos] !== ')') { args.push(parse()); while (tokens[pos] === ',') { pos++; args.push(parse()); } }
      take(')'); value = funcs[token]!(...args);
    } else if (token === 'pi') value = Math.PI;
    else if (token === 'e') value = Math.E;
    else if (token && Object.hasOwn(state, token)) value = state[token]!;
    else throw Error('variable');
    while (pos < tokens.length) {
      const op = tokens[pos]!; const p = precedence[op];
      if (p === undefined || p < level) break;
      pos++; value = binary(op, value, parse(p + (op === '^' ? 0 : 1)));
    }
    if (level === 0 && tokens[pos] === '?') { pos++; const yes = parse(); take(':'); const no = parse(); value = value ? yes : no; }
    depth--; return value;
  };
  try { const result = parse(); return pos === tokens.length && Number.isFinite(result) ? result : undefined; }
  catch { return undefined; }
}

export function uiTemplate(text: string, state: UiState): string {
  return text.replace(/\{\{([^{}]+)\}\}/g, (_, expr: string) => {
    const value = evaluateUi(expr.trim(), state);
    return value === undefined ? '—' : String(Math.round(value * 1e6) / 1e6);
  });
}
