import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

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

async function main() {
  const hadDataDir = fs.existsSync(DATA_DIR);
  const hadStoreFile = fs.existsSync(STORE_FILE);
  const prevStoreRaw = hadStoreFile ? fs.readFileSync(STORE_FILE) : null;
  const prevBucketFiles = fs.existsSync(BUCKET_DIR) ? new Set(fs.readdirSync(BUCKET_DIR)) : new Set();

  const originalFetch = globalThis.fetch;
  const capturedLLMCalls = [];
  let customFetchHandler = null;

  let passed = 0;
  let failed = 0;
  const failures = [];

  async function runTest(id, description, fn) {
    try {
      await fn();
      passed += 1;
      console.log(`  [PASS] ${id}: ${description}`);
    } catch (err) {
      failed += 1;
      failures.push({ id, description, err });
      console.error(`  [FAIL] ${id}: ${description}\n    -> ${err?.stack || err}`);
    }
  }

  try {
    const serverLib = await import('../lib/server.ts');
    const authRoute = await import('../app/api/auth/route.ts');
    const adminRoute = await import('../app/api/admin/route.ts');
    const studioRoute = await import('../app/api/studio/route.ts');
    const uploadRoute = await import('../app/api/upload/route.ts');

    async function loginKey(key) {
      const res = await authRoute.POST(
        new Request('http://localhost/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'login_key', key }),
        })
      );
      assert.equal(res.status, 200);
      return (await res.json()).token;
    }

    async function adminGet(token) {
      return adminRoute.GET(
        new Request('http://localhost/api/admin', {
          headers: token ? { 'x-studio-token': token } : {},
        })
      );
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
      const url = query ? `http://localhost/api/upload?${query}` : 'http://localhost/api/upload';
      return uploadRoute.POST(
        new Request(url, {
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
      const found = (snap.systemConfig?.skillPlugins || []).find(
        (p) => p.name === opts.name && p.kind === opts.kind && p.slot === opts.slot
      );
      assert.ok(found);
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
        if (customFetchHandler) {
          const maybeResp = await customFetchHandler(url, init, originalFetch);
          if (maybeResp) return maybeResp;
        }
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
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: '【创作引擎交付】已完成阶段推理与正文处理。' } }],
              usage: { prompt_tokens: 100, completion_tokens: 150, total_tokens: 250 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return originalFetch(url, init);
      };
    }

    async function enableMockGeminiProvider(adminToken, keys = ['AIzaSyTier5MockGeminiKey01']) {
      const res = await adminPost(adminToken, {
        operation: 'save_provider',
        provider: {
          id: 'prov-gemini',
          name: '测试引擎通道',
          vendor: 'gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKeys: keys,
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

    console.log('\n=== Tier 5: White-Box Adversarial Hardening Suite ===');

    // T5-01: Store migration, corrupt JSON recovery, invalid entry filtering & default deduplication
    await runTest('T5-01', 'Store migration recovers from corrupt JSON, filters invalid skillPlugins, and deduplicates defaults', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-t5-01-'));
      try {
        const dataDir = path.join(tmpDir, '.data');
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(path.join(dataDir, 'studio-store.json'), '{corrupt json!!!', 'utf-8');

        const childScript = `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';

const hookCode = \`
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !path.extname(specifier)) {
    const parentDir = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
    for (const ext of ['.ts', '.tsx', '.js', '.mjs']) {
      const candidate = path.resolve(parentDir, specifier + ext);
      if (fs.existsSync(candidate)) return nextResolve(pathToFileURL(candidate).href, context);
    }
  }
  return nextResolve(specifier, context);
}
\`;
register('data:text/javascript,' + encodeURIComponent(hookCode));
const { getStore } = await import(process.env.SERVER_TS_URL);

const recovered = getStore();
assert.ok(Array.isArray(recovered.accounts) && recovered.accounts.some((a) => a.username === 'ayin'));
assert.deepEqual(recovered.systemConfig.skillPlugins, []);

delete globalThis.__STUDIO_PERSISTENT_STORE__;
fs.writeFileSync(path.join(process.cwd(), '.data', 'studio-store.json'), JSON.stringify({
  systemConfig: {
    skillPlugins: [
      null,
      { id: '', kind: 'foreign', slot: 'primary', content: 'x' },
      { id: 'bad-kind', kind: 'unknown', slot: 'primary', content: 'x' },
      { id: 'bad-slot', kind: 'transcribe', slot: 'secondary', content: 'x' },
      { id: 'empty-bom', kind: 'foreign', slot: 'primary', content: '\\uFEFF   \\n ' },
      { id: 'dis-def', kind: 'foreign', slot: 'primary', name: 'DisDef', content: 'disabled', fileName: 'dis.md', enabled: false, isDefault: true, updatedAt: '2026-01-03T00:00:00Z' },
      { id: 'old-def', kind: 'foreign', slot: 'primary', name: 'OldDef', content: 'old', fileName: 'old.md', enabled: true, isDefault: true, updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'new-def', kind: 'foreign', slot: 'primary', name: 'NewDef', content: 'new', fileName: 'new.md', enabled: true, isDefault: true, updatedAt: '2026-01-02T00:00:00Z' },
    ],
  },
}));

const migrated = getStore();
const pls = migrated.systemConfig.skillPlugins;
assert.equal(pls.length, 3);
assert.equal(pls.find((p) => p.id === 'new-def').isDefault, true);
assert.equal(pls.find((p) => p.id === 'old-def').isDefault, false);
assert.equal(pls.find((p) => p.id === 'dis-def').isDefault, false);
console.log('T5_01_CHILD_OK');
`;
        const res = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
          cwd: tmpDir,
          encoding: 'utf-8',
          env: {
            ...process.env,
            SERVER_TS_URL: pathToFileURL(path.resolve('lib/server.ts')).href,
          },
        });
        assert.equal(res.status, 0, `Child T5-01 failed: ${res.stderr || res.stdout}`);
        assert.ok(res.stdout.includes('T5_01_CHILD_OK'));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    // T5-02: Admin Skill plugin upload boundaries
    await runTest('T5-02', 'Plugin >2MB returns 413, UTF-16/control-char returns 400, extensionless/no-name rejected, FormData auto-derives name', async () => {
      await clearAllSkillPlugins(adminToken);
      const over2mb = 'A'.repeat(2 * 1024 * 1024 + 10);
      const rOver = await adminPost(adminToken, {
        operation: 'upload_skill_plugin',
        kind: 'foreign',
        slot: 'primary',
        name: 'Over2MB',
        fileName: 'over.md',
        content: over2mb,
      });
      assert.equal(rOver.status, 413);

      const fdOver = new FormData();
      fdOver.append('operation', 'upload_skill_plugin');
      fdOver.append('kind', 'foreign');
      fdOver.append('slot', 'primary');
      fdOver.append('name', 'Over2MBForm');
      fdOver.append('file', new File([Buffer.from(over2mb, 'utf-8')], 'over-fd.md'));
      assert.equal((await adminPost(adminToken, fdOver)).status, 413);

      const fd16 = new FormData();
      fd16.append('operation', 'upload_skill_plugin');
      fd16.append('kind', 'foreign');
      fd16.append('slot', 'primary');
      fd16.append('name', 'UTF16');
      fd16.append('file', new File([new Uint8Array([0xff, 0xfe, 0x41, 0x00])], 'u16.md'));
      const res16 = await adminPost(adminToken, fd16);
      assert.equal(res16.status, 400);
      assert.equal((await res16.json()).error, 'BINARY_CONTENT_REJECTED');

      const ctrlJson = await adminPost(adminToken, {
        operation: 'upload_skill_plugin',
        kind: 'foreign',
        slot: 'primary',
        name: 'Ctrl',
        fileName: 'ctrl.md',
        content: 'bad\u0007text',
      });
      assert.equal(ctrlJson.status, 400);

      const noExt = await adminPost(adminToken, {
        operation: 'upload_skill_plugin',
        kind: 'foreign',
        slot: 'primary',
        name: 'NoExt',
        fileName: 'README',
        content: 'valid',
      });
      assert.equal(noExt.status, 400);
      assert.equal((await noExt.json()).error, 'INVALID_PLUGIN_FILE_TYPE');

      const noNameNoFile = await adminPost(adminToken, {
        operation: 'upload_skill_plugin',
        kind: 'foreign',
        slot: 'primary',
        content: 'valid',
      });
      assert.equal(noNameNoFile.status, 400);

      const explicitNameNoFile = await adminPost(adminToken, {
        operation: 'upload_skill_plugin',
        kind: 'foreign',
        slot: 'primary',
        name: 'DefaultExtMd',
        content: 'Valid explicit name body',
      });
      assert.equal(explicitNameNoFile.status, 200);
      const expSnap = await explicitNameNoFile.json();
      assert.ok(expSnap.systemConfig.skillPlugins.some((p) => p.name === 'DefaultExtMd' && p.fileExt === 'md'));

      const fdAuto = new FormData();
      fdAuto.append('operation', 'upload_skill_plugin');
      fdAuto.append('kind', 'domestic');
      fdAuto.append('slot', 'secondary');
      fdAuto.append('file', new File([Buffer.from('Derived name body', 'utf-8')], 'auto-derived.txt'));
      const resAuto = await adminPost(adminToken, fdAuto);
      assert.equal(resAuto.status, 200);
      const snap = await resAuto.json();
      assert.ok(snap.systemConfig.skillPlugins.some((p) => p.name === 'auto-derived' && p.fileExt === 'txt'));
    });

    // T5-03: Admin replace/toggle/set_default/delete edge cases & 404s
    await runTest('T5-03', 'Admin replace/toggle/set_default/delete edge cases, auto-enable on set_default, and 404s', async () => {
      await clearAllSkillPlugins(adminToken);
      const p = await uploadPluginJSON(adminToken, {
        kind: 'original',
        slot: 'primary',
        name: 'Edge_P',
        description: 'd',
        fileName: 'edge.md',
        content: 'Edge body',
        isDefault: true,
      });

      assert.equal((await adminPost(adminToken, { operation: 'replace_skill_plugin', id: p.id, name: '   ' })).status, 400);
      assert.equal((await adminPost(adminToken, { operation: 'replace_skill_plugin', id: p.id, content: '  \n ' })).status, 400);
      assert.equal((await adminPost(adminToken, { operation: 'replace_skill_plugin', id: p.id, fileName: 'bad.json' })).status, 400);
      assert.equal((await adminPost(adminToken, { operation: 'replace_skill_plugin', id: 'missing-id', content: 'x' })).status, 404);

      const swExt = await adminPost(adminToken, { operation: 'replace_skill_plugin', id: p.id, fileName: 'edge-renamed.txt' });
      assert.equal(swExt.status, 200);
      assert.equal((await swExt.json()).systemConfig.skillPlugins.find((x) => x.id === p.id).fileExt, 'txt');

      const off = await (await adminPost(adminToken, { operation: 'toggle_skill_plugin', id: p.id, enabled: false })).json();
      const pOff = off.systemConfig.skillPlugins.find((x) => x.id === p.id);
      assert.equal(pOff.enabled, false);
      assert.equal(pOff.isDefault, false);

      const reDef = await (await adminPost(adminToken, { operation: 'set_default_skill_plugin', id: p.id, isDefault: true })).json();
      const pOn = reDef.systemConfig.skillPlugins.find((x) => x.id === p.id);
      assert.equal(pOn.enabled, true);
      assert.equal(pOn.isDefault, true);

      const unsetDef = await (await adminPost(adminToken, { operation: 'set_default_skill_plugin', id: p.id, isDefault: false })).json();
      assert.equal(unsetDef.systemConfig.skillPlugins.find((x) => x.id === p.id).isDefault, false);

      const flipOff = await (await adminPost(adminToken, { operation: 'toggle_skill_plugin', id: p.id })).json();
      assert.equal(flipOff.systemConfig.skillPlugins.find((x) => x.id === p.id).enabled, false);

      for (const op of ['toggle_skill_plugin', 'set_default_skill_plugin', 'delete_skill_plugin']) {
        assert.equal((await adminPost(adminToken, { operation: op, id: 'nonexistent', enabled: true, isDefault: true })).status, 404);
      }
    });

    // T5-04: __builtin__ override, partial set_prompts, cross-kind/slot rejections, create & switch_kind & transfer_iteration guards
    await runTest('T5-04', '__builtin__ suppresses default, partial set_prompts preserves sibling, invalid selections & switch_kind/transfer guarded', async () => {
      await clearAllSkillPlugins(adminToken);
      const defP = await uploadPluginJSON(adminToken, { kind: 'foreign', slot: 'primary', name: 'Def_F', description: 'd', fileName: 'df.md', content: 'DEFAULT_SUPPRESS_CANARY', isDefault: true });
      const secF = await uploadPluginJSON(adminToken, { kind: 'foreign', slot: 'secondary', name: 'Sec_F', description: 's', fileName: 'sf.txt', content: 'SEC_PRESERVE_CANARY' });
      const domP = await uploadPluginJSON(adminToken, { kind: 'domestic', slot: 'primary', name: 'Dom_P', description: 'd', fileName: 'dp.md', content: 'DOM_RULE_CANARY' });

      assert.equal((await studioPost(creator1Token, { operation: 'create', title: 'BadKind', kind: 'invalid', brief: 'x' })).status, 400);
      assert.equal((await studioPost(creator1Token, { operation: 'create', title: '   ', kind: 'foreign', brief: 'x' })).status, 400);
      assert.equal((await studioPost(creator1Token, { operation: 'create', title: 'BadLock', kind: 'foreign', brief: '全剧 10 集，前 10 集已锁定' })).status, 400);
      assert.equal((await studioPost(creator1Token, { operation: 'create', title: 'BadSel', kind: 'foreign', promptSelections: [] })).status, 400);

      let p = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Builtin & Partial',
        kind: 'foreign',
        brief: '全剧 30 集',
        primaryPluginId: '__builtin__',
        secondaryPluginId: secF.id,
      })).json();
      assert.equal(p.promptSelections?.foreign?.primary, '__builtin__');
      assert.equal(p.promptSelections?.foreign?.secondary, secF.id);

      p = await (await studioPost(creator1Token, { operation: 'confirm', id: p.id, version: p.version })).json();
      capturedLLMCalls.length = 0;
      p = await (await studioPost(creator1Token, { operation: 'connect', id: p.id, version: p.version })).json();
      assert.equal(capturedLLMCalls[0].systemPrompt.includes('DEFAULT_SUPPRESS_CANARY'), false);
      assert.equal(capturedLLMCalls[0].systemPrompt.includes('SEC_PRESERVE_CANARY'), true);

      // switch_kind blocked after connect; transfer_iteration blocked on non-transcribe
      assert.equal((await studioPost(creator1Token, { operation: 'switch_kind', id: p.id, version: p.version, kind: 'domestic' })).status, 400);
      assert.equal((await studioPost(creator1Token, { operation: 'transfer_iteration', id: p.id, version: p.version, target_kind: 'domestic' })).status, 400);

      // partial set_prompts omits kind & secondaryPluginId -> preserves secondary
      p = await (await studioPost(creator1Token, { operation: 'set_prompts', id: p.id, version: p.version, primaryPluginId: defP.id })).json();
      assert.equal(p.promptSelections?.foreign?.primary, defP.id);
      assert.equal(p.promptSelections?.foreign?.secondary, secF.id);

      // cross-kind, non-string, and malformed promptSelections rejected
      assert.equal((await studioPost(creator1Token, { operation: 'set_prompts', id: p.id, version: p.version, primaryPluginId: domP.id })).status, 400);
      assert.equal((await studioPost(creator1Token, { operation: 'set_prompts', id: p.id, version: p.version, primaryPluginId: 123 })).status, 400);
      assert.equal((await studioPost(creator1Token, { operation: 'set_prompts', id: p.id, version: p.version, promptSelections: 'not-an-obj' })).status, 400);

      // transcribe __builtin__ on secondary rejected; '' allowed; invalid target_kind on transfer rejected
      const tr = await (await studioPost(creator1Token, { operation: 'create', title: 'Tr Builtin', kind: 'transcribe', brief: '全剧 2 集' })).json();
      assert.equal((await studioPost(creator1Token, { operation: 'set_prompts', id: tr.id, version: tr.version, secondaryPluginId: '__builtin__' })).status, 400);
      assert.equal((await studioPost(creator1Token, { operation: 'set_prompts', id: tr.id, version: tr.version, secondaryPluginId: '' })).status, 200);
      assert.equal((await studioPost(creator1Token, { operation: 'transfer_iteration', id: tr.id, version: tr.version + 1, target_kind: 'original' })).status, 400);
    });

    // T5-05: Native Gemini generateContent URL + primary failover + keyCursor rotation + auditLogs
    await runTest('T5-05', 'Native Gemini generateContent, primary 503 failover, keyCursor rotation, and auditLogs', async () => {
      await clearAllSkillPlugins(adminToken);
      const seenAuthKeys = [];
      const seenUrls = [];

      const beforeSnap = await (await adminGet(adminToken)).json();
      const origDirectorRoute = beforeSnap.systemConfig.routes.director;

      assert.equal(
        (
          await adminPost(adminToken, {
            operation: 'save_provider',
            provider: {
              id: 'prov-openai',
              name: 'OpenAI Primary Failover Test',
              vendor: 'openai',
              baseUrl: 'https://api.openai.com/v1',
              apiKeys: ['sk-test-rotate-key-A', 'sk-test-rotate-key-B'],
              models: ['gpt-4o'],
              enabled: true,
              priority: 1,
            },
          })
        ).status,
        200
      );
      assert.equal(
        (
          await adminPost(adminToken, {
            operation: 'save_provider',
            provider: {
              id: 'prov-gemini-native',
              name: 'Gemini Native Fallback',
              vendor: 'gemini',
              baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
              apiKeys: ['AIzaSyNativeGeminiFallback01'],
              models: ['gemini-2.5-flash'],
              enabled: true,
              priority: 2,
            },
          })
        ).status,
        200
      );
      assert.equal(
        (
          await adminPost(adminToken, {
            operation: 'save_routes',
            routes: {
              director: {
                ...origDirectorRoute,
                primaryProviderId: 'prov-openai',
                primaryModel: 'gpt-4o',
                fallbackProviderId: 'prov-gemini-native',
                fallbackModel: 'gemini-2.5-flash',
              },
            },
          })
        ).status,
        200
      );

      customFetchHandler = async (url, init) => {
        const u = String(url);
        seenUrls.push(u);
        if (u.includes('api.openai.com/v1/chat/completions')) {
          const auth = init?.headers?.Authorization || init?.headers?.authorization || '';
          seenAuthKeys.push(auth);
          return new Response('Primary unavailable', { status: 503 });
        }
        if (u.includes('generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')) {
          const parsed = JSON.parse(String(init?.body || '{}'));
          assert.ok(parsed.systemInstruction?.parts?.[0]?.text, 'Gemini native request must include systemInstruction');
          return new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: '原生备选回复成功' }] } }],
              usageMetadata: { totalTokenCount: 180 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return null;
      };

      try {
        await adminPost(adminToken, { operation: 'clear_audit_logs' });
        const acc = serverLib.getStore().accounts.find((a) => a.username === 'writer01');
        const r1 = await serverLib.callStationLLM({ station: 'director', userPrompt: 'test1', account: acc });
        const r2 = await serverLib.callStationLLM({ station: 'director', userPrompt: 'test2', account: acc });
        assert.equal(r1.ok, true);
        assert.equal(r2.ok, true);
        assert.equal(r1.text, '原生备选回复成功');
        assert.equal(seenAuthKeys.length, 2);
        assert.notEqual(seenAuthKeys[0], seenAuthKeys[1], 'keyCursor must rotate across multiple keys');
        assert.ok(seenUrls.some((u) => u.includes(':generateContent?key=AIzaSyNativeGeminiFallback01')));

        const snap = await (await adminGet(adminToken)).json();
        assert.ok(snap.auditLogs.some((l) => l.status === 'failed' && l.providerId === 'prov-openai'));
        assert.ok(snap.auditLogs.some((l) => l.status === 'fallback' && l.providerId === 'prov-gemini-native'));
      } finally {
        customFetchHandler = null;
        await adminPost(adminToken, {
          operation: 'save_provider',
          provider: {
            id: 'prov-openai',
            name: 'OpenAI 官方 / 兼容主线',
            vendor: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            apiKeys: [],
            models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
            enabled: true,
            priority: 1,
          },
        });
        await adminPost(adminToken, { operation: 'delete_provider', id: 'prov-gemini-native' });
        await adminPost(adminToken, { operation: 'save_routes', routes: { director: origDirectorRoute } });
        await enableMockGeminiProvider(adminToken);
      }
    });

    // T5-06: connect preconditions, action pause/resume/release_stops, action_id & client_id dedup, set_episode EPISODE_ALREADY_USED
    await runTest('T5-06', 'connect preconditions (503/400), action pause/resume/release_stops, idempotency dedup, set_episode duplicate', async () => {
      // Unconfirmed -> 400; missing total -> 400; transcribe unmapped -> 400 EPISODE_MAPPING_REQUIRED; action before connect -> 503
      let pFor = await (await studioPost(creator1Token, { operation: 'create', title: 'Precond Foreign', kind: 'foreign', brief: '一个都市故事' })).json();
      assert.equal((await studioPost(creator1Token, { operation: 'action', id: pFor.id, version: pFor.version, action: { action: 'confirm' } })).status, 503);
      assert.equal((await studioPost(creator1Token, { operation: 'connect', id: pFor.id, version: pFor.version })).status, 400);
      pFor = await (await studioPost(creator1Token, { operation: 'confirm', id: pFor.id, version: pFor.version })).json();
      assert.equal((await studioPost(creator1Token, { operation: 'connect', id: pFor.id, version: pFor.version })).status, 400);

      // Test message client_id dedup
      const cid = crypto.randomUUID();
      const m1 = await (await studioPost(creator1Token, { operation: 'message', id: pFor.id, version: pFor.version, text: '全剧 20 集', client_id: cid })).json();
      const m2 = await (await studioPost(creator1Token, { operation: 'message', id: pFor.id, version: m1.version, text: '全剧 20 集', client_id: cid })).json();
      assert.equal(m2.messages.length, m1.messages.length, 'Duplicate client_id must not duplicate messages');
      pFor = m2;

      // Test 503 SERVICE_NOT_CONNECTED when no keys configured
      const savedEnv = {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      };
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      const store = serverLib.getStore();
      const prevKeys = store.systemConfig.providers.map((pr) => ({ id: pr.id, apiKeys: [...pr.apiKeys] }));
      for (const pr of store.systemConfig.providers) pr.apiKeys = [];
      try {
        const noKeyRes = await studioPost(creator1Token, { operation: 'connect', id: pFor.id, version: pFor.version });
        assert.equal(noKeyRes.status, 503);
      } finally {
        for (const pr of store.systemConfig.providers) {
          const orig = prevKeys.find((x) => x.id === pr.id);
          if (orig) pr.apiKeys = orig.apiKeys;
        }
        if (savedEnv.OPENAI_API_KEY !== undefined) process.env.OPENAI_API_KEY = savedEnv.OPENAI_API_KEY;
        if (savedEnv.GEMINI_API_KEY !== undefined) process.env.GEMINI_API_KEY = savedEnv.GEMINI_API_KEY;
        if (savedEnv.GOOGLE_API_KEY !== undefined) process.env.GOOGLE_API_KEY = savedEnv.GOOGLE_API_KEY;
      }

      // Connect and test pause / resume / release_stops / action_id dedup
      pFor = await (await studioPost(creator1Token, { operation: 'connect', id: pFor.id, version: pFor.version })).json();
      pFor = await (await studioPost(creator1Token, { operation: 'action', id: pFor.id, version: pFor.version, action: { action: 'pause', action_id: crypto.randomUUID() } })).json();
      assert.equal(pFor.remote.status, 'paused');
      pFor = await (await studioPost(creator1Token, { operation: 'action', id: pFor.id, version: pFor.version, action: { action: 'resume', action_id: crypto.randomUUID() } })).json();
      assert.equal(pFor.remote.status, 'waiting_confirm');
      pFor = await (await studioPost(creator1Token, { operation: 'action', id: pFor.id, version: pFor.version, action: { action: 'release_stops', action_id: crypto.randomUUID() } })).json();
      assert.equal(pFor.stopsReleased, true);

      const aid = crypto.randomUUID();
      capturedLLMCalls.length = 0;
      pFor = await (await studioPost(creator1Token, {
        operation: 'action',
        id: pFor.id,
        version: pFor.version,
        action: { version: pFor.remote.version, action_id: aid, action: 'confirm', answers: { scope: 'ok' } },
      })).json();
      const countAfterFirst = capturedLLMCalls.length;
      const cursorAfterFirst = pFor.remote.cursor;
      pFor = await (await studioPost(creator1Token, {
        operation: 'action',
        id: pFor.id,
        version: pFor.version,
        action: { version: pFor.remote.version, action_id: aid, action: 'confirm', answers: { scope: 'ok' } },
      })).json();
      assert.equal(capturedLLMCalls.length, countAfterFirst, 'Duplicate action_id must not re-invoke LLM');
      assert.equal(pFor.remote.cursor, cursorAfterFirst, 'Duplicate action_id must not advance cursor');

      // Transcribe unmapped & duplicate episode
      let pTr = await (await studioPost(creator1Token, { operation: 'create', title: 'Tr Precond', kind: 'transcribe', brief: '全剧 3 集' })).json();
      pTr = await (await uploadPost(creator1Token, `id=${pTr.id}&name=${encodeURIComponent('第01集.mp4')}`, Buffer.from('1'), 'video/mp4')).json();
      pTr = await (await uploadPost(creator1Token, `id=${pTr.id}&name=${encodeURIComponent('1-1.mp4')}`, Buffer.from('2'), 'video/mp4')).json();
      pTr = await (await studioPost(creator1Token, { operation: 'confirm', id: pTr.id, version: pTr.version })).json();
      const unmappedRes = await studioPost(creator1Token, { operation: 'connect', id: pTr.id, version: pTr.version });
      assert.equal(unmappedRes.status, 400);
      assert.equal((await unmappedRes.json()).error, 'EPISODE_MAPPING_REQUIRED');

      const ambigAtt = pTr.attachments.find((a) => a.name === '1-1.mp4');
      const dupEpRes = await studioPost(creator1Token, { operation: 'set_episode', id: pTr.id, version: pTr.version, attachment_id: ambigAtt.id, episode: 1 });
      assert.equal(dupEpRes.status, 400);
      assert.equal((await dupEpRes.json()).error, 'EPISODE_ALREADY_USED');
    });

    // T5-07: Upload/Download edge cases
    await runTest('T5-07', 'Upload/Download edge cases: missing id, bad role, FormData id in body, duplicate/out-of-range episode, GET 400/404', async () => {
      const pTr = await (await studioPost(creator1Token, { operation: 'create', title: 'Upload Edge Tr', kind: 'transcribe', brief: '全剧 2 集' })).json();
      assert.equal((await uploadPost(creator1Token, '', Buffer.from('x'), 'text/plain')).status, 400);
      assert.equal((await uploadPost(creator1Token, `id=${pTr.id}&role=invalid`, Buffer.from('x'), 'text/plain')).status, 400);

      const fdBodyId = new FormData();
      fdBodyId.append('id', pTr.id);
      fdBodyId.append('file', new File([Buffer.from('v1')], '第01集.mp4', { type: 'video/mp4' }));
      const r1 = await uploadPost(creator1Token, '', fdBodyId);
      assert.equal(r1.status, 200);

      // Duplicate auto-detected episode -> undefined; > total -> undefined
      const r2 = await (await uploadPost(creator1Token, `id=${pTr.id}&name=${encodeURIComponent('EP01.mp4')}`, Buffer.from('v2'), 'video/mp4')).json();
      assert.equal(r2.attachments.find((a) => a.name === 'EP01.mp4').episode, undefined);

      const r3 = await (await uploadPost(creator1Token, `id=${pTr.id}&name=${encodeURIComponent('第05集.mp4')}`, Buffer.from('v3'), 'video/mp4')).json();
      assert.equal(r3.attachments.find((a) => a.name === '第05集.mp4').episode, undefined);

      assert.equal((await uploadGet(creator1Token, '')).status, 400);
      assert.equal((await uploadGet(creator1Token, `id=${pTr.id}`)).status, 400);
      assert.equal((await uploadGet(creator1Token, `id=${pTr.id}&file=missing-att`)).status, 404);
    });

    // T5-08: Regression tests for BUG-1..BUG-5
    await runTest('T5-08', 'Regressions BUG-1..BUG-5: foreign cursor progression, standalone brand scrub, 402 budget, 400 bad JSON, 400 set_prompts', async () => {
      // BUG-1: foreign 1st confirm -> mainline_understood -> 2nd confirm -> script_episodes (NOT mainline_understood!)
      let pFor = await (await studioPost(creator1Token, { operation: 'create', title: 'BUG1 Foreign', kind: 'foreign', brief: '全剧 40 集' })).json();
      pFor = await (await studioPost(creator1Token, { operation: 'confirm', id: pFor.id, version: pFor.version })).json();
      pFor = await (await studioPost(creator1Token, { operation: 'connect', id: pFor.id, version: pFor.version })).json();
      pFor = await (await studioPost(creator1Token, {
        operation: 'action',
        id: pFor.id,
        version: pFor.version,
        action: { version: pFor.remote.version, action_id: crypto.randomUUID(), action: 'confirm', answers: { scope: 'ok' } },
      })).json();
      assert.equal(pFor.remote.stage.key, 'mainline_understood');
      pFor = await (await studioPost(creator1Token, {
        operation: 'action',
        id: pFor.id,
        version: pFor.version,
        action: { version: pFor.remote.version, action_id: crypto.randomUUID(), action: 'confirm', answers: { selection: '方案 A', understood: true } },
      })).json();
      assert.equal(pFor.remote.stage.key, 'script_episodes');

      // BUG-2: standalone GPT / ChatGPT / Claude / Gemini / Grok scrubbed
      const cleaned = serverLib.sanitizeForClient('由 GPT 与 ChatGPT 和 Claude 和 Gemini 和 Grok 共同完成');
      assert.equal(/\b(GPT|ChatGPT|Claude|Gemini|Grok)\b/i.test(cleaned), false, `Unredacted brand in: ${cleaned}`);

      // BUG-3: budget exceeded on connect returns 402 BUDGET_EXCEEDED
      const acc = serverLib.getStore().accounts.find((a) => a.username === 'writer01');
      const prevUsed = acc.budgetUsedUsd;
      const prevCap = acc.budgetCapUsd;
      acc.budgetUsedUsd = prevCap;
      try {
        let pBudget = await (await studioPost(creator1Token, { operation: 'create', title: 'BUG3 Budget', kind: 'original', brief: '脑洞' })).json();
        pBudget = await (await studioPost(creator1Token, { operation: 'confirm', id: pBudget.id, version: pBudget.version })).json();
        const bRes = await studioPost(creator1Token, { operation: 'connect', id: pBudget.id, version: pBudget.version });
        assert.equal(bRes.status, 402);
        assert.equal((await bRes.json()).error, 'BUDGET_EXCEEDED');
      } finally {
        acc.budgetUsedUsd = prevUsed;
      }

      // BUG-4 & BUG-5
      const badJsonRes = await studioRoute.POST(
        new Request('http://localhost/api/studio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-studio-token': creator1Token },
          body: '{bad',
        })
      );
      assert.equal(badJsonRes.status, 400);
      assert.equal((await badJsonRes.json()).error, 'INVALID_INPUT');

      const badSetPrompts = await studioPost(creator1Token, {
        operation: 'set_prompts',
        id: pFor.id,
        version: pFor.version,
        promptSelections: ['bad'],
      });
      assert.equal(badSetPrompts.status, 400);
    });

    // T5-U1: STUDIO_MAX_UPLOAD_MB override + FormData large/negative validation
    await runTest('T5-U1', 'STUDIO_MAX_UPLOAD_MB dynamically caps GET /api/studio & FormData/raw upload (413)', async () => {
      const proj = await (await studioPost(creator1Token, { operation: 'create', title: 'Env Cap', kind: 'foreign', brief: '全剧 20 集' })).json();
      process.env.STUDIO_MAX_UPLOAD_MB = '1';
      try {
        const meta = await (await studioGet(creator1Token)).json();
        assert.equal(meta.maxUploadBytes, 1048576);

        const fdOk = new FormData();
        fdOk.append('file', new File([new Uint8Array(500 * 1024)], 'ok-500k.bin', { type: 'application/octet-stream' }));
        assert.equal((await uploadPost(creator1Token, `id=${proj.id}`, fdOk)).status, 200);

        const fdOver = new FormData();
        fdOver.append('file', new File([new Uint8Array(1024 * 1024 + 512)], 'over-1mb.bin', { type: 'application/octet-stream' }));
        assert.equal((await uploadPost(creator1Token, `id=${proj.id}`, fdOver)).status, 413);

        const fdNoFile = new FormData();
        fdNoFile.append('id', proj.id);
        assert.equal((await uploadPost(creator1Token, '', fdNoFile)).status, 400);

        const fdBadRole = new FormData();
        fdBadRole.append('id', proj.id);
        fdBadRole.append('role', 'admin');
        fdBadRole.append('file', new File([Buffer.from('ok')], 'a.txt', { type: 'text/plain' }));
        assert.equal((await uploadPost(creator1Token, '', fdBadRole)).status, 400);
      } finally {
        delete process.env.STUDIO_MAX_UPLOAD_MB;
      }
    });

    // T5-U2: Large 21 MB multipart/form-data upload + byte-exact download
    await runTest('T5-U2', 'Large 21 MB multipart/form-data upload persists and downloads byte-for-byte', async () => {
      const proj = await (await studioPost(creator1Token, { operation: 'create', title: 'Multipart 21MB', kind: 'foreign', brief: '全剧 20 集' })).json();
      const size21MB = 21 * 1024 * 1024;
      const buf = new Uint8Array(size21MB);
      buf[0] = 0x42;
      buf[size21MB - 1] = 0x59;
      const fd = new FormData();
      fd.append('file', new File([buf], 'multipart-21mb.mp4', { type: 'video/mp4' }));
      const res = await uploadPost(creator1Token, `id=${proj.id}`, fd);
      assert.equal(res.status, 200);
      const att = (await res.json()).attachments.find((a) => a.name === 'multipart-21mb.mp4');
      assert.ok(att);
      const dl = await uploadGet(creator1Token, `id=${proj.id}&file=${att.id}`);
      const dlBytes = new Uint8Array(await dl.arrayBuffer());
      assert.equal(dlBytes.byteLength, size21MB);
      assert.equal(dlBytes[0], 0x42);
      assert.equal(dlBytes[size21MB - 1], 0x59);
    });

    // T5-U3: Skill plugin >2MB cap, UTF-16 BOM, invalid UTF-8, %PDF/PK magic, replace_skill_plugin negative paths
    await runTest('T5-U3', 'Admin rejects >2MB plugin, UTF-16 BOM, invalid UTF-8, PDF/ZIP magic, and invalid replace_skill_plugin', async () => {
      const over2Mb = 'A'.repeat(2 * 1024 * 1024 + 10);
      const r2m = await adminPost(adminToken, {
        operation: 'upload_skill_plugin',
        kind: 'foreign',
        slot: 'primary',
        name: 'TooBig',
        fileName: 'big.md',
        content: over2Mb,
      });
      assert.equal(r2m.status, 413);

      for (const [fname, bytes] of [
        ['utf16le.md', new Uint8Array([0xff, 0xfe, 0x41, 0x00])],
        ['utf16be.txt', new Uint8Array([0xfe, 0xff, 0x00, 0x41])],
        ['badutf8.txt', new Uint8Array([0x80, 0x81, 0xfe])],
        ['pdf-disguised.md', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])],
        ['zip-disguised.txt', new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
      ]) {
        const fd = new FormData();
        fd.append('operation', 'upload_skill_plugin');
        fd.append('kind', 'foreign');
        fd.append('slot', 'primary');
        fd.append('name', `Bad_${fname}`);
        fd.append('file', new File([bytes], fname));
        const res = await adminPost(adminToken, fd);
        assert.equal(res.status, 400, `${fname} must be rejected with 400`);
      }

      const repMissing = await adminPost(adminToken, { operation: 'replace_skill_plugin', id: 'nonexistent-id', content: 'x' });
      assert.equal(repMissing.status, 404);
    });

    // T5-U4: Cross-owner /api/upload isolation & export gates + ASCII filename fallback (GAP-U3, GAP-U4)
    await runTest('T5-U4', 'Cross-owner /api/upload isolation + domestic export includes outputs.gates & ASCII filename fallback', async () => {
      let proj = await (await studioPost(creator1Token, { operation: 'create', title: '中文导出与隔离测试', kind: 'domestic', brief: '全剧 30 集' })).json();
      proj = await (await uploadPost(creator1Token, `id=${proj.id}&name=secret.txt`, Buffer.from('owned'), 'text/plain')).json();
      const attId = proj.attachments[0].id;
      assert.equal((await uploadGet(creator2Token, `id=${proj.id}&export=1`)).status, 404);
      assert.equal((await uploadGet(creator2Token, `id=${proj.id}&file=${attId}`)).status, 404);
      assert.equal((await uploadPost(creator2Token, `id=${proj.id}&name=hijack.txt`, Buffer.from('x'), 'text/plain')).status, 404);

      // Advance domestic project to domestic_gates so outputs.gates is populated
      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();
      proj = await (await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version })).json();
      proj = await (await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { version: proj.remote.version, action_id: crypto.randomUUID(), action: 'confirm', answers: { scope: '30集' } },
      })).json();
      assert.ok(proj.remote.outputs.gates?.content);

      const expRes = await uploadGet(creator1Token, `id=${proj.id}&export=1`);
      assert.equal(expRes.status, 200);
      const disp = expRes.headers.get('content-disposition') || '';
      const filenameMatch = disp.match(/filename="([^"]+)"/);
      assert.ok(filenameMatch, 'Content-Disposition must contain filename="..."');
      assert.equal(/%E/.test(filenameMatch[1]), false, 'ASCII fallback filename must not be percent-encoded');
      assert.ok(disp.includes("filename*=UTF-8''"), 'Content-Disposition must include RFC 5987 filename*');

      const expText = await expRes.text();
      assert.equal(expText.includes('桥段出海四级诊断与三道门方案'), true, 'export=1 must include outputs.gates section');
    });

    // T5-S1: __builtin__ override skips active default + persists + switching back to '' restores default + unset default fallback
    await runTest('T5-S1', '__builtin__ skips active default plugin, persists across reload, and toggle(false)/set_default(false) falls back', async () => {
      await clearAllSkillPlugins(adminToken);
      const pDef = await uploadPluginJSON(adminToken, {
        kind: 'original',
        slot: 'primary',
        name: 'Orig_Def',
        description: 'def',
        fileName: 'orig-def.md',
        content: 'CANARY_ORIG_DEFAULT_SKIP_TEST',
        isDefault: true,
      });

      let proj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Builtin Skip Default',
        kind: 'original',
        brief: '悬疑脑洞',
        promptSelections: { original: { primary: '__builtin__' } },
      })).json();
      assert.equal(proj.promptSelections?.original?.primary, '__builtin__');
      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();

      capturedLLMCalls.length = 0;
      proj = await (await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version })).json();
      assert.equal(capturedLLMCalls[0].systemPrompt.includes('CANARY_ORIG_DEFAULT_SKIP_TEST'), false);

      const reloaded = await (await studioGet(creator1Token, `?id=${proj.id}`)).json();
      assert.equal(reloaded.promptSelections?.original?.primary, '__builtin__');

      proj = await (await studioPost(creator1Token, { operation: 'set_prompts', id: proj.id, version: proj.version, kind: 'original', primaryPluginId: '' })).json();
      capturedLLMCalls.length = 0;
      proj = await (await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { version: proj.remote.version, action_id: crypto.randomUUID(), action: 'revise', answers: { feedback: 'check default' } },
      })).json();
      assert.equal(capturedLLMCalls[0].systemPrompt.includes('CANARY_ORIG_DEFAULT_SKIP_TEST'), true);

      const disSnap = await (await adminPost(adminToken, { operation: 'toggle_skill_plugin', id: pDef.id, enabled: false })).json();
      assert.equal(disSnap.systemConfig.skillPlugins.find((x) => x.id === pDef.id).isDefault, false);

      capturedLLMCalls.length = 0;
      proj = await (await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { version: proj.remote.version, action_id: crypto.randomUUID(), action: 'revise', answers: { feedback: 'check builtin fallback' } },
      })).json();
      assert.equal(capturedLLMCalls[0].systemPrompt.includes('CANARY_ORIG_DEFAULT_SKIP_TEST'), false);

      const reEnSnap = await (await adminPost(adminToken, { operation: 'toggle_skill_plugin', id: pDef.id, enabled: true })).json();
      assert.equal(reEnSnap.systemConfig.skillPlugins.find((x) => x.id === pDef.id).isDefault, false);
    });

    // T5-S2: Cross-kind, cross-slot, disabled plugin validation & transcribe __builtin__ secondary rejection
    await runTest('T5-S2', 'create & set_prompts reject cross-kind, cross-slot, disabled plugins & transcribe secondary=__builtin__', async () => {
      await clearAllSkillPlugins(adminToken);
      const domP = await uploadPluginJSON(adminToken, { kind: 'domestic', slot: 'primary', name: 'Dom_P', description: 'd', fileName: 'dp.md', content: 'DOM_P_RULE' });
      const forS = await uploadPluginJSON(adminToken, { kind: 'foreign', slot: 'secondary', name: 'For_S', description: 'f', fileName: 'fs.md', content: 'FOR_S_RULE' });
      const disP = await uploadPluginJSON(adminToken, { kind: 'foreign', slot: 'primary', name: 'Dis_P', description: 'x', fileName: 'xp.md', content: 'DIS_P_RULE' });
      await adminPost(adminToken, { operation: 'toggle_skill_plugin', id: disP.id, enabled: false });

      assert.equal((await studioPost(creator1Token, { operation: 'create', title: 'CrossKind', kind: 'foreign', brief: '全剧 10 集', promptSelections: { foreign: { primary: domP.id } } })).status, 400);
      assert.equal((await studioPost(creator1Token, { operation: 'create', title: 'CrossSlot', kind: 'foreign', brief: '全剧 10 集', promptSelections: { foreign: { primary: forS.id } } })).status, 400);
      assert.equal((await studioPost(creator1Token, { operation: 'create', title: 'DisabledSel', kind: 'foreign', brief: '全剧 10 集', promptSelections: { foreign: { primary: disP.id } } })).status, 400);

      const tr = await (await studioPost(creator1Token, { operation: 'create', title: 'TrBuiltinSec', kind: 'transcribe', brief: '全剧 10 集' })).json();
      const trRes = await studioPost(creator1Token, { operation: 'set_prompts', id: tr.id, version: tr.version, kind: 'transcribe', secondaryPluginId: '__builtin__' });
      assert.equal(trRes.status, 400);
      assert.equal((await trRes.json()).error, 'SLOT_NOT_ALLOWED');
    });

    // T5-R1: Redline scrubs plugin.fileName, short Skill lines, station systemPrompt, token/model variants, dynamic URLs & removes gpt branding
    await runTest('T5-R1', 'Redline scrubs fileName, short Skill lines, station systemPrompt, token/model variants, URLs, and removes gptTestAvailable/gpt_test', async () => {
      await clearAllSkillPlugins(adminToken);
      const p = await uploadPluginJSON(adminToken, {
        kind: 'domestic',
        slot: 'primary',
        name: 'Short_Redline_P',
        description: 'short',
        fileName: 'top-secret-skill-file.md',
        content: '秘密规则A\nSECRET_R01\n第二行也是短规则',
      });
      const p5 = await uploadPluginJSON(adminToken, {
        kind: 'domestic',
        slot: 'secondary',
        name: 'FiveChar_P',
        description: '5char',
        fileName: 'five-char.txt',
        content: '禁止恋爱脑',
      });

      let proj = await (await studioPost(creator1Token, {
        operation: 'create',
        title: 'Redline Edge',
        kind: 'domestic',
        brief: '全剧 30 集',
        promptSelections: { domestic: { primary: p.id, secondary: p5.id } },
      })).json();
      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();

      customFetchHandler = async (url) => {
        if (String(url).includes('/chat/completions') || String(url).includes('generativelanguage.googleapis.com')) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      '参考 top-secret-skill-file.md，执行 SECRET_R01 与 秘密规则A 和 禁止恋爱脑；你是短剧工作台的总编剧；由 Gemini 和 Claude 生成，访问 https://generativelanguage.googleapis.com/v1beta/openai ，tokens: 480, totalTokenCount: 320',
                  },
                },
              ],
              usage: { total_tokens: 480 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return null;
      };
      try {
        proj = await (await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version })).json();
      } finally {
        customFetchHandler = null;
      }

      assert.equal(proj.remote?.mode, 'test_channel', 'remote.mode must be test_channel (not gpt_test)');
      const listJson = await (await studioGet(creator1Token)).json();
      assert.equal('gptTestAvailable' in listJson, false, 'GET /api/studio must not expose gptTestAvailable');
      assert.equal(typeof listJson.testChannelAvailable, 'boolean');

      const s = JSON.stringify(proj);
      assert.equal(s.includes('top-secret-skill-file.md'), false, 'plugin.fileName must be scrubbed');
      assert.equal(s.includes('SECRET_R01'), false, 'Short ASCII Skill line must be scrubbed');
      assert.equal(s.includes('秘密规则A'), false, 'Short CJK Skill line must be scrubbed');
      assert.equal(s.includes('禁止恋爱脑'), false, '5-char Skill plugin must be scrubbed');
      assert.equal(s.includes('你是短剧工作台的总编剧'), false, 'Station systemPrompt must be scrubbed');
      assert.equal(s.includes('generativelanguage.googleapis.com'), false, 'Provider URL must be scrubbed');
      assert.equal(/\btokens\s*:\s*480\b/i.test(s), false, 'tokens: 480 must be scrubbed');
      assert.equal(/totalTokenCount/i.test(s), false, 'totalTokenCount must be scrubbed');
      assert.equal(/\b(Gemini|Claude|GPT|ChatGPT|Grok)\b/i.test(s), false, 'Bare model/brand name must be scrubbed');

      const expText = await (await uploadGet(creator1Token, `id=${proj.id}&export=1`)).text();
      assert.equal(expText.includes('top-secret-skill-file.md'), false);
      assert.equal(expText.includes('SECRET_R01'), false);
      assert.equal(expText.includes('你是短剧工作台的总编剧'), false);

      const pageSrc = fs.readFileSync(path.join(process.cwd(), 'app', 'page.tsx'), 'utf-8');
      assert.equal(/\bgpt/i.test(pageSrc), false, 'app/page.tsx must contain zero case-insensitive gpt references');
    });

    // T5-R2: Malformed JSON returns 400 + unauthenticated GET /api/auth returns account: null + UI contracts
    await runTest('T5-R2', 'Malformed JSON -> 400, unauth GET /api/auth -> account: null when auth required, and UI error/state contracts', async () => {
      const badRes = await studioRoute.POST(
        new Request('http://localhost/api/studio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-studio-token': creator1Token },
          body: '{bad json',
        })
      );
      assert.equal(badRes.status, 400);

      await adminPost(adminToken, { operation: 'save_system_config', requireAuthOnFrontend: true });
      try {
        const authGet = await (await authRoute.GET(new Request('http://localhost/api/auth'))).json();
        assert.equal(authGet.authenticated, false);
        assert.equal(authGet.account, null, 'Must not leak default admin profile when unauthenticated & requireAuthOnFrontend=true');
      } finally {
        await adminPost(adminToken, { operation: 'save_system_config', requireAuthOnFrontend: false });
      }

      // Static UI checks for GAP-UI1
      const adminSrc = fs.readFileSync(path.join(process.cwd(), 'app', 'admin', 'page.tsx'), 'utf-8');
      assert.equal(adminSrc.includes('BINARY_CONTENT_REJECTED'), true);
      assert.equal(adminSrc.includes('INVALID_PLUGIN_FILE_TYPE'), true);

      const pageSrc = fs.readFileSync(path.join(process.cwd(), 'app', 'page.tsx'), 'utf-8');
      assert.equal(pageSrc.includes('BUDGET_EXCEEDED'), true);
      assert.equal(pageSrc.includes('SLOT_NOT_ALLOWED'), true);
      assert.equal(pageSrc.includes('ACCOUNT_DISABLED'), true);
      assert.equal(pageSrc.includes('已停用或已移除的提示词'), true);
    });
  } finally {
    globalThis.fetch = originalFetch;

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

  console.log(`\n=== Tier 5 Summary ===\n  T5: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
  console.log('ALL_TIER5_ADVERSARIAL_TESTS_PASSED');
}

main().catch((err) => {
  console.error('TIER5_FATAL:', err);
  process.exit(1);
});
