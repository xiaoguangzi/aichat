import { messagesRepo } from '../db/repos/messages.js';

/**
 * Path to view when the user picks one variant: walk up to the root, then keep going down through
 * the newest child at each step so the rest of the conversation stays readable. Storing the whole
 * path (rather than just the picked id) is what lets one message id describe an entire view, and
 * keeps the walk in the read path a simple array lookup.
 */
export function branchPathFor(conversationId: string, messageId: string, role?: 'user' | 'assistant'): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  const target = role ? samePosition(messageId, role) : null;
  let current = messagesRepo.get(target ?? messageId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.id);
    current = current.parentId ? messagesRepo.get(current.parentId) : null;
  }
  if (!path.length) return [];
  let leaf = messagesRepo.get(path[path.length - 1]!);
  while (leaf) {
    const next = messagesRepo.childrenOf(conversationId, leaf.id).at(-1);
    if (!next) break;
    path.push(next.id);
    leaf = next;
  }
  return path;
}

/**
 * The row occupying the same position as `messageId` but with the wanted role. A caller that only
 * has the row it was showing when the request started (the newest row of the old tree) resolves to
 * the row it actually meant: the flipped question or the flipped answer.
 */
function samePosition(messageId: string, role: 'user' | 'assistant'): string | null {
  const source = messagesRepo.get(messageId);
  if (!source) return null;
  if (source.role === role) return source.id;
  const sibling = messagesRepo.childrenOf(source.conversationId, source.parentId ?? null).find((m) => m.role === role);
  return sibling?.id ?? null;
}

/**
 * Attach the sibling position to the few visible messages that have one. Stored rows stay
 * untouched, so a variant switch is a pure view change and the message tree never leaves the server.
 */
export function visibleMessages(conversationId: string, activeBranch: string[] = []) {
  const variants = messagesRepo.variants(conversationId);
  return messagesRepo.list(conversationId, activeBranch).map((m) => (variants[m.id] ? { ...m, variants: variants[m.id]! } : m));
}

/** Messages the conversation is currently showing. */
export function showCurrent(conv: { id: string; activeBranch?: string[] }) {
  return visibleMessages(conv.id, conv.activeBranch ?? []);
}
