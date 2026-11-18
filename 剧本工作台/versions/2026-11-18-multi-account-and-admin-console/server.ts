import fs from 'node:fs';
import path from 'node:path';
import type {
  AccountRole,
  AdminSystemConfig,
  ApiAuditLog,
  ApiProviderConfig,
  InviteKeyRecord,
  Kind,
  Project,
  PublicAccountProfile,
  StationRoleKey,
  StationRouteConfig,
  StudioAccount,
  StudioMessage,
} from './types';

interface PersistentStoreData {
  projects: Record<string, { owner: string; data: string; version: number; updated_at: string }>;
  accounts: StudioAccount[];
  invites: InviteKeyRecord[];
  sessions: Record<string, { accountId: string; username: string; createdAt: string }>;
  systemConfig: AdminSystemConfig;
  auditLogs: ApiAuditLog[];
}

const DATA_DIR = path.join(process.cwd(), '.data');
const STORE_FILE = path.join(DATA_DIR, 'studio-store.json');
const BUCKET_DIR = path.join(DATA_DIR, 'buckets');

function createDefaultSystemConfig(): AdminSystemConfig {
  const providers: ApiProviderConfig[] = [
    {
      id: 'prov-openai',
      name: 'OpenAI 官方 / 兼容主线',
      vendor: 'openai',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKeys: process.env.OPENAI_API_KEY ? [process.env.OPENAI_API_KEY] : [],
      models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
      enabled: true,
      priority: 1,
      keyCursor: 0,
      lastTestStatus: process.env.OPENAI_API_KEY ? 'ok' : 'untested',
      note: '主力综合推理与总编剧复述线路（支持多 Key 轮询）',
    },
    {
      id: 'prov-claude',
      name: 'Claude 剧本创作专线 (OpenRouter/中转)',
      vendor: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKeys: [],
      models: ['anthropic/claude-3.5-sonnet', 'anthropic/claude-3.7-sonnet', 'openai/gpt-4o'],
      enabled: true,
      priority: 2,
      keyCursor: 0,
      lastTestStatus: 'untested',
      note: '用于分集编剧、美式幽默精修与人物小传高质感生成',
    },
    {
      id: 'prov-gemini',
      name: 'Google Gemini 官方通道 (支持免费/付费额度)',
      vendor: 'gemini',
      baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKeys:
        process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
          ? [String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)]
          : [],
      models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
      enabled: true,
      priority: 1,
      keyCursor: 0,
      lastTestStatus: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? 'ok' : 'untested',
      note: '支持直接填入 Google AI Studio (AIzaSy...) 密钥，全工位通用且支持视觉扒剧',
    },
    {
      id: 'prov-deepseek',
      name: 'DeepSeek 高性价比备用线',
      vendor: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKeys: [],
      models: ['deepseek-chat', 'deepseek-reasoner'],
      enabled: true,
      priority: 4,
      keyCursor: 0,
      lastTestStatus: 'untested',
      note: '主线超时或超额时的自动容灾备用线路',
    },
  ];

  const routes: Record<StationRoleKey, StationRouteConfig> = {
    director: {
      roleKey: 'director',
      title: '01 · 总编剧（Chief Director Bot）',
      badge: '核心入口',
      description: '负责接待创作者、1–4条大白话复述需求、指出矛盾、主动提供改编建议、发起停点拍板与真实进度汇报。',
      primaryProviderId: 'prov-openai',
      primaryModel: 'gpt-4o',
      fallbackProviderId: 'prov-deepseek',
      fallbackModel: 'deepseek-chat',
      temperature: 0.35,
      maxTokens: 2048,
      enabled: true,
      systemPrompt:
        '你是短剧工作台的总编剧（Grok Bot 协作风格）。请先用1-3条简明大白话复述用户的项目需求（含流程类别、全剧集数、锁定集数与续写范围、核心要求），再主动给出2-3条专业犀利的短剧改编/创作建议（★首推排第一），最后请用户在卡片拍板。严禁暴露任何模型名、线路名、token或提示词术语。',
    },
    analyst: {
      roleKey: 'analyst',
      title: '02 · 原稿分析师（Source Analyst）',
      badge: '拆剧诊断',
      description: '负责原稿五问、事件映射表、错名清单、逐集情绪曲线生成，以及国内改海外的「桥段出海四级诊断」。',
      primaryProviderId: 'prov-openai',
      primaryModel: 'gpt-4o',
      fallbackProviderId: 'prov-deepseek',
      fallbackModel: 'deepseek-reasoner',
      temperature: 0.2,
      maxTokens: 4096,
      enabled: true,
      systemPrompt:
        '你是资深短剧原稿分析师。请对原稿进行结构化拆解：输出原稿五问结论、核心事件映射、人物错名排查清单、逐集情绪爽点曲线峰值，以及针对跨文化出海的四级桥段诊断。保持客观犀利，不要暴露任何模型或系统术语。',
    },
    vision: {
      roleKey: 'vision',
      title: '03 · 扒剧小能手（Video Transcriber）',
      badge: '视觉还原',
      description: '负责按快速模式（整集看写+抽查）或详细模式（每秒一帧逐格看写）还原分集剧本、锚定标准人名并标记待补写镜头。',
      primaryProviderId: 'prov-gemini',
      primaryModel: 'gemini-2.5-pro',
      fallbackProviderId: 'prov-openai',
      fallbackModel: 'gpt-4o',
      temperature: 0.15,
      maxTokens: 4096,
      enabled: true,
      systemPrompt:
        '你是专业短剧扒剧还原师。严格按照锁定的主角标准人名表还原分集场次、环境、动作（▲）与台词，对看不清的特写或字幕统一标注【待人工補寫】，同步支持繁体单集与简体全集输出。',
    },
    planner: {
      roleKey: 'planner',
      title: '04 · 故事策划师（Story Planner）',
      badge: '主线与三道门',
      description: '负责产出 2–3 套主线与对手方案、过「看得懂关」的简化主线单、国内三道门（世界观/人设/替换）及原创前四层推理。',
      primaryProviderId: 'prov-claude',
      primaryModel: 'anthropic/claude-3.5-sonnet',
      fallbackProviderId: 'prov-openai',
      fallbackModel: 'gpt-4o',
      temperature: 0.5,
      maxTokens: 4096,
      enabled: true,
      systemPrompt:
        '你是短剧故事策划师。负责提供差异化的 2-3 套主线与反派升级方案（★推荐排第一），编写通俗易懂的简化主线单（确保过看得懂关），以及推进世界观、人设、桥段替换三道门与原创前四层推理。',
    },
    writer: {
      roleKey: 'writer',
      title: '05 · 分集编剧（Episode Writer）',
      badge: '细纲与正文',
      description: '负责每 10 集分批细纲、正文前 3 集逐集打磨、放开停点后的整批正文写作，并严格执行前 N 集锁定稿一字不动保护。',
      primaryProviderId: 'prov-claude',
      primaryModel: 'anthropic/claude-3.5-sonnet',
      fallbackProviderId: 'prov-deepseek',
      fallbackModel: 'deepseek-chat',
      temperature: 0.65,
      maxTokens: 8192,
      enabled: true,
      systemPrompt:
        '你是金牌短剧分集编剧。每集必须保证黄金前3秒强冲突切入，事件线与感情线双线推进，集尾留强悬念钩子。续写模式下绝对禁止修改前 N 集锁定稿的任何一个字或标点。',
    },
    polisher: {
      roleKey: 'polisher',
      title: '06 · 审稿官 & 剧本精修师（Script Polisher）',
      badge: '终审与本土化',
      description: '负责自动执行初审、裁定、返修、复核、北美语感与美式幽默精修（Caught in 4K / 冷面自嘲）、终复核及 Word 交付包合成。',
      primaryProviderId: 'prov-claude',
      primaryModel: 'anthropic/claude-3.5-sonnet',
      fallbackProviderId: 'prov-openai',
      fallbackModel: 'gpt-4o',
      temperature: 0.4,
      maxTokens: 4096,
      enabled: true,
      systemPrompt:
        '你是短剧终审官与北美本土化精修师。负责核查台账要求落实情况、消除中式说教腔、注入地道北美豪门/狼人语感与美式冷面幽默，并按「故事梗概 → 人物小传 → 剧本正文」标准格式封装交付。',
    },
  };

  return {
    mode: 'direct_llm',
    backendUrl: process.env.STUDIO_BACKEND_URL || '',
    backendToken: process.env.STUDIO_BACKEND_TOKEN || '',
    requireAuthOnFrontend: false,
    allowInviteRegistration: true,
    globalBudgetCapUsd: 50.0,
    providers,
    routes,
  };
}

function createDefaultAccounts(): StudioAccount[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'acc-admin-ayin',
      username: 'ayin',
      displayName: 'ayin（总负责人 / 主审）',
      role: 'admin',
      password: process.env.STUDIO_ADMIN_PASSWORD || 'ayin888',
      accessKey: 'AYIN-ADMIN-8888-KEY',
      status: 'active',
      budgetCapUsd: 100.0,
      budgetUsedUsd: 0.42,
      tokensUsed: 28400,
      allowedFlows: ['foreign', 'domestic', 'transcribe', 'original'],
      note: '系统最高管理员与创作最终拍板人，拥有 /admin 后台全部权限',
      createdAt: now,
      lastLoginAt: now,
    },
    {
      id: 'acc-creator-01',
      username: 'writer01',
      displayName: '核心编剧 A 组（海外迭代）',
      role: 'creator',
      password: 'writer123',
      accessKey: 'AYIN-KEY-W01-9921',
      status: 'active',
      budgetCapUsd: 15.0,
      budgetUsedUsd: 1.15,
      tokensUsed: 84200,
      allowedFlows: ['foreign', 'domestic', 'transcribe', 'original'],
      note: '负责欧美狼人/豪门线续写与分集扒剧',
      createdAt: now,
    },
    {
      id: 'acc-creator-02',
      username: 'writer02',
      displayName: '出海改编 B 组（三道门）',
      role: 'creator',
      password: 'writer123',
      accessKey: 'AYIN-KEY-W02-7743',
      status: 'active',
      budgetCapUsd: 15.0,
      budgetUsedUsd: 0.68,
      tokensUsed: 49100,
      allowedFlows: ['domestic', 'foreign', 'original'],
      note: '专注国内爆款短剧改北美本土化与原创脑洞',
      createdAt: now,
    },
    {
      id: 'acc-reviewer-01',
      username: 'reviewer01',
      displayName: '剧本审阅与质检组',
      role: 'reviewer',
      password: 'review123',
      accessKey: 'AYIN-KEY-R01-5510',
      status: 'active',
      budgetCapUsd: 5.0,
      budgetUsedUsd: 0.12,
      tokensUsed: 9500,
      allowedFlows: ['foreign', 'domestic', 'transcribe', 'original'],
      note: '负责核对成稿 Word、锁定集逐字比对与终审验收',
      createdAt: now,
    },
  ];
}

function createDefaultInvites(): InviteKeyRecord[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'inv-default-01',
      code: 'AYIN-INV-2026-TEAM01',
      role: 'creator',
      budgetCapUsd: 10.0,
      allowedFlows: ['foreign', 'domestic', 'transcribe', 'original'],
      maxUses: 5,
      usedCount: 0,
      boundAccountIds: [],
      boundUsernames: [],
      note: '编剧团队通用邀请码（成员可直接用此码登录，或用此码激活绑定个人账号密码）',
      status: 'active',
      createdAt: now,
      createdBy: 'ayin',
    },
    {
      id: 'inv-default-02',
      code: 'AYIN-INV-2026-VIP88',
      role: 'creator',
      budgetCapUsd: 25.0,
      allowedFlows: ['foreign', 'domestic', 'transcribe', 'original'],
      maxUses: 1,
      usedCount: 0,
      boundAccountIds: [],
      boundUsernames: [],
      note: '主笔编剧单人专属高额邀请码',
      status: 'active',
      createdAt: now,
      createdBy: 'ayin',
    },
  ];
}

const memoryBucket = new Map<string, ArrayBuffer>();

function loadPersistentStore(): PersistentStoreData {
  const g = globalThis as any;
  if (g.__STUDIO_PERSISTENT_STORE__) {
    return g.__STUDIO_PERSISTENT_STORE__;
  }

  let initial: PersistentStoreData = {
    projects: {},
    accounts: createDefaultAccounts(),
    invites: createDefaultInvites(),
    sessions: {},
    systemConfig: createDefaultSystemConfig(),
    auditLogs: [],
  };

  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      initial = {
        projects: parsed.projects || {},
        accounts: Array.isArray(parsed.accounts) && parsed.accounts.length ? parsed.accounts : initial.accounts,
        invites: Array.isArray(parsed.invites) ? parsed.invites : initial.invites,
        sessions: parsed.sessions || {},
        systemConfig: parsed.systemConfig
          ? {
              ...initial.systemConfig,
              ...parsed.systemConfig,
              routes: { ...initial.systemConfig.routes, ...(parsed.systemConfig.routes || {}) },
            }
          : initial.systemConfig,
        auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
      };
    }
  } catch (_) {}

  g.__STUDIO_PERSISTENT_STORE__ = initial;
  return initial;
}

export function flushPersistentStore() {
  const store = loadPersistentStore();
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (_) {}
}

export function getStore(): PersistentStoreData {
  return loadPersistentStore();
}

export function generateRandomCode(prefix = 'AYIN-KEY'): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = (len: number) =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${prefix}-${seg(4)}-${seg(4)}`;
}

export function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return secret.slice(0, 2) + '***' + secret.slice(-2);
  return secret.slice(0, 6) + '••••' + secret.slice(-4);
}

export function toPublicProfile(acc: StudioAccount): PublicAccountProfile {
  return {
    id: acc.id,
    username: acc.username,
    displayName: acc.displayName,
    role: acc.role,
    budgetCapUsd: acc.budgetCapUsd,
    budgetUsedUsd: Number(acc.budgetUsedUsd.toFixed(4)),
    allowedFlows: acc.allowedFlows,
    accessKeyMasked: maskSecret(acc.accessKey),
  };
}

export function bindings(): any {
  const g = globalThis as any;
  if (g.__STUDIO_BINDINGS__) return g.__STUDIO_BINDINGS__;
  const store = loadPersistentStore();

  return {
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async all() {
                if (sql.includes('FROM studio_projects WHERE owner=?')) {
                  const ownerId = args[0];
                  const results = Object.values(store.projects)
                    .filter((r) => r.owner === ownerId)
                    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
                  return { results };
                }
                if (sql.includes('FROM studio_projects')) {
                  const results = Object.values(store.projects).sort((a, b) =>
                    b.updated_at.localeCompare(a.updated_at)
                  );
                  return { results };
                }
                return { results: [] };
              },
              async first() {
                if (sql.includes('WHERE id=? AND owner=?')) {
                  const [id, ownerId] = args;
                  const row = store.projects[id];
                  if (!row || (row.owner !== ownerId && ownerId !== '__ADMIN_ALL__')) return null;
                  return row;
                }
                return null;
              },
              async run() {
                if (sql.startsWith('INSERT INTO studio_projects')) {
                  const [id, ownerId, data, updated_at] = args;
                  store.projects[id] = { owner: ownerId, data, version: 1, updated_at };
                  flushPersistentStore();
                } else if (sql.startsWith('UPDATE studio_projects')) {
                  const [data, version, updated_at, id, ownerId] = args;
                  const row = store.projects[id];
                  if (row && (row.owner === ownerId || ownerId === '__ADMIN_ALL__')) {
                    store.projects[id] = { owner: row.owner, data, version, updated_at };
                    flushPersistentStore();
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
        const mem = memoryBucket.get(key);
        if (mem) {
          return {
            async arrayBuffer() {
              return mem;
            },
          };
        }
        try {
          const safeFile = path.join(BUCKET_DIR, key.replace(/[^a-zA-Z0-9._-]/g, '_'));
          if (fs.existsSync(safeFile)) {
            const buf = fs.readFileSync(safeFile);
            const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            return {
              async arrayBuffer() {
                return ab;
              },
            };
          }
        } catch (_) {}
        return null;
      },
      async put(key: string, value: ArrayBuffer) {
        memoryBucket.set(key, value);
        try {
          if (!fs.existsSync(BUCKET_DIR)) {
            fs.mkdirSync(BUCKET_DIR, { recursive: true });
          }
          const safeFile = path.join(BUCKET_DIR, key.replace(/[^a-zA-Z0-9._-]/g, '_'));
          fs.writeFileSync(safeFile, Buffer.from(value));
        } catch (_) {}
      },
    },
    STUDIO_BACKEND_URL: store.systemConfig.backendUrl || process.env.STUDIO_BACKEND_URL || '',
    STUDIO_BACKEND_TOKEN: store.systemConfig.backendToken || process.env.STUDIO_BACKEND_TOKEN || '',
    OPENAI_API_KEY:
      store.systemConfig.providers.find((p) => p.enabled && p.apiKeys.length > 0)?.apiKeys[0] ||
      process.env.OPENAI_API_KEY ||
      '',
    OPENAI_BASE_URL:
      store.systemConfig.providers.find((p) => p.enabled && p.apiKeys.length > 0)?.baseUrl ||
      process.env.OPENAI_BASE_URL ||
      'https://api.openai.com/v1',
  };
}

export function parseSessionTokenFromRequest(request?: Request): string | null {
  if (!request) return null;
  const headerToken =
    request.headers.get('x-studio-token') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (headerToken && headerToken.trim()) return headerToken.trim();

  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)studio_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function resolveAccountFromRequest(request?: Request): StudioAccount | null {
  const store = loadPersistentStore();
  const token = parseSessionTokenFromRequest(request);
  if (token) {
    // 1. Check active session token
    const sess = store.sessions[token];
    if (sess) {
      const acc = store.accounts.find((a) => a.id === sess.accountId && a.status === 'active');
      if (acc) return acc;
    }
    // 2. Allow direct Access Key authentication via header/cookie
    const byKey = store.accounts.find((a) => a.accessKey === token && a.status === 'active');
    if (byKey) return byKey;
  }
  return null;
}

export async function owner(request?: Request): Promise<string> {
  const g = globalThis as any;
  if (g.__STUDIO_BINDINGS__ && 'CURRENT_USER' in g.__STUDIO_BINDINGS__) {
    if (g.__STUDIO_BINDINGS__.CURRENT_USER === null) throw new Error('AUTH_REQUIRED');
    return g.__STUDIO_BINDINGS__.CURRENT_USER;
  }
  const acc = resolveAccountFromRequest(request);
  if (acc) return acc.username;

  const store = loadPersistentStore();
  if (store.systemConfig.requireAuthOnFrontend) {
    throw new Error('AUTH_REQUIRED');
  }
  return process.env.STUDIO_DEFAULT_USER || 'ayin';
}

export function getActiveAccountOrDefault(request?: Request): StudioAccount {
  const acc = resolveAccountFromRequest(request);
  if (acc) return acc;
  const store = loadPersistentStore();
  return store.accounts.find((a) => a.username === 'ayin') || store.accounts[0];
}

export function createSessionForAccount(acc: StudioAccount): string {
  const store = loadPersistentStore();
  const token = 'sess_' + crypto.randomUUID().replace(/-/g, '');
  acc.lastLoginAt = new Date().toISOString();
  store.sessions[token] = {
    accountId: acc.id,
    username: acc.username,
    createdAt: acc.lastLoginAt,
  };
  flushPersistentStore();
  return token;
}

export function connected(): boolean {
  const store = loadPersistentStore();
  const b = bindings();
  if (store.systemConfig.mode === 'custom_backend' || store.systemConfig.mode === 'hybrid') {
    return Boolean(store.systemConfig.backendUrl || b.STUDIO_BACKEND_URL || process.env.STUDIO_BACKEND_URL);
  }
  return Boolean(b.STUDIO_BACKEND_URL || process.env.STUDIO_BACKEND_URL);
}

export function gptAvailable(): boolean {
  const store = loadPersistentStore();
  const hasProviderKey = store.systemConfig.providers.some((p) => p.enabled && p.apiKeys.some((k) => k.trim().length > 0));
  if (hasProviderKey) return true;
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
  'apikey',
  'password',
  'accesskey',
]);

/**
 * Redline filter: User-facing pages, API responses, errors, and exports MUST NEVER expose
 * model names, route names, token counts, or raw system prompts.
 */
export function sanitizeForClient<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return input
      .replace(
        /\b(gpt-4[a-z0-9.-]*|gpt-5[a-z0-9.-]*|o1-[a-z0-9.-]*|o3-[a-z0-9.-]*|claude-[a-z0-9.-]+|gemini-[a-z0-9.-]+|deepseek-[a-z0-9.-]+|grok-[a-z0-9.-]+)\b/gi,
        '创作引擎'
      )
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

/**
 * Executes an LLM chat request against either an OpenAI-compatible `/chat/completions` endpoint
 * OR Google Gemini's native `generateContent` endpoint automatically when a Gemini URL/Key is used.
 */
export async function executeProviderChat(params: {
  provider: ApiProviderConfig;
  apiKey: string;
  model: string;
  sysPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
}): Promise<{ reply: string; totalTokens: number }> {
  const baseUrl = params.provider.baseUrl.replace(/\/+$/, '');
  const isGeminiNativeUrl =
    baseUrl.includes('generativelanguage.googleapis.com') && !baseUrl.endsWith('/openai');

  if (isGeminiNativeUrl) {
    const cleanModel = params.model.replace(/^models\//, '');
    const geminiUrl = `${baseUrl}/models/${cleanModel}:generateContent?key=${encodeURIComponent(params.apiKey)}`;
    const res = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(params.sysPrompt
          ? { systemInstruction: { parts: [{ text: params.sysPrompt }] } }
          : {}),
        contents: [{ role: 'user', parts: [{ text: params.userPrompt }] }],
        generationConfig: {
          temperature: params.temperature,
          maxOutputTokens: params.maxTokens,
        },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 140)}`);
    }
    const data: any = await res.json();
    const reply = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
    const totalTokens = Number(
      data?.usageMetadata?.totalTokenCount ||
        Math.ceil((params.sysPrompt.length + params.userPrompt.length + reply.length) / 3)
    );
    return { reply, totalTokens };
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      messages: [
        ...(params.sysPrompt ? [{ role: 'system', content: params.sysPrompt }] : []),
        { role: 'user', content: params.userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 140)}`);
  }
  const data: any = await res.json();
  const reply = data?.choices?.[0]?.message?.content || '';
  const totalTokens = Number(
    data?.usage?.total_tokens ||
      Math.ceil((params.sysPrompt.length + params.userPrompt.length + reply.length) / 3)
  );
  return { reply, totalTokens };
}
/**
 * Calls a specific AI Station (e.g. 'director', 'analyst', 'vision', 'planner', 'writer', 'polisher')
 * using the server-side Admin Provider Pool & Station Routing configuration, with automatic multi-key
 * round-robin rotation, fallback provider failover, budget check, and audit logging.
 */
export async function callStationLLM(params: {
  station: StationRoleKey;
  userPrompt: string;
  systemPromptOverride?: string;
  account?: StudioAccount;
  projectId?: string;
}): Promise<{ ok: boolean; text: string | null; error?: string }> {
  const store = loadPersistentStore();
  const route = store.systemConfig.routes[params.station];
  const acc = params.account || store.accounts[0];

  // 1. Check account budget cap
  if (acc && acc.budgetCapUsd > 0 && acc.budgetUsedUsd >= acc.budgetCapUsd) {
    return { ok: false, text: null, error: 'BUDGET_EXCEEDED' };
  }

  const candidateTargets: { provider: ApiProviderConfig; model: string; isFallback: boolean }[] = [];

  if (route && route.enabled) {
    const primaryProv = store.systemConfig.providers.find(
      (p) => p.id === route.primaryProviderId && p.enabled && p.apiKeys.some((k) => k.trim())
    );
    if (primaryProv) {
      candidateTargets.push({
        provider: primaryProv,
        model: route.primaryModel || primaryProv.models[0] || 'gpt-4o-mini',
        isFallback: false,
      });
    }
    if (route.fallbackProviderId) {
      const fallbackProv = store.systemConfig.providers.find(
        (p) => p.id === route.fallbackProviderId && p.enabled && p.apiKeys.some((k) => k.trim())
      );
      if (fallbackProv) {
        candidateTargets.push({
          provider: fallbackProv,
          model: route.fallbackModel || fallbackProv.models[0] || 'gpt-4o-mini',
          isFallback: true,
        });
      }
    }
  }

  // Fallback to any enabled provider with a key or env GEMINI_API_KEY / OPENAI_API_KEY
  if (candidateTargets.length === 0) {
    const anyProv = store.systemConfig.providers.find((p) => p.enabled && p.apiKeys.some((k) => k.trim()));
    if (anyProv) {
      candidateTargets.push({
        provider: anyProv,
        model: anyProv.models[0] || 'gemini-2.5-flash',
        isFallback: false,
      });
    } else if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
      candidateTargets.push({
        provider: {
          id: 'env-gemini',
          name: '环境变量 Gemini 通道',
          vendor: 'gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKeys: [String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)],
          models: ['gemini-2.5-flash'],
          enabled: true,
          priority: 98,
        },
        model: 'gemini-2.5-flash',
        isFallback: false,
      });
    } else if (process.env.OPENAI_API_KEY) {
      candidateTargets.push({
        provider: {
          id: 'env-openai',
          name: '环境变量默认通道',
          vendor: 'openai',
          baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
          apiKeys: [process.env.OPENAI_API_KEY],
          models: [process.env.OPENAI_MODEL || 'gpt-4o-mini'],
          enabled: true,
          priority: 99,
        },
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        isFallback: false,
      });
    }
  }

  if (candidateTargets.length === 0) {
    return { ok: false, text: null, error: 'NO_API_KEY_CONFIGURED' };
  }

  const sysPrompt = params.systemPromptOverride || route?.systemPrompt || '';
  const temperature = route?.temperature ?? 0.35;
  const maxTokens = route?.maxTokens ?? 2048;

  for (const target of candidateTargets) {
    const validKeys = target.provider.apiKeys.map((k) => k.trim()).filter(Boolean);
    if (!validKeys.length) continue;

    const cursor = (target.provider.keyCursor || 0) % validKeys.length;
    const apiKey = validKeys[cursor];
    target.provider.keyCursor = cursor + 1;

    const t0 = Date.now();
    try {
      const { reply, totalTokens } = await executeProviderChat({
        provider: target.provider,
        apiKey,
        model: target.model,
        sysPrompt,
        userPrompt: params.userPrompt,
        temperature,
        maxTokens,
      });

      const latencyMs = Date.now() - t0;
      const estimatedCostUsd = Number(((totalTokens / 1000) * 0.002).toFixed(5));

      if (typeof reply === 'string' && reply.trim()) {
        target.provider.lastTestStatus = 'ok';
        target.provider.lastLatencyMs = latencyMs;
        target.provider.lastTestedAt = new Date().toISOString();

        if (acc) {
          acc.tokensUsed = (acc.tokensUsed || 0) + totalTokens;
          acc.budgetUsedUsd = Number(((acc.budgetUsedUsd || 0) + estimatedCostUsd).toFixed(5));
        }

        const logEntry: ApiAuditLog = {
          id: 'log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          time: new Date().toISOString(),
          accountId: acc?.id || 'system',
          username: acc?.username || 'ayin',
          projectId: params.projectId,
          station: params.station,
          stationTitle: route?.title || params.station,
          providerId: target.provider.id,
          providerName: target.provider.name,
          model: target.model,
          latencyMs,
          tokens: totalTokens,
          estimatedCostUsd,
          status: target.isFallback ? 'fallback' : 'success',
        };
        store.auditLogs.unshift(logEntry);
        if (store.auditLogs.length > 200) store.auditLogs.length = 200;
        flushPersistentStore();

        return { ok: true, text: sanitizeForClient(reply.trim()) };
      }
    } catch (err: any) {
      const latencyMs = Date.now() - t0;
      target.provider.lastTestStatus = 'error';
      target.provider.lastErrorMsg = err?.message || 'Request failed';
      target.provider.lastTestedAt = new Date().toISOString();

      store.auditLogs.unshift({
        id: 'log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        time: new Date().toISOString(),
        accountId: acc?.id || 'system',
        username: acc?.username || 'ayin',
        projectId: params.projectId,
        station: params.station,
        stationTitle: route?.title || params.station,
        providerId: target.provider.id,
        providerName: target.provider.name,
        model: target.model,
        latencyMs,
        tokens: 0,
        estimatedCostUsd: 0,
        status: 'failed',
        error: String(err?.message || 'Unknown error').slice(0, 160),
      });
      flushPersistentStore();
    }
  }

  return { ok: false, text: null, error: 'BACKEND_REQUEST_FAILED' };
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
  parsed.owner = row.owner || user;
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
  p.owner = p.owner || user;
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
  pathStr: string,
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
  const res = await fetch(baseUrl + pathStr, {
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
    FORBIDDEN_ADMIN_ONLY: 403,
    ACCOUNT_DISABLED: 403,
    INVALID_CREDENTIALS: 401,
    INVALID_INVITE_CODE: 400,
    USERNAME_EXISTS: 409,
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
