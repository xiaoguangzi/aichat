type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const string = (value: unknown) => typeof value === 'string' ? value : '';

/** A readable projection of captured wire data only; never borrow from later requests or chat history. */
export function traceResponse(raw: string | null): { value: unknown; partial: boolean } | null {
  if (!raw?.trim()) return null;
  try { return { value: JSON.parse(raw), partial: false }; } catch { /* SSE follows. */ }
  const output = new Map<number, JsonObject>();
  let response: JsonObject | undefined;
  const blocks = new Map<number, JsonObject>();
  const inputs = new Map<number, string>();
  const choices = new Map<number, JsonObject>();
  const calls = new Map<number, Map<number, JsonObject>>();
  let partial = false;
  let ended = false;
  const events: unknown[] = [];
  for (const frame of raw.replace(/\r\n?/g, '\n').split('\n\n')) {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data) continue;
    if (data.trim() === '[DONE]') { ended = true; continue; }
    let event: JsonObject;
    try { event = object(JSON.parse(data)); } catch { partial = true; continue; }
    if (typeof event.type === 'string' && event.type.startsWith('response.')) {
      if (event.response) response = object(event.response);
      if (['response.completed', 'response.incomplete', 'response.failed'].includes(event.type)) ended = true;
      const index = typeof event.output_index === 'number' ? event.output_index : 0;
      if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') output.set(index, { ...object(event.item) });
      const item = output.get(index);
      if (item && event.type === 'response.function_call_arguments.delta') item.arguments = string(item.arguments) + string(event.delta);
      if (item && (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta')) {
        const content = (item.content ??= []) as JsonObject[];
        const i = typeof event.content_index === 'number' ? event.content_index : 0;
        const refusal = event.type === 'response.refusal.delta';
        const part = content[i] ??= { type: refusal ? 'refusal' : 'output_text' };
        const key = refusal ? 'refusal' : 'text';
        part[key] = string(part[key]) + string(event.delta);
      }
      if (item && event.type === 'response.reasoning_summary_text.delta') {
        const summary = (item.summary ??= []) as JsonObject[];
        const i = typeof event.summary_index === 'number' ? event.summary_index : 0;
        const part = summary[i] ??= { type: 'summary_text' };
        part.text = string(part.text) + string(event.delta);
      }
    }
    if (event.type === 'message_stop') ended = true;
    if (event.type === 'content_block_start' && typeof event.index === 'number') {
      blocks.set(event.index, { ...object(event.content_block) });
    }
    if (event.type === 'content_block_delta' && typeof event.index === 'number') {
      const delta = object(event.delta);
      const block = blocks.get(event.index);
      if (!block) { partial = true; continue; }
      if (delta.type === 'thinking_delta') block.thinking = string(block.thinking) + string(delta.thinking);
      if (delta.type === 'text_delta') block.text = string(block.text) + string(delta.text);
      if (delta.type === 'signature_delta') block.signature = string(block.signature) + string(delta.signature);
      if (delta.type === 'input_json_delta') inputs.set(event.index, (inputs.get(event.index) ?? '') + string(delta.partial_json));
    }
    if (Array.isArray(event.choices)) for (const value of event.choices) {
      const choice = object(value);
      const index = typeof choice.index === 'number' ? choice.index : 0;
      const accumulated = choices.get(index) ?? { index, role: 'assistant' };
      choices.set(index, accumulated);
      const delta = object(choice.delta ?? choice.message);
      const thinking = delta.reasoning_content ?? delta.reasoning ?? delta.reasoning_text;
      if (typeof thinking === 'string') accumulated.thinking = string(accumulated.thinking) + thinking;
      if (typeof delta.content === 'string') accumulated.text = string(accumulated.text) + delta.content;
      if (Array.isArray(delta.tool_calls)) for (const value of delta.tool_calls) {
        const call = object(value);
        const callIndex = typeof call.index === 'number' ? call.index : 0;
        const byIndex = calls.get(index) ?? new Map<number, JsonObject>();
        calls.set(index, byIndex);
        const tool = byIndex.get(callIndex) ?? { index: callIndex, type: 'function', function: { name: '', arguments: '' } };
        byIndex.set(callIndex, tool);
        if (typeof call.id === 'string') tool.id = call.id;
        const fn = object(call.function);
        const target = object(tool.function);
        target.name = string(target.name) + string(fn.name);
        target.arguments = string(target.arguments) + string(fn.arguments);
      }
      if (choice.finish_reason != null) accumulated.finish_reason = choice.finish_reason;
    }
    if (event.error || event.type === 'error') events.push(event);
  }
  for (const [index, input] of inputs) {
    const block = blocks.get(index)!;
    try { block.input = JSON.parse(input); } catch { block.input = input; partial = true; }
  }
  for (const [index, tools] of calls) choices.get(index)!.tool_calls = [...tools.values()];
  const value: JsonObject = response ? { ...response } : {};
  if (output.size && (!ended || !Array.isArray(value.output) || !value.output.length)) value.output = [...output.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
  if (blocks.size) value.content = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block);
  if (choices.size) value.choices = [...choices.values()];
  if (events.length) value.errors = events;
  return Object.keys(value).length ? { value, partial: partial || !ended } : null;
}
