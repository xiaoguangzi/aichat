import type { StreamEvent } from '@aichat/shared';

interface Partial {
  id: string;
  name: string;
  args: string;
  started: boolean;
}

/**
 * Accumulates OpenAI streaming `delta.tool_calls` fragments (keyed by index) and emits
 * unified tool_call_start / tool_call_delta / tool_call_end events.
 */
export class ToolCallAccumulator {
  private calls = new Map<number, Partial>();
  private counter = 0;

  push(
    fragments:
      | Array<{ index?: number; id?: string | null; function?: { name?: string | null; arguments?: string | null } | null }>
      | undefined
      | null,
  ): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (!fragments) return events;
    for (const f of fragments) {
      const idx = f.index ?? 0;
      let p = this.calls.get(idx);
      if (!p) {
        // The current fragment is applied below, including its name, exactly once.
        p = { id: f.id ?? '', name: '', args: '', started: false };
        this.calls.set(idx, p);
      }
      if (f.id) p.id = f.id;
      if (f.function?.name) p.name += f.function.name;
      if (!p.started && p.name) {
        if (!p.id) p.id = `call_${Date.now().toString(36)}_${this.counter++}`;
        p.started = true;
        events.push({ type: 'tool_call_start', id: p.id, name: p.name });
      }
      if (f.function?.arguments) {
        p.args += f.function.arguments;
        if (p.started) events.push({ type: 'tool_call_delta', id: p.id, argsDelta: f.function.arguments });
      }
    }
    return events;
  }

  finish(): StreamEvent[] {
    const events: StreamEvent[] = [];
    const sorted = [...this.calls.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, p] of sorted) {
      if (!p.started) {
        if (!p.id) p.id = `call_${Date.now().toString(36)}_${this.counter++}`;
        events.push({ type: 'tool_call_start', id: p.id, name: p.name || 'unknown' });
      }
      let input: unknown = {};
      try {
        input = p.args.trim() ? JSON.parse(p.args) : {};
      } catch {
        input = { _raw: p.args };
      }
      events.push({ type: 'tool_call_end', id: p.id, input });
    }
    this.calls.clear();
    return events;
  }

  get size() {
    return this.calls.size;
  }
}
