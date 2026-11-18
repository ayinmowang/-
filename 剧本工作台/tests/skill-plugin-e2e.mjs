import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';

// Register lightweight hook so extensionless TypeScript imports (e.g. '../lib/server') resolve in Node v24
const hookCode = `
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !path.extname(specifier)) {
    const parentDir = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
    for (const ext of ['.ts', '.tsx', '.js', '.mjs']) {
      const candidate = path.resolve(parentDir, specifier + ext);
      if (fs.existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
`;

register('data:text/javascript,' + encodeURIComponent(hookCode));

const DATA_DIR = path.join(process.cwd(), '.data');
const STORE_FILE = path.join(DATA_DIR, 'studio-store.json');
const BUCKET_DIR = path.join(DATA_DIR, 'buckets');

const CREATOR_SUMMARY_KEYS = new Set(['id', 'kind', 'slot', 'name', 'description', 'isDefault']);
const FORBIDDEN_PROMPT_CATALOG_KEYS = new Set([
  'content',
  'filename',
  'fileext',
  'enabled',
  'createdat',
  'updatedat',
]);
const FORBIDDEN_CREATOR_KEYS = new Set([
  'rawmarkdown',
  'systemprompt',
  'system_prompt',
  'raw_prompt',
  'skillcontent',
  'skill_content',
  'promptcontent',
  'prompt_content',
  'prompttext',
  'prompt_text',
  'skillplugins',
  'skill_plugins',
  'filename',
  'fileext',
  'skillfilename',
  'pluginfilename',
  'model',
  'modelname',
  'model_name',
  'provider',
  'providerid',
  'route',
  'line',
  'tokens',
  'tokensused',
  'prompt_tokens',
  'prompttokens',
  'completion_tokens',
  'completiontokens',
  'total_tokens',
  'totaltokens',
  'apikey',
  'api_key',
  'password',
  'accesskey',
  'backendurl',
  'backendtoken',
]);

function collectObjectKeys(obj, out = new Set(), keyPaths = []) {
  if (!obj || typeof obj !== 'object') return { keys: out, keyPaths };
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => collectObjectKeys(item, out, keyPaths));
    return { keys: out, keyPaths };
  }
  for (const [k, v] of Object.entries(obj)) {
    out.add(k.toLowerCase());
    if (k.toLowerCase() === 'content') {
      keyPaths.push({ key: k, parentObj: obj });
    }
    collectObjectKeys(v, out, keyPaths);
  }
  return { keys: out, keyPaths };
}

function isAllowedContentPath(obj, root) {
  // Walk root to find where `obj` sits: legitimate only under outputs.<stage> (StageOutput) or messages[]
  let allowed = false;
  function walk(node, pathSegs) {
    if (allowed || !node || typeof node !== 'object') return;
    if (node === obj) {
      const len = pathSegs.length;
      const inOutputsStage = len >= 2 && pathSegs[len - 2] === 'outputs';
      const inMessagesItem = len >= 2 && pathSegs[len - 2] === 'messages';
      if (inOutputsStage || inMessagesItem) {
        allowed = true;
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, pathSegs);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      walk(v, [...pathSegs, k]);
    }
  }
  walk(root, []);
  return allowed;
}

function assertPromptCatalogEntriesClean(node, label) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) assertPromptCatalogEntriesClean(item, label);
    return;
  }
  if (node.promptCatalog && typeof node.promptCatalog === 'object') {
    for (const [kindKey, slotsObj] of Object.entries(node.promptCatalog)) {
      if (!slotsObj || typeof slotsObj !== 'object') continue;
      for (const [slotKey, items] of Object.entries(slotsObj)) {
        if (!Array.isArray(items)) continue;
        for (const entry of items) {
          assert.ok(entry && typeof entry === 'object', `[${label}] promptCatalog.${kindKey}.${slotKey} entry must be an object`);
          for (const k of Object.keys(entry)) {
            assert.equal(
              FORBIDDEN_PROMPT_CATALOG_KEYS.has(k.toLowerCase()),
              false,
              `[${label}] Forbidden key "${k}" leaked in promptCatalog.${kindKey}.${slotKey}`
            );
            assert.equal(
              CREATOR_SUMMARY_KEYS.has(k),
              true,
              `[${label}] Unexpected key "${k}" in promptCatalog.${kindKey}.${slotKey} entry`
            );
          }
        }
      }
    }
  }
  for (const v of Object.values(node)) {
    assertPromptCatalogEntriesClean(v, label);
  }
}

function assertCreatorRedlineClean(payload, label, forbiddenTexts = []) {
  const { keys } = collectObjectKeys(payload);
  for (const fk of FORBIDDEN_CREATOR_KEYS) {
    assert.equal(keys.has(fk), false, `[${label}] Forbidden key "${fk}" leaked to creator payload`);
  }
  if (payload && typeof payload === 'object') {
    assertPromptCatalogEntriesClean(payload, label);
    const { keyPaths } = collectObjectKeys(payload);
    for (const kp of keyPaths) {
      assert.equal(
        isAllowedContentPath(kp.parentObj, payload),
        true,
        `[${label}] Key "content" appeared outside StageOutput/messages in creator payload`
      );
    }
  }
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  assert.equal(/\b(gpt-4[a-z0-9.-]*|gpt-5[a-z0-9.-]*|claude-[a-z0-9.-]+|gemini-[a-z0-9.-]+|deepseek-[a-z0-9.-]+|grok-[a-z0-9.-]+)\b/i.test(serialized), false, `[${label}] Model name leaked`);
  assert.equal(/\b(prompt_?tokens|completion_?tokens|total_?tokens)\b/i.test(serialized), false, `[${label}] Token field leaked`);
  assert.equal(serialized.includes('OPENAI_API_KEY'), false, `[${label}] OPENAI_API_KEY leaked`);
  assert.equal(serialized.includes('STUDIO_BACKEND_URL'), false, `[${label}] STUDIO_BACKEND_URL leaked`);
  assert.equal(/Grok[\s-]?Bot/i.test(serialized), false, `[${label}] Grok Bot leaked`);
  for (const text of forbiddenTexts) {
    if (text) {
      assert.equal(serialized.includes(text), false, `[${label}] Raw Skill plugin text "${text}" leaked`);
    }
  }
}

async function main() {
  // Snapshot .data/ before running any route code
  const hadDataDir = fs.existsSync(DATA_DIR);
  const hadStoreFile = fs.existsSync(STORE_FILE);
  const prevStoreRaw = hadStoreFile ? fs.readFileSync(STORE_FILE) : null;
  const prevBucketFiles = fs.existsSync(BUCKET_DIR) ? new Set(fs.readdirSync(BUCKET_DIR)) : new Set();

  const originalFetch = globalThis.fetch;
  const capturedLLMCalls = [];
  let mockReplyMode = 'normal';
  let mockCanaryLeakText = '';

  const tierStats = {
    T1: { passed: 0, failed: 0 },
    T2: { passed: 0, failed: 0 },
    T3: { passed: 0, failed: 0 },
    T4: { passed: 0, failed: 0 },
  };
  const failures = [];

  async function runTest(id, tier, description, fn) {
    try {
      await fn();
      tierStats[tier].passed += 1;
      console.log(`  [PASS] ${id}: ${description}`);
    } catch (err) {
      tierStats[tier].failed += 1;
      failures.push({ id, tier, description, err });
      console.error(`  [FAIL] ${id}: ${description}\n    -> ${err?.stack || err}`);
    }
  }

  try {
    const authRoute = await import('../app/api/auth/route.ts');
    const adminRoute = await import('../app/api/admin/route.ts');
    const studioRoute = await import('../app/api/studio/route.ts');
    const uploadRoute = await import('../app/api/upload/route.ts');

    // Helper functions bound to imported routes
    async function loginKey(key) {
      const res = await authRoute.POST(
        new Request('http://localhost/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'login_key', key }),
        })
      );
      assert.equal(res.status, 200, `Login with key failed`);
      const data = await res.json();
      return data.token;
    }

    async function adminPost(token, bodyOrForm) {
      const isForm = bodyOrForm instanceof FormData;
      return adminRoute.POST(
        new Request('http://localhost/api/admin', {
          method: 'POST',
          headers: isForm
            ? { 'x-studio-token': token }
            : { 'Content-Type': 'application/json', 'x-studio-token': token },
          body: isForm ? bodyOrForm : JSON.stringify(bodyOrForm),
        })
      );
    }

    async function adminGet(token) {
      return adminRoute.GET(
        new Request('http://localhost/api/admin', {
          headers: token ? { 'x-studio-token': token } : {},
        })
      );
    }

    async function studioGet(token, query = '') {
      return studioRoute.GET(
        new Request(`http://localhost/api/studio${query}`, {
          headers: { 'x-studio-token': token },
        })
      );
    }

    async function studioPost(token, body) {
      return studioRoute.POST(
        new Request('http://localhost/api/studio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-studio-token': token },
          body: JSON.stringify(body),
        })
      );
    }

    async function uploadPost(token, query, body, contentType) {
      const headers = { 'x-studio-token': token };
      if (contentType) headers['Content-Type'] = contentType;
      return uploadRoute.POST(
        new Request(`http://localhost/api/upload?${query}`, {
          method: 'POST',
          headers,
          body,
        })
      );
    }

    async function uploadGet(token, query) {
      return uploadRoute.GET(
        new Request(`http://localhost/api/upload?${query}`, {
          headers: { 'x-studio-token': token },
        })
      );
    }

    async function uploadPluginJSON(adminToken, opts) {
      const res = await adminPost(adminToken, {
        operation: 'upload_skill_plugin',
        ...opts,
      });
      assert.equal(res.status, 200, `Expected 200 uploading plugin ${opts.name}, got ${res.status}`);
      const snap = await res.json();
      const found = (snap.systemConfig?.skillPlugins || []).find((p) => p.name === opts.name && p.kind === opts.kind && p.slot === opts.slot);
      assert.ok(found, `Uploaded plugin ${opts.name} not found in systemConfig.skillPlugins`);
      return found;
    }

    async function clearAllSkillPlugins(adminToken) {
      const snap = await (await adminGet(adminToken)).json();
      for (const p of snap.systemConfig?.skillPlugins || []) {
        await adminPost(adminToken, { operation: 'delete_skill_plugin', id: p.id });
      }
    }

    function installMockFetch() {
      globalThis.fetch = async (url, init) => {
        const urlStr = String(url);
        if (urlStr.includes('/chat/completions') || urlStr.includes('generativelanguage.googleapis.com')) {
          let systemPrompt = '';
          let userPrompt = '';
          try {
            const parsed = JSON.parse(String(init?.body || '{}'));
            if (Array.isArray(parsed.messages)) {
              systemPrompt = parsed.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
              userPrompt = parsed.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
            } else if (parsed.systemInstruction?.parts) {
              systemPrompt = parsed.systemInstruction.parts.map((p) => p.text || '').join('\n');
              userPrompt = (parsed.contents || []).map((c) => (c.parts || []).map((p) => p.text || '').join('\n')).join('\n');
            }
          } catch {}
          capturedLLMCalls.push({ url: urlStr, systemPrompt, userPrompt });

          let replyText = '【创作引擎交付】已完成本阶段剧情结构梳理与剧本撰写。';
          if (mockReplyMode === 'noisy_redline') {
            replyText = `由 gpt-4o-mini 与 claude-3.5-sonnet 联合生成（prompt_tokens: 310，total_tokens: 640），包含测试文本：${mockCanaryLeakText}`;
          }

          return new Response(
            JSON.stringify({
              choices: [{ message: { content: replyText } }],
              usage: { prompt_tokens: 120, completion_tokens: 200, total_tokens: 320 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return originalFetch(url, init);
      };
    }

    async function enableMockGeminiProvider(adminToken) {
      const res = await adminPost(adminToken, {
        operation: 'save_provider',
        provider: {
          id: 'prov-gemini',
          name: '测试引擎通道',
          vendor: 'gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKeys: ['AIzaSyE2EMockSkillPluginTestKey01'],
          models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
          enabled: true,
          priority: 1,
        },
      });
      assert.equal(res.status, 200);
    }

    const adminToken = await loginKey('AYIN-ADMIN-8888-KEY');
    const creator1Token = await loginKey('AYIN-KEY-W01-9921');
    const creator2Token = await loginKey('AYIN-KEY-W02-7743');

    installMockFetch();
    await enableMockGeminiProvider(adminToken);

    // =========================================================================
    // TIER 1: Feature Coverage (Happy Path & Core Contracts)
    // =========================================================================
    console.log('\n=== Tier 1: Feature Coverage ===');

    await runTest('T1-01', 'T1', 'Admin auth gate rejects unauthenticated & non-admin, accepts admin key', async () => {
      const unauth = await adminGet(null);
      assert.equal(unauth.status, 401);
      const nonAdmin = await adminGet(creator1Token);
      assert.ok(nonAdmin.status === 401 || nonAdmin.status === 403, `Expected 401/403, got ${nonAdmin.status}`);
      const okAdmin = await adminGet(adminToken);
      assert.equal(okAdmin.status, 200);
      const data = await okAdmin.json();
      assert.equal(data.authorized, true);
    });

    await runTest('T1-02', 'T1', 'Admin uploads .md (JSON) & .txt (FormData) Skill plugins', async () => {
      await clearAllSkillPlugins(adminToken);
      const mdPlugin = await uploadPluginJSON(adminToken, {
        kind: 'foreign',
        slot: 'primary',
        name: 'T1_Foreign_Primary_MD',
        description: '国外迭代主提示词',
        fileName: 'foreign-primary.md',
        content: '# Foreign Primary\nFocus on cliffhanger hooks.',
      });
      assert.equal(mdPlugin.fileExt, 'md');
      assert.equal(mdPlugin.enabled, true);

      const fd = new FormData();
      fd.append('operation', 'upload_skill_plugin');
      fd.append('kind', 'foreign');
      fd.append('slot', 'secondary');
      fd.append('name', 'T1_Foreign_Secondary_TXT');
      fd.append('description', '国外迭代副提示词');
      fd.append('file', new File([Buffer.from('Secondary rhythm checklist.', 'utf-8')], 'foreign-sec.txt', { type: 'text/plain' }));
      const fdRes = await adminPost(adminToken, fd);
      assert.equal(fdRes.status, 200);
      const snap = await fdRes.json();
      const txtPlugin = snap.systemConfig.skillPlugins.find((p) => p.name === 'T1_Foreign_Secondary_TXT');
      assert.ok(txtPlugin);
      assert.equal(txtPlugin.fileExt, 'txt');
      assert.equal(txtPlugin.content.trim(), 'Secondary rhythm checklist.');
    });

    await runTest('T1-03', 'T1', 'Multi-plugin per slot & set_default_skill_plugin mutual exclusion', async () => {
      await clearAllSkillPlugins(adminToken);
      const p1 = await uploadPluginJSON(adminToken, {
        kind: 'domestic',
        slot: 'primary',
        name: 'T1_Dom_A',
        description: '方案A',
        fileName: 'dom-a.md',
        content: 'Rule A',
        isDefault: true,
      });
      const p2 = await uploadPluginJSON(adminToken, {
        kind: 'domestic',
        slot: 'primary',
        name: 'T1_Dom_B',
        description: '方案B',
        fileName: 'dom-b.md',
        content: 'Rule B',
        isDefault: false,
      });
      assert.equal(p1.isDefault, true);
      assert.equal(p2.isDefault, false);

      const setDefRes = await adminPost(adminToken, {
        operation: 'set_default_skill_plugin',
        id: p2.id,
        isDefault: true,
      });
      assert.equal(setDefRes.status, 200);
      const snap = await setDefRes.json();
      const updatedP1 = snap.systemConfig.skillPlugins.find((p) => p.id === p1.id);
      const updatedP2 = snap.systemConfig.skillPlugins.find((p) => p.id === p2.id);
      assert.equal(updatedP1.isDefault, false, 'Previous default in same (kind, slot) must be unset');
      assert.equal(updatedP2.isDefault, true);
    });

    await runTest('T1-04', 'T1', 'Admin replace (JSON + FormData), toggle enable/disable, and delete plugin', async () => {
      await clearAllSkillPlugins(adminToken);
      const p = await uploadPluginJSON(adminToken, {
        kind: 'original',
        slot: 'primary',
        name: 'T1_Replaceable',
        description: 'v1 desc',
        fileName: 'orig-v1.md',
        content: 'Original v1 rule',
      });

      const repJson = await adminPost(adminToken, {
        operation: 'replace_skill_plugin',
        id: p.id,
        name: 'T1_Replaced_JSON',
        description: 'v2 desc',
        fileName: 'orig-v2.txt',
        content: 'Replaced v2 rule',
      });
      assert.equal(repJson.status, 200);
      let snap = await repJson.json();
      let cur = snap.systemConfig.skillPlugins.find((x) => x.id === p.id);
      assert.equal(cur.name, 'T1_Replaced_JSON');
      assert.equal(cur.content, 'Replaced v2 rule');

      const fd = new FormData();
      fd.append('operation', 'replace_skill_plugin');
      fd.append('id', p.id);
      fd.append('file', new File([Buffer.from('Replaced v3 via FormData', 'utf-8')], 'orig-v3.md', { type: 'text/markdown' }));
      const repFd = await adminPost(adminToken, fd);
      assert.equal(repFd.status, 200);
      snap = await repFd.json();
      cur = snap.systemConfig.skillPlugins.find((x) => x.id === p.id);
      assert.equal(cur.content, 'Replaced v3 via FormData');

      const togOff = await adminPost(adminToken, { operation: 'toggle_skill_plugin', id: p.id, enabled: false });
      assert.equal(togOff.status, 200);
      snap = await togOff.json();
      assert.equal(snap.systemConfig.skillPlugins.find((x) => x.id === p.id).enabled, false);

      const delRes = await adminPost(adminToken, { operation: 'delete_skill_plugin', id: p.id });
      assert.equal(delRes.status, 200);
      snap = await delRes.json();
      assert.equal(snap.systemConfig.skillPlugins.some((x) => x.id === p.id), false);
    });

    await runTest('T1-05', 'T1', '4 workflows slot topology (transcribe=1 slot; domestic/foreign/original=2 slots)', async () => {
      await clearAllSkillPlugins(adminToken);
      await uploadPluginJSON(adminToken, { kind: 'transcribe', slot: 'primary', name: 'Tr_P', description: '扒剧主', fileName: 'tr.md', content: 'Tr rule' });
      for (const k of ['domestic', 'foreign', 'original']) {
        await uploadPluginJSON(adminToken, { kind: k, slot: 'primary', name: `${k}_P`, description: '主', fileName: `${k}-p.md`, content: `${k} P` });
        await uploadPluginJSON(adminToken, { kind: k, slot: 'secondary', name: `${k}_S`, description: '副', fileName: `${k}-s.txt`, content: `${k} S` });
      }
      const res = await studioGet(creator1Token);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.promptCatalog, 'GET /api/studio must include promptCatalog');
      assert.ok(Array.isArray(data.promptCatalog.transcribe?.primary));
      assert.equal(data.promptCatalog.transcribe?.secondary, undefined, 'transcribe must not expose secondary slot');
      for (const k of ['domestic', 'foreign', 'original']) {
        assert.ok(data.promptCatalog[k]?.primary?.length >= 1);
        assert.ok(data.promptCatalog[k]?.secondary?.length >= 1);
      }
    });

    await runTest('T1-06', 'T1', 'Creator GET /api/studio (list & single) returns summary-only promptCatalog with enabled plugins only', async () => {
      await clearAllSkillPlugins(adminToken);
      const enabledP = await uploadPluginJSON(adminToken, {
        kind: 'foreign',
        slot: 'primary',
        name: 'Visible_Prompt',
        description: '可见简短说明',
        fileName: 'secret-file-name.md',
        content: 'SECRET_PROMPT_RAW_BODY_DO_NOT_EXPOSE',
      });
      const disabledP = await uploadPluginJSON(adminToken, {
        kind: 'foreign',
        slot: 'primary',
        name: 'Hidden_Disabled_Prompt',
        description: '禁用不可见',
        fileName: 'hidden.md',
        content: 'DISABLED_RAW_BODY',
      });
      await adminPost(adminToken, { operation: 'toggle_skill_plugin', id: disabledP.id, enabled: false });

      const listData = await (await studioGet(creator1Token)).json();
      const catList = listData.promptCatalog.foreign.primary;
      assert.equal(catList.some((x) => x.id === enabledP.id), true);
      assert.equal(catList.some((x) => x.id === disabledP.id), false, 'Disabled plugin must be excluded from promptCatalog');
      for (const item of catList) {
        for (const k of Object.keys(item)) {
          assert.equal(CREATOR_SUMMARY_KEYS.has(k), true, `Unexpected key "${k}" in CreatorPromptSummary`);
        }
      }
      assertCreatorRedlineClean(listData, 'GET /api/studio list', ['SECRET_PROMPT_RAW_BODY_DO_NOT_EXPOSE', 'secret-file-name.md']);

      const created = await (await studioPost(creator1Token, { operation: 'create', title: 'Catalog Single Check', kind: 'foreign', brief: '全剧 40 集' })).json();
      const singleData = await (await studioGet(creator1Token, `?id=${created.id}`)).json();
      assert.ok(singleData.promptCatalog, 'Single-project GET /api/studio?id= must include promptCatalog');
      assertCreatorRedlineClean(singleData, 'GET /api/studio?id= single', ['SECRET_PROMPT_RAW_BODY_DO_NOT_EXPOSE', 'secret-file-name.md']);
    });

    await runTest('T1-07', 'T1', 'Creator create with promptSelections (both nested & flat forms)', async () => {
      await clearAllSkillPlugins(adminToken);
      const p1 = await uploadPluginJSON(adminToken, { kind: 'foreign', slot: 'primary', name: 'Create_P', description: 'P', fileName: 'cp.md', content: 'CP' });
      const s1 = await uploadPluginJSON(adminToken, { kind: 'foreign', slot: 'secondary', name: 'Create_S', description: 'S', fileName: 'cs.txt', content: 'CS' });

      const resNested = await studioPost(creator1Token, {
        operation: 'create',
        title: 'Create Nested Selections',
        kind: 'foreign',
        brief: '全剧 50 集',
        promptSelections: { foreign: { primary: p1.id, secondary: s1.id } },
      });
      assert.equal(resNested.status, 201);
      const proj1 = await resNested.json();
      assert.equal(proj1.promptSelections?.foreign?.primary, p1.id);
      assert.equal(proj1.promptSelections?.foreign?.secondary, s1.id);

      const resFlat = await studioPost(creator1Token, {
        operation: 'create',
        title: 'Create Flat Selections',
        kind: 'foreign',
        brief: '全剧 50 集',
        promptSelections: { primary: p1.id, secondary: s1.id },
      });
      assert.equal(resFlat.status, 201);
      const proj2 = await resFlat.json();
      assert.equal(proj2.promptSelections?.foreign?.primary, p1.id);
      assert.equal(proj2.promptSelections?.foreign?.secondary, s1.id);
    });

    await runTest('T1-08', 'T1', 'Creator set_prompts switches slot selections & allows clearing to fallback', async () => {
      await clearAllSkillPlugins(adminToken);
      const p1 = await uploadPluginJSON(adminToken, { kind: 'domestic', slot: 'primary', name: 'Switch_P1', description: 'P1', fileName: 'p1.md', content: 'P1' });
      const p2 = await uploadPluginJSON(adminToken, { kind: 'domestic', slot: 'primary', name: 'Switch_P2', description: 'P2', fileName: 'p2.md', content: 'P2' });
      const s1 = await uploadPluginJSON(adminToken, { kind: 'domestic', slot: 'secondary', name: 'Switch_S1', description: 'S1', fileName: 's1.txt', content: 'S1' });

      const proj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Set Prompts Test',
        kind: 'domestic',
        brief: '全剧 60 集',
        promptSelections: { domestic: { primary: p1.id } },
      })).json();

      const swRes = await studioPost(creator1Token, {
        operation: 'set_prompts',
        id: proj.id,
        version: proj.version,
        kind: 'domestic',
        primaryPluginId: p2.id,
        secondaryPluginId: s1.id,
      });
      assert.equal(swRes.status, 200);
      const updated = await swRes.json();
      assert.equal(updated.version, proj.version + 1);
      assert.equal(updated.promptSelections?.domestic?.primary, p2.id);
      assert.equal(updated.promptSelections?.domestic?.secondary, s1.id);

      const clrRes = await studioPost(creator1Token, {
        operation: 'set_prompts',
        id: updated.id,
        version: updated.version,
        kind: 'domestic',
        primaryPluginId: '',
        secondaryPluginId: '',
      });
      assert.equal(clrRes.status, 200);
      const cleared = await clrRes.json();
      assert.equal(Boolean(cleared.promptSelections?.domestic?.primary), false);
      assert.equal(Boolean(cleared.promptSelections?.domestic?.secondary), false);
    });

    await runTest('T1-09', 'T1', 'Built-in fallback runs cleanly when no plugin is selected or default', async () => {
      await clearAllSkillPlugins(adminToken);
      capturedLLMCalls.length = 0;
      const proj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Fallback Baseline',
        kind: 'original',
        brief: '豪门真假千金反转',
      })).json();
      const conf = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();
      const connRes = await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: conf.version });
      assert.equal(connRes.status, 200);
      assert.ok(capturedLLMCalls.length >= 1, 'Built-in fallback must invoke LLM station');
      assert.ok(capturedLLMCalls[0].systemPrompt.length > 10, 'Built-in station systemPrompt must be non-empty');
    });

    await runTest('T1-10', 'T1', 'Mocked fetch verifies actual .md & .txt primary+secondary plugin content injected into LLM', async () => {
      await clearAllSkillPlugins(adminToken);
      const pCanary = 'CANARY_PRIMARY_MD_8811_HOOK_RULE';
      const sCanary = 'CANARY_SECONDARY_TXT_9922_DIALOGUE_STYLE';
      const p = await uploadPluginJSON(adminToken, { kind: 'domestic', slot: 'primary', name: 'Inject_P', description: '主', fileName: 'inj-p.md', content: `# 主规则\n${pCanary}` });
      const s = await uploadPluginJSON(adminToken, { kind: 'domestic', slot: 'secondary', name: 'Inject_S', description: '副', fileName: 'inj-s.txt', content: `副规则：\n${sCanary}` });

      const proj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Injection Verify',
        kind: 'domestic',
        brief: '全剧 60 集',
        promptSelections: { domestic: { primary: p.id, secondary: s.id } },
      })).json();
      const conf = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();

      capturedLLMCalls.length = 0;
      const conn = await (await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: conf.version })).json();
      assert.ok(capturedLLMCalls.length >= 1);
      assert.equal(capturedLLMCalls[0].systemPrompt.includes(pCanary), true, 'Director LLM call must inject primary plugin');
      assert.equal(capturedLLMCalls[0].systemPrompt.includes(sCanary), true, 'Director LLM call must inject secondary plugin');

      capturedLLMCalls.length = 0;
      const actRes = await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: conn.version,
        action: { version: conn.remote.version, action_id: crypto.randomUUID(), action: 'confirm', answers: { scope: '全剧 60 集' } },
      });
      assert.equal(actRes.status, 200);
      assert.ok(capturedLLMCalls.length >= 1);
      assert.equal(capturedLLMCalls[0].systemPrompt.includes(pCanary), true, 'Planner LLM call must inject primary plugin');
      assert.equal(capturedLLMCalls[0].systemPrompt.includes(sCanary), true, 'Planner LLM call must inject secondary plugin');
    });

    await runTest('T1-11', 'T1', 'Multi-type upload (raw binary + FormData) & UTF-8 filename*= download header', async () => {
      const proj = await (await studioPost(creator1Token, { operation: 'create', title: 'Upload Modes', kind: 'foreign', brief: '全剧 30 集' })).json();
      const rawBytes = Buffer.from('%PDF-1.4 fake pdf content for test', 'utf-8');
      const rawRes = await uploadPost(creator1Token, `id=${proj.id}&name=${encodeURIComponent('中文分集大纲.pdf')}`, rawBytes, 'application/pdf');
      assert.equal(rawRes.status, 200);
      const afterRaw = await rawRes.json();
      const pdfAtt = afterRaw.attachments.find((a) => a.name === '中文分集大纲.pdf');
      assert.ok(pdfAtt);

      const fd = new FormData();
      fd.append('file', new File([Buffer.from('1\n00:00:01,000 --> 00:00:03,000\nHello', 'utf-8')], '第01集字幕.srt', { type: 'text/plain' }));
      const fdRes = await uploadPost(creator1Token, `id=${proj.id}&name=${encodeURIComponent('第01集字幕.srt')}`, fd);
      assert.equal(fdRes.status, 200);
      const afterFd = await fdRes.json();
      assert.ok(afterFd.attachments.some((a) => a.name === '第01集字幕.srt'));

      const dlRes = await uploadGet(creator1Token, `id=${proj.id}&file=${pdfAtt.id}`);
      assert.equal(dlRes.status, 200);
      const disp = dlRes.headers.get('content-disposition') || '';
      assert.equal(disp.includes(`filename*=UTF-8''${encodeURIComponent('中文分集大纲.pdf')}`), true, `Expected RFC 5987 filename*= header, got: ${disp}`);
      const dlBuf = Buffer.from(await dlRes.arrayBuffer());
      assert.equal(dlBuf.equals(rawBytes), true);
    });

    await runTest('T1-12', 'T1', 'Relaxed upload limit allows > 20 MB (21 MB) & persists to bucket', async () => {
      const proj = await (await studioPost(creator1Token, { operation: 'create', title: 'Large Upload 21MB', kind: 'foreign', brief: '全剧 30 集' })).json();
      const size21MB = 21 * 1024 * 1024;
      const bigBuf = new Uint8Array(size21MB);
      bigBuf[0] = 0x41;
      bigBuf[size21MB - 1] = 0x5a;

      const upRes = await uploadPost(creator1Token, `id=${proj.id}&name=${encodeURIComponent('large-21mb.mov')}`, bigBuf, 'video/quicktime');
      assert.equal(upRes.status, 200, `21 MB upload should succeed, got ${upRes.status}`);
      const updated = await upRes.json();
      const att = updated.attachments.find((a) => a.name === 'large-21mb.mov');
      assert.ok(att);
      assert.equal(att.size, size21MB);

      const dlRes = await uploadGet(creator1Token, `id=${proj.id}&file=${att.id}`);
      assert.equal(dlRes.status, 200);
      const dlAb = await dlRes.arrayBuffer();
      assert.equal(dlAb.byteLength, size21MB);
    });

    // =========================================================================
    // TIER 2: Boundary & Corner Cases
    // =========================================================================
    console.log('\n=== Tier 2: Boundary & Corner Cases ===');

    await runTest('T2-01', 'T2', 'Uppercase .MD/.TXT extensions & UTF-8 BOM stripping', async () => {
      await clearAllSkillPlugins(adminToken);
      const bomBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('BOM_CLEAN_CONTENT', 'utf-8')]);
      const fd1 = new FormData();
      fd1.append('operation', 'upload_skill_plugin');
      fd1.append('kind', 'original');
      fd1.append('slot', 'primary');
      fd1.append('name', 'Upper_BOM_MD');
      fd1.append('description', 'BOM测试');
      fd1.append('file', new File([bomBytes], 'UPPER_CASE.MD', { type: 'text/markdown' }));
      const r1 = await adminPost(adminToken, fd1);
      assert.equal(r1.status, 200);
      const s1 = await r1.json();
      const p1 = s1.systemConfig.skillPlugins.find((p) => p.name === 'Upper_BOM_MD');
      assert.equal(p1.fileExt, 'md');
      assert.equal(p1.content.startsWith('\uFEFF'), false, 'UTF-8 BOM must be stripped');
      assert.equal(p1.content, 'BOM_CLEAN_CONTENT');

      const fd2 = new FormData();
      fd2.append('operation', 'upload_skill_plugin');
      fd2.append('kind', 'original');
      fd2.append('slot', 'secondary');
      fd2.append('name', 'Upper_TXT');
      fd2.append('description', '大写TXT');
      fd2.append('file', new File([Buffer.from('\uFEFFT2_TXT_BODY', 'utf-8')], 'STYLE.TXT', { type: 'text/plain' }));
      const r2 = await adminPost(adminToken, fd2);
      assert.equal(r2.status, 200);
      const s2 = await r2.json();
      const p2 = s2.systemConfig.skillPlugins.find((p) => p.name === 'Upper_TXT');
      assert.equal(p2.fileExt, 'txt');
      assert.equal(p2.content, 'T2_TXT_BODY');
    });

    await runTest('T2-02', 'T2', 'Reject binary (null-byte) & empty/whitespace-only plugin files', async () => {
      const binFd = new FormData();
      binFd.append('operation', 'upload_skill_plugin');
      binFd.append('kind', 'foreign');
      binFd.append('slot', 'primary');
      binFd.append('name', 'Binary_Fake_MD');
      binFd.append('description', 'bad');
      binFd.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02])], 'fake.md', { type: 'text/markdown' }));
      const binRes = await adminPost(adminToken, binFd);
      assert.equal(binRes.status, 400, `Binary plugin must return 400, got ${binRes.status}`);

      const emptyRes = await adminPost(adminToken, {
        operation: 'upload_skill_plugin',
        kind: 'foreign',
        slot: 'primary',
        name: 'Empty_Plugin',
        description: 'empty',
        fileName: 'empty.md',
        content: '\uFEFF   \n\t  ',
      });
      assert.equal(emptyRes.status, 400, `Whitespace-only plugin must return 400, got ${emptyRes.status}`);
    });

    await runTest('T2-03', 'T2', 'Reject unsupported non-.md/.txt plugin file extensions', async () => {
      const fd = new FormData();
      fd.append('operation', 'upload_skill_plugin');
      fd.append('kind', 'foreign');
      fd.append('slot', 'primary');
      fd.append('name', 'Bad_Ext_Plugin');
      fd.append('description', 'bad ext');
      fd.append('file', new File([Buffer.from('hello', 'utf-8')], 'malware.exe', { type: 'application/octet-stream' }));
      const res = await adminPost(adminToken, fd);
      assert.equal(res.status, 400, `Unsupported plugin extension must return 400, got ${res.status}`);
    });

    await runTest('T2-04', 'T2', 'transcribe strictly rejects secondary slot on admin upload & studio create/set_prompts', async () => {
      await clearAllSkillPlugins(adminToken);
      const validP = await uploadPluginJSON(adminToken, { kind: 'foreign', slot: 'secondary', name: 'Foreign_Sec', description: 'f', fileName: 'fs.md', content: 'FS' });

      const adminBad = await adminPost(adminToken, {
        operation: 'upload_skill_plugin',
        kind: 'transcribe',
        slot: 'secondary',
        name: 'Invalid_Transcribe_Sec',
        description: 'forbidden',
        fileName: 'bad.md',
        content: 'should fail',
      });
      assert.equal(adminBad.status, 400, 'Admin upload_skill_plugin for transcribe+secondary must return 400');

      const createBad = await studioPost(creator1Token, {
        operation: 'create',
        title: 'Transcribe Bad Slot Create',
        kind: 'transcribe',
        brief: '全剧 10 集',
        promptSelections: { transcribe: { secondary: validP.id } },
      });
      assert.equal(createBad.status, 400, 'Studio create with transcribe+secondary must return 400');

      const trProj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Transcribe Valid',
        kind: 'transcribe',
        brief: '全剧 10 集',
      })).json();
      const setBad = await studioPost(creator1Token, {
        operation: 'set_prompts',
        id: trProj.id,
        version: trProj.version,
        kind: 'transcribe',
        secondaryPluginId: validP.id,
      });
      assert.equal(setBad.status, 400, 'Studio set_prompts for transcribe with secondaryPluginId must return 400');
    });

    await runTest('T2-05', 'T2', 'Disabled plugin falls back to enabled default (or built-in) without injecting disabled content', async () => {
      await clearAllSkillPlugins(adminToken);
      const defP = await uploadPluginJSON(adminToken, {
        kind: 'foreign',
        slot: 'primary',
        name: 'Fallback_Default_P',
        description: '默认',
        fileName: 'def.md',
        content: 'DEFAULT_FALLBACK_CANARY_4455',
        isDefault: true,
      });
      const selP = await uploadPluginJSON(adminToken, {
        kind: 'foreign',
        slot: 'primary',
        name: 'Will_Disable_P',
        description: '将被禁用',
        fileName: 'dis.md',
        content: 'DISABLED_CANARY_SHOULD_NOT_APPEAR_7788',
        isDefault: false,
      });

      const proj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Disable Fallback',
        kind: 'foreign',
        brief: '全剧 40 集',
        promptSelections: { foreign: { primary: selP.id } },
      })).json();
      const conf = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();

      // Disable selected plugin before connect
      await adminPost(adminToken, { operation: 'toggle_skill_plugin', id: selP.id, enabled: false });

      capturedLLMCalls.length = 0;
      const connRes = await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: conf.version });
      assert.equal(connRes.status, 200);
      assert.equal(capturedLLMCalls[0].systemPrompt.includes('DISABLED_CANARY_SHOULD_NOT_APPEAR_7788'), false);
      assert.equal(capturedLLMCalls[0].systemPrompt.includes(defP.content), true, 'Must fall back to enabled slot default');
    });

    await runTest('T2-06', 'T2', 'Deleted plugin falls back gracefully to built-in prompt without error', async () => {
      await clearAllSkillPlugins(adminToken);
      const selP = await uploadPluginJSON(adminToken, {
        kind: 'original',
        slot: 'primary',
        name: 'Will_Delete_P',
        description: '将被删除',
        fileName: 'del.md',
        content: 'DELETED_CANARY_6677',
      });
      const proj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Delete Fallback',
        kind: 'original',
        brief: '重生逆袭短剧',
        promptSelections: { original: { primary: selP.id } },
      })).json();
      const conf = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();

      await adminPost(adminToken, { operation: 'delete_skill_plugin', id: selP.id });

      capturedLLMCalls.length = 0;
      const connRes = await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: conf.version });
      assert.equal(connRes.status, 200);
      assert.equal(capturedLLMCalls[0].systemPrompt.includes('DELETED_CANARY_6677'), false);
      assert.ok(capturedLLMCalls[0].systemPrompt.length > 10);
    });

    await runTest('T2-07', 'T2', 'Stale version on set_prompts returns 409 CONFLICT without mutating selection', async () => {
      await clearAllSkillPlugins(adminToken);
      const p1 = await uploadPluginJSON(adminToken, { kind: 'foreign', slot: 'primary', name: 'Ver_P1', description: '1', fileName: 'v1.md', content: 'V1' });
      const p2 = await uploadPluginJSON(adminToken, { kind: 'foreign', slot: 'primary', name: 'Ver_P2', description: '2', fileName: 'v2.md', content: 'V2' });
      const proj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Version Conflict',
        kind: 'foreign',
        brief: '全剧 40 集',
        promptSelections: { foreign: { primary: p1.id } },
      })).json();

      // Advance version via rename
      await studioPost(creator1Token, { operation: 'rename', id: proj.id, version: proj.version, title: 'Version Conflict v2' });

      const staleRes = await studioPost(creator1Token, {
        operation: 'set_prompts',
        id: proj.id,
        version: proj.version, // stale!
        kind: 'foreign',
        primaryPluginId: p2.id,
      });
      assert.equal(staleRes.status, 409);
      const errData = await staleRes.json();
      assert.equal(errData.error, 'CONFLICT');

      const fresh = await (await studioGet(creator1Token, `?id=${proj.id}`)).json();
      assert.equal(fresh.promptSelections?.foreign?.primary, p1.id);
    });

    await runTest('T2-08', 'T2', 'Upload > 200 MB (201 MB) returns 413 FILE_TOO_LARGE', async () => {
      const proj = await (await studioPost(creator1Token, { operation: 'create', title: 'Oversize 201MB', kind: 'foreign', brief: '全剧 30 集' })).json();
      const overBuf = new Uint8Array(201 * 1024 * 1024);
      const res = await uploadPost(creator1Token, `id=${proj.id}&name=${encodeURIComponent('too-big-201mb.mp4')}`, overBuf, 'video/mp4');
      assert.equal(res.status, 413);
      const err = await res.json();
      assert.equal(err.error, 'FILE_TOO_LARGE');
    });

    await runTest('T2-09', 'T2', 'Diverse file extensions accepted (.pdf, .srt, .mov, .csv, .json, extensionless)', async () => {
      const proj = await (await studioPost(creator1Token, { operation: 'create', title: 'Diverse Formats', kind: 'domestic', brief: '全剧 50 集' })).json();
      const samples = [
        ['bible.pdf', '%PDF-1.5 sample'],
        ['captions.srt', '1\n00:00:00,000 --> 00:00:02,000\nLine 1'],
        ['clip.mov', 'ftypqt  mov-header'],
        ['episodes.csv', 'ep,title\n1,Pilot'],
        ['meta.json', '{"genre":"urban"}'],
        ['无后缀设定稿', '纯文本设定资料内容'],
      ];
      let latest;
      for (const [fname, body] of samples) {
        const res = await uploadPost(creator1Token, `id=${proj.id}&name=${encodeURIComponent(fname)}`, Buffer.from(body, 'utf-8'), 'application/octet-stream');
        assert.equal(res.status, 200, `Upload failed for ${fname}`);
        latest = await res.json();
      }
      for (const [fname] of samples) {
        assert.equal(latest.attachments.some((a) => a.name === fname), true, `Missing attachment ${fname}`);
      }
    });

    await runTest('T2-10', 'T2', 'Locked episode immutability preserved across set_prompts switches', async () => {
      await clearAllSkillPlugins(adminToken);
      const p1 = await uploadPluginJSON(adminToken, { kind: 'foreign', slot: 'primary', name: 'Lock_P1', description: '1', fileName: 'lp1.md', content: 'LP1' });
      const proj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Locked Ep Preservation',
        kind: 'foreign',
        brief: '全剧 60 集，前 10 集已锁定，帮我续写后面',
      })).json();
      assert.equal(proj.lockedEpisodes, 10);
      assert.equal(proj.startEpisode, 11);

      const up = await (await uploadPost(creator1Token, `id=${proj.id}&name=${encodeURIComponent('前10集锁定稿.docx')}&role=locked`, Buffer.from('LOCKED_TEXT_EXACT', 'utf-8'), 'application/octet-stream')).json();
      const sw = await (await studioPost(creator1Token, {
        operation: 'set_prompts',
        id: proj.id,
        version: up.version,
        kind: 'foreign',
        primaryPluginId: p1.id,
      })).json();
      assert.equal(sw.lockedEpisodes, 10);
      assert.equal(sw.startEpisode, 11);
      assert.equal(sw.attachments.some((a) => a.name === '前10集锁定稿.docx' && a.role === 'locked'), true);
    });

    await runTest('T2-11', 'T2', 'Non-admin creator token cannot upload, toggle, set_default, or delete plugins on /api/admin', async () => {
      const p = await uploadPluginJSON(adminToken, { kind: 'foreign', slot: 'primary', name: 'Auth_Guard_P', description: 'g', fileName: 'ag.md', content: 'AG' });
      for (const payload of [
        { operation: 'upload_skill_plugin', kind: 'foreign', slot: 'primary', name: 'Hack', description: 'x', fileName: 'h.md', content: 'x' },
        { operation: 'toggle_skill_plugin', id: p.id, enabled: false },
        { operation: 'set_default_skill_plugin', id: p.id, isDefault: true },
        { operation: 'delete_skill_plugin', id: p.id },
      ]) {
        const res = await adminPost(creator1Token, payload);
        assert.ok(res.status === 401 || res.status === 403, `Creator must not execute ${payload.operation}, got ${res.status}`);
      }
    });

    // =========================================================================
    // TIER 3: Cross-Feature Interactions
    // =========================================================================
    console.log('\n=== Tier 3: Cross-Feature Interactions ===');

    await runTest('T3-01', 'T3', 'Cross-feature flow: upload -> create -> LLM inject -> mid-project switch -> next LLM uses new prompt -> export sanitized', async () => {
      await clearAllSkillPlugins(adminToken);
      const oldCanary = 'CANARY_OLD_PRIMARY_1111';
      const newCanary = 'CANARY_NEW_PRIMARY_2222';
      const secCanary = 'CANARY_SHARED_SEC_3333';

      const pOld = await uploadPluginJSON(adminToken, { kind: 'domestic', slot: 'primary', name: 'Flow_Old_P', description: '旧主', fileName: 'old.md', content: oldCanary });
      const pNew = await uploadPluginJSON(adminToken, { kind: 'domestic', slot: 'primary', name: 'Flow_New_P', description: '新主', fileName: 'new.md', content: newCanary });
      const pSec = await uploadPluginJSON(adminToken, { kind: 'domestic', slot: 'secondary', name: 'Flow_Sec', description: '副', fileName: 'sec.txt', content: secCanary });

      let proj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Mid-Project Switch Flow',
        kind: 'domestic',
        brief: '全剧 60 集，红果爆款改编北美',
        promptSelections: { domestic: { primary: pOld.id, secondary: pSec.id } },
      })).json();
      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();

      capturedLLMCalls.length = 0;
      proj = await (await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version })).json();
      assert.equal(capturedLLMCalls[0].systemPrompt.includes(oldCanary), true);
      assert.equal(capturedLLMCalls[0].systemPrompt.includes(secCanary), true);

      // Mid-project switch
      proj = await (await studioPost(creator1Token, {
        operation: 'set_prompts',
        id: proj.id,
        version: proj.version,
        kind: 'domestic',
        primaryPluginId: pNew.id,
        secondaryPluginId: pSec.id,
      })).json();

      mockReplyMode = 'noisy_redline';
      mockCanaryLeakText = newCanary;
      capturedLLMCalls.length = 0;
      proj = await (await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { version: proj.remote.version, action_id: crypto.randomUUID(), action: 'confirm', answers: { scope: '全剧 60 集' } },
      })).json();
      mockReplyMode = 'normal';
      mockCanaryLeakText = '';

      assert.equal(capturedLLMCalls[0].systemPrompt.includes(newCanary), true, 'Next LLM call must use switched prompt');
      assert.equal(capturedLLMCalls[0].systemPrompt.includes(oldCanary), false, 'Old prompt must not remain after switch');
      assert.equal(capturedLLMCalls[0].systemPrompt.includes(secCanary), true);

      const expRes = await uploadGet(creator1Token, `id=${proj.id}&export=1`);
      assert.equal(expRes.status, 200);
      const expText = await expRes.text();
      assertCreatorRedlineClean(expText, 'T3-01 export=1', [oldCanary, newCanary, secCanary]);
    });

    await runTest('T3-02', 'T3', 'transcribe -> transfer_iteration -> domestic/foreign slot selection & LLM injection', async () => {
      await clearAllSkillPlugins(adminToken);
      const trP = await uploadPluginJSON(adminToken, { kind: 'transcribe', slot: 'primary', name: 'Tr_Only', description: '扒剧', fileName: 'tr.md', content: 'CANARY_TRANSCRIBE_ONLY' });
      const domP = await uploadPluginJSON(adminToken, { kind: 'domestic', slot: 'primary', name: 'Dom_After_Tr', description: '国内出海主', fileName: 'dat.md', content: 'CANARY_AFTER_TRANSFER_DOM_P' });
      const domS = await uploadPluginJSON(adminToken, { kind: 'domestic', slot: 'secondary', name: 'Dom_Sec_After_Tr', description: '国内出海副', fileName: 'dsat.txt', content: 'CANARY_AFTER_TRANSFER_DOM_S' });

      let trProj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Transcribe Transfer Test',
        kind: 'transcribe',
        brief: '全剧 10 集',
        promptSelections: { transcribe: { primary: trP.id } },
      })).json();
      trProj = await (await uploadPost(creator1Token, `id=${trProj.id}&name=${encodeURIComponent('第01集.mp4')}`, Buffer.from('mp4data'), 'video/mp4')).json();

      const transRes = await studioPost(creator1Token, {
        operation: 'transfer_iteration',
        id: trProj.id,
        version: trProj.version,
        target_kind: 'domestic',
      });
      assert.equal(transRes.status, 201);
      let domProj = await transRes.json();
      assert.equal(domProj.kind, 'domestic');
      assert.equal(domProj.attachments.length, 1);

      domProj = await (await studioPost(creator1Token, {
        operation: 'set_prompts',
        id: domProj.id,
        version: domProj.version,
        kind: 'domestic',
        primaryPluginId: domP.id,
        secondaryPluginId: domS.id,
      })).json();
      domProj = await (await studioPost(creator1Token, { operation: 'confirm', id: domProj.id, version: domProj.version })).json();

      capturedLLMCalls.length = 0;
      await studioPost(creator1Token, { operation: 'connect', id: domProj.id, version: domProj.version });
      assert.equal(capturedLLMCalls[0].systemPrompt.includes('CANARY_AFTER_TRANSFER_DOM_P'), true);
      assert.equal(capturedLLMCalls[0].systemPrompt.includes('CANARY_AFTER_TRANSFER_DOM_S'), true);
      assert.equal(capturedLLMCalls[0].systemPrompt.includes('CANARY_TRANSCRIBE_ONLY'), false);
    });

    await runTest('T3-03', 'T3', 'switch_kind + set_prompts + LLM execution flow', async () => {
      await clearAllSkillPlugins(adminToken);
      const origP = await uploadPluginJSON(adminToken, { kind: 'original', slot: 'primary', name: 'Orig_Sw_P', description: '原创主', fileName: 'op.md', content: 'CANARY_ORIG_SWITCH_P' });
      const origS = await uploadPluginJSON(adminToken, { kind: 'original', slot: 'secondary', name: 'Orig_Sw_S', description: '原创副', fileName: 'os.txt', content: 'CANARY_ORIG_SWITCH_S' });

      let proj = await (await studioPost(creator1Token, { operation: 'create', title: 'Switch Kind Flow', kind: 'foreign', brief: '豪门脑洞' })).json();
      const swKindRes = await studioPost(creator1Token, { operation: 'switch_kind', id: proj.id, version: proj.version, kind: 'original' });
      assert.equal(swKindRes.status, 200);
      proj = await swKindRes.json();
      assert.equal(proj.kind, 'original');

      proj = await (await studioPost(creator1Token, {
        operation: 'set_prompts',
        id: proj.id,
        version: proj.version,
        kind: 'original',
        primaryPluginId: origP.id,
        secondaryPluginId: origS.id,
      })).json();
      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();

      capturedLLMCalls.length = 0;
      await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version });
      assert.equal(capturedLLMCalls[0].systemPrompt.includes('CANARY_ORIG_SWITCH_P'), true);
      assert.equal(capturedLLMCalls[0].systemPrompt.includes('CANARY_ORIG_SWITCH_S'), true);
    });

    await runTest('T3-04', 'T3', 'Admin replace_skill_plugin hot-reloads into active project next LLM call', async () => {
      await clearAllSkillPlugins(adminToken);
      const p = await uploadPluginJSON(adminToken, { kind: 'foreign', slot: 'primary', name: 'Hot_Reload_P', description: '热更新', fileName: 'hr.md', content: 'HOT_RELOAD_V1_CANARY' });
      let proj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Hot Reload Project',
        kind: 'foreign',
        brief: '全剧 40 集',
        promptSelections: { foreign: { primary: p.id } },
      })).json();
      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();
      proj = await (await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version })).json();

      await adminPost(adminToken, {
        operation: 'replace_skill_plugin',
        id: p.id,
        content: 'HOT_RELOAD_V2_CANARY',
      });

      capturedLLMCalls.length = 0;
      await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { version: proj.remote.version, action_id: crypto.randomUUID(), action: 'revise', answers: { feedback: '强化前3秒冲突' } },
      });
      assert.equal(capturedLLMCalls[0].systemPrompt.includes('HOT_RELOAD_V2_CANARY'), true);
      assert.equal(capturedLLMCalls[0].systemPrompt.includes('HOT_RELOAD_V1_CANARY'), false);
    });

    await runTest('T3-05', 'T3', 'Multi-account isolation: shared promptCatalog but strict project ownership enforcement', async () => {
      await clearAllSkillPlugins(adminToken);
      const sharedP = await uploadPluginJSON(adminToken, { kind: 'foreign', slot: 'primary', name: 'Shared_Cat_P', description: '共享', fileName: 'sh.md', content: 'SHARED_CANARY' });

      const cat1 = await (await studioGet(creator1Token)).json();
      const cat2 = await (await studioGet(creator2Token)).json();
      assert.equal(cat1.promptCatalog.foreign.primary.some((x) => x.id === sharedP.id), true);
      assert.equal(cat2.promptCatalog.foreign.primary.some((x) => x.id === sharedP.id), true);

      const p1 = await (await studioPost(creator1Token, { operation: 'create', title: 'Owner1 Secret Proj', kind: 'foreign', brief: '全剧 30 集' })).json();
      const hijackRes = await studioPost(creator2Token, {
        operation: 'set_prompts',
        id: p1.id,
        version: p1.version,
        kind: 'foreign',
        primaryPluginId: sharedP.id,
      });
      assert.equal(hijackRes.status, 404, 'Other creator must not mutate prompt selections of unowned project');
    });

    // =========================================================================
    // TIER 4: Real-World Application Scenarios & Redline Audits
    // =========================================================================
    console.log('\n=== Tier 4: Real-World Scenarios & Redline Audits ===');

    await runTest('T4-01', 'T4', 'Real-world foreign continuation (60 eps, 10 locked) end-to-end delivery & export', async () => {
      await clearAllSkillPlugins(adminToken);
      const pFor = await uploadPluginJSON(adminToken, { kind: 'foreign', slot: 'primary', name: 'RW_Foreign_P', description: '欧美狼人主流程', fileName: 'rw-f-p.md', content: 'RW_FOREIGN_PRIMARY_CANARY' });
      const sFor = await uploadPluginJSON(adminToken, { kind: 'foreign', slot: 'secondary', name: 'RW_Foreign_S', description: '锁集衔接副规则', fileName: 'rw-f-s.txt', content: 'RW_FOREIGN_SECONDARY_CANARY' });

      let proj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Alpha Contract Continuation',
        kind: 'foreign',
        brief: '全剧 60 集，前 10 集已锁定，帮我续写后面',
        promptSelections: { foreign: { primary: pFor.id, secondary: sFor.id } },
      })).json();
      proj = await (await uploadPost(creator1Token, `id=${proj.id}&name=${encodeURIComponent('ep1-10-locked.docx')}&role=locked`, Buffer.from('Locked 1-10'), 'application/octet-stream')).json();
      proj = await (await uploadPost(creator1Token, `id=${proj.id}&name=${encodeURIComponent('series-bible.pdf')}&role=setting`, Buffer.from('%PDF bible'), 'application/pdf')).json();
      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();
      proj = await (await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version })).json();

      // Step through stages (recap -> mainline_understood -> script_episodes -> delivered)
      proj = await (await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { version: proj.remote.version, action_id: crypto.randomUUID(), action: 'confirm', answers: { scope: '前10集锁定' } },
      })).json();

      // Verify understood gate blocks when understood !== true
      const gateFail = await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { version: proj.remote.version, action_id: crypto.randomUUID(), action: 'confirm', answers: { selection: '方案 A', understood: false } },
      });
      assert.equal(gateFail.status, 400);

      proj = await (await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { version: proj.remote.version, action_id: crypto.randomUUID(), action: 'confirm', answers: { selection: '方案 A', understood: true } },
      })).json();
      assert.equal(proj.remote.stage.key, 'script_episodes', 'foreign must advance directly from mainline_understood to script_episodes');
      assert.equal(proj.remote.card?.step, 'script_confirm');

      proj = await (await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { version: proj.remote.version, action_id: crypto.randomUUID(), action: 'confirm', answers: { ending: 'HE' } },
      })).json();
      assert.equal(proj.remote.status, 'delivered');

      const expText = await (await uploadGet(creator1Token, `id=${proj.id}&export=1`)).text();
      assert.equal(expText.includes('前 10 集已锁定（一字不动）'), true);
      assertCreatorRedlineClean(expText, 'T4-01 export', ['RW_FOREIGN_PRIMARY_CANARY', 'RW_FOREIGN_SECONDARY_CANARY']);
    });

    await runTest('T4-02', 'T4', 'Real-world domestic 3-gate cross-cultural adaptation scenario', async () => {
      await clearAllSkillPlugins(adminToken);
      const pDom = await uploadPluginJSON(adminToken, { kind: 'domestic', slot: 'primary', name: 'RW_Dom_P', description: '三道门出海规范', fileName: 'rw-d-p.md', content: 'RW_DOM_PRIMARY_CANARY' });
      const sDom = await uploadPluginJSON(adminToken, { kind: 'domestic', slot: 'secondary', name: 'RW_Dom_S', description: '美式幽默精修', fileName: 'rw-d-s.txt', content: 'RW_DOM_SECONDARY_CANARY' });

      let proj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Dom-to-US Billionaire Remake',
        kind: 'domestic',
        brief: '全剧 70 集，把国内豪门退婚桥段改成北美信托对决',
        promptSelections: { domestic: { primary: pDom.id, secondary: sDom.id } },
      })).json();
      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();
      proj = await (await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version })).json();
      // cursor 1 -> 2 (domestic_gates)
      proj = await (await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { version: proj.remote.version, action_id: crypto.randomUUID(), action: 'confirm', answers: { scope: '70集' } },
      })).json();
      assert.equal(proj.remote.stage.key, 'domestic_gates');

      // cursor 2 -> 3 (mainline_understood)
      capturedLLMCalls.length = 0;
      proj = await (await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { version: proj.remote.version, action_id: crypto.randomUUID(), action: 'confirm', answers: { worldview_gate: '通过', persona_gate: '通过', trope_gate: '通过' } },
      })).json();
      assert.equal(proj.remote.stage.key, 'mainline_understood');
      assert.equal(capturedLLMCalls[0].systemPrompt.includes('RW_DOM_PRIMARY_CANARY'), true);
      assert.equal(capturedLLMCalls[0].systemPrompt.includes('RW_DOM_SECONDARY_CANARY'), true);
    });

    await runTest('T4-03', 'T4', 'Real-world transcribe scenario: episode detection, manual set_episode, mode required, delivery', async () => {
      await clearAllSkillPlugins(adminToken);
      const pTr = await uploadPluginJSON(adminToken, { kind: 'transcribe', slot: 'primary', name: 'RW_Tr_P', description: '扒剧规范', fileName: 'rw-tr.md', content: 'RW_TRANSCRIBE_CANARY' });

      let proj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Short Drama Video Transcribe',
        kind: 'transcribe',
        brief: '全剧 2 集',
        promptSelections: { transcribe: { primary: pTr.id } },
      })).json();
      proj = await (await uploadPost(creator1Token, `id=${proj.id}&name=${encodeURIComponent('第01集.mp4')}`, Buffer.from('v1'), 'video/mp4')).json();
      proj = await (await uploadPost(creator1Token, `id=${proj.id}&name=${encodeURIComponent('1-1.mp4')}`, Buffer.from('v2'), 'video/mp4')).json();

      const ep1 = proj.attachments.find((a) => a.name === '第01集.mp4');
      const epAmbig = proj.attachments.find((a) => a.name === '1-1.mp4');
      assert.equal(ep1.episode, 1);
      assert.equal(epAmbig.episode, undefined, '1-1.mp4 must not auto-guess episode');

      proj = await (await studioPost(creator1Token, { operation: 'set_episode', id: proj.id, version: proj.version, attachment_id: epAmbig.id, episode: 2 })).json();
      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();
      proj = await (await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version })).json();

      const noModeRes = await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { version: proj.remote.version, action_id: crypto.randomUUID(), action: 'confirm', answers: {} },
      });
      assert.equal(noModeRes.status, 400, 'Transcribe mode must not have default');

      capturedLLMCalls.length = 0;
      proj = await (await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { version: proj.remote.version, action_id: crypto.randomUUID(), action: 'confirm', answers: { mode: 'detailed' } },
      })).json();
      assert.equal(capturedLLMCalls[0].systemPrompt.includes('RW_TRANSCRIBE_CANARY'), true);

      proj = await (await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { version: proj.remote.version, action_id: crypto.randomUUID(), action: 'confirm', answers: { boundaries: '人名无误' } },
      })).json();
      assert.equal(proj.remote.status, 'delivered');
    });

    await runTest('T4-04', 'T4', 'Real-world original scenario: create without total episodes -> Stop A total=60 -> delivered', async () => {
      await clearAllSkillPlugins(adminToken);
      const pOr = await uploadPluginJSON(adminToken, { kind: 'original', slot: 'primary', name: 'RW_Orig_P', description: '原创四层推理', fileName: 'rw-o-p.md', content: 'RW_ORIG_PRIMARY_CANARY' });
      const sOr = await uploadPluginJSON(adminToken, { kind: 'original', slot: 'secondary', name: 'RW_Orig_S', description: '爽点卡点副规则', fileName: 'rw-o-s.txt', content: 'RW_ORIG_SECONDARY_CANARY' });

      let proj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Original Brainstorm Idea',
        kind: 'original',
        brief: '真假千金互换记忆后在拍卖会反杀',
        promptSelections: { original: { primary: pOr.id, secondary: sOr.id } },
      })).json();
      assert.equal(proj.total, null, 'Original workflow starts without requiring upfront total episodes');

      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();
      proj = await (await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version })).json();
      proj = await (await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { version: proj.remote.version, action_id: crypto.randomUUID(), action: 'confirm', answers: { direction: '方案 A', opening: '开场 B', engine: '记忆共振', total: '60', audience: '女频' } },
      })).json();
      assert.equal(proj.total, 60);
      proj = await (await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { version: proj.remote.version, action_id: crypto.randomUUID(), action: 'confirm', answers: { ending: 'HE' } },
      })).json();
      assert.equal(proj.remote.status, 'delivered');
    });

    await runTest('T4-05', 'T4', 'Strict redline leak audit across creator APIs, export .md, and app/page.tsx UI source', async () => {
      await clearAllSkillPlugins(adminToken);
      const secretCanary = 'ULTRA_SECRET_PROMPT_LINE_987654321';
      const p = await uploadPluginJSON(adminToken, {
        kind: 'foreign',
        slot: 'primary',
        name: 'Audit_Redline_Prompt',
        description: '仅展示名称与简介',
        fileName: 'internal-secret-skill.md',
        content: secretCanary,
      });

      mockReplyMode = 'noisy_redline';
      mockCanaryLeakText = secretCanary;
      let proj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Redline Audit Project',
        kind: 'foreign',
        brief: '全剧 40 集',
        promptSelections: { foreign: { primary: p.id } },
      })).json();
      assertCreatorRedlineClean(proj, 'create response', [secretCanary, 'internal-secret-skill.md']);

      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();
      proj = await (await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version })).json();
      assertCreatorRedlineClean(proj, 'connect response', [secretCanary, 'internal-secret-skill.md']);

      const listSnap = await (await studioGet(creator1Token)).json();
      assertCreatorRedlineClean(listSnap, 'GET /api/studio', [secretCanary, 'internal-secret-skill.md']);

      const singleSnap = await (await studioGet(creator1Token, `?id=${proj.id}`)).json();
      assertCreatorRedlineClean(singleSnap, 'GET /api/studio?id=', [secretCanary, 'internal-secret-skill.md']);

      const exportMd = await (await uploadGet(creator1Token, `id=${proj.id}&export=1`)).text();
      assertCreatorRedlineClean(exportMd, 'GET /api/upload?export=1', [secretCanary, 'internal-secret-skill.md']);
      mockReplyMode = 'normal';
      mockCanaryLeakText = '';

      // Static source redline check on creator UI (app/page.tsx)
      const pageSrc = fs.readFileSync(path.join(process.cwd(), 'app', 'page.tsx'), 'utf-8');
      assert.equal(pageSrc.includes('提示词'), true, 'app/page.tsx must present unified 「提示词」 UI label');
      assert.equal(pageSrc.includes('OPENAI_API_KEY'), false, 'app/page.tsx must NOT leak OPENAI_API_KEY');
      assert.equal(pageSrc.includes('STUDIO_BACKEND_URL'), false, 'app/page.tsx must NOT leak STUDIO_BACKEND_URL');
      assert.equal(/Grok[\s-]?Bot/i.test(pageSrc), false, 'app/page.tsx must NOT expose Grok Bot');
      assert.equal(pageSrc.includes('rawMarkdown'), false, 'app/page.tsx must NOT reference rawMarkdown');
      assert.equal(pageSrc.includes('systemPrompt'), false, 'app/page.tsx must NOT reference systemPrompt');
      assert.equal(/\bGPT\b/.test(pageSrc), false, 'app/page.tsx must NOT expose GPT branding');
      assert.equal(pageSrc.includes('20 MB'), false, 'app/page.tsx must update 20 MB limit text');
      assert.equal(pageSrc.includes('20 * 1024 * 1024'), false, 'app/page.tsx must update 20 MB client guard');
    });
  } finally {
    globalThis.fetch = originalFetch;

    // Cleanly restore .data/ state
    try {
      if (!hadDataDir) {
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
      } else {
        if (hadStoreFile && prevStoreRaw) {
          fs.writeFileSync(STORE_FILE, prevStoreRaw);
        } else if (fs.existsSync(STORE_FILE)) {
          fs.rmSync(STORE_FILE, { force: true });
        }
        if (fs.existsSync(BUCKET_DIR)) {
          for (const entry of fs.readdirSync(BUCKET_DIR)) {
            if (!prevBucketFiles.has(entry)) {
              fs.rmSync(path.join(BUCKET_DIR, entry), { recursive: true, force: true });
            }
          }
        }
      }
      delete globalThis.__STUDIO_PERSISTENT_STORE__;
    } catch (cleanupErr) {
      console.error('CLEANUP_WARNING:', cleanupErr);
    }
  }

  console.log('\n=== E2E Summary ===');
  let totalPassed = 0;
  let totalFailed = 0;
  for (const [tier, s] of Object.entries(tierStats)) {
    totalPassed += s.passed;
    totalFailed += s.failed;
    console.log(`  ${tier}: ${s.passed} passed, ${s.failed} failed`);
  }
  console.log(`  TOTAL: ${totalPassed} passed, ${totalFailed} failed`);

  if (totalFailed > 0) {
    process.exit(1);
  }
  console.log('ALL_SKILL_PLUGIN_AND_UPLOAD_E2E_TESTS_PASSED');
}

main().catch((err) => {
  console.error('SKILL_PLUGIN_E2E_FATAL:', err);
  process.exit(1);
});
