import type { Attachment, Conversation, ConversationGroup, GroupInput, GroupPatch, McpServer, McpServerInput, McpToolInfo, Message, Model, ModelInput, Provider, ProviderInput, SkillInfo, ConversationInput } from '@aichat/shared';
import type { ArtifactEdit, AppSettings } from '@aichat/shared';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let payload: { code?: string; message?: string } = {};
    try {
      payload = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(payload.code ?? 'http', payload.message ?? res.statusText, res.status);
  }
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('json') ? await res.json() : await res.text()) as T;
}

export const api = {
  settings: {
    get: () => req<AppSettings>('GET', '/api/settings'),
    update: (input: AppSettings) => req<AppSettings>('PUT', '/api/settings', input),
  },
  providers: {
    list: () => req<Provider[]>('GET', '/api/providers'),
    create: (input: ProviderInput) => req<Provider>('POST', '/api/providers', input),
    update: (id: string, input: Partial<ProviderInput>) => req<Provider>('PUT', `/api/providers/${id}`, input),
    remove: (id: string) => req<{ ok: true }>('DELETE', `/api/providers/${id}`),
    remoteModels: (id: string) => req<{ id: string; displayName?: string }[]>('GET', `/api/providers/${id}/remote-models`),
    test: (id: string, model?: string) => req<{ ok: boolean; ms: number; text: string }>('POST', `/api/providers/${id}/test`, { model }),
    addModel: (id: string, input: ModelInput) => req<Model>('POST', `/api/providers/${id}/models`, input),
    updateModel: (id: string, mid: string, input: Partial<ModelInput>) => req<Model>('PUT', `/api/providers/${id}/models/${mid}`, input),
    removeModel: (id: string, mid: string) => req<{ ok: true }>('DELETE', `/api/providers/${id}/models/${mid}`),
  },
  conversations: {
    list: (opts?: { q?: string; groupId?: string }) => {
      const p = new URLSearchParams();
      if (opts?.q) p.set('q', opts.q);
      if (opts?.groupId) p.set('groupId', opts.groupId);
      return req<Conversation[]>('GET', `/api/conversations${p.size ? `?${p}` : ''}`);
    },
    create: (input?: ConversationInput) => req<Conversation>('POST', '/api/conversations', input ?? {}),
    get: (id: string) => req<Conversation & { messages: Message[]; running?: boolean }>('GET', `/api/conversations/${id}`),
    update: (id: string, input: ConversationInput) => req<Conversation>('PUT', `/api/conversations/${id}`, input),
    remove: (id: string) => req<{ ok: true }>('DELETE', `/api/conversations/${id}`),
    deleteFrom: (id: string, mid: string) => req<{ ok: true }>('DELETE', `/api/conversations/${id}/messages/${mid}`),
    stop: (id: string) => req<{ ok: boolean }>('POST', `/api/conversations/${id}/stop`),
    exportUrl: (id: string) => `/api/conversations/${id}/export`,
  },
  artifacts: {
    list: (id: string) => req<ArtifactEdit[]>('GET', `/api/conversations/${id}/artifacts`),
    save: (id: string, input: { messageId: string; artifactId: string; code: string }) => req<ArtifactEdit>('POST', `/api/conversations/${id}/artifacts`, input),
  },
  groups: {
    list: () => req<ConversationGroup[]>('GET', '/api/groups'),
    create: (input: GroupInput) => req<ConversationGroup>('POST', '/api/groups', input),
    update: (id: string, input: GroupPatch) => req<ConversationGroup>('PUT', `/api/groups/${id}`, input),
    remove: (id: string) => req<{ ok: true }>('DELETE', `/api/groups/${id}`),
    reorder: (ids: string[]) => req<ConversationGroup[]>('POST', '/api/groups/reorder', { ids }),
  },
  approvals: { resolve: (id: string, approve: boolean) => req<{ ok: true }>('POST', `/api/approvals/${id}`, { approve }) },
  mcp: {
    list: () => req<McpServer[]>('GET', '/api/mcp'),
    create: (input: McpServerInput) => req<McpServer>('POST', '/api/mcp', input),
    update: (id: string, input: Partial<McpServerInput>) => req<McpServer>('PUT', `/api/mcp/${id}`, input),
    remove: (id: string) => req<{ ok: true }>('DELETE', `/api/mcp/${id}`),
    connect: (id: string) => req<McpServer>('POST', `/api/mcp/${id}/connect`),
    disconnect: (id: string) => req<McpServer>('POST', `/api/mcp/${id}/disconnect`),
    tools: (id: string) => req<McpToolInfo[]>('GET', `/api/mcp/${id}/tools`),
    logs: (id: string) => req<string[]>('GET', `/api/mcp/${id}/logs`),
    import: (json: unknown) => req<{ created: number }>('POST', '/api/mcp/import', json),
  },
  skills: {
    list: () => req<{ dir: string; skills: SkillInfo[]; warnings: string[] }>('GET', '/api/skills'),
    get: (name: string) => req<SkillInfo & { body: string }>('GET', `/api/skills/${encodeURIComponent(name)}`),
    rescan: () => req<{ skills: SkillInfo[]; warnings: string[] }>('POST', '/api/skills/rescan'),
    setAutoApprove: (name: string, autoApprove: boolean) => req<SkillInfo>('PUT', `/api/skills/${encodeURIComponent(name)}/auto-approve`, { autoApprove }),
  },
  uploads: {
    upload: (files: File[], conversationId?: string) => {
      const fd = new FormData();
      for (const f of files) fd.append('file', f);
      if (conversationId) fd.append('conversationId', conversationId);
      return req<Attachment[]>('POST', '/api/uploads', fd);
    },
  },
};
