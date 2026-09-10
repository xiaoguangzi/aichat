import type OpenAI from 'openai';
import type { Block, ToolDef } from '@aichat/shared';
import type { LLMMessage } from '../types.js';

type CM = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type UserPart = OpenAI.Chat.Completions.ChatCompletionContentPart;

function blockToText(b: Block): string {
  switch (b.type) {
    case 'text':
      return b.text;
    case 'image':
      return `[image ${b.mime}]`;
    case 'document':
      return b.data ? `<file name="${b.name}">\n${Buffer.from(b.data, 'base64').toString('utf8')}\n</file>` : `[document ${b.name}]`;
    default:
      return '';
  }
}

function userParts(blocks: Block[]): UserPart[] {
  const parts: UserPart[] = [];
  for (const b of blocks) {
    if (b.type === 'text') {
      if (b.text) parts.push({ type: 'text', text: b.text });
    } else if (b.type === 'image' && b.data) {
      parts.push({ type: 'image_url', image_url: { url: `data:${b.mime};base64,${b.data}` } });
    } else if (b.type === 'document' && b.data) {
      // PDF text was already extracted server-side into a text document when needed.
      parts.push({ type: 'text', text: blockToText(b) });
    }
  }
  return parts;
}

export function toOpenAIMessages(system: string | undefined, messages: LLMMessage[], replayReasoning = false): CM[] {
  const out: CM[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'assistant') {
      const text = m.content
        .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const toolUses = m.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
      const msg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam & { reasoning_content?: string } = { role: 'assistant', content: text || null };
      if (replayReasoning) {
        msg.reasoning_content = m.content
          .filter((b): b is Extract<Block, { type: 'thinking' }> => b.type === 'thinking')
          .map(b => b.thinking).join('');
      }
      if (toolUses.length) {
        msg.tool_calls = toolUses.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) },
        }));
      }
      if (msg.content || msg.tool_calls || msg.reasoning_content) out.push(msg);
      continue;
    }
    // user: tool results become separate role:'tool' messages, rest becomes one user message
    const toolResults = m.content.filter((b): b is Extract<Block, { type: 'tool_result' }> => b.type === 'tool_result');
    for (const tr of toolResults) {
      const txt = tr.content.map(blockToText).filter(Boolean).join('\n') || '(empty result)';
      out.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: tr.is_error ? `ERROR: ${txt}` : txt });
    }
    const rest = m.content.filter((b) => b.type !== 'tool_result');
    // Chat Completions only allows text in role:tool. Attach tool images to a user
    // message AFTER all parallel results, labelled by call ID, instead of discarding them.
    const parts: UserPart[] = [];
    for (const tr of toolResults) {
      const images = userParts(tr.content.filter(b => b.type === 'image'));
      if (images.length) parts.push({ type: 'text', text: `Images from tool result ${tr.tool_use_id}:` }, ...images);
    }
    parts.push(...userParts(rest));
    if (parts.length) {
      const onlyText = parts.every((p) => p.type === 'text');
      out.push({ role: 'user', content: onlyText ? parts.map((p) => (p as { text: string }).text).join('\n') : parts });
    }
  }
  return out;
}

export function toOpenAITools(tools: ToolDef[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}
