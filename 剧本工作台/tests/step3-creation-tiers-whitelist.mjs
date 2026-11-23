import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const loaderCode = `
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\\.[a-z0-9]+$/i.test(specifier) && context.parentURL?.startsWith('file:')) {
    const parentPath = fileURLToPath(context.parentURL);
    const tsUrl = new URL(specifier + '.ts', pathToFileURL(parentPath));
    if (fs.existsSync(fileURLToPath(tsUrl))) {
      return { url: tsUrl.href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript;base64,${Buffer.from(loaderCode).toString('base64')}`);

const origCwd = process.cwd();
const origFixture = process.env.STUDIO_LLM_FIXTURE;
const origStrict = process.env.STUDIO_STRICT_NATIVE_GEMINI;
const origGeminiKey = process.env.GEMINI_API_KEY;
const origGoogleKey = process.env.GOOGLE_API_KEY;
const origOpenAiKey = process.env.OPENAI_API_KEY;
const origFetch = globalThis.fetch;

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'step3-tiers-whitelist-'));
const root = new URL('../', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

try {
  process.chdir(tmp);
  delete process.env.STUDIO_LLM_FIXTURE;
  delete process.env.STUDIO_STRICT_NATIVE_GEMINI;

  const observedModels = [];
  const observedCalls = [];
  let failPrimaryRelay = false;
  let allowEnvGeminiMock = false;
  const MOCK_RELAY_BASE = 'https://mock-relay.invalid/v1';
  const MOCK_BACKUP_BASE = 'https://mock-backup.invalid/v1';
  const ENV_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
  globalThis.fetch = async (url, init) => {
    const u = String(url || '');
    const isPrimary = u.startsWith(MOCK_RELAY_BASE);
    const isBackup = u.startsWith(MOCK_BACKUP_BASE);
    const isEnvGemini = allowEnvGeminiMock && u.startsWith(ENV_GEMINI_BASE);
    if (!isPrimary && !isBackup && !isEnvGemini) {
      throw new Error(`Unexpected external fetch in offline test: ${u}`);
    }
    const parsed = JSON.parse(String(init?.body || '{}'));
    observedModels.push(parsed.model);
    observedCalls.push({ url: u, model: parsed.model });
    if (isPrimary && failPrimaryRelay) {
      return new Response(
        JSON.stringify({ error: { message: 'simulated primary 500' } }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '总编剧复述测试响应：结构完整，可进入下一步。' } }],
        usage: { total_tokens: 42 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const {
    createDefaultCreationTiers,
    normalizeCreationTiers,
    resolveCreationTier,
    getStore,
    callStationLLM,
    executeProviderChat,
  } = await imp('lib/server.ts');
  const studio = await imp('app/api/studio/route.ts');

  const expectedTierIds = ['tier-fast', 'tier-standard', 'tier-deep'];
  const assertAllDefaultTiersCarbon = (tiers, label) => {
    assert.equal(tiers.length, 3, `${label}: expected 3 default tiers`);
    assert.deepEqual(
      tiers.map((t) => t.id),
      expectedTierIds,
      `${label}: tier IDs mismatch`
    );
    for (const tier of tiers) {
      assert.equal(tier.model, 'gemini-4-carbon', `${label}: ${tier.id} model must be gemini-4-carbon`);
      assert.equal(tier.providerId, undefined, `${label}: ${tier.id} providerId must remain unset`);
    }
  };

  // 1. Default factory & normalizers
  assertAllDefaultTiersCarbon(createDefaultCreationTiers(), 'createDefaultCreationTiers()');
  assertAllDefaultTiersCarbon(normalizeCreationTiers(undefined), 'normalizeCreationTiers(undefined)');
  assertAllDefaultTiersCarbon(normalizeCreationTiers([]), 'normalizeCreationTiers([])');

  // 2. Fresh store & resolveCreationTier()
  const store = await getStore();
  assertAllDefaultTiersCarbon(store.systemConfig.creationTiers, 'fresh getStore().systemConfig.creationTiers');

  for (const tierId of [...expectedTierIds, undefined]) {
    const resolved = resolveCreationTier(store.systemConfig, tierId);
    assert.equal(
      resolved.model,
      'gemini-4-carbon',
      `resolveCreationTier(${String(tierId)}) must resolve to gemini-4-carbon, got ${resolved.model}`
    );
  }

  // Configure isolated tmp store accounts & synthetic relay providers (0 real keys/calls)
  const OWNER_KEY = 'test-tier-owner-key';
  store.accounts = [
    {
      id: 'owner',
      username: 'owner',
      accessKey: OWNER_KEY,
      status: 'active',
      role: 'creator',
      budgetUsedUsd: 0,
      budgetCapUsd: 0,
      allowedFlows: ['transcribe', 'foreign', 'domestic', 'original'],
    },
  ];
  store.systemConfig.requireAuthOnFrontend = true;
  store.systemConfig.backendUrl = '';
  store.systemConfig.backendToken = '';
  store.systemConfig.mode = 'direct_llm';
  store.systemConfig.providers = (store.systemConfig.providers || []).map((prov) => ({
    ...prov,
    enabled: prov.id === 'prov-openai' || prov.id === 'prov-gemini',
    baseUrl: MOCK_RELAY_BASE,
    backupBaseUrl1: '',
    backupBaseUrl2: '',
    apiKeys: ['sk-offline-dummy-key-123456'],
  }));
  store.projects = {};

  const seedConfirmedOriginal = (id, preferredTierId) => {
    const now = new Date().toISOString();
    const project = {
      id,
      title: `白名单测试项目-${id}`,
      kind: 'original',
      total: 40,
      lockedEpisodes: null,
      startEpisode: 1,
      brief: '都市悬疑短剧测试大纲',
      messages: [],
      attachments: [],
      requirements: [],
      promptSelections: {},
      volumes: [],
      episodes: [],
      outlineNodes: [],
      characterNodes: [],
      worldNodes: [],
      ...(preferredTierId ? { preferredTierId } : {}),
      thinkingLevel: 'off',
      executionMode: 'auto',
      archived: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
      confirmed: true,
    };
    store.projects[id] = {
      owner: 'owner',
      data: JSON.stringify(project),
      version: 1,
      updated_at: now,
    };
  };

  // 3. Real studio.POST -> callProjectStation -> assertAllowedRelayModel -> callStationLLM -> executeProviderChat
  for (const tierId of [...expectedTierIds, undefined]) {
    const pid = `proj-${tierId || 'default'}`;
    seedConfirmedOriginal(pid, tierId);
    const beforeCalls = observedModels.length;
    const resp = await studio.POST(
      new Request('http://localhost/api/studio', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-studio-token': OWNER_KEY,
        },
        body: JSON.stringify({
          id: pid,
          version: 1,
          operation: 'connect',
          ...(tierId ? { preferredTierId: tierId } : {}),
          thinkingLevel: 'off',
          executionMode: 'auto',
        }),
      })
    );
    const bodyText = await resp.text();
    assert.equal(resp.status, 200, `studio.POST connect (${String(tierId)}) failed: ${resp.status} ${bodyText}`);
    assert.ok(!bodyText.includes('MODEL_NOT_ALLOWED'), `unexpected MODEL_NOT_ALLOWED for ${String(tierId)}`);
    assert.equal(observedModels.length, beforeCalls + 1, `expected 1 mocked fetch call for ${String(tierId)}`);
    assert.equal(
      observedModels[observedModels.length - 1],
      'gemini-4-carbon',
      `fetch payload model must be gemini-4-carbon for ${String(tierId)}`
    );
  }

  // 4. Negative control: an isolated tier with legacy 'gemini-2.5-pro' MUST trigger MODEL_NOT_ALLOWED
  store.systemConfig.creationTiers = [
    {
      id: 'tier-legacy-disallowed',
      name: '旧模型对照档',
      badge: 'legacy',
      description: 'negative control',
      costHint: '1x',
      station: 'director',
      model: 'gemini-2.5-pro',
      supportsThinking: false,
      enabled: true,
      isDefault: true,
      order: 1,
    },
  ];
  seedConfirmedOriginal('proj-neg', 'tier-legacy-disallowed');
  const callsBeforeNeg = observedModels.length;
  const negResp = await studio.POST(
    new Request('http://localhost/api/studio', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-studio-token': OWNER_KEY,
      },
      body: JSON.stringify({
        id: 'proj-neg',
        version: 1,
        operation: 'connect',
        preferredTierId: 'tier-legacy-disallowed',
        thinkingLevel: 'off',
        executionMode: 'auto',
      }),
    })
  );
  const negText = await negResp.text();
  assert.equal(negResp.status, 500, `expected HTTP 500 on disallowed model, got ${negResp.status}: ${negText}`);
  assert.match(negText, /MODEL_NOT_ALLOWED/, `expected MODEL_NOT_ALLOWED in negative response, got: ${negText}`);
  assert.equal(observedModels.length, callsBeforeNeg, 'disallowed model must be rejected before fetch');

  await assert.rejects(
    () =>
      executeProviderChat({
        provider: store.systemConfig.providers[0],
        apiKey: 'sk-offline-dummy-key-123456',
        model: 'gemini-2.5-pro',
        sysPrompt: 'test',
        userPrompt: 'test',
        temperature: 0.2,
        maxTokens: 128,
        thinkingLevel: 'off',
      }),
    /MODEL_NOT_ALLOWED/
  );

  // 5. Failover propagation: primary relay (prov-openai) HTTP 500 -> backup relay (prov-gemini) HTTP 200
  //    Must propagate modelOverride ('gemini-4-carbon') to ALL candidateTargets (both with & without providerIdOverride)
  store.systemConfig.creationTiers = [
    ...createDefaultCreationTiers(),
    {
      id: 'tier-pinned-primary',
      name: '指定主中转测试档',
      badge: 'pinned',
      description: 'failover with providerIdOverride',
      costHint: '1x',
      station: 'director',
      providerId: 'prov-openai',
      model: 'gemini-4-carbon',
      supportsThinking: false,
      enabled: true,
      isDefault: false,
      order: 4,
    },
  ];
  store.systemConfig.providers = store.systemConfig.providers.map((prov) => {
    if (prov.id === 'prov-openai') {
      return { ...prov, enabled: true, baseUrl: MOCK_RELAY_BASE, apiKeys: ['sk-offline-primary-key-1234'] };
    }
    if (prov.id === 'prov-gemini') {
      return { ...prov, enabled: true, baseUrl: MOCK_BACKUP_BASE, apiKeys: ['sk-offline-backup-key-5678'] };
    }
    return { ...prov, enabled: false };
  });
  failPrimaryRelay = true;

  for (const failoverTierId of ['tier-fast', 'tier-pinned-primary']) {
    const failoverPid = `proj-failover-${failoverTierId}`;
    seedConfirmedOriginal(failoverPid, failoverTierId);
    const callStart = observedCalls.length;
    const failoverResp = await studio.POST(
      new Request('http://localhost/api/studio', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-studio-token': OWNER_KEY,
        },
        body: JSON.stringify({
          id: failoverPid,
          version: 1,
          operation: 'connect',
          preferredTierId: failoverTierId,
          thinkingLevel: 'off',
          executionMode: 'auto',
        }),
      })
    );
    const failoverBody = await failoverResp.text();
    assert.equal(
      failoverResp.status,
      200,
      `failover studio.POST (${failoverTierId}) failed: ${failoverResp.status} ${failoverBody}`
    );
    assert.ok(
      !failoverBody.includes('MODEL_NOT_ALLOWED'),
      `failover (${failoverTierId}) must not trigger MODEL_NOT_ALLOWED`
    );
    const recentCalls = observedCalls.slice(callStart);
    assert.ok(
      recentCalls.some((c) => c.url.startsWith(MOCK_RELAY_BASE) && c.model === 'gemini-4-carbon'),
      `expected primary relay attempt with gemini-4-carbon for ${failoverTierId}`
    );
    assert.ok(
      recentCalls.some((c) => c.url.startsWith(MOCK_BACKUP_BASE) && c.model === 'gemini-4-carbon'),
      `expected backup relay failover with gemini-4-carbon for ${failoverTierId}, got ${JSON.stringify(recentCalls)}`
    );
    const recentErrors = (store.auditLogs || [])
      .slice(0, 5)
      .filter((l) => l.status === 'failed')
      .map((l) => l.error);
    assert.ok(
      !recentErrors.includes('MODEL_NOT_ALLOWED'),
      `auditLogs must not record MODEL_NOT_ALLOWED on failover (${failoverTierId}), got ${JSON.stringify(recentErrors)}`
    );
  }

  // 5b. Failover env-gemini fallback target must also honor modelOverride
  const savedProviders = store.systemConfig.providers;
  store.systemConfig.providers = savedProviders.map((p) => ({ ...p, enabled: false }));
  process.env.GEMINI_API_KEY = 'sk-offline-env-gemini-key';
  delete process.env.GOOGLE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  allowEnvGeminiMock = true;
  const envCallStart = observedCalls.length;
  const envRes = await callStationLLM({
    station: 'director',
    userPrompt: 'env fallback modelOverride test',
    modelOverride: 'gemini-4-carbon',
  });
  allowEnvGeminiMock = false;
  store.systemConfig.providers = savedProviders;
  assert.equal(envRes.ok, true, `env-gemini fallback with modelOverride failed: ${envRes.error}`);
  const envRecentCalls = observedCalls.slice(envCallStart);
  assert.ok(
    envRecentCalls.some((c) => c.url.startsWith(ENV_GEMINI_BASE) && c.model === 'gemini-4-carbon'),
    `env-gemini fallback must send gemini-4-carbon, got ${JSON.stringify(envRecentCalls)}`
  );

  // 6. Pre-R1 persisted .data/studio-store.json backfill test:
  //    tier-fast / tier-standard / tier-deep omitting `model` are backfilled to 'gemini-4-carbon',
  //    while custom tier IDs omitting `model` preserve `model: undefined`.
  failPrimaryRelay = false;
  const preR1DataDir = path.join(tmp, '.data');
  await fs.mkdir(preR1DataDir, { recursive: true });
  const preR1ProjectId = 'proj-pre-r1-backfill';
  const nowIso = new Date().toISOString();
  const preR1Project = {
    id: preR1ProjectId,
    title: '旧版档位自动回填测试',
    kind: 'original',
    total: 40,
    lockedEpisodes: null,
    startEpisode: 1,
    brief: '都市悬疑短剧测试大纲',
    messages: [],
    attachments: [],
    requirements: [],
    promptSelections: {},
    volumes: [],
    episodes: [],
    outlineNodes: [],
    characterNodes: [],
    worldNodes: [],
    preferredTierId: 'tier-standard',
    thinkingLevel: 'off',
    executionMode: 'auto',
    archived: false,
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
    confirmed: true,
  };
  const preR1StoreJson = {
    projects: {
      [preR1ProjectId]: {
        owner: 'owner',
        data: JSON.stringify(preR1Project),
        version: 1,
        updated_at: nowIso,
      },
    },
    accounts: store.accounts,
    invites: [],
    sessions: {},
    systemConfig: {
      ...store.systemConfig,
      providers: store.systemConfig.providers.map((prov) => ({
        ...prov,
        enabled: prov.id === 'prov-openai' || prov.id === 'prov-gemini',
        baseUrl: prov.id === 'prov-gemini' ? MOCK_BACKUP_BASE : MOCK_RELAY_BASE,
        backupBaseUrl1: '',
        backupBaseUrl2: '',
        apiKeys: ['sk-offline-dummy-key-123456'],
      })),
      creationTiers: [
        {
          id: 'tier-fast',
          name: '极速档',
          badge: '⚡ 极速 · 0.5x',
          description: 'pre-R1 omitted model',
          costHint: '消耗 0.5x',
          station: 'director',
          supportsThinking: false,
          enabled: true,
          isDefault: false,
          order: 1,
        },
        {
          id: 'tier-standard',
          name: '标准档',
          badge: '✨ 标准 · 1x',
          description: 'pre-R1 omitted model',
          costHint: '消耗 1x',
          station: 'writer',
          supportsThinking: true,
          enabled: true,
          isDefault: true,
          order: 2,
        },
        {
          id: 'tier-deep',
          name: '深度精修档',
          badge: '👑 深度精修 · 2x',
          description: 'pre-R1 omitted model',
          costHint: '消耗 2x',
          station: 'polisher',
          supportsThinking: true,
          enabled: true,
          isDefault: false,
          order: 3,
        },
        {
          id: 'custom-tier-no-model',
          name: '自定义无模型档',
          badge: 'custom',
          description: 'custom tier omitting model must stay undefined',
          costHint: '1x',
          station: 'writer',
          supportsThinking: false,
          enabled: true,
          isDefault: false,
          order: 4,
        },
      ],
    },
    auditLogs: [],
    plans: [],
    subscriptions: [],
    orders: [],
  };
  await fs.writeFile(path.join(preR1DataDir, 'studio-store.json'), JSON.stringify(preR1StoreJson), 'utf-8');
  delete globalThis.__STUDIO_PERSISTENT_STORE__;

  const reloadedStore = await getStore();
  const reloadedTiers = reloadedStore.systemConfig.creationTiers;
  for (const builtinId of expectedTierIds) {
    const found = reloadedTiers.find((t) => t.id === builtinId);
    assert.ok(found, `missing built-in tier ${builtinId} after pre-R1 load`);
    assert.equal(found.model, 'gemini-4-carbon', `pre-R1 ${builtinId} must backfill gemini-4-carbon`);
    const resolved = resolveCreationTier(reloadedStore.systemConfig, builtinId);
    assert.equal(
      resolved.model,
      'gemini-4-carbon',
      `resolveCreationTier(${builtinId}) after pre-R1 backfill must be gemini-4-carbon, got ${resolved.model}`
    );
  }
  const customReloaded = reloadedTiers.find((t) => t.id === 'custom-tier-no-model');
  assert.ok(customReloaded, 'missing custom-tier-no-model after pre-R1 load');
  assert.equal(customReloaded.model, undefined, 'custom tier omitting model must preserve model: undefined');

  const preR1CallStart = observedCalls.length;
  const preR1Resp = await studio.POST(
    new Request('http://localhost/api/studio', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-studio-token': OWNER_KEY,
      },
      body: JSON.stringify({
        id: preR1ProjectId,
        version: 1,
        operation: 'connect',
        preferredTierId: 'tier-standard',
        thinkingLevel: 'off',
        executionMode: 'auto',
      }),
    })
  );
  const preR1Body = await preR1Resp.text();
  assert.equal(preR1Resp.status, 200, `pre-R1 studio.POST failed: ${preR1Resp.status} ${preR1Body}`);
  assert.ok(!preR1Body.includes('MODEL_NOT_ALLOWED'), 'pre-R1 backfill studio.POST must not throw MODEL_NOT_ALLOWED');
  const preR1Calls = observedCalls.slice(preR1CallStart);
  assert.ok(
    preR1Calls.some((c) => c.model === 'gemini-4-carbon'),
    `expected pre-R1 backfilled studio.POST to send gemini-4-carbon, got ${JSON.stringify(preR1Calls)}`
  );

  console.log(
    'PASS (step3-creation-tiers-whitelist: 4 default tiers + negative control + failover propagation + pre-R1 store backfill)'
  );
} finally {
  globalThis.fetch = origFetch;
  if (origFixture === undefined) delete process.env.STUDIO_LLM_FIXTURE;
  else process.env.STUDIO_LLM_FIXTURE = origFixture;
  if (origStrict === undefined) delete process.env.STUDIO_STRICT_NATIVE_GEMINI;
  else process.env.STUDIO_STRICT_NATIVE_GEMINI = origStrict;
  if (origGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = origGeminiKey;
  if (origGoogleKey === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = origGoogleKey;
  if (origOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = origOpenAiKey;
  delete globalThis.__STUDIO_PERSISTENT_STORE__;
  process.chdir(origCwd);
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
