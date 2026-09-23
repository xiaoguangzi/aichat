/**
 * Minimal mock of all three API formats for e2e smoke tests.
 *   POST /v1/chat/completions  (OpenAI, streaming)  -> text, or a tool call if tools are present and no tool result yet
 *   POST /v1/messages          (Anthropic, streaming) -> same behaviour
 *   GET  /v1/models
 * Run: npx tsx test/mock-llm-server.ts [port]
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 3999);

function sse(res: import('node:http').ServerResponse, events: Array<{ event?: string; data: unknown }>) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  for (const e of events) {
    if (e.event) res.write(`event: ${e.event}\n`);
    res.write(`data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`);
  }
  res.end();
}

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://x').pathname;
    if (url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', display_name: 'Mock Model' }, { id: 'mock-2' }] }));
      return;
    }
    const j = { messages: [], ...(JSON.parse(body || '{}') as object) } as { messages: Array<{ role: string; content: unknown }>; tools?: unknown[] };
    const hasToolResult = j.messages.some((m) => m.role === 'tool' || (Array.isArray(m.content) && (m.content as Array<{ type: string }>).some((c) => c.type === 'tool_result')));
    const wantTool = !!j.tools?.length && !hasToolResult;
    const lastUser = [...j.messages].reverse().find((m) => m.role === 'user');
    const userText = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '');
    const reply = `Echo: ${userText.slice(0, 60)}`;
    const toolName = wantTool ? String((j.tools![0] as { name?: string; function?: { name: string } }).name ?? (j.tools![0] as { function: { name: string } }).function.name) : '';

    if (url.endsWith('/responses')) {
      const r = JSON.parse(body) as { input: Array<{ type?: string; role?: string; content?: unknown }>; tools?: Array<{ name: string }> };
      const hasResult = r.input.some(i => i.type === 'function_call_output');
      const wantsTool = !!r.tools?.length && !hasResult;
      const reasoning = { type: 'reasoning', id: 'rs_mock', summary: [{ type: 'summary_text', text: 'Responses thinking' }], encrypted_content: 'mock-encrypted-reasoning' };
      if (hasResult && !r.input.some(i => i.type === 'reasoning')) {
        res.writeHead(400); res.end('Missing reasoning replay'); return;
      }
      const call = { type: 'function_call', id: 'fc_mock', call_id: 'call_responses', name: r.tools?.find(t => t.name === 'skill__load')?.name ?? r.tools?.[0]?.name, arguments: '{"name":"example-skill"}' };
      const text = hasResult ? 'Responses tool round trip complete.' : 'Responses reply received.';
      const message = { type: 'message', id: 'msg_mock', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }], status: 'completed' };
      const events: Array<{ data: unknown }> = [
        { data: { type: 'response.created', response: { id: 'resp_mock', output: [] } } },
        { data: { type: 'response.output_item.added', output_index: 0, item: { ...reasoning, summary: [], encrypted_content: null } } },
        { data: { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'Responses thinking' } },
        { data: { type: 'response.output_item.done', output_index: 0, item: reasoning } },
      ];
      if (wantsTool) events.push(
        { data: { type: 'response.output_item.added', output_index: 1, item: { ...call, arguments: '' } } },
        { data: { type: 'response.function_call_arguments.delta', output_index: 1, delta: call.arguments } },
        { data: { type: 'response.output_item.done', output_index: 1, item: call } },
      );
      else events.push(
        { data: { type: 'response.output_item.added', output_index: 1, item: { ...message, content: [] } } },
        { data: { type: 'response.output_text.delta', output_index: 1, content_index: 0, delta: text } },
        { data: { type: 'response.output_item.done', output_index: 1, item: message } },
      );
      events.push({ data: { type: 'response.completed', response: { id: 'resp_mock', status: 'completed', output: [reasoning, wantsTool ? call : message], usage: { input_tokens: 30, output_tokens: 8, input_tokens_details: { cached_tokens: 10 } } } } });
      sse(res, events); return;
    }
    if (url.endsWith('/chat/completions')) {
      const id = 'chatcmpl-1';
      const chunk = (delta: unknown, finish: string | null = null) => ({ data: { id, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] } });
      const ev = wantTool
        ? [chunk({ role: 'assistant', content: 'Let me call a tool.' }), chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: toolName, arguments: '{"na' } }] }), chunk({ tool_calls: [{ index: 0, function: { arguments: 'me":"example-skill"}' } }] }), chunk({}, 'tool_calls')]
        : [chunk({ role: 'assistant', reasoning_content: 'thinking...' }), ...reply.split(' ').map((w) => chunk({ content: w + ' ' })), chunk({}, 'stop'), { data: { id, choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } } }];
      sse(res, [...ev, ...(wantTool ? [{ data: { id, choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } } }] : []), { data: '[DONE]' }]);
      return;
    }
    if (url.endsWith('/messages')) {
      const ev: Array<{ event: string; data: unknown }> = [
        { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } } } },
      ];
      let idx = 0;
      ev.push({ event: 'content_block_start', data: { type: 'content_block_start', index: idx, content_block: { type: 'thinking', thinking: '' } } });
      ev.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: idx, delta: { type: 'thinking_delta', thinking: 'pondering' } } });
      ev.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: idx, delta: { type: 'signature_delta', signature: 'sig123' } } });
      ev.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index: idx } });
      idx++;
      ev.push({ event: 'content_block_start', data: { type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } } });
      for (const w of (wantTool ? 'Calling a tool.' : reply).split(' ')) ev.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text: w + ' ' } } });
      ev.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index: idx } });
      if (wantTool) {
        idx++;
        ev.push({ event: 'content_block_start', data: { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: 'toolu_1', name: toolName, input: {} } } });
        ev.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: '{"name":"exam' } } });
        ev.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: 'ple-skill"}' } } });
        ev.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index: idx } });
      }
      ev.push({ event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: wantTool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } } });
      ev.push({ event: 'message_stop', data: { type: 'message_stop' } });
      sse(res, ev);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
}).listen(port, () => console.log(`mock llm on http://127.0.0.1:${port}`));
