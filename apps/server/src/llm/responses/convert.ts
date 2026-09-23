import type OpenAI from 'openai';
import type { Block, ToolDef } from '@aichat/shared';
import type { LLMMessage } from '../types.js';

type Input = OpenAI.Responses.ResponseInput;
type Part = OpenAI.Responses.ResponseInputContent;
function parts(blocks: Block[]): Part[] {
  return blocks.flatMap((b): Part[] => {
    if (b.type === 'text') return b.text ? [{ type: 'input_text', text: b.text }] : [];
    if (b.type === 'image' && b.data) return [{ type: 'input_image', image_url: `data:${b.mime};base64,${b.data}`, detail: 'auto' }];
    if (b.type === 'document' && b.data) {
      if (b.mime === 'application/pdf') return [{ type: 'input_file', filename: b.name, file_data: `data:${b.mime};base64,${b.data}` }];
      return [{ type: 'input_text', text: `<file name="${b.name}">\n${Buffer.from(b.data, 'base64').toString('utf8')}\n</file>` }];
    }
    return [];
  });
}

export function toResponsesInput(messages: LLMMessage[]): Input {
  const out: Input = [];
  for (const m of messages) {
    if (m.role === 'assistant') {
      for (const b of m.content) {
        if (b.type === 'thinking' && b.responsesReasoning) out.push({ type: 'reasoning', ...b.responsesReasoning });
        if (b.type === 'text' && b.text) out.push({ role: 'assistant', content: b.text });
        if (b.type === 'tool_use') out.push({ type: 'function_call', call_id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) });
      }
    } else {
      for (const b of m.content) if (b.type === 'tool_result') {
        const output = parts(b.content);
        if (b.is_error) output.unshift({ type: 'input_text', text: 'ERROR:' });
        out.push({ type: 'function_call_output', call_id: b.tool_use_id, output: output.length ? output : '(empty result)' });
      }
      const content = parts(m.content);
      if (content.length) out.push({ role: 'user', content });
    }
  }
  return out;
}

export function toResponsesTools(tools: ToolDef[]): OpenAI.Responses.Tool[] {
  // Existing tool schemas permit optional properties; Responses defaults to strict schemas.
  return tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.inputSchema, strict: false }));
}
