import { z } from 'zod';

/**
 * Request-log retention. Every limit is optional; `null` means "use the built-in default"
 * (kept in DEFAULT_TRACE_RETENTION so old rows and the UI agree on one number).
 */
export const traceRetentionSchema = z.object({
  autoPrune: z.boolean().optional(),
  maxCount: z.number().int().min(0).nullable().optional(),
  maxTotalBytes: z.number().int().min(0).nullable().optional(),
  maxAgeDays: z.number().int().min(0).nullable().optional(),
  /** Reclaim free pages after a manual cleanup. Auto-prune never vacuums. */
  vacuumOnPrune: z.boolean().optional(),
}).strict();
export type TraceRetentionInput = z.infer<typeof traceRetentionSchema>;

export const appSettingsSchema = z.object({
  titleModelId: z.string().min(1).nullable(),
  traceRetention: traceRetentionSchema.optional(),
}).strict();
export type AppSettings = z.infer<typeof appSettingsSchema>;

/** Effective retention (defaults resolved) plus what the log currently costs on disk. */
export interface TraceRetention {
  autoPrune: boolean;
  maxCount: number;
  maxTotalBytes: number;
  maxAgeDays: number;
  vacuumOnPrune: boolean;
}

/**
 * Used when a limit is null and as the ceiling for the insert-time guard, so a single
 * oversized generation cannot bloat the database before the next prune runs.
 */
export const DEFAULT_TRACE_RETENTION: TraceRetention = {
  autoPrune: true,
  maxCount: 500,
  maxTotalBytes: 128 * 1024 * 1024,
  maxAgeDays: 30,
  vacuumOnPrune: false,
};

export interface StorageStats {
  retention: TraceRetention;
  /**
   * Exactly what is persisted, with unset limits still null. The UI seeds its form from this so
   * saving an untouched box keeps it on the built-in default instead of freezing today's number.
   */
  retentionInput: TraceRetentionInput;
  traces: { count: number; bytes: number; conversations: number };
  db: { pageCount: number; pageSize: number; freePages: number; bytes: number; reclaimableBytes: number };
  /** Uploaded files on disk; `orphaned` are not referenced by any message any more. */
  uploads: { count: number; bytes: number; orphaned: number; orphanedBytes: number };
  /** Local originals kept for context__read_result. */
  toolResults: { count: number; bytes: number };
  messages: { count: number; bytes: number };
}

export interface BackupInfo {
  name: string;
  bytes: number;
  createdAt: string;
}

export interface PruneResult {
  deleted: number;
  remaining: number;
  bytesFreed: number;
  vacuumed: boolean;
  reclaimedBytes: number;
  /** Conversations currently generating are never pruned. */
  protectedConversations: number;
}

// TypeSafe System One is deliberately separate from chat providers and settings.
const jevEntrySchema = z.union([z.string(), z.record(z.string(), z.json()), z.array(z.json()), z.null()]);
export const jevQuestionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('noul'), instructions: jevEntrySchema,
    criteria: z.object({ true: jevEntrySchema.optional(), false: jevEntrySchema.optional() }).strict().optional() }).strict(),
  z.object({ type: z.literal('choice'), instructions: jevEntrySchema,
    criteria: z.record(z.string().min(1), jevEntrySchema).refine(v => Object.keys(v).length >= 1 && Object.keys(v).length <= 255, 'Choice 需要 1–255 个选项') }).strict(),
  z.object({ type: z.literal('score'), instructions: jevEntrySchema,
    criteria: z.array(jevEntrySchema).min(2).max(10) }).strict(),
]);
export const jevRequestSchema = z.object({
  model: z.string().trim().min(1).max(200),
  state: z.union([z.string().min(1), z.record(z.string(), z.json()), z.array(z.json())]),
  questions: z.record(z.string().min(1), jevQuestionSchema).refine(v => Object.keys(v).length > 0, '至少添加一个问题'),
}).strict();
export type JevRequest = z.infer<typeof jevRequestSchema>;
export const jevSettingsSchema = z.object({
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().max(4096).regex(/^[^\r\n]*$/).nullable().optional(),
}).strict();
export type JevSettingsInput = z.infer<typeof jevSettingsSchema>;

export const reasoningLevelSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
export const jevRoutingProfileSchema = z.object({
  id: z.string().min(1).max(80),
  modelId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  speed: z.number().int().min(1).max(5),
  intelligence: z.number().int().min(1).max(5),
  reasoning: reasoningLevelSchema,
  description: z.string().max(2000),
}).strict();
export const jevRoutingSettingsSchema = z.object({
  enabled: z.boolean(),
  instructions: z.string().trim().min(1).max(4000),
  minConfidence: z.number().min(0).max(1),
  fallbackProfileId: z.string().max(80),
  profiles: z.array(jevRoutingProfileSchema).max(32),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.profiles.map(p => p.id)).size !== v.profiles.length) ctx.addIssue({ code: 'custom', path: ['profiles'], message: '候选项 ID 不能重复' });
  if (v.enabled && (!v.profiles.length || !v.profiles.some(p => p.id === v.fallbackProfileId))) ctx.addIssue({ code: 'custom', path: ['fallbackProfileId'], message: '启用前请添加候选项并指定兜底项' });
});
export type JevRoutingSettings = z.infer<typeof jevRoutingSettingsSchema>;
export type JevRoutingProfile = z.infer<typeof jevRoutingProfileSchema>;
/** Partial<Record<ReasoningLevel, string | null>>: level → endpoint literal; null = unsupported level */
export const reasoningMapSchema = z.partialRecord(reasoningLevelSchema, z.string().nullable());

export const providerCompatSchema = z.object({
  apiFormat: z.enum(['chat-completions', 'responses']).optional(),
  promptCaching: z.enum(['auto', 'on', 'off']).optional(),
  streamOptions: z.boolean().optional(),
  maxCompletionTokens: z.boolean().optional(),
  sendTemperature: z.boolean().optional(),
  thinkingDisplay: z.boolean().optional(),
  effortParam: z.enum(['output_config', 'reasoning_effort']).optional(),
  openaiThinkingObject: z.boolean().optional(), // legacy; equivalent to thinkingFormat: 'zai'
  thinkingFormat: z.enum(['openai', 'openrouter', 'zai', 'qwen', 'deepseek']).optional(),
  allowEmptySignature: z.boolean().optional(),
  inlineThinkTags: z.boolean().optional(),
});

export const providerInputSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['openai', 'anthropic']),
  baseUrl: z.string().min(1),
  apiKey: z.string().optional(), // undefined = keep existing
  extraHeaders: z.record(z.string(), z.string()).optional(),
  compat: providerCompatSchema.optional(),
});
export type ProviderInput = z.infer<typeof providerInputSchema>;

export const modelInputSchema = z.object({
  modelId: z.string().min(1),
  displayName: z.string().optional(),
  caps: z
    .object({ image: z.boolean(), pdf: z.boolean(), tools: z.boolean(), thinking: z.boolean() })
    .partial()
    .optional(),
  maxOutput: z.number().int().positive().nullable().optional(),
  /** Declared token window for the occupancy ratio; null clears it. */
  contextWindow: z.number().int().positive().nullable().optional(),
  adaptive: z.boolean().nullable().optional(),
  reasoningMap: reasoningMapSchema.nullable().optional(),
  isDefault: z.boolean().optional(),
});
export type ModelInput = z.infer<typeof modelInputSchema>;

export const conversationSettingsSchema = z.object({
  autoRoute: z.boolean().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxTokens: z.number().int().positive().nullable().optional(),
  topP: z.number().gt(0).max(1).nullable().optional(),
  /** Anthropic and OpenAI both cap stop sequences at 4. */
  stop: z.array(z.string().min(1)).max(4).nullable().optional(),
  enabledMcpServers: z.union([z.literal('all'), z.array(z.string())]).optional(),
  enabledSkills: z.union([z.literal('all'), z.array(z.string())]).optional(),
  reasoning: reasoningLevelSchema.nullable().optional(),
});

export const conversationInputSchema = z.object({
  title: z.string().max(200).optional(),
  providerId: z.string().nullable().optional(),
  modelId: z.string().nullable().optional(),
  /** null moves the conversation out of its group; undefined leaves it where it is */
  groupId: z.string().nullable().optional(),
  pinned: z.boolean().optional(),
  systemPrompt: z.string().optional(),
  settings: conversationSettingsSchema.optional(),
});
export type ConversationInput = z.infer<typeof conversationInputSchema>;

export const groupInputSchema = z.object({
  name: z.string().min(1).max(100),
  collapsed: z.boolean().optional(),
  instructions: z.string().max(20_000).optional(),
  modelId: z.string().min(1).nullable().optional(),
  /**
   * Project defaults for new conversations. `null` clears a single field (same convention as
   * conversation settings); omitted fields are left alone.
   */
  settings: conversationSettingsSchema.optional(),
});
export type GroupInput = z.infer<typeof groupInputSchema>;

export const groupPatchSchema = groupInputSchema.partial();
export type GroupPatch = z.infer<typeof groupPatchSchema>;

export const groupReorderSchema = z.object({ ids: z.array(z.string()) });

/** Filters for message-level search; every field is optional. */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  conversationId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  role: z.enum(['user', 'assistant']).optional(),
  /** ISO date; only messages created at or after it. */
  since: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
}).strict();
export type SearchOptions = Omit<z.infer<typeof searchQuerySchema>, 'q'>;

/** One message-level search result. */
export interface SearchHit {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  role: 'user' | 'assistant';
  seq: number;
  createdAt: string;
  /** Text around the match, for the result list. */
  snippet: string;
  /** False when the match sits on a superseded version and jumping to it would show nothing new. */
  visible: boolean;
}

/** Switch the viewed variant at one position; the server derives the full path. */
export const switchBranchSchema = z.object({ messageId: z.string().min(1) }).strict();
export type SwitchBranchInput = z.infer<typeof switchBranchSchema>;

export const sendMessageSchema = z.object({
  text: z.string(),
  attachmentIds: z.array(z.string()).optional(),
  /** regenerate: re-run from the last user message without adding a new one */
  regenerate: z.boolean().optional(),
  /** edit: replace user message with this id (and drop everything after it) */
  editMessageId: z.string().optional(),
  /**
   * continue: answer again from this assistant message without adding a user turn. Used when a
   * reply was cut off (length limit or a stop) and the model should just keep going.
   */
  continueFromId: z.string().optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const approvalDecisionSchema = z.object({
  approve: z.boolean(),
  /** Write this answer down as a standing rule for the same tool. */
  remember: z.boolean().optional(),
}).strict();

export const mcpServerInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'name must be [a-zA-Z0-9_-]'),
  transport: z.enum(['stdio', 'http', 'sse']),
  command: z.string().nullable().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});
export type McpServerInput = z.infer<typeof mcpServerInputSchema>;

/** Claude Desktop / Cursor style import: { mcpServers: { name: {command,args,env} | {url,headers} } } */
export const mcpImportSchema = z.object({
  mcpServers: z.record(
    z.string(),
    z.object({
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
      cwd: z.string().optional(),
      url: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      type: z.string().optional(),
      disabled: z.boolean().optional(),
    }),
  ),
});

export const artifactEditSchema = z.object({
  messageId: z.string().min(1),
  artifactId: z.string().min(1).max(300),
  code: z.string().max(1_000_000),
}).strict();
