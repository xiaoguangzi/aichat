import type { ApprovalRule, ChatSSEEvent } from '@aichat/shared';
import { shortId } from '../util/id.js';
import { settingsRepo } from '../db/repos/settings.js';

interface Pending {
  resolve: (ok: boolean) => void;
  conversationId: string;
  tool: string;
}

const pending = new Map<string, Pending>();

/**
 * Remembered approvals, keyed by tool name. A rule says "this exact tool does not need to ask
 * again", and applies to both answers: being asked about the same script twice is just as annoying
 * when the answer is no, and the list is visible and removable in settings, so nothing becomes
 * silently unreachable.
 *
 * Keyed by the whole tool name rather than by an argument pattern on purpose: a pattern would have
 * to be re-validated against every call, and getting that subtly wrong means a script runs
 * unattended under arguments the user never saw.
 */
const RULES_KEY = 'tool.approvalRules';

export function readApprovalRules(): ApprovalRule[] {
  const raw = settingsRepo.get<ApprovalRule[] | null>(RULES_KEY, null);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((rule): rule is ApprovalRule => !!rule && typeof rule?.tool === 'string' && rule.tool.length > 0)
    .map((rule) => ({
      tool: rule.tool,
      decidedAt: typeof rule.decidedAt === 'string' ? rule.decidedAt : new Date().toISOString(),
      // Carried through explicitly: dropping `allow` here would silently turn a remembered denial
      // into an allow, which is the one mistake this mechanism must never make.
      allow: rule.allow !== false,
    }));
}

export function isRemembered(tool: string): boolean {
  return readApprovalRules().some((rule) => rule.tool === tool);
}

export function rememberApproval(tool: string, allow: boolean): void {
  const rules = readApprovalRules().filter((rule) => rule.tool !== tool);
  rules.push({ tool, decidedAt: new Date().toISOString(), allow });
  settingsRepo.set(RULES_KEY, rules);
}

export function forgetApproval(tool: string): void {
  settingsRepo.set(RULES_KEY, readApprovalRules().filter((rule) => rule.tool !== tool));
}

/**
 * Ask the user, unless this tool's answer was already remembered. Resolves to the decision; the
 * caller reports the outcome so a remembered answer can be recorded.
 */
export async function requestApproval(
  ctx: {
    conversationId: string; tool: string; input: unknown; signal: AbortSignal;
    emit: (ev: ChatSSEEvent) => void | Promise<void>;
    /** Distinct from `tool` when one tool serves several targets (which skill script). */
    ruleKey?: string;
  },
): Promise<{ allowed: boolean; remembered: boolean }> {
  const rule = readApprovalRules().find((r) => r.tool === ctx.tool);
  // A remembered denial is honoured without asking, which is the point: the model keeps proposing
  // the same script and the user keeps saying no.
  if (rule) return { allowed: rule.allow !== false, remembered: true };

  const { id, promise } = createApproval(ctx.conversationId, ctx.ruleKey ?? ctx.tool, ctx.signal);
  await ctx.emit({ event: 'approval_required', data: { requestId: id, tool: ctx.tool, ruleKey: ctx.ruleKey ?? ctx.tool, input: ctx.input } });
  const allowed = await promise;
  return { allowed, remembered: false };
}

/** Which tool a pending request belongs to, so a remembered answer can be attributed. */
export function pendingToolOf(id: string): string | null {
  return pending.get(id)?.tool ?? null;
}

export function createApproval(conversationId: string, tool: string, signal?: AbortSignal): { id: string; promise: Promise<boolean> } {
  const id = shortId('apr_');
  const promise = new Promise<boolean>((resolve) => {
    pending.set(id, { resolve, conversationId, tool });
    signal?.addEventListener(
      'abort',
      () => {
        if (pending.delete(id)) resolve(false);
      },
      { once: true },
    );
  });
  return { id, promise };
}

export function resolveApproval(id: string, ok: boolean): boolean {
  const p = pending.get(id);
  if (!p) return false;
  pending.delete(id);
  p.resolve(ok);
  return true;
}
