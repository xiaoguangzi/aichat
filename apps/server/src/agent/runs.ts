import type { ChatApproval, ChatRunSnapshot, ChatSSEEvent, Conversation, Message, ToolResultBlock } from '@aichat/shared';
import { conversationsRepo } from '../db/repos/conversations.js';
import { messagesRepo } from '../db/repos/messages.js';
import { errorToPayload, notFound } from '../util/errors.js';
import { BlockBuilder, fallbackTitle, runAgent } from './loop.js';
import { generateTitle } from './title.js';

// Only live jobs are kept in memory. Completed replies are read from SQLite.
export const activeRuns = new Map<string, BackgroundRun>();

export function idleSnapshot(id: string): ChatRunSnapshot {
  const conversation = conversationsRepo.get(id);
  if (!conversation) throw notFound('conversation');
  return { conversation, messages: messagesRepo.list(id), streaming: null, pendingResults: {}, approval: null, running: false, error: null };
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
  private listeners = new Set<(event: ChatSSEEvent) => void>();

  constructor(readonly conversation: Conversation, userText: string, isFirst: boolean) {
    activeRuns.set(conversation.id, this);
    this.task = this.execute(userText, isFirst);
  }

  snapshot(): ChatRunSnapshot {
    return structuredClone({
      ...idleSnapshot(this.conversation.id), streaming: this.streaming,
      pendingResults: this.pendingResults, approval: this.approvals.values().next().value ?? null,
      running: this.running, error: this.error,
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
      case 'thinking_delta': this.blocks.thinking(event.data.text); break;
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
      await runAgent({
        conversation: this.conversation, signal: this.abort.signal,
        emit: (event) => {
          if (event.event === 'text_delta') assistantText += event.data.text;
          if (event.event === 'thinking_reclassify') assistantText = '';
          this.emit(event);
        },
      });
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
