// ---------- Canonical message format (provider-agnostic) ----------

export type TextBlock = { type: 'text'; text: string };
export type ThinkingBlock = { type: 'thinking'; thinking: string; signature?: string };
/** Image stored either inline (base64) or as a reference to an uploaded attachment. */
export type ImageBlock = {
  type: 'image';
  mime: string;
  data?: string; // base64
  attachmentId?: string;
};
export type DocumentBlock = {
  type: 'document';
  mime: string;
  name: string;
  data?: string; // base64
  attachmentId?: string;
};
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
export type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: Block[];
  is_error?: boolean;
  durationMs?: number;
  /** Local original; adapters omit this metadata until history compaction exposes a reader reference. */
  resultId?: string;
};

export type Block = TextBlock | ThinkingBlock | ImageBlock | DocumentBlock | ToolUseBlock | ToolResultBlock;

export type Role = 'user' | 'assistant';

export interface Message {
  id: string;
  conversationId: string;
  seq: number;
  role: Role;
  content: Block[];
  usage?: Usage | null;
  stopReason?: StopReason | null;
  createdAt: string;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'interrupted' | 'error' | 'other';

export interface Usage {
  /** New responses use total input, including cache reads/writes. Legacy records may use provider-specific input. */
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  inputUncached?: number;
  /** False means input is a lower bound because the provider omitted cache counters. */
  inputTotalKnown?: boolean;
  /** Aggregates include known counts without treating missing requests as zero. */
  cacheReadComplete?: boolean;
  cacheWriteComplete?: boolean;
  usageComplete?: boolean;
}

// ---------- Unified stream events (adapter -> agent loop) ----------

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string; signature?: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; argsDelta: string }
  | { type: 'tool_call_end'; id: string; input: unknown }
  | { type: 'usage'; usage: Usage }
  /** the text streamed so far was reasoning the model leaked into content (see llm/thinkTags) */
  | { type: 'thinking_reclassify' }
  | { type: 'done'; stopReason: StopReason; refusal?: { category?: string | null; explanation?: string | null } };

// ---------- Server -> browser SSE events ----------

export interface ChatApproval {
  requestId: string;
  tool: string;
  input: unknown;
}

export interface ChatRunSnapshot {
  conversation: Conversation;
  messages: Message[];
  streaming: Message | null;
  pendingResults: Record<string, ToolResultBlock>;
  approval: ChatApproval | null;
  running: boolean;
  error: string | null;
}

export type ChatSSEEvent =
  | { event: 'snapshot'; data: ChatRunSnapshot }
  | { event: 'approval_state'; data: { approval: ChatApproval | null } }
  | { event: 'message_start'; data: { messageId: string; role: Role } }
  | { event: 'text_delta'; data: { text: string } }
  | { event: 'thinking_delta'; data: { text: string } }
  /** move the text of the message being streamed into a thinking block (leaked </think>) */
  | { event: 'thinking_reclassify'; data: Record<string, never> }
  | { event: 'tool_call'; data: { id: string; name: string; input: unknown } }
  | { event: 'tool_call_start'; data: { id: string; name: string } }
  | { event: 'tool_result'; data: { toolUseId: string; content: Block[]; isError: boolean; durationMs: number } }
  | { event: 'approval_required'; data: { requestId: string; tool: string; input: unknown } }
  | { event: 'usage'; data: Usage }
  | { event: 'message_end'; data: { messageId: string; stopReason: StopReason; message: Message } }
  | { event: 'title'; data: { conversationId: string; title: string } }
  | { event: 'error'; data: { code: string; message: string } }
  | { event: 'done'; data: Record<string, never> };

// ---------- Providers / models ----------

export type ProviderType = 'openai' | 'anthropic';

export interface ProviderCompat {
  /** Anthropic explicit 5-minute breakpoints. Auto enables only documented endpoints. */
  promptCaching?: 'auto' | 'on' | 'off';
  /** send stream_options: { include_usage: true } (OpenAI only) */
  streamOptions?: boolean;
  /** use max_completion_tokens instead of max_tokens (OpenAI only) */
  maxCompletionTokens?: boolean;
  /** send temperature (some reasoning models reject it) */
  sendTemperature?: boolean;
  /** Anthropic protocol: include thinking.display: "summarized" (official API returns summaries; some gateways reject unknown fields) */
  thinkingDisplay?: boolean;
  /** Anthropic protocol: where to put the effort level. Official Anthropic API uses output_config.effort;
   *  Z.AI / GLM and other gateways use a top-level reasoning_effort field. */
  effortParam?: 'output_config' | 'reasoning_effort';
  /** OpenAI protocol: also send a GLM/Qwen-style top-level thinking: {type:"enabled"|"disabled"} object
   *  (legacy flag; equivalent to thinkingFormat: "zai") */
  openaiThinkingObject?: boolean;
  /** OpenAI protocol: which dialect to use for reasoning params (default "openai" = top-level reasoning_effort) */
  thinkingFormat?: 'openai' | 'openrouter' | 'zai' | 'qwen' | 'deepseek';
  /** Anthropic protocol: replay thinking blocks that come back without a signature instead of degrading them to text */
  allowEmptySignature?: boolean;
  /** route `<think>…</think>` the model leaks into its answer text into thinking blocks (default on) */
  inlineThinkTags?: boolean;
}

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  /** masked in API responses, e.g. "sk-...abcd" */
  apiKeyMasked: string;
  hasApiKey: boolean;
  extraHeaders: Record<string, string>;
  compat: ProviderCompat;
  createdAt: string;
  models: Model[];
}

/**
 * What the model can do, declared per model in Settings. Purely descriptive: it says which
 * inputs the endpoint accepts and whether it can think at all — never *how hard* it should
 * think (that is a per-conversation choice, see ConversationSettings.reasoning).
 */
export interface ModelCaps {
  /** input modalities (text is always assumed) */
  image: boolean;
  pdf: boolean;
  tools: boolean;
  thinking: boolean;
}

/**
 * Unified reasoning dial, protocol-agnostic: the agent/UI always speak this language and each
 * adapter translates it for the endpoint (output_config.effort, reasoning_effort, enable_thinking, ...).
 */
export type ReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/**
 * Per-model level table: maps a unified level to the literal value the endpoint expects.
 * `null` marks a level as unsupported — it is hidden from the chat effort picker and its param
 * is omitted if requested anyway. For `off`, `null` means the endpoint cannot disable thinking.
 */
export type ReasoningMap = Partial<Record<ReasoningLevel, string | null>>;

/**
 * A model entry describes the endpoint, not a preference: capabilities plus the wire details
 * needed to talk to it. The effort actually used lives on the conversation.
 */
export interface Model {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  caps: ModelCaps;
  maxOutput: number | null;
  /** Anthropic protocol: how thinking is switched on — thinking:{type:"adaptive"} (true, official
   *  API) vs thinking:{type:"enabled"} (false, gateways fronting non-Claude models). Effort is the
   *  depth dial in both cases; budget_tokens is gone from current APIs. */
  adaptive: boolean;
  /** which levels this endpoint accepts (null value = unsupported) and what literal each sends */
  reasoningMap: ReasoningMap | null;
  isDefault: boolean;
}

// ---------- Conversations ----------

export interface ConversationSettings {
  temperature?: number | null;
  maxTokens?: number | null;
  enabledMcpServers?: string[] | 'all';
  enabledSkills?: string[] | 'all';
  /**
   * effort for this conversation; null/absent falls back to DEFAULT_REASONING_LEVEL, not to
   * "send nothing" — see resolveReasoningLevel. A level the model does not accept is snapped to
   * the nearest one it does.
   */
  reasoning?: ReasoningLevel | null;
}

export interface Conversation {
  id: string;
  title: string;
  providerId: string | null;
  modelId: string | null; // references models.id
  /** references conversation_groups.id; null = ungrouped */
  groupId: string | null;
  systemPrompt: string;
  settings: ConversationSettings;
  createdAt: string;
  updatedAt: string;
}

/** A user-named folder in the sidebar; conversations are dragged in and out of it. */
export interface ConversationGroup {
  id: string;
  name: string;
  sortOrder: number;
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------- MCP ----------

export type McpTransport = 'stdio' | 'http' | 'sse';
export type McpStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpServer {
  id: string;
  name: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
  url: string | null;
  headers: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  status: McpStatus;
  error: string | null;
  toolCount: number;
}

export interface McpToolInfo {
  server: string;
  name: string;
  fullName: string;
  description: string;
  inputSchema: unknown;
}

// ---------- Skills ----------

export interface SkillInfo {
  name: string;
  description: string;
  dir: string;
  allowedTools: string[];
  files: string[];
  hasScripts: boolean;
  autoApprove: boolean;
}

// ---------- Attachments ----------

export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
  url: string;
}

// ---------- Tool definitions ----------

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
