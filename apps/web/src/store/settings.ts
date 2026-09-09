import { useMemo } from 'react';
import { create } from 'zustand';
import type { McpServer, Model, Provider, SkillInfo } from '@aichat/shared';
import { api } from '../api/client';

interface SettingsState {
  providers: Provider[];
  mcpServers: McpServer[];
  skills: SkillInfo[];
  skillsDir: string;
  skillWarnings: string[];
  loaded: boolean;
  loadAll: () => Promise<void>;
  loadProviders: () => Promise<void>;
  loadMcp: () => Promise<void>;
  loadSkills: () => Promise<void>;
  allModels: () => Array<Model & { providerName: string; providerType: Provider['type'] }>;
}

/**
 * Collapses concurrent calls for the same resource into one request. Several components load
 * the same lists on mount (ChatPage's loadAll plus whichever settings page is mounting, and
 * React's StrictMode double-mount in dev), which otherwise fires each GET two or three times
 * for one navigation.
 */
const inflight = new Map<string, Promise<void>>();
function once(key: string, run: () => Promise<void>): Promise<void> {
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const useSettings = create<SettingsState>((set, get) => ({
  providers: [],
  mcpServers: [],
  skills: [],
  skillsDir: '',
  skillWarnings: [],
  loaded: false,
  loadAll: async () => {
    await Promise.all([get().loadProviders(), get().loadMcp(), get().loadSkills()]);
    set({ loaded: true });
  },
  loadProviders: () => once('providers', async () => set({ providers: await api.providers.list() })),
  loadMcp: () => once('mcp', async () => set({ mcpServers: await api.mcp.list() })),
  loadSkills: () =>
    once('skills', async () => {
      const r = await api.skills.list();
      set({ skills: r.skills, skillsDir: r.dir, skillWarnings: r.warnings });
    }),
  allModels: () => get().providers.flatMap((p) => p.models.map((m) => ({ ...m, providerName: p.name, providerType: p.type }))),
}));

/** Stable, memoised flat model list (selector must not return a fresh array each render). */
export function useAllModels() {
  const providers = useSettings((s) => s.providers);
  return useMemo(() => providers.flatMap((p) => p.models.map((m) => ({ ...m, providerName: p.name, providerType: p.type }))), [providers]);
}
