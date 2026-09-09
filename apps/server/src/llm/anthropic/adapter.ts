import Anthropic from '@anthropic-ai/sdk';
import type { StreamEvent, StopReason } from '@aichat/shared';
import type { LLMAdapter, LLMModelInfo, LLMRequest } from '../types.js';
import type { ProviderSecret } from '../../db/repos/providers.js';
import { canDisableThinking, resolveEffortParam } from '../reasoning.js';
import { toAnthropicMessages, toAnthropicTools } from './convert.js';
import { AppError } from '../../util/errors.js';
import { anthropicUsage } from '../usage.js';
import { requestDiagnostics } from '../diagnostics.js';
import { applyPromptCaching, supportsPromptCaching } from './cache.js';

function mapStop(reason: string | null): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

export class AnthropicAdapter implements LLMAdapter {
  readonly type = 'anthropic' as const;
  private client: Anthropic;
  private compat: ProviderSecret['compat'];
  private promptCaching: boolean;

  constructor(p: ProviderSecret) {
    this.compat = p.compat;
    this.promptCaching = supportsPromptCaching(p.baseUrl, p.compat.promptCaching);
    this.client = new Anthropic({
      apiKey: p.apiKey || 'missing',
      baseURL: p.baseUrl,
      defaultHeaders: p.extraHeaders,
      maxRetries: 1,
    });
  }

  async listModels(): Promise<LLMModelInfo[]> {
    const out: LLMModelInfo[] = [];
    for await (const m of this.client.models.list({ limit: 100 })) out.push({ id: m.id, displayName: m.display_name });
    return out;
  }

  async *stream(req: LLMRequest): AsyncIterable<StreamEvent> {
    const params: Anthropic.MessageStreamParams = {
      model: req.model,
      max_tokens: req.maxTokens,
      messages: toAnthropicMessages(req.messages, { allowEmptySignature: this.compat.allowEmptySignature === true }),
    };
    if (req.system) params.system = req.system;
    if (req.tools?.length) {
      params.tools = toAnthropicTools(req.tools);
      params.tool_choice = { type: 'auto' };
    }
    // Reasoning is a unified dial translated for this protocol. Thinking config is generic:
    // the endpoint may front any model that speaks the Anthropic protocol, so the adaptive vs
    // budget choice is a per-model flag, not a model-name guess.
    const display = this.compat.thinkingDisplay !== false ? { display: 'summarized' as const } : {};
    const level = req.reasoning;
    const effort = resolveEffortParam(level, req.reasoningMap, { minimal: 'low' });
    if (level === 'off') {
      // Adaptive-capable endpoints understand {type:"disabled"}; unknown gateways get the
      // parameter omitted (reasoningMap.off === null marks endpoints that cannot disable at all).
      if (req.adaptive && canDisableThinking(req.reasoningMap)) {
        params.thinking = { type: 'disabled' } as Anthropic.ThinkingConfigParam;
      }
      if (req.temperature != null) params.temperature = req.temperature;
    } else {
      // Thinking on. Two ways to say it: {type:"adaptive"} on the official API, {type:"enabled"}
      // on gateways fronting other vendors (GLM & co). budget_tokens is not sent at all — current
      // APIs reject it and effort is the depth dial in both styles.
      params.thinking = { type: req.adaptive ? 'adaptive' : 'enabled', ...display } as Anthropic.ThinkingConfigParam;
      if (effort) {
        if (this.compat.effortParam === 'reasoning_effort') (params as Record<string, unknown>).reasoning_effort = effort;
        else params.output_config = { effort } as Anthropic.MessageStreamParams['output_config'];
      }
    }

    if (this.promptCaching) applyPromptCaching(params);
    const record = requestDiagnostics('anthropic', params, req.onDiagnostic);
    let stream: ReturnType<Anthropic['messages']['stream']>;
    try {
      stream = this.client.messages.stream(params, { signal: req.signal });
    } catch (e) {
      record({ status: req.signal?.aborted ? 'interrupted' : 'error' });
      throw wrapError(e);
    }

    const toolArgs = new Map<number, { id: string; name: string; json: string }>();
    let stopReason: StopReason = 'other';
    let rawUsage: Record<string, unknown> | undefined;
    let responseId: string | undefined;
    let complete = false;

    try {
      for await (const ev of stream) {
        switch (ev.type) {
          case 'message_start':
            rawUsage = { ...ev.message.usage };
            responseId = ev.message.id;
            break;
          case 'content_block_start':
            if (ev.content_block.type === 'tool_use') {
              toolArgs.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, json: '' });
              yield { type: 'tool_call_start', id: ev.content_block.id, name: ev.content_block.name };
            }
            break;
          case 'content_block_delta':
            if (ev.delta.type === 'text_delta') yield { type: 'text_delta', text: ev.delta.text };
            else if (ev.delta.type === 'thinking_delta') yield { type: 'thinking_delta', text: ev.delta.thinking };
            else if (ev.delta.type === 'signature_delta') yield { type: 'thinking_delta', text: '', signature: ev.delta.signature };
            else if (ev.delta.type === 'input_json_delta') {
              const t = toolArgs.get(ev.index);
              if (t) {
                t.json += ev.delta.partial_json;
                yield { type: 'tool_call_delta', id: t.id, argsDelta: ev.delta.partial_json };
              }
            }
            break;
          case 'content_block_stop': {
            const t = toolArgs.get(ev.index);
            if (t) {
              let input: unknown = {};
              try {
                input = t.json.trim() ? JSON.parse(t.json) : {};
              } catch {
                input = { _raw: t.json };
              }
              yield { type: 'tool_call_end', id: t.id, input };
              toolArgs.delete(ev.index);
            }
            break;
          }
          case 'message_delta':
            stopReason = mapStop(ev.delta.stop_reason);
            rawUsage = { ...rawUsage, ...Object.fromEntries(Object.entries(ev.usage).filter(([, v]) => v != null)) };
            break;
          default:
            break;
        }
      }
      const final = await stream.finalMessage();
      rawUsage = { ...rawUsage, ...Object.fromEntries(Object.entries(final.usage).filter(([, v]) => v != null)) };
      responseId = final.id;
      complete = true;
      yield { type: 'usage', usage: anthropicUsage(rawUsage) };
      const refusal =
        final.stop_reason === 'refusal' && final.stop_details
          ? { category: (final.stop_details as { category?: string | null }).category ?? null, explanation: (final.stop_details as { explanation?: string | null }).explanation ?? null }
          : undefined;
      yield { type: 'done', stopReason: mapStop(final.stop_reason) ?? stopReason, refusal };
    } catch (e) {
      throw wrapError(e);
    } finally {
      record({ status: complete ? 'complete' : req.signal?.aborted ? 'interrupted' : 'error', rawUsage, requestId: stream.request_id, responseId });
    }
  }
}

function wrapError(e: unknown): unknown {
  if (e instanceof Anthropic.AuthenticationError) return new AppError('auth', `Anthropic auth failed: ${e.message}`, 401);
  if (e instanceof Anthropic.RateLimitError) return new AppError('rate_limit', `Rate limited: ${e.message}`, 429);
  if (e instanceof Anthropic.BadRequestError) return new AppError('bad_request', `Anthropic 400: ${e.message}`, 400);
  if (e instanceof Anthropic.APIError) return new AppError('upstream', `Anthropic ${e.status ?? ''}: ${e.message}`, 502);
  if (e instanceof Anthropic.APIConnectionError) return new AppError('connection', `Cannot reach provider: ${e.message}`, 502);
  return e;
}
