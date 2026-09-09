import type { Block, ChatSSEEvent, Conversation, Message, StopReason, Usage } from '@aichat/shared';
import { resolveReasoningLevel } from '@aichat/shared';
import { conversationsRepo } from '../db/repos/conversations.js';
import { messagesRepo } from '../db/repos/messages.js';
import { modelsRepo, providersRepo } from '../db/repos/providers.js';
import { getAdapter } from '../llm/registry.js';
import type { LLMMessage } from '../llm/types.js';
import { mcpManager } from '../mcp/manager.js';
import { skillToolDefs } from '../skills/tools.js';
import { hydrateBlocks } from '../util/attachments.js';
import { AppError, errorToPayload } from '../util/errors.js';
import { uuid } from '../util/id.js';
import { config } from '../config.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { shapeOldTurns } from './history.js';
import { executeTool } from './toolRouter.js';
import { toolResultsRepo } from '../db/repos/toolResults.js';
import { stableToolDefs } from '../llm/tools.js';
import { requestDiagnosticsRepo } from '../db/repos/requestDiagnostics.js';
import { allocateToolResultBudgets, prepareToolResult, readResultTool, READ_RESULT_TOOL, readToolResult, resultTextChars } from './toolResults.js';

export interface RunOptions {
  conversation: Conversation;
  emit: (ev: ChatSSEEvent) => void | Promise<void>;
  signal: AbortSignal;
}

function resolveModel(conv: Conversation) {
  const model = (conv.modelId && modelsRepo.get(conv.modelId)) || modelsRepo.getDefault();
  if (!model) throw new AppError('no_model', 'No model configured. Add a provider and model in Settings.', 400);
  const provider = providersRepo.get(model.providerId);
  if (!provider) throw new AppError('no_provider', 'Provider for the selected model no longer exists.', 400);
  return { model, provider };
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
  thinking(t: string, signature?: string) {
    const last = this.blocks[this.blocks.length - 1];
    if (last && last.type === 'thinking') {
      last.thinking += t;
      if (signature) last.signature = signature;
    } else if (t || signature) {
      // signature for an already-closed thinking block: attach to the most recent one
      const prev = [...this.blocks].reverse().find((b) => b.type === 'thinking');
      if (!t && signature && prev && prev.type === 'thinking') prev.signature = signature;
      else this.blocks.push({ type: 'thinking', thinking: t, signature });
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

export async function runAgent(opts: RunOptions): Promise<void> {
  const { emit, signal } = opts;
  const conv = opts.conversation;
  const { model, provider } = resolveModel(conv);
  const adapter = getAdapter(provider);
  const settings = conv.settings;

  let tools = model.caps.tools
    ? [...mcpManager.toolDefs(settings.enabledMcpServers ?? 'all'), ...skillToolDefs(settings.enabledSkills ?? 'all')]
    : [];
  if (model.caps.tools && (tools.length || toolResultsRepo.has(conv.id))) tools.push(readResultTool);
  tools = stableToolDefs(tools);
  const system = buildSystemPrompt(conv, { hasTools: tools.length > 0 });
  // Effort is a conversation setting; the model only says whether it can think at all and which
  // levels it accepts. An unset conversation still gets a real level (DEFAULT_REASONING_LEVEL).
  const reasoning = resolveReasoningLevel(model, settings.reasoning);
  const maxTokens = settings.maxTokens ?? model.maxOutput ?? 64000;

  const history: LLMMessage[] = [];
  // Replay stable prefixes; batch-compact old turns only when overhead crosses the budget.
  // Shape before hydrating so cleared media is never read from disk.
  for (const m of shapeOldTurns(messagesRepo.list(conv.id), provider.type)) {
    history.push({ role: m.role, content: await hydrateBlocks(m.content, provider.type) });
  }

  for (let iter = 0; iter < config.maxAgentIterations; iter++) {
    if (signal.aborted) return;
    const assistantId = uuid();
    const bb = new BlockBuilder();
    let usage: Usage | null = null;
    let stopReason: StopReason = 'other';
    let refusal: { category?: string | null; explanation?: string | null } | undefined;
    await emit({ event: 'message_start', data: { messageId: assistantId, role: 'assistant' } });

    try {
      for await (const ev of adapter.stream({ model: model.modelId, system, messages: history, tools, maxTokens, temperature: settings.temperature ?? null, reasoning, adaptive: model.adaptive, reasoningMap: model.reasoningMap, signal,
        onDiagnostic: (record) => {
          try { requestDiagnosticsRepo.save(conv.id, assistantId, provider.id, record); }
          catch { console.warn('Could not save local request diagnostics.'); }
        },
      })) {
        switch (ev.type) {
          case 'text_delta':
            bb.text(ev.text);
            await emit({ event: 'text_delta', data: { text: ev.text } });
            break;
          case 'thinking_delta':
            bb.thinking(ev.text, ev.signature);
            if (ev.text) await emit({ event: 'thinking_delta', data: { text: ev.text } });
            break;
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
            usage = ev.usage;
            await emit({ event: 'usage', data: ev.usage });
            break;
          case 'done':
            stopReason = ev.stopReason;
            refusal = ev.refusal;
            break;
        }
      }
    } catch (e) {
      const aborted = signal.aborted;
      const payload = errorToPayload(e);
      if (bb.hasContent() || aborted) {
        const saved = messagesRepo.create({ conversationId: conv.id, role: 'assistant', content: bb.blocks, usage, stopReason: aborted ? 'interrupted' : 'error', id: assistantId });
        await emit({ event: 'message_end', data: { messageId: assistantId, stopReason: saved.stopReason ?? 'error', message: saved } });
      }
      if (!aborted) await emit({ event: 'error', data: { code: payload.code, message: payload.message } });
      return;
    }

    if (signal.aborted) stopReason = 'interrupted';
    if (stopReason === 'refusal' && refusal) {
      bb.text(`\n\n> Request declined by the model's safety system${refusal.category ? ` (${refusal.category})` : ''}${refusal.explanation ? `: ${refusal.explanation}` : '.'}`);
    }
    const toolUses = bb.toolUses();
    if (toolUses.length && stopReason !== 'interrupted') stopReason = 'tool_use';
    const saved = messagesRepo.create({ conversationId: conv.id, role: 'assistant', content: bb.blocks, usage, stopReason, id: assistantId });
    conversationsRepo.touch(conv.id);
    await emit({ event: 'message_end', data: { messageId: assistantId, stopReason, message: saved } });
    history.push({ role: 'assistant', content: bb.blocks });

    if (stopReason !== 'tool_use' || !toolUses.length) return;

    // Execute all tool calls in parallel, collect results into ONE user message.
    const outcomes = await Promise.all(
      toolUses.map(async (t) => {
        const started = Date.now();
        const r = await executeTool(t.name, t.input, { conversationId: conv.id, signal, emit });
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
    const resultMsg = messagesRepo.create({ conversationId: conv.id, role: 'user', content: results });
    await emit({ event: 'message_start', data: { messageId: resultMsg.id, role: 'user' } });
    await emit({ event: 'message_end', data: { messageId: resultMsg.id, stopReason: 'end_turn', message: resultMsg } });
    history.push({ role: 'user', content: await hydrateBlocks(results, provider.type) });
    if (signal.aborted) return;
  }
  await emit({ event: 'error', data: { code: 'max_iterations', message: `Stopped after ${config.maxAgentIterations} tool iterations.` } });
}

export function fallbackTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 30 ? `${t.slice(0, 30)}…` : t || 'New chat';
}

export type { Message };
