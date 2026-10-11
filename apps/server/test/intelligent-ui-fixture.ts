/** Isolated browser smoke fixture; never uses a real provider or the user's database. */
import { createServer, type ServerResponse } from 'node:http';

const components = [
  { type: 'view', title: '一起吃饭，轻松分账', description: '调整账单、人数与小费，每一份都算得清楚。金额仅用于演示。' },
  { type: 'number', id: 'total', label: '账单金额', value: 240, min: 0, max: 10000, step: 1, unit: '元' },
  { type: 'slider', id: 'people', label: '用餐人数', value: 4, min: 1, max: 12, step: 1, unit: '人' },
  { type: 'slider', id: 'tip', label: '小费比例', value: 10, min: 0, max: 30, step: 1, unit: '%' },
  { type: 'metric', id: 'each', label: '每人支付', expr: 'total * (1 + tip / 100) / people', digits: 2, unit: '元' },
  { type: 'metric', id: 'sum', label: '账单含小费', expr: 'total * (1 + tip / 100)', digits: 2, unit: '元' },
  { type: 'choice', id: 'mode', label: '想看什么？', value: 1, options: [{ label: '人数与花费', value: 1 }, { label: '分账方式', value: 2 }] },
  { type: 'chart', id: 'curve', label: '人数越多，每份越轻松', xLabel: '人数', yLabel: '元 / 人', min: 1, max: 12, series: [{ label: '含小费', expr: 'total * (1 + tip / 100) / x' }, { label: '原账单', expr: 'total / x' }], when: 'mode == 1' },
  { type: 'cards', id: 'compare', items: [{ title: '平均分摊', text: '{{people}} 人，每人 {{round(total * (1 + tip / 100) / people * 100) / 100}} 元。' }, { title: '按实际消费分摊', text: '适合点餐差异较大的聚会，可以继续追问调整分账。' }], when: 'mode == 2' },
  { type: 'check', id: 'paid', label: '已核对账单', value: false, text: '确认没有重复或遗漏的项目。' },
  { type: 'diagram', id: 'diagram', label: '钱是怎样分的？', nodes: [{ id: 'bill', label: '账单', text: '原账单 {{total}} 元。' }, { id: 'service', label: '小费', text: '另加 {{tip}}%，共 {{total * tip / 100}} 元。' }, { id: 'guests', label: '每位朋友', text: '总额除以 {{people}} 位朋友。' }], edges: [{ from: 'bill', to: 'service', label: '加上小费' }, { from: 'service', to: 'guests', label: '一起分摊' }] },
  { type: 'action', id: 'followup', label: '按当前选择继续调整', prompt: '请按 {{people}} 人、{{tip}}% 小费继续调整分账。' },
];
export const uiFixture = `这次用一个可以直接调整的分账器。\n\n\`\`\`aichat-ui\n${components.map(r => JSON.stringify(r)).join('\n')}\n\`\`\`\n\n也可以切换分账方式，或把你的选择带入下一轮讨论。`;
const port = Number(process.argv[2] ?? 3998);
async function stream(res: ServerResponse, events: { event?: string; data: unknown }[]) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  for (const event of events) {
    if (res.destroyed) return;
    if (event.event) res.write(`event: ${event.event}\n`);
    res.write(`data: ${typeof event.data === 'string' ? event.data : JSON.stringify(event.data)}\n\n`);
    await new Promise(resolve => setTimeout(resolve, 90));
  }
  res.end();
}
createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c; });
  req.on('end', () => {
    try {
      const request = JSON.parse(body || '{}');
      const messages = request.messages ?? request.input ?? [];
      const last = [...messages].reverse().find(m => m.role === 'user');
      const selection = JSON.stringify(last?.content ?? '').includes('当前选择');
      const reply = selection ? '已收到你的当前选择，接下来可以按这些参数继续讨论。' : uiFixture;
      const chunks = Array.from({ length: Math.ceil(reply.length / 70) }, (_, i) => reply.slice(i * 70, (i + 1) * 70));
      if (req.url?.endsWith('/chat/completions')) {
        void stream(res, [
          ...chunks.map(content => ({ data: { id: 'ui-chat', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content }, finish_reason: null }] } })),
          { data: { id: 'ui-chat', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] } },
          { data: { id: 'ui-chat', choices: [], usage: { prompt_tokens: 100, completion_tokens: 100 } } }, { data: '[DONE]' },
        ]);
      } else if (req.url?.endsWith('/messages')) {
        void stream(res, [
          { event: 'message_start', data: { type: 'message_start', message: { id: 'ui-ant', type: 'message', role: 'assistant', model: 'ui-fixture', content: [], usage: { input_tokens: 100, output_tokens: 0 } } } },
          { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
          ...chunks.map(text => ({ event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } })),
          { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
          { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 100 } } },
          { event: 'message_stop', data: { type: 'message_stop' } },
        ]);
      } else if (req.url?.endsWith('/responses')) {
        const message = { type: 'message', id: 'ui-msg', role: 'assistant', content: [{ type: 'output_text', text: reply, annotations: [] }], status: 'completed' };
        void stream(res, [
          { data: { type: 'response.created', response: { id: 'ui-rsp', output: [] } } },
          { data: { type: 'response.output_item.added', output_index: 0, item: { ...message, content: [] } } },
          ...chunks.map(delta => ({ data: { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta } })),
          { data: { type: 'response.output_item.done', output_index: 0, item: message } },
          { data: { type: 'response.completed', response: { id: 'ui-rsp', status: 'completed', output: [message], usage: { input_tokens: 100, output_tokens: 100 } } } },
        ]);
      } else { res.writeHead(404); res.end(); }
    } catch { res.writeHead(400); res.end(); }
  });
}).listen(port, '127.0.0.1', () => console.log(`UI fixture listening on ${port}`));
