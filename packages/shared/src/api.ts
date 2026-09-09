import { z } from 'zod';

export const appSettingsSchema = z.object({ titleModelId: z.string().min(1).nullable() }).strict();
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const reasoningLevelSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
/** Partial<Record<ReasoningLevel, string | null>>: level → endpoint literal; null = unsupported level */
export const reasoningMapSchema = z.partialRecord(reasoningLevelSchema, z.string().nullable());

export const providerCompatSchema = z.object({
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
  adaptive: z.boolean().nullable().optional(),
  reasoningMap: reasoningMapSchema.nullable().optional(),
  isDefault: z.boolean().optional(),
});
export type ModelInput = z.infer<typeof modelInputSchema>;

export const conversationSettingsSchema = z.object({
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxTokens: z.number().int().positive().nullable().optional(),
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
  systemPrompt: z.string().optional(),
  settings: conversationSettingsSchema.optional(),
});
export type ConversationInput = z.infer<typeof conversationInputSchema>;

export const groupInputSchema = z.object({
  name: z.string().min(1).max(100),
  collapsed: z.boolean().optional(),
});
export type GroupInput = z.infer<typeof groupInputSchema>;

export const groupPatchSchema = groupInputSchema.partial();
export type GroupPatch = z.infer<typeof groupPatchSchema>;

export const groupReorderSchema = z.object({ ids: z.array(z.string()) });

export const sendMessageSchema = z.object({
  text: z.string(),
  attachmentIds: z.array(z.string()).optional(),
  /** regenerate: re-run from the last user message without adding a new one */
  regenerate: z.boolean().optional(),
  /** edit: replace user message with this id (and drop everything after it) */
  editMessageId: z.string().optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

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
