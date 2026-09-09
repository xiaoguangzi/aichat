import type { Block, ReasoningLevel, ReasoningMap, StreamEvent, ToolDef } from '@aichat/shared';
import type { RequestDiagnostic } from './diagnostics.js';

/** Provider-agnostic message shape sent to adapters (no ids / persistence fields). */
export interface LLMMessage {
  role: 'user' | 'assistant';
  content: Block[];
}

export interface LLMRequest {
  onDiagnostic?: (record: RequestDiagnostic) => void;
  model: string;
  system?: string;
  messages: LLMMessage[];
  tools?: ToolDef[];
  maxTokens: number;
  temperature?: number | null;
  /**
   * Unified reasoning dial; each adapter translates it for its protocol/dialect. Always a
   * concrete level — resolveReasoningLevel() picks it, and 'off' is what a model that cannot
   * think gets.
   */
  reasoning: ReasoningLevel;
  /** Anthropic protocol: thinking:{type:"adaptive"} (true) vs thinking:{type:"enabled"} (false). */
  adaptive?: boolean;
  /** Per-model level → endpoint literal overrides; null marks a level as unsupported. */
  reasoningMap?: ReasoningMap | null;
  signal?: AbortSignal;
}

export interface LLMModelInfo {
  id: string;
  displayName?: string;
}

export interface LLMAdapter {
  readonly type: 'openai' | 'anthropic';
  stream(req: LLMRequest): AsyncIterable<StreamEvent>;
  listModels(): Promise<LLMModelInfo[]>;
}
