import type { ChatApproval, ChatRunSnapshot, ChatSSEEvent, ContextEstimate, Conversation, Message, ToolResultBlock } from '@aichat/shared';
import { conversationsRepo } from '../db/repos/conversations.js';
import { messagesRepo } from '../db/repos/messages.js';
import { errorToPayload, notFound } from '../util/errors.js';
import { BlockBuilder, fallbackTitle, runAgent } from './loop.js';
import { generateTitle } from './title.js';
import { routeConversation } from '../decisions/routing.js';
import { autoPruneTraces } from '../db/maintenance.js';
import { branchPathFor } from './branches.js';

// Only live jobs are kept in memory. Completed replies are read from SQLite.
export const activeRuns = new Map<string, BackgroundRun>();

export function idleSnapshot(id: string, context: ContextEstimate | null = null): ChatRunSnapshot {
  const conversation = conversationsRepo.get(id);
  if (!conversation) throw notFound('conversation');
  // Only the branch being viewed: alternates stay in the database until the user switches to them.
  return { conversation, messages: messagesRepo.list(id, conversation.activeBranch ?? []), streaming: null, pendingResults: {}, approval: null, running: false, error: null, context };
}

export class BackgroundRun {
  readonly abort = new AbortController();
  readonly task: Promise<void>;
  private running = true;
  private streaming: Message | null = null;
  private blocks = new BlockBuilder();
  private pendingResults: Record<string, ToolResultBlock> = {};
  private approvals = new Map<string, ChatApproval>();
  private error: string | null = null;
  /** Payload size of the request this run sent; null until the first call is assembled. */
  private context: ContextEstimate | null = null;
  private listeners = new Set<(event: ChatSSEEvent) => void>();

  /**
   * `branchPoint` overrides where the new reply attaches. Regenerating passes the question so the
   * reply becomes a sibling of the answer it replaces, instead of nesting under it.
   */
  constructor(
    public conversation: Conversation, userText: string, isFirst: boolean,
    /** Row the conversation should be showing once the run finishes; null when it is not moving. */
    readonly branchPoint?: string | null,
    /** Where the new reply attaches; undefined keeps the tip of the visible branch. */
    readonly attachTo?: string | null,
  ) {
    activeRuns.set(conversation.id, this);
    this.task = this.execute(userText, isFirst);
  }

  snapshot(): ChatRunSnapshot {
    return structuredClone({
      ...idleSnapshot(this.conversation.id), streaming: this.streaming,
      pendingResults: this.pendingResults, approval: this.approvals.values().next().value ?? null,
      running: this.running, error: this.error, context: this.context,
    });
  }

  subscribe(listener: (event: ChatSSEEvent) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  resolveApproval(id: string) {
    if (!this.approvals.delete(id)) return;
    this.emit({ event: 'approval_state', data: { approval: this.approvals.values().next().value ?? null } });
  }

  private emit = (event: ChatSSEEvent): void => {
    switch (event.event) {
      case 'message_start':
        this.blocks = new BlockBuilder();
        this.streaming = { id: event.data.messageId, conversationId: this.conversation.id, seq: 0, role: event.data.role, content: [], createdAt: new Date().toISOString() };
        break;
      case 'text_delta': this.blocks.text(event.data.text); break;
      case 'thinking_delta': this.blocks.thinking(event.data.text, undefined, event.data.summarized); break;
      case 'thinking_reclassify': this.blocks.reclassifyTextAsThinking(); break;
      case 'tool_call_start': this.blocks.toolStart(event.data.id, event.data.name); break;
      case 'tool_call': this.blocks.toolEnd(event.data.id, event.data.input); break;
      case 'usage': if (this.streaming) this.streaming.usage = event.data; break;
      case 'message_end': this.streaming = null; break;
      case 'tool_result':
        this.pendingResults[event.data.toolUseId] = { type: 'tool_result', tool_use_id: event.data.toolUseId, content: event.data.content, is_error: event.data.isError, durationMs: event.data.durationMs };
        break;
      case 'approval_required': this.approvals.set(event.data.requestId, event.data); break;
      case 'error': this.error = event.data.message; break;
      case 'done': this.running = false; this.streaming = null; this.approvals.clear(); break;
    }
    if (this.streaming) this.streaming.content = this.blocks.blocks;
    // Listeners only enqueue; generation never awaits a browser's network writes.
    for (const listener of this.listeners) listener(event);
  };

  private async execute(userText: string, isFirst: boolean) {
    let assistantText = '';
    try {
      // Retention is enforced here rather than on a timer: a chat run is the only thing that grows
      // the request log, and a password-free local server has no better lifecycle hook.
      autoPruneTraces(activeRuns.keys());
      this.conversation = await routeConversation(this.conversation, this.abort.signal, conversation => {
        this.conversation = conversation;
        this.emit({ event: 'routing', data: { conversation } });
      });
      this.abort.signal.throwIfAborted();
      await runAgent({
        conversation: this.conversation, signal: this.abort.signal,
        branchPoint: this.attachTo,
        onContext: (estimate) => { this.context = estimate; },
        emit: (event) => {
          if (event.event === 'text_delta') assistantText += event.data.text;
          if (event.event === 'thinking_reclassify') assistantText = '';
          this.emit(event);
        },
      });
      // Record the view only after the reply exists: the path is derived from the message tree, so
      // computing it earlier would pin the previous variant instead of the answer just produced.
      if (this.branchPoint) {
        const updated = conversationsRepo.setActiveBranch(this.conversation.id, branchPathFor(this.conversation.id, this.branchPoint, 'user'));
        if (updated) {
          this.conversation = updated;
          this.emit({ event: 'routing', data: { conversation: updated } });
        }
      }
      if (isFirst && !this.conversation.title && !this.error && !this.abort.signal.aborted) {
        const title = (await generateTitle(this.conversation, userText, assistantText, this.abort.signal)) ?? fallbackTitle(userText);
        conversationsRepo.update(this.conversation.id, { title });
        this.emit({ event: 'title', data: { conversationId: this.conversation.id, title } });
      }
    } catch (e) {
      const { code, message } = errorToPayload(e);
      this.emit({ event: 'error', data: { code, message } });
    } finally {
      this.emit({ event: 'done', data: {} });
      if (activeRuns.get(this.conversation.id) === this) activeRuns.delete(this.conversation.id);
      this.listeners.clear();
    }
  }
}

export async function stopAllRuns() {
  const runs = [...activeRuns.values()];
  for (const run of runs) run.abort.abort();
  await Promise.allSettled(runs.map((run) => run.task));
}
