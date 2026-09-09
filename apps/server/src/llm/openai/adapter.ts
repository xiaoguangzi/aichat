import OpenAI from 'openai';
import type { StreamEvent, StopReason } from '@aichat/shared';
import type { LLMAdapter, LLMModelInfo, LLMRequest } from '../types.js';
import type { ProviderSecret } from '../../db/repos/providers.js';
import { resolveEffortParam } from '../reasoning.js';
import { toOpenAIMessages, toOpenAITools } from './convert.js';
import { ToolCallAccumulator } from './toolCallAccumulator.js';
import { AppError } from '../../util/errors.js';
import { openAIUsage } from '../usage.js';
import { requestDiagnostics } from '../diagnostics.js';

function mapFinish(reason: string | null | undefined, hadTools: boolean): StopReason {
  switch (reason) {
    case 'stop':
      return hadTools ? 'tool_use' : 'end_turn';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return hadTools ? 'tool_use' : 'end_turn';
  }
}

export class OpenAIAdapter implements LLMAdapter {
  readonly type = 'openai' as const;
  private client: OpenAI;
  private compat: ProviderSecret['compat'];

  constructor(p: ProviderSecret) {
    this.compat = p.compat;
    this.client = new OpenAI({
      apiKey: p.apiKey || 'missing',
      baseURL: p.baseUrl,
      defaultHeaders: p.extraHeaders,
      maxRetries: 1,
    });
  }

  async listModels(): Promise<LLMModelInfo[]> {
    const out: LLMModelInfo[] = [];
    for await (const m of this.client.models.list()) out.push({ id: m.id });
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Translate the unified reasoning dial into this provider's dialect. Real OpenAI rejects
   * unknown params, so the default dialect only sends top-level reasoning_effort; the other
   * dialects exist for gateways that front other vendors over the OpenAI protocol.
   */
  private applyReasoning(params: Record<string, unknown>, req: LLMRequest) {
    const level = req.reasoning;
    const format = this.compat.thinkingFormat ?? (this.compat.openaiThinkingObject ? 'zai' : 'openai');
    const effort = resolveEffortParam(level, req.reasoningMap);
    switch (format) {
      case 'openai':
        if (effort) params.reasoning_effort = effort;
        break;
      case 'openrouter':
        if (effort) params.reasoning = { effort };
        break;
      case 'zai':
        params.thinking = { type: level === 'off' ? 'disabled' : 'enabled' };
        if (effort) params.reasoning_effort = effort;
        break;
      case 'qwen':
        params.enable_thinking = level !== 'off';
        break;
      case 'deepseek':
        if (level !== 'off') params.thinking = { type: 'enabled' };
        break;
    }
  }

  async *stream(req: LLMRequest): AsyncIterable<StreamEvent> {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model: req.model,
      messages: toOpenAIMessages(req.system, req.messages),
      stream: true,
    };
    if (this.compat.streamOptions !== false) params.stream_options = { include_usage: true };
    if (this.compat.maxCompletionTokens) params.max_completion_tokens = req.maxTokens;
    else params.max_tokens = req.maxTokens;
    if (req.temperature != null && this.compat.sendTemperature !== false) params.temperature = req.temperature;
    this.applyReasoning(params as unknown as Record<string, unknown>, req);
    if (req.tools?.length) {
      params.tools = toOpenAITools(req.tools);
      params.tool_choice = 'auto';
    }

    const acc = new ToolCallAccumulator();
    let finish: string | null | undefined;
    let rawUsage: Record<string, unknown> | undefined;
    let requestId: string | null | undefined;
    let responseId: string | undefined;
    let complete = false;
    const record = requestDiagnostics('openai', params, req.onDiagnostic);

    try {
      const response = await this.client.chat.completions.create(params, { signal: req.signal }).withResponse();
      requestId = response.request_id;
      const stream = response.data;
      for await (const chunk of stream) {
        responseId = chunk.id || responseId;
        if (chunk.usage) {
          rawUsage = { ...rawUsage, ...chunk.usage,
            prompt_tokens_details: { ...(rawUsage?.prompt_tokens_details as object | undefined), ...chunk.usage.prompt_tokens_details },
          };
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta as {
          content?: string | null;
          reasoning_content?: string | null;
          reasoning?: string | null;
          reasoning_text?: string | null;
          tool_calls?: Array<{ index?: number; id?: string | null; function?: { name?: string | null; arguments?: string | null } | null }>;
        };
        // Gateways disagree on the reasoning field name; some even send two at once,
        // so take the first non-empty to avoid duplicated thinking output.
        const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.reasoning_text;
        if (reasoning) yield { type: 'thinking_delta', text: reasoning };
        if (delta.content) yield { type: 'text_delta', text: delta.content };
        if (delta.tool_calls) for (const ev of acc.push(delta.tool_calls)) yield ev;
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      complete = true;
    } catch (e) {
      throw wrapError(e);
    } finally {
      record({ status: complete ? 'complete' : req.signal?.aborted ? 'interrupted' : 'error', rawUsage, requestId, responseId });
    }
    const hadTools = acc.size > 0;
    for (const ev of acc.finish()) yield ev;
    if (rawUsage) yield { type: 'usage', usage: openAIUsage(rawUsage) };
    yield { type: 'done', stopReason: mapFinish(finish, hadTools) };
  }
}

function wrapError(e: unknown): unknown {
  if (e instanceof OpenAI.AuthenticationError) return new AppError('auth', `OpenAI auth failed: ${e.message}`, 401);
  if (e instanceof OpenAI.RateLimitError) return new AppError('rate_limit', `Rate limited: ${e.message}`, 429);
  if (e instanceof OpenAI.BadRequestError) return new AppError('bad_request', `OpenAI 400: ${e.message}`, 400);
  if (e instanceof OpenAI.APIError) return new AppError('upstream', `OpenAI ${e.status ?? ''}: ${e.message}`, 502);
  if (e instanceof OpenAI.APIConnectionError) return new AppError('connection', `Cannot reach provider: ${e.message}`, 502);
  return e;
}
