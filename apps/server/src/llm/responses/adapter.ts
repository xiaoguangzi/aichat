import OpenAI from 'openai';
import type { StreamEvent, StopReason } from '@aichat/shared';
import type { LLMAdapter, LLMRequest } from '../types.js';
import type { ProviderSecret } from '../../db/repos/providers.js';
import { resolveEffortParam } from '../reasoning.js';
import { toResponsesInput, toResponsesTools } from './convert.js';
import { openAIUsage } from '../usage.js';
import { requestDiagnostics } from '../diagnostics.js';
import { traceRequests } from '../trace.js';
import { retryXaioThinking } from '../xaio-retry.js';
import { wrapError } from '../openai/adapter.js';
import { AppError } from '../../util/errors.js';

export class ResponsesAdapter implements LLMAdapter {
  readonly type = 'openai' as const;
  private client: OpenAI;
  constructor(private provider: ProviderSecret) {
    this.client = new OpenAI({ apiKey: provider.apiKey || 'missing', baseURL: provider.baseUrl, defaultHeaders: provider.extraHeaders, maxRetries: 1 });
  }
  async listModels() {
    const models = [];
    for await (const m of this.client.models.list()) models.push({ id: m.id });
    return models.sort((a, b) => a.id.localeCompare(b.id));
  }
  async *stream(req: LLMRequest): AsyncIterable<StreamEvent> {
    const trace = traceRequests(this.provider, req.model, req.onTrace);
    yield* retryXaioThinking(this.provider.baseUrl, req.signal, () => this.attempt(req, trace));
  }
  private async *attempt(req: LLMRequest, trace: ReturnType<typeof traceRequests>): AsyncIterable<StreamEvent> {
    const params: OpenAI.Responses.ResponseCreateParamsStreaming = {
      model: req.model, input: toResponsesInput(req.messages), instructions: req.system,
      stream: true, store: false, max_output_tokens: req.maxTokens,
      include: ['reasoning.encrypted_content'],
    };
    const effort = resolveEffortParam(req.reasoning, req.reasoningMap);
    if (effort) params.reasoning = { effort: effort as OpenAI.ReasoningEffort, summary: 'auto' };
    else if (req.reasoning === 'off' && req.reasoningMap?.off) params.reasoning = { effort: req.reasoningMap.off as OpenAI.ReasoningEffort };
    if (req.temperature != null && this.provider.compat.sendTemperature !== false) params.temperature = req.temperature;
    if (req.tools?.length) { params.tools = toResponsesTools(req.tools); params.tool_choice = 'auto'; }
    const client = trace.fetch ? this.client.withOptions({ fetch: trace.fetch }) : this.client;
    const { input, instructions, ...settings } = params;
    const record = requestDiagnostics('openai', { ...settings, model: req.model, messages: input as unknown[], system: instructions }, d => { trace.finish(d); req.onDiagnostic?.(d); });
    let rawUsage: Record<string, unknown> | undefined;
    let requestId: string | null | undefined;
    let responseId: string | undefined;
    let complete = false;
    let stopReason: StopReason = 'end_turn';
    let refused = false;
    const calls = new Map<number, { id: string; args: string; ended: boolean }>();
    try {
      const response = await client.responses.create(params, { signal: req.signal }).withResponse();
      requestId = response.request_id;
      for await (const ev of response.data) {
        switch (ev.type) {
          case 'response.created': responseId = ev.response.id; break;
          case 'response.output_text.delta': yield { type: 'text_delta', text: ev.delta }; break;
          case 'response.refusal.delta': refused = true; yield { type: 'text_delta', text: ev.delta }; break;
          case 'response.reasoning_summary_text.delta': yield { type: 'thinking_delta', text: ev.delta }; break;
          case 'response.output_item.added':
            if (ev.item.type === 'function_call') {
              calls.set(ev.output_index, { id: ev.item.call_id, args: ev.item.arguments || '', ended: false });
              yield { type: 'tool_call_start', id: ev.item.call_id, name: ev.item.name };
            }
            break;
          case 'response.function_call_arguments.delta': {
            const call = calls.get(ev.output_index);
            if (!call) throw new AppError('upstream', 'Responses tool arguments arrived without a call', 502);
            call.args += ev.delta;
            yield { type: 'tool_call_delta', id: call.id, argsDelta: ev.delta };
            break;
          }
          case 'response.output_item.done':
            if (ev.item.type === 'reasoning' && ev.item.encrypted_content) {
              yield { type: 'responses_reasoning', item: { id: ev.item.id, encrypted_content: ev.item.encrypted_content, summary: ev.item.summary } };
            }
            if (ev.item.type === 'function_call') {
              const call = calls.get(ev.output_index);
              if (!call) throw new AppError('upstream', 'Responses tool completion arrived without a call', 502);
              call.args = ev.item.arguments;
              // Do not execute malformed/truncated function arguments.
              const input: unknown = JSON.parse(call.args);
              call.ended = true;
              yield { type: 'tool_call_end', id: call.id, input };
            }
            break;
          case 'response.completed':
          case 'response.incomplete':
          case 'response.failed': {
            responseId = ev.response.id;
            if (ev.response.usage) rawUsage = { ...ev.response.usage };
            if (ev.type === 'response.failed') throw new AppError('upstream', ev.response.error?.message ?? 'Responses request failed', 502);
            if (ev.type === 'response.incomplete') stopReason = ev.response.incomplete_details?.reason === 'max_output_tokens' ? 'max_tokens' : 'refusal';
            else stopReason = refused ? 'refusal' : calls.size ? 'tool_use' : 'end_turn';
            complete = true;
            break;
          }
          case 'error': throw new AppError('upstream', ev.message, 502);
        }
      }
      if (req.signal?.aborted) throw req.signal.reason;
      if (!complete) throw new AppError('upstream', 'Responses stream ended before completion', 502);
      if (stopReason === 'tool_use' && [...calls.values()].some(c => !c.ended)) throw new AppError('upstream', 'Responses stream contains unfinished tool calls', 502);
    } catch (e) { complete = false; throw wrapError(e); }
    finally { record({ status: complete ? 'complete' : req.signal?.aborted ? 'interrupted' : 'error', rawUsage, requestId, responseId }); }
    if (rawUsage) yield { type: 'usage', usage: openAIUsage({ prompt_tokens: rawUsage.input_tokens, completion_tokens: rawUsage.output_tokens, prompt_tokens_details: rawUsage.input_tokens_details }) };
    yield { type: 'done', stopReason };
  }
}
