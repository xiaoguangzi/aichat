import type {
  Block, ChatSSEEvent, ContextEstimate, Conversation, Message, MessageModel, Model, ProviderType,
  ReasoningLevel, StopReason, ToolDef, Usage,
} from '@aichat/shared';
import { resolveReasoningLevel } from '@aichat/shared';
import { conversationsRepo } from '../db/repos/conversations.js';
import { groupsRepo } from '../db/repos/groups.js';
import { messagesRepo } from '../db/repos/messages.js';
import { modelsRepo, providersRepo } from '../db/repos/providers.js';
import type { ProviderSecret } from '../db/repos/providers.js';
import { getAdapter } from '../llm/registry.js';
import type { LLMAdapter, LLMMessage } from '../llm/types.js';
import { mcpManager } from '../mcp/manager.js';
import { skillToolDefs } from '../skills/tools.js';
import { hydrateBlocks } from '../util/attachments.js';
import { AppError, errorToPayload } from '../util/errors.js';
import { uuid } from '../util/id.js';
import { config } from '../config.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { shapeOldTurns, shapeTurnsForOverflow } from './history.js';
import { isContextOverflowError } from '../llm/contextOverflow.js';
import { delegateTool, type DelegateRun } from './delegate.js';
import { estimateContext } from './context.js';
import { isOfficialDeepSeek } from '../llm/openai/deepseek.js';
import { executeTool } from './toolRouter.js';
import { toolResultsRepo } from '../db/repos/toolResults.js';
import { TurnTimer } from './timing.js';
import { stableToolDefs } from '../llm/tools.js';
import { apiTracesRepo } from '../db/repos/apiTraces.js';
import { requestDiagnosticsRepo } from '../db/repos/requestDiagnostics.js';
import { allocateToolResultBudgets, prepareToolResult, readResultTool, READ_RESULT_TOOL, readToolResult, resultTextChars } from './toolResults.js';

export interface RunOptions {
  conversation: Conversation;
  emit: (ev: ChatSSEEvent) => void | Promise<void>;
  signal: AbortSignal;
  /** Reports the assembled payload size. The estimator mirrors what is sent, not a guess. */
  onContext?: (estimate: ContextEstimate) => void;
  /** Where the new reply attaches; defaults to the tip of the visible branch. */
  branchPoint?: string | null;
}

function resolveModel(conv: Conversation) {
  const model = (conv.modelId && modelsRepo.get(conv.modelId)) || modelsRepo.getDefault();
  if (!model) throw new AppError('no_model', 'No model configured. Add a provider and model in Settings.', 400);
  const provider = providersRepo.get(model.providerId);
  if (!provider) throw new AppError('no_provider', 'Provider for the selected model no longer exists.', 400);
  return { model, provider };
}

/**
 * Attribution snapshot for the assistant message. `displayName` is provider-supplied or
 * user-supplied, so it is stored rather than re-derived: a later rename or model deletion must not
 * rewrite what history says answered.
 */
function modelAttribution(model: { id: string; modelId: string; displayName: string }, provider: { name: string }): MessageModel {
  return {
    id: model.id,
    modelId: model.modelId,
    providerName: provider.name,
    label: model.displayName && model.displayName !== model.modelId
      ? `${provider.name} / ${model.displayName}`
      : `${provider.name} / ${model.modelId}`,
  };
}

/** Accumulates stream events into ordered canonical blocks. */
export class BlockBuilder {
  blocks: Block[] = [];
  private tools = new Map<string, Extract<Block, { type: 'tool_use' }>>();
  text(t: string) {
    const last = this.blocks[this.blocks.length - 1];
    if (last && last.type === 'text') last.text += t;
    else this.blocks.push({ type: 'text', text: t });
  }
  thinking(t: string, signature?: string, summarized?: boolean) {
    const last = this.blocks[this.blocks.length - 1];
    if (last && last.type === 'thinking') {
      last.thinking += t;
      if (signature) last.signature = signature;
      if (summarized) last.summarized = true;
    } else if (t || signature) {
      // signature for an already-closed thinking block: attach to the most recent one
      const prev = [...this.blocks].reverse().find((b) => b.type === 'thinking');
      if (!t && signature && prev && prev.type === 'thinking') prev.signature = signature;
      else this.blocks.push({ type: 'thinking', thinking: t, signature, ...(summarized && { summarized: true }) });
    }
  }
  /** the text collected so far was reasoning the model leaked into content */
  reclassifyTextAsThinking() {
    const next: Block[] = [];
    for (const b of this.blocks) {
      const nb: Block = b.type === 'text' ? { type: 'thinking', thinking: b.text } : b;
      const last = next[next.length - 1];
      if (nb.type === 'thinking' && last && last.type === 'thinking') last.thinking += nb.thinking;
      else next.push(nb);
    }
    this.blocks = next;
  }
  toolStart(id: string, name: string) {
    const b: Extract<Block, { type: 'tool_use' }> = { type: 'tool_use', id, name, input: {} };
    this.tools.set(id, b);
    this.blocks.push(b);
  }
  toolName(id: string) {
    return this.tools.get(id)?.name ?? '';
  }
  toolEnd(id: string, input: unknown) {
    const b = this.tools.get(id);
    if (b) b.input = input;
  }
  toolUses() {
    return this.blocks.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
  }
  hasContent() {
    return this.blocks.some((b) => (b.type === 'text' && b.text) || b.type === 'tool_use' || (b.type === 'thinking' && b.thinking));
  }
}

/**
 * Assemble everything a request needs: model, adapter, tools, system prompt and the shaped history.
 * Shared with the snapshot builders so the composer's occupancy reading describes the same payload
 * the model will actually receive, rather than a second, drifting calculation.
 */
export async function buildRequestContext(conv: Conversation): Promise<{
  model: Model;
  provider: ProviderSecret;
  adapter: LLMAdapter;
  responses: boolean;
  tools: ToolDef[];
  system: string;
  history: LLMMessage[];
  maxTokens: number;
  reasoning: ReasoningLevel;
  attribution: MessageModel;
  turnId: string | undefined;
  /** Parent for the next row created by this run, so the message tree stays a tree. */
  tipId: string | null;
}> {
  const { model, provider } = resolveModel(conv);
  const adapter = getAdapter(provider);
  const responses = provider.type === 'openai' && provider.compat.apiFormat === 'responses';
  const settings = conv.settings;

  let tools = model.caps.tools
    ? [...mcpManager.toolDefs(settings.enabledMcpServers ?? 'all'), ...skillToolDefs(settings.enabledSkills ?? 'all')]
    : [];
  if (model.caps.tools && (tools.length || toolResultsRepo.has(conv.id))) tools.push(readResultTool);
  if (model.caps.tools) tools.push(delegateTool);
  tools = stableToolDefs(tools);
  const storedMessages = messagesRepo.list(conv.id, conv.activeBranch ?? []);
  const turnId = [...storedMessages].reverse().find(m => m.role === 'user' && m.content.some(b => b.type !== 'tool_result'))?.id;
  const history: LLMMessage[] = [];
  // Replay stable prefixes; batch-compact old turns only when overhead crosses the budget.
  // Shape before hydrating so cleared media is never read from disk.
  for (const m of shapeOldTurns(storedMessages, provider.type, (isOfficialDeepSeek(provider) && tools.length > 0) || responses)) {
    history.push({ role: m.role, content: await hydrateBlocks(m.content, provider.type, responses && model.caps.pdf) });
  }
  return {
    model,
    provider,
    adapter,
    responses,
    tools,
    system: buildSystemPrompt(conv, {
      hasTools: tools.length > 0,
      projectInstructions: conv.groupId ? groupsRepo.get(conv.groupId)?.instructions : undefined,
    }),
    history,
    // Effort is a conversation setting; the model only says whether it can think at all and which
    // levels it accepts. An unset conversation still gets a real level (DEFAULT_REASONING_LEVEL).
    maxTokens: settings.maxTokens ?? model.maxOutput ?? 64000,
    reasoning: resolveReasoningLevel(model, settings.reasoning),
    attribution: modelAttribution(model, provider),
    turnId,
    tipId: storedMessages.at(-1)?.id ?? null,
  };
}

/** Payload size of the request this conversation would send right now. */
export async function contextEstimateFor(conv: Conversation): Promise<ContextEstimate | null> {
  try {
    const ctx = await buildRequestContext(conv);
    return estimateContext({
      system: ctx.system,
      messages: ctx.history,
      tools: ctx.tools,
      contextWindow: ctx.model.contextWindow,
      reservedOutput: ctx.maxTokens,
    });
  } catch {
    // A missing model/provider is reported by the run itself; the meter simply shows nothing.
    return null;
  }
}

/**
 * Result of one model call. Returned rather than assigned to captured variables so the caller's
 * control-flow narrowing still works, and so a retry is a second call instead of shared state.
 */
type StreamOutcome =
  | { ok: true; usage: Usage | null; stopReason: StopReason; refusal?: { category?: string | null; explanation?: string | null } }
  | { ok: false; error: unknown; usage: Usage | null };

export async function runAgent(opts: RunOptions): Promise<void> {
  const timer = new TurnTimer();
  let lastAssistantId: string | undefined;
  const { emit, signal } = opts;
  const conv = opts.conversation;
  const ctx = await buildRequestContext(conv);
  const { adapter, model, provider, responses, tools, system, history, maxTokens, reasoning, attribution } = ctx;
  const settings = conv.settings;
  const turnId = ctx.turnId;
  // New rows continue the branch being viewed. The first reply attaches to whatever the branch ended
  // with; later replies in the same turn attach to the tool result that precedes them.
  let pendingParent: string | null = opts.branchPoint !== undefined ? opts.branchPoint : ctx.tipId;
  /**
   * One-shot sub-agent. It reuses this conversation's adapter and credentials but none of its
   * history: the whole point is a fresh context that returns only a result.
   */
  const delegateRun: DelegateRun = {
    modelId: model.modelId,
    label: attribution.label,
    async *run(delegateSystem, task, maxTokens, delegateSignal) {
      for await (const ev of adapter.stream({
        model: model.modelId, system: delegateSystem, messages: [{ role: 'user', content: [{ type: 'text', text: task }] }],
        maxTokens, temperature: settings.temperature ?? null, topP: settings.topP ?? null, stop: null,
        reasoning, adaptive: model.adaptive, reasoningMap: model.reasoningMap, signal: delegateSignal,
      })) {
        if (ev.type === 'text_delta') yield ev.text;
      }
    },
  };
  const reportContext = () => opts.onContext?.(estimateContext({
    system, messages: history, tools, contextWindow: model.contextWindow, reservedOutput: maxTokens,
  }));

  try {
    for (let iter = 0; iter < config.maxAgentIterations; iter++) {
      if (signal.aborted) return;
      const bb = new BlockBuilder();
      let assistantId = uuid();
      await emit({ event: 'message_start', data: { messageId: assistantId, role: 'assistant' } });

      /** One model call. Kept separate so an over-long request can be retried with a smaller payload. */
      const streamTurn = async (id: string): Promise<StreamOutcome> => {
        // The payload is assembled before every attempt, so the reported size matches what is sent.
        reportContext();
        timer.startCall();
        let attemptUsage: Usage | null = null;
        let attemptStop: StopReason = 'other';
        let attemptRefusal: { category?: string | null; explanation?: string | null } | undefined;
        try {
          for await (const ev of adapter.stream({ model: model.modelId, system, messages: history, tools, maxTokens, temperature: settings.temperature ?? null, topP: settings.topP ?? null, stop: settings.stop ?? null, reasoning, adaptive: model.adaptive, reasoningMap: model.reasoningMap, signal,
            onTrace: turnId ? apiTracesRepo.sink({ conversationId: conv.id, turnId, messageId: id, providerId: provider.id, providerName: provider.name, purpose: 'chat' }) : undefined,
            onDiagnostic: (record) => {
              try { requestDiagnosticsRepo.save(conv.id, id, provider.id, record); }
              catch { console.warn('Could not save local request diagnostics.'); }
            },
          })) {
            timer.observe(ev);
            switch (ev.type) {
              case 'text_delta':
                bb.text(ev.text);
                await emit({ event: 'text_delta', data: { text: ev.text } });
                break;
              case 'thinking_delta':
                bb.thinking(ev.text, ev.signature, ev.summarized);
                if (ev.text) await emit({ event: 'thinking_delta', data: { text: ev.text, ...(ev.summarized && { summarized: ev.summarized }) } });
                break;
              case 'responses_reasoning': {
                const last = bb.blocks.at(-1);
                if (last?.type === 'thinking' && !last.responsesReasoning) Object.assign(last, { responsesReasoning: ev.item, summarized: true });
                else bb.blocks.push({ type: 'thinking', thinking: '', summarized: true, responsesReasoning: ev.item });
                break;
              }
              case 'thinking_reclassify':
                bb.reclassifyTextAsThinking();
                await emit({ event: 'thinking_reclassify', data: {} });
                break;
              case 'tool_call_start':
                bb.toolStart(ev.id, ev.name);
                await emit({ event: 'tool_call_start', data: { id: ev.id, name: ev.name } });
                break;
              case 'tool_call_delta':
                break;
              case 'tool_call_end':
                bb.toolEnd(ev.id, ev.input);
                await emit({ event: 'tool_call', data: { id: ev.id, name: bb.toolName(ev.id), input: ev.input } });
                break;
              case 'usage':
                attemptUsage = ev.usage;
                await emit({ event: 'usage', data: ev.usage });
                break;
              case 'done':
                attemptStop = ev.stopReason;
                attemptRefusal = ev.refusal;
                break;
            }
          }
          timer.finishCall(attemptUsage);
          return { ok: true, usage: attemptUsage, stopReason: attemptStop, refusal: attemptRefusal };
        } catch (e) {
          timer.finishCall(attemptUsage);
          return { ok: false, error: e, usage: attemptUsage };
        }
      };

      let attempt = await streamTurn(assistantId);
      // An over-long history is the one failure the server can repair on its own: squeeze the old
      // tool results and thinking, then try once more with a fresh message id so the retry is a
      // separate record in the request log rather than an overwrite.
      if (!attempt.ok && !signal.aborted && isContextOverflowError(errorToPayload(attempt.error).message)) {
        const squeezed = shapeTurnsForOverflow(history);
        const before = history.reduce((n, m) => n + JSON.stringify(m.content).length, 0);
        const after = squeezed.reduce((n, m) => n + JSON.stringify(m.content).length, 0);
        if (after < before) {
          history.length = 0;
          history.push(...squeezed);
          assistantId = uuid();
          await emit({ event: 'message_start', data: { messageId: assistantId, role: 'assistant' } });
          attempt = await streamTurn(assistantId);
          if (!attempt.ok) {
            await emit({ event: 'error', data: { code: 'context_overflow', message: `${errorToPayload(attempt.error).message}\n\n已清理旧工具结果与思考后重试一次仍超出上限，请新建会话或减少附件。` } });
          }
        }
      }

      if (!attempt.ok) {
        const aborted = signal.aborted;
        const payload = errorToPayload(attempt.error);
        // Preserve failed attempts even when the provider returned no content.
        const failed = messagesRepo.create({ conversationId: conv.id, role: 'assistant', content: bb.blocks, parentId: pendingParent, usage: attempt.usage, timing: timer.snapshot(), model: attribution, stopReason: aborted ? 'interrupted' : 'error', id: assistantId });
        lastAssistantId = assistantId;
        await emit({ event: 'message_end', data: { messageId: assistantId, stopReason: failed.stopReason ?? 'error', message: failed } });
        if (!aborted) {
          // The squeeze path already emitted its own, more specific error.
          if (payload.code !== 'context_overflow') await emit({ event: 'error', data: { code: payload.code, message: payload.message } });
        }
        return;
      }

      let stopReason = attempt.stopReason;
      const refusal = attempt.refusal;
      if (signal.aborted) stopReason = 'interrupted';
      if (stopReason === 'refusal' && refusal) {
        bb.text(`\n\n> Request declined by the model's safety system${refusal.category ? ` (${refusal.category})` : ''}${refusal.explanation ? `: ${refusal.explanation}` : '.'}`);
      }
      const toolUses = bb.toolUses();
      if (toolUses.length && stopReason !== 'interrupted' && !responses) stopReason = 'tool_use';
      const saved = messagesRepo.create({ conversationId: conv.id, role: 'assistant', content: bb.blocks, parentId: pendingParent, usage: attempt.usage, timing: timer.snapshot(), model: attribution, stopReason, id: assistantId });
      lastAssistantId = assistantId;
      conversationsRepo.touch(conv.id);
      await emit({ event: 'message_end', data: { messageId: assistantId, stopReason, message: saved } });
      history.push({ role: 'assistant', content: bb.blocks });

      if (stopReason !== 'tool_use' || !toolUses.length) return;

      // Execute all tool calls in parallel, collect results into ONE user message.
      const outcomes = await Promise.all(
        toolUses.map(async (t) => {
          const started = Date.now();
          const r = await executeTool(t.name, t.input, { conversationId: conv.id, signal, emit, delegate: delegateRun });
          const durationMs = Date.now() - started;
          return { t, r, durationMs };
        }),
      );
      const budgets = allocateToolResultBudgets(outcomes.map(({ r }) => resultTextChars(r.content)));
      const results: Extract<Block, { type: 'tool_result' }>[] = [];
      for (const [i, { t, r, durationMs }] of outcomes.entries()) {
        // Reader pages keep the original resource and pagination, never create nested previews.
        let content: Block[];
        let resultId: string | undefined;
        if (t.name === READ_RESULT_TOOL && !r.isError) {
          content = resultTextChars(r.content) <= budgets[i]! ? r.content : readToolResult(conv.id, t.input, budgets[i]).content;
        } else {
          ({ content, resultId } = prepareToolResult(conv.id, t.name, r.content, budgets[i]));
        }
        results.push({ type: 'tool_result', tool_use_id: t.id, content, is_error: r.isError, durationMs, resultId });
        await emit({ event: 'tool_result', data: { toolUseId: t.id, content, isError: r.isError, durationMs } });
      }
      const resultMsg = messagesRepo.create({ conversationId: conv.id, role: 'user', content: results, parentId: assistantId });
      await emit({ event: 'message_start', data: { messageId: resultMsg.id, role: 'user' } });
      await emit({ event: 'message_end', data: { messageId: resultMsg.id, stopReason: 'end_turn', message: resultMsg } });
      history.push({ role: 'user', content: await hydrateBlocks(results, provider.type, responses && model.caps.pdf) });
      pendingParent = resultMsg.id;
      if (signal.aborted) return;
    }
    await emit({ event: 'error', data: { code: 'max_iterations', message: `Stopped after ${config.maxAgentIterations} tool iterations.` } });
  } finally {
    // Include tool execution/approval even when stopped before the next model call.
    if (lastAssistantId) {
      const timing = timer.snapshot();
      messagesRepo.update(lastAssistantId, { timing });
      await emit({ event: 'timing', data: { messageId: lastAssistantId, timing } });
    }
  }
}

export function fallbackTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 30 ? `${t.slice(0, 30)}…` : t || 'New chat';
}

export type { Message };
