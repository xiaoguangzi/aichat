import type Anthropic from '@anthropic-ai/sdk';
import type { Block, ToolDef } from '@aichat/shared';
import type { LLMMessage } from '../types.js';

type MP = Anthropic.MessageParam;
type CBP = Anthropic.ContentBlockParam;

function blockToAnthropic(b: Block, allowEmptySignature: boolean): CBP | null {
  switch (b.type) {
    case 'text':
      return b.text ? { type: 'text', text: b.text } : null;
    case 'thinking':
      // Signed thinking blocks replay unchanged (same-model continuation). Unsigned blocks
      // (e.g. from gateways that don't sign thinking) are replayed as-is only when the
      // endpoint tolerates it, otherwise degraded to text so context is preserved.
      if (b.signature) return { type: 'thinking', thinking: b.thinking, signature: b.signature };
      if (!b.thinking) return null;
      return allowEmptySignature ? ({ type: 'thinking', thinking: b.thinking, signature: '' } as CBP) : { type: 'text', text: b.thinking };
    case 'image':
      if (!b.data) return null;
      return {
        type: 'image',
        source: { type: 'base64', media_type: b.mime as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: b.data },
      };
    case 'document':
      if (!b.data) return null;
      if (b.mime === 'application/pdf')
        return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b.data }, title: b.name };
      return { type: 'document', source: { type: 'text', media_type: 'text/plain', data: Buffer.from(b.data, 'base64').toString('utf8') }, title: b.name };
    case 'tool_use':
      return { type: 'tool_use', id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> };
    case 'tool_result': {
      const inner = b.content.map((x) => blockToAnthropic(x, allowEmptySignature)).filter((x): x is CBP => !!x);
      const content = inner.filter((x): x is Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam => x.type === 'text' || x.type === 'image' || x.type === 'document');
      return {
        type: 'tool_result',
        tool_use_id: b.tool_use_id,
        content: content.length ? content : [{ type: 'text', text: '(empty result)' }],
        is_error: b.is_error ?? false,
      };
    }
  }
}

export function toAnthropicMessages(messages: LLMMessage[], opts: { allowEmptySignature?: boolean } = {}): MP[] {
  const allowEmpty = opts.allowEmptySignature === true;
  const out: MP[] = [];
  for (const m of messages) {
    const content = m.content.map((b) => blockToAnthropic(b, allowEmpty)).filter((x): x is CBP => !!x);
    if (!content.length) continue;
    // Anthropic requires alternating roles; merge consecutive same-role turns.
    const last = out[out.length - 1];
    if (last && last.role === m.role && Array.isArray(last.content)) {
      (last.content as CBP[]).push(...content);
    } else {
      out.push({ role: m.role, content });
    }
  }
  // First message must be user.
  while (out.length && out[0]!.role !== 'user') out.shift();
  return out;
}

export function toAnthropicTools(tools: ToolDef[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

/** Convert a complete Anthropic Message back into canonical blocks for persistence. */
export function fromAnthropicContent(content: Anthropic.ContentBlock[]): Block[] {
  const out: Block[] = [];
  for (const c of content) {
    switch (c.type) {
      case 'text':
        out.push({ type: 'text', text: c.text });
        break;
      case 'thinking':
        out.push({ type: 'thinking', thinking: c.thinking, signature: c.signature });
        break;
      case 'redacted_thinking':
        out.push({ type: 'thinking', thinking: '', signature: undefined });
        break;
      case 'tool_use':
        out.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
        break;
      default:
        break;
    }
  }
  return out;
}
