import type { Model, ModelCaps, Provider, ProviderCompat, ProviderType, ReasoningMap } from '@aichat/shared';
import { getDb, j } from '../database.js';
import { nowIso, uuid } from '../../util/id.js';

interface ProviderRow {
  id: string;
  name: string;
  type: ProviderType;
  base_url: string;
  api_key: string;
  extra_headers_json: string;
  extra_json: string;
  created_at: string;
}
interface ModelRow {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  caps_json: string;
  max_output: number | null;
  reasoning_map: string | null;
  adaptive: number | null;
  is_default: number;
  // legacy columns kept by the migrations but no longer read: thinking, effort, reasoning,
  // thinking_budget (reasoning held a per-model default effort — that is a conversation setting
  // now; budget_tokens is gone from current APIs, effort replaced it)
}

/** Full provider including secret key — server-internal only. */
export interface ProviderSecret {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  extraHeaders: Record<string, string>;
  compat: ProviderCompat;
  createdAt: string;
}

const defaultCaps: ModelCaps = { image: true, pdf: true, tools: true, thinking: false };

/** Tolerant read of caps_json: rows written before modalities were split still say `vision`. */
function parseCaps(json: string): ModelCaps {
  const c = j.parse<Partial<ModelCaps> & { vision?: boolean }>(json, {});
  return {
    image: c.image ?? c.vision ?? defaultCaps.image,
    pdf: c.pdf ?? c.vision ?? defaultCaps.pdf,
    tools: c.tools ?? defaultCaps.tools,
    thinking: c.thinking ?? defaultCaps.thinking,
  };
}

function mask(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}

function rowToSecret(r: ProviderRow): ProviderSecret {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    baseUrl: r.base_url,
    apiKey: r.api_key,
    extraHeaders: j.parse(r.extra_headers_json, {}),
    compat: j.parse(r.extra_json, {}),
    createdAt: r.created_at,
  };
}

function rowToModel(r: ModelRow): Model {
  return {
    id: r.id,
    providerId: r.provider_id,
    modelId: r.model_id,
    displayName: r.display_name,
    caps: parseCaps(r.caps_json),
    maxOutput: r.max_output,
    adaptive: !!r.adaptive,
    reasoningMap: r.reasoning_map ? (j.parse<ReasoningMap>(r.reasoning_map, {}) as ReasoningMap) : null,
    isDefault: !!r.is_default,
  };
}

export function toPublic(p: ProviderSecret, models: Model[]): Provider {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    baseUrl: p.baseUrl,
    apiKeyMasked: mask(p.apiKey),
    hasApiKey: !!p.apiKey,
    extraHeaders: p.extraHeaders,
    compat: p.compat,
    createdAt: p.createdAt,
    models,
  };
}

export const providersRepo = {
  list(): ProviderSecret[] {
    return (getDb().prepare('SELECT * FROM providers ORDER BY created_at').all() as unknown as ProviderRow[]).map(rowToSecret);
  },
  get(id: string): ProviderSecret | null {
    const r = getDb().prepare('SELECT * FROM providers WHERE id = ?').get(id) as unknown as ProviderRow | undefined;
    return r ? rowToSecret(r) : null;
  },
  create(input: {
    name: string;
    type: ProviderType;
    baseUrl: string;
    apiKey?: string;
    extraHeaders?: Record<string, string>;
    compat?: ProviderCompat;
  }): ProviderSecret {
    const id = uuid();
    getDb()
      .prepare('INSERT INTO providers(id,name,type,base_url,api_key,extra_headers_json,extra_json,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, input.name, input.type, input.baseUrl.replace(/\/+$/, ''), input.apiKey ?? '', j.str(input.extraHeaders ?? {}), j.str(input.compat ?? {}), nowIso());
    return this.get(id)!;
  },
  update(
    id: string,
    input: Partial<{ name: string; type: ProviderType; baseUrl: string; apiKey: string; extraHeaders: Record<string, string>; compat: ProviderCompat }>,
  ): ProviderSecret | null {
    const cur = this.get(id);
    if (!cur) return null;
    const next = {
      name: input.name ?? cur.name,
      type: input.type ?? cur.type,
      baseUrl: (input.baseUrl ?? cur.baseUrl).replace(/\/+$/, ''),
      apiKey: input.apiKey === undefined ? cur.apiKey : input.apiKey,
      extraHeaders: input.extraHeaders ?? cur.extraHeaders,
      compat: input.compat ?? cur.compat,
    };
    getDb()
      .prepare('UPDATE providers SET name=?, type=?, base_url=?, api_key=?, extra_headers_json=?, extra_json=? WHERE id=?')
      .run(next.name, next.type, next.baseUrl, next.apiKey, j.str(next.extraHeaders), j.str(next.compat), id);
    return this.get(id);
  },
  delete(id: string): boolean {
    return getDb().prepare('DELETE FROM providers WHERE id = ?').run(id).changes > 0;
  },
};

export const modelsRepo = {
  listByProvider(providerId: string): Model[] {
    return (getDb().prepare('SELECT * FROM models WHERE provider_id = ? ORDER BY display_name').all(providerId) as unknown as ModelRow[]).map(rowToModel);
  },
  listAll(): Model[] {
    return (getDb().prepare('SELECT * FROM models ORDER BY display_name').all() as unknown as ModelRow[]).map(rowToModel);
  },
  get(id: string): Model | null {
    const r = getDb().prepare('SELECT * FROM models WHERE id = ?').get(id) as unknown as ModelRow | undefined;
    return r ? rowToModel(r) : null;
  },
  getDefault(): Model | null {
    const r =
      (getDb().prepare('SELECT * FROM models WHERE is_default = 1 LIMIT 1').get() as unknown as ModelRow | undefined) ??
      (getDb().prepare('SELECT * FROM models LIMIT 1').get() as unknown as ModelRow | undefined);
    return r ? rowToModel(r) : null;
  },
  upsert(
    providerId: string,
    input: { modelId: string; displayName?: string; caps?: Partial<ModelCaps>; maxOutput?: number | null; adaptive?: boolean | null; reasoningMap?: ReasoningMap | null; isDefault?: boolean },
  ): Model {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM models WHERE provider_id = ? AND model_id = ?').get(providerId, input.modelId) as unknown as
      | ModelRow
      | undefined;
    if (input.isDefault) db.prepare('UPDATE models SET is_default = 0').run();
    // Adaptive thinking is the sane default on the official Anthropic API; gateways opt out per model.
    const protocolDefaultAdaptive = providersRepo.get(providerId)?.type === 'anthropic';
    if (existing) {
      const cur = rowToModel(existing);
      db.prepare('UPDATE models SET display_name=?, caps_json=?, max_output=?, adaptive=?, reasoning_map=?, is_default=? WHERE id=?').run(
        input.displayName ?? cur.displayName,
        j.str({ ...cur.caps, ...(input.caps ?? {}) }),
        input.maxOutput === undefined ? cur.maxOutput : input.maxOutput,
        input.adaptive === undefined ? (cur.adaptive ? 1 : 0) : input.adaptive ? 1 : 0,
        input.reasoningMap === undefined ? (cur.reasoningMap ? j.str(cur.reasoningMap) : null) : input.reasoningMap ? j.str(input.reasoningMap) : null,
        input.isDefault === undefined ? (cur.isDefault ? 1 : 0) : input.isDefault ? 1 : 0,
        cur.id,
      );
      return this.get(cur.id)!;
    }
    const id = uuid();
    const count = (db.prepare('SELECT COUNT(*) as c FROM models').get() as { c: number }).c;
    db.prepare('INSERT INTO models(id,provider_id,model_id,display_name,caps_json,max_output,adaptive,reasoning_map,is_default) VALUES (?,?,?,?,?,?,?,?,?)').run(
      id,
      providerId,
      input.modelId,
      input.displayName ?? input.modelId,
      j.str({ ...defaultCaps, ...(input.caps ?? {}) }),
      input.maxOutput ?? null,
      (input.adaptive ?? protocolDefaultAdaptive) ? 1 : 0,
      input.reasoningMap ? j.str(input.reasoningMap) : null,
      input.isDefault || count === 0 ? 1 : 0,
    );
    return this.get(id)!;
  },
  delete(id: string): boolean {
    return getDb().prepare('DELETE FROM models WHERE id = ?').run(id).changes > 0;
  },
};
