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
const origFetch = globalThis.fetch;

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'step3-tiers-whitelist-'));
const root = new URL('../', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

try {
  process.chdir(tmp);
  delete process.env.STUDIO_LLM_FIXTURE;
  delete process.env.STUDIO_STRICT_NATIVE_GEMINI;

  const observedModels = [];
  const MOCK_RELAY_BASE = 'https://mock-relay.invalid/v1';
  globalThis.fetch = async (url, init) => {
    const u = String(url || '');
    if (!u.startsWith(MOCK_RELAY_BASE)) {
      throw new Error(`Unexpected external fetch in offline test: ${u}`);
    }
    const parsed = JSON.parse(String(init?.body || '{}'));
    observedModels.push(parsed.model);
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

  console.log('PASS (step3-creation-tiers-whitelist: 4 default tiers allowed + negative control rejected)');
} finally {
  globalThis.fetch = origFetch;
  if (origFixture === undefined) delete process.env.STUDIO_LLM_FIXTURE;
  else process.env.STUDIO_LLM_FIXTURE = origFixture;
  if (origStrict === undefined) delete process.env.STUDIO_STRICT_NATIVE_GEMINI;
  else process.env.STUDIO_STRICT_NATIVE_GEMINI = origStrict;
  process.chdir(origCwd);
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
