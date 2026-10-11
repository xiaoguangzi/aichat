import type { Block, ToolDef } from '@aichat/shared';

export const DELEGATE_TOOL = 'context__delegate';

/**
 * A one-shot sub-agent: the model hands over a self-contained task and gets back a single answer,
 * produced in a context that does not contain this conversation.
 *
 * Deliberately weaker than the main loop — no tools, one model call, a smaller output budget — so a
 * delegation cannot recursively fan out, cannot run scripts, and cannot quietly cost more than the
 * turn that asked for it. Its value is context isolation: reading a long document, comparing several
 * options, or producing a compact summary without pulling the source material permanently into this
 * conversation's history.
 */
export const delegateTool: ToolDef = {
  name: DELEGATE_TOOL,
  description:
    'Run a self-contained task in a separate fresh context and get back only the result. Use it to digest long material, compare options, or draft something without keeping the working notes in this conversation. The sub-agent cannot use tools or ask follow-up questions, so include everything it needs in the prompt. Phrase the task so that the reply alone is useful.',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'The complete instruction for the sub-agent, including any material it must read.' },
      max_tokens: { type: 'number', description: 'Optional output cap for the answer. Defaults to 2000.' },
    },
    required: ['task'],
  },
};

export interface DelegateRun {
  /** Streams the sub-agent's answer; the caller decides how much of it to keep. */
  run(system: string, task: string, maxTokens: number, signal: AbortSignal): AsyncIterable<string>;
  modelId: string;
  /** Name shown in the tool card, so the user can see which model did the work. */
  label: string;
}

const DEFAULT_MAX_TOKENS = 2_000;
const HARD_MAX_TOKENS = 16_000;

export async function runDelegate(input: unknown, delegate: DelegateRun, signal: AbortSignal): Promise<{ content: Block[]; isError: boolean }> {
  const task = String((input as { task?: unknown })?.task ?? '').trim();
  if (!task) return { content: [{ type: 'text', text: 'delegate needs a non-empty task.' }], isError: true };
  const requested = Number((input as { max_tokens?: unknown })?.max_tokens ?? DEFAULT_MAX_TOKENS);
  const maxTokens = Number.isFinite(requested) && requested > 0 ? Math.min(HARD_MAX_TOKENS, Math.floor(requested)) : DEFAULT_MAX_TOKENS;

  let text = '';
  try {
    for await (const chunk of delegate.run(
      'You are a focused sub-agent. Complete the task you are given and reply with the result only. You have no tools and cannot ask questions; if something is missing, state the assumption you made.',
      task, maxTokens, signal,
    )) {
      text += chunk;
      if (signal.aborted) break;
    }
  } catch (e) {
    return { content: [{ type: 'text', text: `Sub-agent failed (${delegate.label}): ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
  if (signal.aborted) return { content: [{ type: 'text', text: 'Sub-agent cancelled.' }], isError: true };
  if (!text.trim()) return { content: [{ type: 'text', text: `Sub-agent (${delegate.label}) returned no text.` }], isError: true };
  // The label is part of the result: which model produced a delegated answer is exactly the kind of
  // thing that is impossible to reconstruct later.
  return { content: [{ type: 'text', text: `[${delegate.label}]\n\n${text}` }], isError: false };
}
