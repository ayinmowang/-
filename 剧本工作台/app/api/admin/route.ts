import {
  adminConfirmOrder,
  adminSavePlan,
  listAllCommerceForAdmin,
} from '../../../lib/commerce';
import {
  callStationLLM,
  createSkillPlugin,
  deleteSkillPlugin,
  executeProviderChat,
  failure,
  flushPersistentStore,
  generateRandomCode,
  getStore,
  hashPassword,
  invalidateProviderModelCache,
  maskSecret,
  normalizeCreationTiers,
  replaceSkillPlugin,
  resolveAccountFromRequest,
  setDefaultSkillPlugin,
  toggleSkillPlugin,
  toPublicProfile,
} from '../../../lib/server';
import type {
  AccountRole,
  ApiProviderConfig,
  InviteKeyRecord,
  Kind,
  PromptSlotKey,
  StationRoleKey,
  StudioAccount,
} from '../../../lib/types';

function maskProviderKey(raw: string): string {
  const k = String(raw || '').trim();
  if (!k) return '';
  if (k.length <= 4) return '****';
  if (k.length <= 12) return `****${k.slice(-Math.min(4, Math.max(2, k.length - 4)))}`;
  return `${k.slice(0, 6)}****${k.slice(-4)}`;
}

function maskBackendToken(raw: string): string {
  const t = String(raw || '').trim();
  if (!t) return '';
  return t.length <= 4 ? '****' : `****${t.slice(-4)}`;
}

function isMaskedPlaceholder(
  val: string,
  knownSecrets: string[] = [],
  maskFn: (s: string) => string = maskProviderKey,
): boolean {
  const s = String(val || '').trim();
  if (!s) return false;
  if (/^[•*]{4,}$/.test(s)) return true;
  if (knownSecrets.some((sec) => maskFn(sec) === s || maskSecret(sec) === s)) return true;
  if (s.includes('****') || s.includes('••••')) return true;
  return false;
}

function collectKnownSecrets(store: ReturnType<typeof getStore>): string[] {
  const secrets: string[] = [];
  for (const prov of store.systemConfig.providers || []) {
    for (const k of prov.apiKeys || []) {
      const trimmed = String(k || '').trim();
      if (trimmed.length >= 4) secrets.push(trimmed);
    }
  }
  const bt = String(store.systemConfig.backendToken || '').trim();
  if (bt.length >= 4) secrets.push(bt);
  return Array.from(new Set(secrets)).sort((a, b) => b.length - a.length);
}

function redactErrorSecrets(
  msg: string | undefined,
  knownSecrets: string[] = [],
): string | undefined {
  if (!msg) return msg;
  let out = msg
    .replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, '$1****')
    .replace(/\bBearer\s+\S+/gi, 'Bearer ****')
    .replace(/\bsk-[A-Za-z0-9_-]{4,}\b/g, 'sk-****')
    .replace(/\bAIza[A-Za-z0-9_-]{4,}\b/g, 'AIza****')
    .replace(/\bxai-[A-Za-z0-9_-]{4,}\b/g, 'xai-****');
  const uniqueSorted = Array.from(
    new Set(knownSecrets.map((s) => String(s || '').trim()).filter((s) => s.length >= 4)),
  ).sort((a, b) => b.length - a.length);
  for (const sec of uniqueSorted) {
    if (out.includes(sec)) {
      out = out.split(sec).join('****');
    }
  }
  return out;
}

function parseProviderKeyList(input: unknown): string[] {
  return (Array.isArray(input) ? input.join('\n') : String(input || ''))
    .split(/[\n,，;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function requireAdminAccount(request: Request): StudioAccount {
  const acc = resolveAccountFromRequest(request);
  if (!acc) {
    throw new Error('AUTH_REQUIRED');
  }
  if (acc.role !== 'admin') {
    throw new Error('FORBIDDEN_ADMIN_ONLY');
  }
  return acc;
}

function buildAdminSnapshot(adminAcc: StudioAccount) {
  const store = getStore();
  const projectRows = Object.values(store.projects);

  const projectCountByOwner: Record<string, number> = {};
  const projectsSummary = projectRows
    .map((row) => {
      projectCountByOwner[row.owner] = (projectCountByOwner[row.owner] || 0) + 1;
      try {
        const p = JSON.parse(row.data);
        return {
          id: p.id,
          owner: row.owner,
          title: p.title,
          kind: p.kind,
          total: p.total,
          lockedEpisodes: p.lockedEpisodes || null,
          confirmed: Boolean(p.confirmed),
          archived: Boolean(p.archived),
          stageTitle: p.remote?.stage?.title || (p.confirmed ? '方向已确认' : '待核对复述'),
          status: p.remote?.status || (p.confirmed ? 'confirmed' : 'draft'),
          attachmentsCount: Array.isArray(p.attachments) ? p.attachments.length : 0,
          requirementsCount: Array.isArray(p.requirements) ? p.requirements.length : 0,
          updatedAt: row.updated_at || p.updatedAt,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  const accountsWithStats = store.accounts.map((acc) => ({
    ...acc,
    password: '••••••••',
    passwordHashed: Boolean(typeof acc.password === 'string' && acc.password.startsWith('scrypt$')),
    projectCount: projectCountByOwner[acc.username] || 0,
  }));
  const commerce = listAllCommerceForAdmin();
  const knownSecrets = collectKnownSecrets(store);

  const sanitizedProviders = (store.systemConfig.providers || []).map((prov) => {
    const validKeys = (prov.apiKeys || []).map((k) => String(k || '').trim()).filter(Boolean);
    const { apiKeys: _omitApiKeys, ...provRest } = prov;
    return {
      ...provRest,
      apiKeysMasked: validKeys.map(maskProviderKey),
      apiKeyCount: validKeys.length,
      hasApiKeys: validKeys.length > 0,
      ...(prov.lastErrorMsg !== undefined
        ? { lastErrorMsg: redactErrorSecrets(prov.lastErrorMsg, knownSecrets) }
        : {}),
    };
  });

  const rawBackendToken = String(store.systemConfig.backendToken || '').trim();
  const { backendToken: _omitBackendToken, ...sysConfigRest } = store.systemConfig;

  return {
    authorized: true,
    adminAccount: toPublicProfile(adminAcc),
    accounts: accountsWithStats,
    invites: store.invites,
    systemConfig: {
      ...sysConfigRest,
      providers: sanitizedProviders,
      backendTokenMasked: maskBackendToken(rawBackendToken),
      hasBackendToken: rawBackendToken.length > 0,
      skillPlugins: Array.isArray(store.systemConfig.skillPlugins) ? store.systemConfig.skillPlugins : [],
      creationTiers: normalizeCreationTiers(store.systemConfig.creationTiers),
    },
    projectsSummary,
    auditLogs: store.auditLogs.slice(0, 100).map((log) => ({
      ...log,
      ...(log.error !== undefined ? { error: redactErrorSecrets(log.error, knownSecrets) } : {}),
    })),
    plans: commerce.plans,
    orders: commerce.orders,
    subscriptions: commerce.subscriptions,
  };
}

interface ParsedAdminRequestBody {
  raw: Record<string, any>;
  isMultipart: boolean;
  fileBytes?: Uint8Array;
  uploadedFileName?: string;
  hasField: (key: string) => boolean;
}

function parseOptionalBoolean(val: unknown): boolean | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'boolean') return val;
  const s = String(val).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
  return undefined;
}

async function parseAdminPostBody(request: Request): Promise<ParsedAdminRequestBody> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('multipart/form-data')) {
    const formData = await request.formData().catch(() => null);
    if (!formData) throw new Error('INVALID_INPUT');

    const raw: Record<string, any> = {};
    const presentKeys = new Set<string>();
    let fileBytes: Uint8Array | undefined;
    let uploadedFileName: string | undefined;

    for (const [k, v] of formData.entries()) {
      presentKeys.add(k);
      if (k === 'file' && typeof v !== 'string' && typeof (v as any).arrayBuffer === 'function') {
        const fileObj = v as File;
        fileBytes = new Uint8Array(await fileObj.arrayBuffer());
        uploadedFileName = fileObj.name || undefined;
      } else if (typeof v === 'string') {
        raw[k] = v;
      }
    }

    return {
      raw,
      isMultipart: true,
      fileBytes,
      uploadedFileName,
      hasField: (key: string) => presentKeys.has(key),
    };
  }

  const jsonBody: any = await request.json().catch(() => ({}));
  const raw = jsonBody && typeof jsonBody === 'object' && !Array.isArray(jsonBody) ? jsonBody : {};
  return {
    raw,
    isMultipart: false,
    hasField: (key: string) => Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined,
  };
}

export async function GET(request: Request) {
  try {
    const adminAcc = requireAdminAccount(request);
    return Response.json(buildAdminSnapshot(adminAcc));
  } catch (e: any) {
    if (e?.message === 'AUTH_REQUIRED' || e?.message === 'FORBIDDEN_ADMIN_ONLY') {
      return Response.json({ authorized: false, error: e.message }, { status: 401 });
    }
    return failure(e);
  }
}

export async function POST(request: Request) {
  try {
    const adminAcc = requireAdminAccount(request);
    const store = getStore();
    const parsed = await parseAdminPostBody(request);
    const body = parsed.raw;
    const op = String(body.operation || '').trim();

    // 1. Create a new team account (Username + Password + Exclusive Key)
    if (op === 'create_account') {
      const username = String(body.username || '').trim().toLowerCase();
      const displayName = String(body.displayName || username).trim();
      const password = String(body.password || 'writer123').trim();
      const role: AccountRole = ['admin', 'creator', 'reviewer'].includes(body.role) ? body.role : 'creator';
      const budgetCapUsd = Math.max(0, Number(body.budgetCapUsd ?? 15));
      const customKey = String(body.accessKey || '').trim();
      const note = String(body.note || '').trim();
      const allowedFlows: Kind[] =
        Array.isArray(body.allowedFlows) && body.allowedFlows.length
          ? body.allowedFlows
          : ['foreign', 'domestic', 'transcribe', 'original'];

      if (!username || username.length < 2 || !password) {
        throw new Error('INVALID_INPUT');
      }
      if (store.accounts.some((a) => a.username.toLowerCase() === username)) {
        throw new Error('USERNAME_EXISTS');
      }

      const now = new Date().toISOString();
      const newAcc: StudioAccount = {
        id: 'acc-' + crypto.randomUUID(),
        username,
        displayName: displayName.slice(0, 50),
        role,
        password: hashPassword(password),
        accessKey: customKey || generateRandomCode('AYIN-KEY'),
        status: 'active',
        budgetCapUsd,
        budgetUsedUsd: 0,
        tokensUsed: 0,
        allowedFlows,
        note,
        createdAt: now,
      };
      store.accounts.push(newAcc);
      flushPersistentStore();
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 2. Update an existing account
    if (op === 'update_account') {
      const acc = store.accounts.find((a) => a.id === body.id);
      if (!acc) throw new Error('NOT_FOUND');

      if (body.displayName !== undefined && body.displayName !== null) {
        acc.displayName = String(body.displayName).trim().slice(0, 50);
      }
      const nextPassword =
        body.password !== undefined && body.password !== null ? String(body.password).trim() : '';
      if (nextPassword && !/^[•*]{4,}$/.test(nextPassword)) {
        acc.password = hashPassword(nextPassword);
      }
      if (body.role && ['admin', 'creator', 'reviewer'].includes(body.role)) {
        acc.role = body.role;
      }
      if (body.status && ['active', 'disabled'].includes(body.status)) {
        // Prevent disabling the last admin
        if (acc.username === 'ayin' && body.status === 'disabled') {
          throw new Error('INVALID_INPUT');
        }
        acc.status = body.status;
      }
      if (body.budgetCapUsd !== undefined && body.budgetCapUsd !== null && Number.isFinite(Number(body.budgetCapUsd))) {
        acc.budgetCapUsd = Math.max(0, Number(body.budgetCapUsd));
      }
      if (body.resetUsage === true) {
        acc.budgetUsedUsd = 0;
        acc.tokensUsed = 0;
      }
      if (body.note !== undefined && body.note !== null) {
        acc.note = String(body.note);
      }
      if (Array.isArray(body.allowedFlows) && body.allowedFlows.length > 0) {
        acc.allowedFlows = body.allowedFlows;
      }
      flushPersistentStore();
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 3. Regenerate Exclusive Access Key for an account
    if (op === 'regenerate_key') {
      const acc = store.accounts.find((a) => a.id === body.id);
      if (!acc) throw new Error('NOT_FOUND');
      acc.accessKey = generateRandomCode(acc.role === 'admin' ? 'AYIN-ADMIN' : 'AYIN-KEY');
      flushPersistentStore();
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 4. Delete an account
    if (op === 'delete_account') {
      const acc = store.accounts.find((a) => a.id === body.id);
      if (!acc || acc.username === 'ayin') throw new Error('INVALID_INPUT');
      store.accounts = store.accounts.filter((a) => a.id !== body.id);
      flushPersistentStore();
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 5. Generate Exclusive Invite Codes (Single or Batch)
    if (op === 'generate_invites') {
      const count = Math.min(20, Math.max(1, Number(body.count || 1)));
      const role: AccountRole = ['admin', 'creator', 'reviewer'].includes(body.role) ? body.role : 'creator';
      const budgetCapUsd = Math.max(0, Number(body.budgetCapUsd ?? 15));
      const maxUses = Math.max(1, Number(body.maxUses || 1));
      const prefix = String(body.prefix || 'AYIN-INV').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') || 'AYIN-INV';
      const note = String(body.note || '团队专属邀请码').trim();
      const now = new Date().toISOString();

      for (let i = 0; i < count; i++) {
        const rec: InviteKeyRecord = {
          id: 'inv-' + crypto.randomUUID(),
          code: generateRandomCode(prefix),
          role,
          budgetCapUsd,
          allowedFlows: ['foreign', 'domestic', 'transcribe', 'original'],
          maxUses,
          usedCount: 0,
          boundAccountIds: [],
          boundUsernames: [],
          note,
          status: 'active',
          createdAt: now,
          createdBy: adminAcc.username,
        };
        store.invites.unshift(rec);
      }
      flushPersistentStore();
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 6. Revoke or Delete Invite Code
    if (op === 'revoke_invite') {
      const inv = store.invites.find((x) => x.id === body.id);
      if (!inv) throw new Error('NOT_FOUND');
      inv.status = inv.status === 'revoked' ? 'active' : 'revoked';
      flushPersistentStore();
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    if (op === 'delete_invite') {
      store.invites = store.invites.filter((x) => x.id !== body.id);
      flushPersistentStore();
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 7. Save or Update API Provider in Provider Pool
    if (op === 'save_provider') {
      const pData = body.provider || {};
      const baseUrl = String(pData.baseUrl || '').trim();
      const name = String(pData.name || '').trim();
      if (!name || !baseUrl) throw new Error('INVALID_INPUT');

      const existingIdx = store.systemConfig.providers.findIndex((p) => p.id === pData.id);
      const existingProvider = existingIdx >= 0 ? store.systemConfig.providers[existingIdx] : undefined;
      const existingKeys = existingProvider
        ? (existingProvider.apiKeys || []).map((k) => String(k || '').trim()).filter(Boolean)
        : [];

      const clearApiKeys = parseOptionalBoolean(body.clearApiKeys ?? pData.clearApiKeys) === true;
      const removeKeyIndicesRaw = body.removeKeyIndices ?? pData.removeKeyIndices;
      const hasRemoveIndices = Array.isArray(removeKeyIndicesRaw);
      const newApiKeysRaw = body.newApiKeys !== undefined ? body.newApiKeys : pData.newApiKeys;
      const hasNewApiKeys = newApiKeysRaw !== undefined && newApiKeysRaw !== null;
      const replaceApiKeys = parseOptionalBoolean(body.replaceApiKeys ?? pData.replaceApiKeys) === true;

      let resolvedKeys: string[];
      if (clearApiKeys) {
        resolvedKeys = [];
      } else if (hasNewApiKeys || hasRemoveIndices) {
        const removeSet = new Set<number>(
          hasRemoveIndices
            ? removeKeyIndicesRaw.map((idx: unknown) => Number(idx)).filter((idx: number) => Number.isInteger(idx))
            : [],
        );
        const base = existingKeys.filter((_, idx) => !removeSet.has(idx));
        const parsedNew = hasNewApiKeys
          ? parseProviderKeyList(newApiKeysRaw).filter((k) => !isMaskedPlaceholder(k, existingKeys, maskProviderKey))
          : [];
        resolvedKeys = replaceApiKeys ? parsedNew : Array.from(new Set([...base, ...parsedNew]));
      } else if (pData.apiKeys !== undefined && pData.apiKeys !== null) {
        const entries = parseProviderKeyList(pData.apiKeys);
        if (entries.length === 0) {
          resolvedKeys = [];
        } else if (entries.every((e) => /^[•*]{4,}$/.test(e))) {
          resolvedKeys = [...existingKeys];
        } else {
          const usedExistingIndices = new Set<number>();
          const nextKeys: string[] = [];
          for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (isMaskedPlaceholder(entry, existingKeys, maskProviderKey)) {
              let matchedIdx = existingKeys.findIndex(
                (sec, idx) =>
                  !usedExistingIndices.has(idx) &&
                  (maskProviderKey(sec) === entry || maskSecret(sec) === entry),
              );
              if (matchedIdx < 0 && /^[•*]{4,}$/.test(entry) && i < existingKeys.length && !usedExistingIndices.has(i)) {
                matchedIdx = i;
              }
              if (matchedIdx >= 0) {
                usedExistingIndices.add(matchedIdx);
                nextKeys.push(existingKeys[matchedIdx]);
              }
            } else {
              nextKeys.push(entry);
            }
          }
          if (
            nextKeys.length === 0 &&
            existingKeys.length > 0 &&
            entries.every((e) => isMaskedPlaceholder(e, existingKeys, maskProviderKey))
          ) {
            resolvedKeys = [...existingKeys];
          } else {
            resolvedKeys = Array.from(new Set(nextKeys));
          }
        }
      } else {
        resolvedKeys = [...existingKeys];
      }

      const rawModels = (Array.isArray(pData.models) ? pData.models.join(',') : String(pData.models || ''))
        .split(/[\n,，、;；]+/)
        .map((s: string) => s.trim())
        .filter(Boolean);

      const updatedProvider: ApiProviderConfig = {
        id: pData.id || 'prov-' + Date.now(),
        name,
        vendor: pData.vendor || 'custom',
        baseUrl: baseUrl.replace(/\/+$/, ''),
        backupBaseUrl1: String(pData.backupBaseUrl1 || '').trim().replace(/\/+$/, ''),
        backupBaseUrl2: String(pData.backupBaseUrl2 || '').trim().replace(/\/+$/, ''),
        apiKeys: resolvedKeys,
        models: rawModels.length ? rawModels : ['gpt-4o', 'gemini-2.5-pro'],
        enabled: pData.enabled !== false,
        priority: Number(pData.priority || store.systemConfig.providers.length + 1),
        note: String(pData.note || ''),
        lastTestStatus: existingProvider ? existingProvider.lastTestStatus : 'untested',
        lastLatencyMs: existingProvider ? existingProvider.lastLatencyMs : undefined,
        lastTestedAt: existingProvider ? existingProvider.lastTestedAt : undefined,
        ...(existingProvider?.lastErrorMsg !== undefined ? { lastErrorMsg: existingProvider.lastErrorMsg } : {}),
      };

      if (existingIdx >= 0) {
        store.systemConfig.providers[existingIdx] = updatedProvider;
      } else {
        store.systemConfig.providers.push(updatedProvider);
      }

      // Auto-sync any station routes bound to this provider whose model is not in the updated models list
      if (updatedProvider.models.length > 0) {
        const firstGpt = updatedProvider.models.find((m) => !/gemini/i.test(m)) || updatedProvider.models[0];
        const firstGemini = updatedProvider.models.find((m) => /gemini/i.test(m)) || updatedProvider.models[0];
        for (const rKey of Object.keys(store.systemConfig.routes || {})) {
          const r = (store.systemConfig.routes as any)[rKey];
          if (r && r.primaryProviderId === updatedProvider.id && !updatedProvider.models.includes(r.primaryModel)) {
            r.primaryModel = ['vision', 'planner', 'writer'].includes(rKey) ? firstGemini : firstGpt;
          }
          if (r && r.fallbackProviderId === updatedProvider.id && !updatedProvider.models.includes(r.fallbackModel)) {
            r.fallbackModel = ['vision', 'planner', 'writer'].includes(rKey) ? firstGpt : firstGemini;
          }
        }
      }

      invalidateProviderModelCache(updatedProvider.id);
      flushPersistentStore();
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 8. Delete API Provider
    if (op === 'delete_provider') {
      const deletedId = String(body.id || '').trim();
      store.systemConfig.providers = store.systemConfig.providers.filter((p) => p.id !== deletedId);
      if (deletedId) {
        invalidateProviderModelCache(deletedId);
      }
      flushPersistentStore();
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 9. Test API Provider Connectivity & Latency (Server-Side)
    if (op === 'test_provider') {
      const prov = store.systemConfig.providers.find((p) => p.id === body.id);
      if (!prov) throw new Error('NOT_FOUND');

      const validKeys = prov.apiKeys.map((k) => k.trim()).filter(Boolean);
      if (!validKeys.length) {
        prov.lastTestStatus = 'error';
        prov.lastErrorMsg = '尚未填写 API Key';
        prov.lastTestedAt = new Date().toISOString();
        flushPersistentStore();
        return Response.json({
          ...buildAdminSnapshot(adminAcc),
          testResult: { ok: false, error: '请先为该渠道填写至少一个 API Key 并保存。' },
        });
      }

      const testModel = body.model || prov.models[0] || 'gemini-2.5-flash';
      const knownSecrets = collectKnownSecrets(store);
      const t0 = Date.now();
      try {
        const { reply, resolvedModel } = await executeProviderChat({
          provider: prov,
          apiKey: validKeys[0],
          model: testModel,
          sysPrompt: '',
          userPrompt: '请用一句话回复：剧本工作台渠道连通正常！',
          temperature: 0.2,
          maxTokens: 48,
        });
        const latencyMs = Date.now() - t0;
        const actualModel = resolvedModel || testModel;
        if (resolvedModel && !prov.models.includes(resolvedModel)) {
          prov.models = [resolvedModel, ...prov.models];
        }
        prov.lastTestStatus = 'ok';
        prov.lastLatencyMs = latencyMs;
        prov.lastTestedAt = new Date().toISOString();
        prov.lastErrorMsg = undefined;
        flushPersistentStore();
        return Response.json({
          ...buildAdminSnapshot(adminAcc),
          testResult: {
            ok: true,
            latencyMs,
            model: actualModel,
            reply: redactErrorSecrets(String(reply), knownSecrets)?.slice(0, 120) || '',
          },
        });
      } catch (err: any) {
        const latencyMs = Date.now() - t0;
        const safeErrorMsg =
          redactErrorSecrets(String(err?.message || '连接失败'), knownSecrets)?.slice(0, 160) || '连接失败';
        prov.lastTestStatus = 'error';
        prov.lastLatencyMs = latencyMs;
        prov.lastTestedAt = new Date().toISOString();
        prov.lastErrorMsg = safeErrorMsg;
        flushPersistentStore();
        return Response.json({
          ...buildAdminSnapshot(adminAcc),
          testResult: {
            ok: false,
            latencyMs,
            error: safeErrorMsg,
          },
        });
      }
    }

    // 9b. Auto-fetch available models from Relay's GET /v1/models AND GET /api/pricing (grouped by Gemini & GPT)
    if (op === 'fetch_provider_models') {
      const prov = store.systemConfig.providers.find((p) => p.id === body.id);
      if (!prov) throw new Error('NOT_FOUND');

      const requestedFamilies: string[] = Array.isArray(body.families) && body.families.length
        ? body.families
        : ['gemini', 'gpt'];
      const wantGemini = requestedFamilies.includes('gemini');
      const wantGpt = requestedFamilies.includes('gpt');

      const validKeys = prov.apiKeys.map((k) => k.trim()).filter(Boolean);
      const urls = [prov.baseUrl, prov.backupBaseUrl1, prov.backupBaseUrl2]
        .map((u) => String(u || '').trim().replace(/\/+$/, ''))
        .filter(Boolean);

      const discoveredSet = new Set<string>();
      const keyDirectSet = new Set<string>();

      for (const u of urls) {
        // 1. Query /v1/models for each configured API key
        for (const k of validKeys) {
          try {
            const res = await fetch(`${u}/models`, {
              headers: { Authorization: `Bearer ${k}` },
            });
            if (res.ok) {
              const data: any = await res.json();
              if (Array.isArray(data?.data)) {
                for (const item of data.data) {
                  const id = String(item?.id || '').trim();
                  if (id) {
                    discoveredSet.add(id);
                    keyDirectSet.add(id);
                  }
                }
              }
            }
          } catch {}
        }

        // 2. Also query NewAPI / OneAPI full station catalog at /api/pricing on the relay origin
        try {
          const origin = new URL(u).origin;
          const pricingRes = await fetch(`${origin}/api/pricing`);
          if (pricingRes.ok) {
            const pricingData: any = await pricingRes.json();
            if (Array.isArray(pricingData?.data)) {
              for (const item of pricingData.data) {
                const name = String(item?.model_name || item?.id || '').trim();
                // Skip non-chat embedding / tts / image-only models
                if (!name || /embedding|tts|image|audio|moderation|whisper|robotics|banana/i.test(name)) {
                  continue;
                }
                discoveredSet.add(name);
              }
            }
          }
        } catch {}
      }

      const allDiscovered = Array.from(discoveredSet);
      const geminiModels = wantGemini
        ? allDiscovered
            .filter((m) => /gemini/i.test(m))
            .sort((a, b) => {
              // Put gemini-4 and gemini-3.8/3.7/2.5 first
              const score = (s: string) =>
                /gemini-4-(hydrogen|argon|carbon)$/i.test(s)
                  ? 0
                  : /gemini-4/i.test(s)
                  ? 1
                  : /gemini-3/i.test(s)
                  ? 2
                  : /gemini-2\.5/i.test(s)
                  ? 3
                  : 4;
              return score(a) - score(b) || a.localeCompare(b);
            })
        : [];

      const gptModels = wantGpt
        ? allDiscovered
            .filter((m) => /^(gpt|o1|o3|o4|chatgpt|codex)/i.test(m))
            .sort((a, b) => {
              const score = (s: string) =>
                keyDirectSet.has(s)
                  ? 0
                  : /gpt-6\.[12]/i.test(s)
                  ? 1
                  : /gpt-6/i.test(s)
                  ? 2
                  : /gpt-5/i.test(s)
                  ? 3
                  : 4;
              return score(a) - score(b) || a.localeCompare(b);
            })
        : [];

      const combined = Array.from(new Set([...gptModels, ...geminiModels]));
      if (combined.length > 0) {
        prov.models = combined;
        const firstGpt = gptModels[0] || combined[0];
        const firstGemini = geminiModels[0] || combined[0];
        for (const rKey of Object.keys(store.systemConfig.routes || {})) {
          const r = (store.systemConfig.routes as any)[rKey];
          if (r && r.primaryProviderId === prov.id && !combined.includes(r.primaryModel)) {
            r.primaryModel = ['vision', 'planner', 'writer'].includes(rKey) ? firstGemini : firstGpt;
          }
          if (r && r.fallbackProviderId === prov.id && !combined.includes(r.fallbackModel)) {
            r.fallbackModel = ['vision', 'planner', 'writer'].includes(rKey) ? firstGpt : firstGemini;
          }
        }
        flushPersistentStore();
        return Response.json({
          ...buildAdminSnapshot(adminAcc),
          fetchModelsResult: {
            ok: true,
            count: combined.length,
            models: combined,
            geminiModels,
            gptModels,
            keySupportedModels: Array.from(keyDirectSet),
          },
        });
      }

      return Response.json({
        ...buildAdminSnapshot(adminAcc),
        fetchModelsResult: {
          ok: false,
          error: '未能从该中转站拉取到所选系列的模型列表，请检查中转接口地址是否正确。',
        },
      });
    }

    // 10. Save 6-Station Agent Routes & System Prompts
    if (op === 'save_routes') {
      if (body.routes && typeof body.routes === 'object') {
        store.systemConfig.routes = {
          ...store.systemConfig.routes,
          ...body.routes,
        };
      }
      flushPersistentStore();
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 11. Test a specific AI Station Route
    if (op === 'test_station') {
      const station = body.station as StationRoleKey;
      const samplePrompt =
        body.prompt ||
        '测试任务：全剧 60 集，前 10 集已锁定，请用两句话说明你作为当前工位的处理重点。';
      const result = await callStationLLM({
        station,
        userPrompt: samplePrompt,
        account: adminAcc,
      });
      const knownSecrets = collectKnownSecrets(store);
      return Response.json({
        ...buildAdminSnapshot(adminAcc),
        stationTestResult: {
          station,
          ok: result.ok,
          reply: redactErrorSecrets(result.text, knownSecrets),
          error: redactErrorSecrets(result.error, knownSecrets),
        },
      });
    }

    // 12. Save Global System Config
    if (op === 'save_system_config') {
      if (body.mode && ['direct_llm', 'custom_backend', 'hybrid'].includes(body.mode)) {
        store.systemConfig.mode = body.mode;
      }
      if (body.backendUrl !== undefined && body.backendUrl !== null) {
        store.systemConfig.backendUrl = String(body.backendUrl).trim();
      }
      const currentBackendToken = String(store.systemConfig.backendToken || '').trim();
      if (parseOptionalBoolean(body.clearBackendToken) === true) {
        store.systemConfig.backendToken = '';
      } else if (body.newBackendToken !== undefined && body.newBackendToken !== null) {
        const nextTok = String(body.newBackendToken).trim();
        if (nextTok && !isMaskedPlaceholder(nextTok, currentBackendToken ? [currentBackendToken] : [], maskBackendToken)) {
          store.systemConfig.backendToken = nextTok;
        }
      } else if (body.backendToken !== undefined && body.backendToken !== null) {
        const nextTok = String(body.backendToken).trim();
        if (nextTok === '') {
          store.systemConfig.backendToken = '';
        } else if (!isMaskedPlaceholder(nextTok, currentBackendToken ? [currentBackendToken] : [], maskBackendToken)) {
          store.systemConfig.backendToken = nextTok;
        }
      }
      if (body.requireAuthOnFrontend !== undefined && body.requireAuthOnFrontend !== null) {
        store.systemConfig.requireAuthOnFrontend = Boolean(body.requireAuthOnFrontend);
      }
      if (body.allowInviteRegistration !== undefined && body.allowInviteRegistration !== null) {
        store.systemConfig.allowInviteRegistration = Boolean(body.allowInviteRegistration);
      }
      if (
        body.globalBudgetCapUsd !== undefined &&
        body.globalBudgetCapUsd !== null &&
        Number.isFinite(Number(body.globalBudgetCapUsd))
      ) {
        store.systemConfig.globalBudgetCapUsd = Math.max(0, Number(body.globalBudgetCapUsd));
      }
      flushPersistentStore();
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 13. Clear Audit Logs
    if (op === 'clear_audit_logs') {
      store.auditLogs = [];
      flushPersistentStore();
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 14. Upload a new Skill plugin (.md / .txt) via JSON or FormData
    if (op === 'upload_skill_plugin') {
      const kind = String(body.kind || '').trim() as Kind;
      const slot = String(body.slot || '').trim() as PromptSlotKey;
      const fileName =
        parsed.uploadedFileName ||
        (parsed.hasField('fileName') ? String(body.fileName || '').trim() : '') ||
        undefined;
      const content =
        parsed.fileBytes !== undefined
          ? parsed.fileBytes
          : parsed.hasField('content')
          ? String(body.content ?? '')
          : undefined;
      if (content === undefined) {
        throw new Error('EMPTY_PLUGIN_CONTENT');
      }

      const rawName = parsed.hasField('name') ? String(body.name ?? '').trim() : '';
      const description = parsed.hasField('description') ? String(body.description ?? '') : '';
      const enabled = parseOptionalBoolean(body.enabled) ?? true;
      const isDefault = parseOptionalBoolean(body.isDefault) ?? false;

      createSkillPlugin({
        kind,
        slot,
        name: rawName || undefined,
        description,
        content,
        fileName,
        enabled,
        isDefault,
      });
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 15. Replace / update an existing Skill plugin (.md / .txt) via JSON or FormData
    if (op === 'replace_skill_plugin') {
      const id = String(body.id || '').trim();
      if (!id) throw new Error('INVALID_INPUT');

      const updatePayload: {
        id: string;
        name?: string;
        description?: string;
        content?: string | Uint8Array;
        fileName?: string;
      } = { id };

      if (parsed.isMultipart) {
        const rawName = parsed.hasField('name') ? String(body.name ?? '').trim() : '';
        if (rawName) updatePayload.name = rawName;
      } else if (parsed.hasField('name')) {
        updatePayload.name = String(body.name ?? '');
      }

      if (parsed.hasField('description')) {
        updatePayload.description = String(body.description ?? '');
      }

      if (parsed.fileBytes !== undefined) {
        updatePayload.content = parsed.fileBytes;
      } else if (parsed.hasField('content')) {
        updatePayload.content = String(body.content ?? '');
      }

      if (parsed.uploadedFileName) {
        updatePayload.fileName = parsed.uploadedFileName;
      } else if (parsed.hasField('fileName') && String(body.fileName || '').trim()) {
        updatePayload.fileName = String(body.fileName).trim();
      }

      replaceSkillPlugin(updatePayload);
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 16. Toggle Skill plugin enabled state
    if (op === 'toggle_skill_plugin') {
      const id = String(body.id || '').trim();
      if (!id) throw new Error('INVALID_INPUT');
      const existing = (store.systemConfig.skillPlugins || []).find((p) => p.id === id);
      if (!existing) throw new Error('NOT_FOUND');
      const parsedEnabled = parseOptionalBoolean(body.enabled);
      const nextEnabled = parsedEnabled !== undefined ? parsedEnabled : !existing.enabled;
      toggleSkillPlugin(id, nextEnabled);
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 17. Set or unset default Skill plugin for its (kind, slot)
    if (op === 'set_default_skill_plugin') {
      const id = String(body.id || '').trim();
      if (!id) throw new Error('INVALID_INPUT');
      const parsedDefault = parseOptionalBoolean(body.isDefault);
      setDefaultSkillPlugin(id, parsedDefault !== undefined ? parsedDefault : true);
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 18. Delete Skill plugin
    if (op === 'delete_skill_plugin') {
      const id = String(body.id || '').trim();
      if (!id) throw new Error('INVALID_INPUT');
      deleteSkillPlugin(id);
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 19. Save Creation Tiers mapping config
    if (op === 'save_creation_tiers') {
      const rawTiers = body.creationTiers ?? body.tiers;
      if (!Array.isArray(rawTiers)) {
        throw new Error('INVALID_INPUT');
      }
      const validStations = new Set(['director', 'analyst', 'vision', 'planner', 'writer', 'polisher']);
      for (const item of rawTiers) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error('INVALID_INPUT');
        }
        if (typeof item.id !== 'string' || !item.id.trim()) {
          throw new Error('INVALID_INPUT');
        }
        if (typeof item.name !== 'string' || !item.name.trim()) {
          throw new Error('INVALID_INPUT');
        }
        if (item.station !== undefined && !validStations.has(String(item.station).trim())) {
          throw new Error('INVALID_INPUT');
        }
      }
      store.systemConfig.creationTiers = normalizeCreationTiers(rawTiers);
      flushPersistentStore();
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 20. Save (create / update / disable) commerce plan
    if (op === 'save_plans') {
      const planPayload =
        body.plan && typeof body.plan === 'object' && !Array.isArray(body.plan) ? body.plan : body;
      try {
        const savedPlan = adminSavePlan(planPayload);
        return Response.json({
          ...buildAdminSnapshot(adminAcc),
          savedPlan,
        });
      } catch (err: any) {
        const code = String(err?.message || 'INVALID_INPUT');
        return Response.json({ error: code }, { status: 422 });
      }
    }

    // 21. List all commerce plans, orders, and subscriptions
    if (op === 'list_commerce') {
      const commerce = listAllCommerceForAdmin();
      return Response.json({
        authorized: true,
        ...commerce,
      });
    }

    // 22. Confirm pending order and credit budgetCapUsd idempotently
    if (op === 'confirm_order') {
      const orderId = String(body.orderId || body.id || '').trim();
      if (!orderId) {
        return Response.json({ error: 'INVALID_INPUT' }, { status: 400 });
      }
      try {
        const result = await adminConfirmOrder({
          orderId,
          adminAccountId: adminAcc.id,
        });
        return Response.json({
          ...buildAdminSnapshot(adminAcc),
          confirmedOrder: result.order,
          confirmedSubscription: result.subscription,
          alreadyPaid: result.alreadyPaid,
          accountBudgetCapUsd: result.accountBudgetCapUsd,
        });
      } catch (err: any) {
        const code = String(err?.message || 'CONFIRM_ORDER_FAILED');
        const status = code === 'ORDER_NOT_FOUND' || code === 'ACCOUNT_NOT_FOUND' ? 404 : 422;
        return Response.json({ error: code }, { status });
      }
    }

    throw new Error('INVALID_INPUT');
  } catch (e: any) {
    if (e?.message === 'AUTH_REQUIRED' || e?.message === 'FORBIDDEN_ADMIN_ONLY') {
      return Response.json({ authorized: false, error: e.message }, { status: 401 });
    }
    return failure(e);
  }
}
