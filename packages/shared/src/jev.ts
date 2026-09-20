import { z } from 'zod';

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
