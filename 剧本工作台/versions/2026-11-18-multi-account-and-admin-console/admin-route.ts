import {
  callStationLLM,
  executeProviderChat,
  failure,
  flushPersistentStore,
  generateRandomCode,
  getStore,
  resolveAccountFromRequest,
  toPublicProfile,
} from '../../../lib/server';
import type {
  AccountRole,
  ApiProviderConfig,
  InviteKeyRecord,
  Kind,
  StationRoleKey,
  StudioAccount,
} from '../../../lib/types';

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
    projectCount: projectCountByOwner[acc.username] || 0,
  }));

  return {
    authorized: true,
    adminAccount: toPublicProfile(adminAcc),
    accounts: accountsWithStats,
    invites: store.invites,
    systemConfig: store.systemConfig,
    projectsSummary,
    auditLogs: store.auditLogs.slice(0, 100),
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
    const body: any = await request.json().catch(() => ({}));
    const op = String(body.operation || '');

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
        password,
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

      if (body.displayName !== undefined) acc.displayName = String(body.displayName).trim().slice(0, 50);
      if (body.password !== undefined && String(body.password).trim()) {
        acc.password = String(body.password).trim();
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
      if (body.budgetCapUsd !== undefined) {
        acc.budgetCapUsd = Math.max(0, Number(body.budgetCapUsd));
      }
      if (body.resetUsage === true) {
        acc.budgetUsedUsd = 0;
        acc.tokensUsed = 0;
      }
      if (body.note !== undefined) {
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

      const rawKeys = Array.isArray(pData.apiKeys)
        ? pData.apiKeys
        : String(pData.apiKeys || '')
            .split(/[\n,]/)
            .map((s: string) => s.trim())
            .filter(Boolean);

      const rawModels = Array.isArray(pData.models)
        ? pData.models
        : String(pData.models || '')
            .split(/[\n,]/)
            .map((s: string) => s.trim())
            .filter(Boolean);

      const existingIdx = store.systemConfig.providers.findIndex((p) => p.id === pData.id);
      const updatedProvider: ApiProviderConfig = {
        id: pData.id || 'prov-' + Date.now(),
        name,
        vendor: pData.vendor || 'openai',
        baseUrl: baseUrl.replace(/\/+$/, ''),
        apiKeys: rawKeys,
        models: rawModels.length ? rawModels : ['gpt-4o'],
        enabled: pData.enabled !== false,
        priority: Number(pData.priority || store.systemConfig.providers.length + 1),
        note: String(pData.note || ''),
        lastTestStatus: existingIdx >= 0 ? store.systemConfig.providers[existingIdx].lastTestStatus : 'untested',
        lastLatencyMs: existingIdx >= 0 ? store.systemConfig.providers[existingIdx].lastLatencyMs : undefined,
        lastTestedAt: existingIdx >= 0 ? store.systemConfig.providers[existingIdx].lastTestedAt : undefined,
      };

      if (existingIdx >= 0) {
        store.systemConfig.providers[existingIdx] = updatedProvider;
      } else {
        store.systemConfig.providers.push(updatedProvider);
      }
      flushPersistentStore();
      return Response.json(buildAdminSnapshot(adminAcc));
    }

    // 8. Delete API Provider
    if (op === 'delete_provider') {
      store.systemConfig.providers = store.systemConfig.providers.filter((p) => p.id !== body.id);
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
      const t0 = Date.now();
      try {
        const { reply } = await executeProviderChat({
          provider: prov,
          apiKey: validKeys[0],
          model: testModel,
          sysPrompt: '',
          userPrompt: '请用一句话回复：剧本工作台渠道连通正常！',
          temperature: 0.2,
          maxTokens: 48,
        });
        const latencyMs = Date.now() - t0;
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
            model: testModel,
            reply: String(reply).slice(0, 120),
          },
        });
      } catch (err: any) {
        const latencyMs = Date.now() - t0;
        prov.lastTestStatus = 'error';
        prov.lastLatencyMs = latencyMs;
        prov.lastTestedAt = new Date().toISOString();
        prov.lastErrorMsg = String(err?.message || '连接失败').slice(0, 160);
        flushPersistentStore();
        return Response.json({
          ...buildAdminSnapshot(adminAcc),
          testResult: {
            ok: false,
            latencyMs,
            error: prov.lastErrorMsg,
          },
        });
      }
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
      return Response.json({
        ...buildAdminSnapshot(adminAcc),
        stationTestResult: {
          station,
          ok: result.ok,
          reply: result.text,
          error: result.error,
        },
      });
    }

    // 12. Save Global System Config
    if (op === 'save_system_config') {
      if (body.mode && ['direct_llm', 'custom_backend', 'hybrid'].includes(body.mode)) {
        store.systemConfig.mode = body.mode;
      }
      if (body.backendUrl !== undefined) {
        store.systemConfig.backendUrl = String(body.backendUrl).trim();
      }
      if (body.backendToken !== undefined) {
        store.systemConfig.backendToken = String(body.backendToken).trim();
      }
      if (body.requireAuthOnFrontend !== undefined) {
        store.systemConfig.requireAuthOnFrontend = Boolean(body.requireAuthOnFrontend);
      }
      if (body.allowInviteRegistration !== undefined) {
        store.systemConfig.allowInviteRegistration = Boolean(body.allowInviteRegistration);
      }
      if (body.globalBudgetCapUsd !== undefined) {
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

    throw new Error('INVALID_INPUT');
  } catch (e) {
    return failure(e);
  }
}
