import { shortId } from '../util/id.js';

interface Pending {
  resolve: (ok: boolean) => void;
  conversationId: string;
  tool: string;
}

const pending = new Map<string, Pending>();

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
