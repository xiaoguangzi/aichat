import { z } from 'zod';
import type { ReasoningLevel } from './types.js';
import type { JevRoutingSettings } from './api.js';

export const DEFAULT_JEV_ROUTING: JevRoutingSettings = {
  enabled: false, profiles: [], fallbackProfileId: '', minConfidence: 0.4,
  instructions: '按首条消息的任务难度选择合适的模型和 effort。简单问答、翻译、改写优先速度；复杂代码、数学、多步骤分析优先智能程度和更高 effort。能力足够时优先速度更快的候选项。速度和智能评分由用户提供，不要根据模型名字猜测能力。',
};
export interface ConversationRouting {
  status: 'routing' | 'routed' | 'fallback';
  profileId: string;
  profileName: string;
  modelId: string;
  providerId: string;
  modelName: string;
  llmModel: string;
  reasoning: ReasoningLevel;
  reason: string;
  decidedAt: string;
  jevModel?: string;
  confidence?: number;
  elapsedMs?: number;
}

const probability = z.number().min(0).max(1);
const probabilities = z.record(z.string(), probability);
export const jevResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), z.discriminatedUnion('type', [
    z.object({ type: z.literal('noul'), noul: probability }),
    z.object({ type: z.literal('choice'), choice: z.string(), probabilities, confidence: probability }),
    z.object({ type: z.literal('score'), score: z.number(), probabilities, confidence: probability,
      legend: z.record(z.string(), z.json()) }),
  ])),
  usage: z.object({ input_tokens: z.number().int().nonnegative().optional(), output_tokens: z.number().int().nonnegative().optional() }).optional(),
});
export type JevResponse = z.infer<typeof jevResponseSchema>;
export interface JevSettings { model: string; hasApiKey: boolean }
export interface JevResult { response: JevResponse; elapsedMs: number }
