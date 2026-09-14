import type { StreamEvent, TurnTiming, Usage } from '@aichat/shared';

/** Monotonic clock: wall-clock corrections must not change generation metrics. */
export class TurnTimer {
  private started: number;
  private firstOutput?: number;
  private callFirstOutput?: number;
  private generationMs = 0;
  private outputTokens = 0;
  private outputComplete = true;

  constructor(private clock = () => performance.now()) {
    this.started = clock();
  }

  startCall() { this.callFirstOutput = undefined; }

  observe(event: StreamEvent) {
    const output = ((event.type === 'text_delta' || event.type === 'thinking_delta') && event.text.length > 0)
      || event.type === 'tool_call_start'
      || (event.type === 'tool_call_delta' && event.argsDelta.length > 0);
    if (!output || this.callFirstOutput !== undefined) return;
    this.callFirstOutput = this.clock();
    this.firstOutput ??= this.callFirstOutput;
  }

  finishCall(usage: Usage | null) {
    if (this.callFirstOutput !== undefined) this.generationMs += this.clock() - this.callFirstOutput;
    this.outputTokens += usage?.output ?? 0;
    this.outputComplete &&= usage != null && usage.usageComplete !== false
      && (usage.output === 0 || this.callFirstOutput !== undefined);
    this.callFirstOutput = undefined;
  }

  snapshot(): TurnTiming {
    return {
      firstTokenMs: this.firstOutput === undefined ? undefined : this.firstOutput - this.started,
      totalMs: this.clock() - this.started,
      generationMs: this.generationMs,
      outputTokens: this.outputTokens,
      outputComplete: this.outputComplete,
    };
  }
}
