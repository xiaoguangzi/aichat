import { describe, it, expect } from 'vitest';
import { DEFAULT_REASONING_LEVEL, resolveReasoningLevel, supportedReasoningLevels } from '@aichat/shared';

const thinker = (map: Record<string, string | null> | null = null) => ({ caps: { thinking: true }, reasoningMap: map as never });

describe('resolveReasoningLevel', () => {
  it('a model that cannot think is always off', () => {
    expect(resolveReasoningLevel({ caps: { thinking: false } }, 'max')).toBe('off');
  });
  it('an unset conversation gets a real level, never "send nothing"', () => {
    // Z.AI-style gateways 400 on a request with no thinking field, and endpoints that accept it
    // think as little as they like — so the default has to be concrete.
    expect(resolveReasoningLevel(thinker(), null)).toBe(DEFAULT_REASONING_LEVEL);
    expect(resolveReasoningLevel(thinker(), undefined)).toBe(DEFAULT_REASONING_LEVEL);
  });
  it('keeps a level the model accepts', () => {
    expect(resolveReasoningLevel(thinker(), 'low')).toBe('low');
  });
  it('falls back to the nearest accepted level, cheaper side on a tie', () => {
    expect(resolveReasoningLevel(thinker({ medium: null }), 'medium')).toBe('low');
    expect(resolveReasoningLevel(thinker({ high: null, xhigh: null, max: null }), 'high')).toBe('medium');
    // endpoint that cannot disable thinking (GLM): "off" becomes the lowest it does accept
    expect(resolveReasoningLevel(thinker({ off: null, minimal: null }), 'off')).toBe('low');
  });
  it('supportedReasoningLevels drives the chat picker', () => {
    expect(supportedReasoningLevels(thinker({ off: null }))).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(supportedReasoningLevels({ caps: { thinking: false } })).toEqual([]);
  });
});
