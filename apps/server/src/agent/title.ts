import type { Conversation } from '@aichat/shared';
import { resolveReasoningLevel } from '@aichat/shared';
import { modelsRepo, providersRepo } from '../db/repos/providers.js';
import { settingsRepo } from '../db/repos/settings.js';
import { requestDiagnosticsRepo } from '../db/repos/requestDiagnostics.js';
import { getAdapter } from '../llm/registry.js';

/** Separate model/credentials, bounded prompt, no tools, minimum supported reasoning. */
export async function generateTitle(conv: Conversation, userText: string, assistantText: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const selected = settingsRepo.get<string | null>('title.modelId', null);
    // A deleted dedicated model must not silently fall back to a more expensive chat model.
    const model = selected ? modelsRepo.get(selected) : (conv.modelId && modelsRepo.get(conv.modelId)) || modelsRepo.getDefault();
    if (!model) return null;
    const provider = providersRepo.get(model.providerId);
    if (!provider) return null;
    const timeout = AbortSignal.timeout(15_000);
    const titleSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let out = '';
    const prompt = `Write a concise title (max 8 words, no quotes, same language as the conversation) for this chat.\n\nUser: ${userText.slice(0, 600)}\n\nAssistant: ${assistantText.slice(0, 600)}\n\nTitle:`;
    for await (const ev of getAdapter(provider).stream({
      model: model.modelId, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      maxTokens: Math.min(model.maxOutput ?? 512, 512), reasoning: resolveReasoningLevel(model, 'off'),
      adaptive: model.adaptive, reasoningMap: model.reasoningMap, signal: titleSignal,
      onDiagnostic: record => {
        try { requestDiagnosticsRepo.save(conv.id, `${conv.id}:title`, provider.id, record); }
        catch { console.warn('Could not save local title diagnostics.'); }
      },
    })) {
      if (ev.type === 'text_delta') out += ev.text;
    }
    return out.trim().split('\n')[0]?.replace(/^["'#\s]+|["'\s]+$/g, '').slice(0, 60) || null;
  } catch { return null; }
}
