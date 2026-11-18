import type { Project, RemoteState, StudioMessage, WorkflowCard } from './types';

// In-memory fallback store for local dev / automated test runner when Cloudflare D1 is absent
const memoryDB = new Map<string, { owner: string; data: string; version: number; updated_at: string }>();
const memoryBucket = new Map<string, ArrayBuffer>();

export function bindings(): any {
  const g = globalThis as any;
  if (g.__STUDIO_BINDINGS__) return g.__STUDIO_BINDINGS__;
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async all() {
                if (sql.includes('FROM studio_projects WHERE owner=?')) {
                  const ownerId = args[0];
                  const results = Array.from(memoryDB.values())
                    .filter((r) => r.owner === ownerId)
                    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
                  return { results };
                }
                return { results: [] };
              },
              async first() {
                if (sql.includes('WHERE id=? AND owner=?')) {
                  const [id, ownerId] = args;
                  const row = memoryDB.get(id);
                  if (!row || row.owner !== ownerId) return null;
                  return row;
                }
                return null;
              },
              async run() {
                if (sql.startsWith('INSERT INTO studio_projects')) {
                  const [id, ownerId, data, updated_at] = args;
                  memoryDB.set(id, { owner: ownerId, data, version: 1, updated_at });
                } else if (sql.startsWith('UPDATE studio_projects')) {
                  const [data, version, updated_at, id, ownerId] = args;
                  const row = memoryDB.get(id);
                  if (row && row.owner === ownerId) {
                    memoryDB.set(id, { owner: ownerId, data, version, updated_at });
                  }
                }
                return { success: true };
              },
            };
          },
        };
      },
    },
    BUCKET: {
      async get(key: string) {
        const buf = memoryBucket.get(key);
        if (!buf) return null;
        return {
          async arrayBuffer() {
            return buf;
          },
        };
      },
      async put(key: string, value: ArrayBuffer) {
        memoryBucket.set(key, value);
      },
    },
    STUDIO_BACKEND_URL: process.env.STUDIO_BACKEND_URL || '',
    STUDIO_BACKEND_TOKEN: process.env.STUDIO_BACKEND_TOKEN || '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  };
}

export async function owner(): Promise<string> {
  const b = bindings();
  if (b.CURRENT_USER === null) throw new Error('AUTH_REQUIRED');
  return b.CURRENT_USER || process.env.STUDIO_DEFAULT_USER || 'ayin';
}

export function connected(): boolean {
  const b = bindings();
  return Boolean(b.STUDIO_BACKEND_URL || process.env.STUDIO_BACKEND_URL);
}

export function gptAvailable(): boolean {
  const b = bindings();
  return Boolean(b.OPENAI_API_KEY || process.env.OPENAI_API_KEY);
}

export function connectionMode(): 'remote' | 'gpt_test' | 'local' {
  if (connected()) return 'remote';
  if (gptAvailable()) return 'gpt_test';
  return 'local';
}

const SENSITIVE_KEYS = new Set([
  'model',
  'model_name',
  'provider',
  'route',
  'line',
  'tokens',
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'system_prompt',
  'raw_prompt',
  'api_key',
]);

/**
 * Redline filter: User-facing pages, API responses, errors, and exports MUST NEVER expose
 * model names, route names, token counts, or raw system prompts.
 */
export function sanitizeForClient<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return input
      .replace(/\b(gpt-4[a-z0-9.-]*|gpt-5[a-z0-9.-]*|claude-[a-z0-9.-]+|gemini-[a-z0-9.-]+|deepseek-[a-z0-9.-]+|grok-[a-z0-9.-]+)\b/gi, '创作引擎')
      .replace(/\b(prompt_tokens|completion_tokens|total_tokens)\s*[:=]\s*\d+/gi, '') as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeForClient(item)) as unknown as T;
  }
  if (typeof input === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(input as Record<string, any>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) continue;
      out[k] = sanitizeForClient(v);
    }
    return out as T;
  }
  return input;
}

export async function getProject(id: string, user: string): Promise<Project> {
  if (!id) throw new Error('INVALID_INPUT');
  const row = await bindings()
    .DB.prepare('SELECT data,version FROM studio_projects WHERE id=? AND owner=?')
    .bind(id, user)
    .first();
  if (!row) throw new Error('NOT_FOUND');
  const parsed: Project = JSON.parse(row.data);
  parsed.version = row.version;
  // Backward compatibility defaults for legacy projects
  if (!Array.isArray(parsed.messages)) parsed.messages = [];
  if (!Array.isArray(parsed.attachments)) parsed.attachments = [];
  if (!Array.isArray(parsed.requirements)) parsed.requirements = [];
  if (parsed.lockedEpisodes === undefined) parsed.lockedEpisodes = null;
  if (parsed.startEpisode === undefined) parsed.startEpisode = parsed.lockedEpisodes ? parsed.lockedEpisodes + 1 : 1;
  if (parsed.budgetCap === undefined) parsed.budgetCap = 1.5;
  if (parsed.budgetUsed === undefined) parsed.budgetUsed = 0;
  return parsed;
}

export async function saveProject(p: Project, user: string): Promise<Project> {
  const now = new Date().toISOString();
  p.updatedAt = now;
  p.version = (p.version || 1) + 1;
  const clean = sanitizeForClient(p);
  await bindings()
    .DB.prepare('UPDATE studio_projects SET data=?,version=?,updated_at=? WHERE id=? AND owner=?')
    .bind(JSON.stringify(clean), clean.version, now, clean.id, user)
    .run();
  return clean;
}

export function message(
  p: Project,
  role: StudioMessage['role'],
  text: string,
  extra: Partial<StudioMessage> = {}
): StudioMessage {
  const msg: StudioMessage = {
    id: crypto.randomUUID(),
    role,
    text: sanitizeForClient(text),
    time: new Date().toISOString(),
    ...extra,
  };
  p.messages.push(msg);
  return msg;
}

export async function backend(
  path: string,
  method = 'GET',
  body?: any,
  rawBuffer = false
): Promise<Response> {
  const b = bindings();
  const baseUrl = String(b.STUDIO_BACKEND_URL || process.env.STUDIO_BACKEND_URL || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('SERVICE_NOT_CONNECTED');
  const headers: Record<string, string> = {};
  const token = b.STUDIO_BACKEND_TOKEN || process.env.STUDIO_BACKEND_TOKEN;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined && !rawBuffer) headers['Content-Type'] = 'application/json';
  const res = await fetch(baseUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined : rawBuffer ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error('BACKEND_REQUEST_FAILED');
  return res;
}

export function failure(e: any): Response {
  const code = String(e?.message || 'REQUEST_FAILED');
  const statusMap: Record<string, number> = {
    AUTH_REQUIRED: 401,
    NOT_FOUND: 404,
    CONFLICT: 409,
    INVALID_INPUT: 400,
    FILE_TOO_LARGE: 413,
    EPISODE_ALREADY_USED: 400,
    EPISODE_MAPPING_REQUIRED: 400,
    MODE_SELECTION_REQUIRED: 400,
    UNDERSTOOD_GATE_REQUIRED: 400,
    BUDGET_EXCEEDED: 402,
    SERVICE_NOT_CONNECTED: 503,
    BACKEND_REQUEST_FAILED: 502,
  };
  return Response.json(
    { error: sanitizeForClient(code) },
    { status: statusMap[code] || 500 }
  );
}
