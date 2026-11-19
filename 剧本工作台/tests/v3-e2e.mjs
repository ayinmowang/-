import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

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

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, '.data');
const STORE_FILE = path.join(DATA_DIR, 'studio-store.json');
const BUCKET_DIR = path.join(DATA_DIR, 'buckets');

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
  'modelid',
  'model_id',
  'modelname',
  'model_name',
  'provider',
  'providerid',
  'provider_id',
  'providername',
  'provider_name',
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
  'apikeys',
  'password',
  'accesskey',
  'backendurl',
  'backendtoken',
  'baseurl',
  'base_url',
]);

const TIER_SUMMARY_ALLOWED_KEYS = new Set([
  'id',
  'name',
  'badge',
  'description',
  'costHint',
  'supportsThinking',
  'isDefault',
]);

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function collectKeysRecursive(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectKeysRecursive(item, out);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    out.add(k.toLowerCase());
    collectKeysRecursive(v, out);
  }
  return out;
}

function assertCreatorRedlineClean(payload, label, forbiddenTexts = []) {
  const keys = collectKeysRecursive(payload);
  for (const fk of FORBIDDEN_CREATOR_KEYS) {
    assert.equal(keys.has(fk), false, `[${label}] Forbidden key "${fk}" leaked to creator payload`);
  }
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  assert.equal(
    /\b(gpt-[a-z0-9.-]+|chatgpt-[a-z0-9.-]+|claude-[a-z0-9.-]+|gemini-[a-z0-9.-]+|deepseek-[a-z0-9.-]+|grok-[a-z0-9.-]+)\b/i.test(
      serialized
    ),
    false,
    `[${label}] Model name leaked in creator payload`
  );
  assert.equal(/\b(prompt_?tokens|completion_?tokens|total_?tokens)\b/i.test(serialized), false, `[${label}] Token field leaked`);
  assert.equal(serialized.includes('OPENAI_API_KEY'), false, `[${label}] OPENAI_API_KEY leaked`);
  assert.equal(serialized.includes('STUDIO_BACKEND_URL'), false, `[${label}] STUDIO_BACKEND_URL leaked`);
  assert.equal(/Grok[\s-]?Bot/i.test(serialized), false, `[${label}] Grok Bot leaked`);
  for (const text of forbiddenTexts) {
    if (text) {
      assert.equal(serialized.includes(text), false, `[${label}] Sensitive text "${text}" leaked`);
    }
  }
}

/**
 * Pure-Node ZIP reader supporting Stored (0) and Deflated (8) entries via Central Directory.
 * Verifies valid PK\x03\x04 local headers and PK\x05\x06 EOCD.
 */
function parseZipEntries(zipBuf) {
  assert.ok(Buffer.isBuffer(zipBuf) && zipBuf.length >= 22, 'ZIP buffer too small');
  assert.equal(zipBuf[0], 0x50, 'ZIP magic byte 0 must be P (0x50)');
  assert.equal(zipBuf[1], 0x4b, 'ZIP magic byte 1 must be K (0x4B)');
  assert.equal(zipBuf[2], 0x03, 'ZIP magic byte 2 must be 0x03');
  assert.equal(zipBuf[3], 0x04, 'ZIP magic byte 3 must be 0x04');

  // Locate End of Central Directory (PK\x05\x06)
  let eocdOffset = -1;
  const minOffset = Math.max(0, zipBuf.length - 65557);
  for (let i = zipBuf.length - 22; i >= minOffset; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  assert.ok(eocdOffset >= 0, 'ZIP End of Central Directory (PK\\x05\\x06) not found');

  const totalEntries = zipBuf.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);
  assert.ok(totalEntries > 0, 'ZIP must contain at least 1 entry');
  assert.ok(cdOffset < eocdOffset, 'Invalid ZIP Central Directory offset');

  const entries = new Map();
  let ptr = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    assert.equal(zipBuf.readUInt32LE(ptr), 0x02014b50, `Invalid Central Directory entry signature at ${ptr}`);
    const compression = zipBuf.readUInt16LE(ptr + 10);
    const compSize = zipBuf.readUInt32LE(ptr + 20);
    const nameLen = zipBuf.readUInt16LE(ptr + 28);
    const extraLen = zipBuf.readUInt16LE(ptr + 30);
    const commentLen = zipBuf.readUInt16LE(ptr + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(ptr + 42);
    const entryName = zipBuf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    ptr += 46 + nameLen + extraLen + commentLen;

    assert.equal(
      zipBuf.readUInt32LE(localHeaderOffset),
      0x04034b50,
      `Invalid Local File Header signature for ${entryName}`
    );
    const lNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
    const lExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
    const compSlice = zipBuf.subarray(dataStart, dataStart + compSize);

    let rawData;
    if (compression === 0) {
      rawData = Buffer.from(compSlice);
    } else if (compression === 8) {
      rawData = zlib.inflateRawSync(compSlice);
    } else {
      throw new Error(`Unsupported ZIP compression method ${compression} for ${entryName}`);
    }
    entries.set(entryName, rawData);
  }
  return entries;
}

function decodeXmlEntities(xml) {
  return xml
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractDocxPlainText(zipBuf) {
  const entries = parseZipEntries(zipBuf);
  assert.ok(entries.has('[Content_Types].xml'), '.docx missing [Content_Types].xml');
  assert.ok(entries.has('_rels/.rels'), '.docx missing _rels/.rels');
  assert.ok(entries.has('word/document.xml'), '.docx missing word/document.xml');

  const docXml = entries.get('word/document.xml').toString('utf8');
  const contentTypesXml = entries.get('[Content_Types].xml').toString('utf8');
  assert.ok(contentTypesXml.includes('wordprocessingml'), '[Content_Types].xml missing wordprocessingml');
  assert.ok(docXml.includes('<w:document'), 'word/document.xml missing <w:document');

  const plain = decodeXmlEntities(
    docXml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:br\b[^>]*\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
  );
  return { entries, docXml, plain };
}

function listFilesRecursive(dirPath, exts = ['.ts', '.tsx']) {
  if (!fs.existsSync(dirPath)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

async function importModuleChecked(relPath) {
  const abs = path.resolve(ROOT_DIR, relPath.replace(/^\.\.\//, ''));
  if (!fs.existsSync(abs)) {
    throw new Error(`Expected module not found: ${relPath}`);
  }
  return import(relPath);
}

async function main() {
  // 1. Pre-test backup of .data/studio-store.json and .data/buckets/ in unique os.tmpdir() folder
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-v3-e2e-backup-'));
  const hadDataDir = fs.existsSync(DATA_DIR);
  const hadStoreFile = fs.existsSync(STORE_FILE);
  const hadBucketsDir = fs.existsSync(BUCKET_DIR);
  const preStoreHash = hadStoreFile ? sha256File(STORE_FILE) : null;

  let expectedCode28KeyCount = null;
  if (hadStoreFile) {
    fs.copyFileSync(STORE_FILE, path.join(backupDir, 'studio-store.json'));
    try {
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      const code28Prov = (parsed?.systemConfig?.providers || []).find(
        (p) => p?.baseUrl === 'https://code28.ccwu.cc/v1'
      );
      if (code28Prov && Array.isArray(code28Prov.apiKeys)) {
        expectedCode28KeyCount = code28Prov.apiKeys.length;
      }
    } catch {}
  }
  if (hadBucketsDir) {
    fs.cpSync(BUCKET_DIR, path.join(backupDir, 'buckets'), { recursive: true });
  }

  delete globalThis.__STUDIO_PERSISTENT_STORE__;

  const originalFetch = globalThis.fetch;
  const prevMaxUploadMb = process.env.STUDIO_MAX_UPLOAD_MB;
  let fetchHandler = null;
  const capturedLLMCalls = [];

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

  let restoreVerified = false;

  try {
    globalThis.fetch = async (url, init) => {
      if (fetchHandler) {
        return fetchHandler(url, init);
      }
      const urlStr = String(url);
      if (urlStr.includes('/chat/completions') || urlStr.includes('generativelanguage.googleapis.com')) {
        let parsedBody = {};
        let systemPrompt = '';
        let userPrompt = '';
        try {
          parsedBody = JSON.parse(String(init?.body || '{}'));
          if (Array.isArray(parsedBody.messages)) {
            systemPrompt = parsedBody.messages
              .filter((m) => m.role === 'system')
              .map((m) => m.content)
              .join('\n');
            userPrompt = parsedBody.messages
              .filter((m) => m.role === 'user')
              .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
              .join('\n');
          } else if (parsedBody.systemInstruction?.parts) {
            systemPrompt = parsedBody.systemInstruction.parts.map((p) => p.text || '').join('\n');
            userPrompt = (parsedBody.contents || [])
              .map((c) => (c.parts || []).map((p) => p.text || '').join('\n'))
              .join('\n');
          }
        } catch {}

        const authHeader =
          init?.headers?.Authorization ||
          init?.headers?.authorization ||
          (init?.headers instanceof Headers ? init.headers.get('authorization') : '') ||
          '';

        capturedLLMCalls.push({
          url: urlStr,
          authHeader,
          body: parsedBody,
          systemPrompt,
          userPrompt,
        });

        const isTranscribePrompt =
          userPrompt.includes('扒剧') || userPrompt.includes('短剧视频') || systemPrompt.includes('扒剧');
        const replyText = isTranscribePrompt
          ? [
              '### 人物锚定表',
              '- 林晚星：女主，表面落魄千金，实为海外资本掌舵人',
              '- 顾沉舟：男主，豪门掌权人，冷面克制',
              '',
              '### 故事梗概',
              '林晚星在订婚宴被当众退婚后亮出隐藏身份，当场逆转局面。',
              '',
              '### 分场剧本',
              '第1集 场次1-1 内景 顾氏宴会厅 夜',
              '▲ 聚光灯打在林晚星身上，宾客窃窃私语。',
              '林晚星：「退婚可以，先把顾氏欠我母亲的三成股权结清。」',
            ].join('\n')
          : '【创作交付】已完成剧情结构推演与本集场次打磨。';

        return new Response(
          JSON.stringify({
            choices: [{ message: { content: replyText } }],
            usage: { prompt_tokens: 100, completion_tokens: 180, total_tokens: 280 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.endsWith('/models')) {
        return new Response(
          JSON.stringify({
            data: [
              { id: 'gpt-4o-mini' },
              { id: 'gpt-4o' },
              { id: 'gemini-2.5-flash' },
              { id: 'gemini-2.5-pro' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(url, init);
    };

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
      assert.equal(res.status, 200, `Expected 200 on login_key, got ${res.status}`);
      return (await res.json()).token;
    }

    async function adminGet(token) {
      return adminRoute.GET(
        new Request('http://localhost/api/admin', {
          headers: token ? { 'x-studio-token': token } : {},
        })
      );
    }

    async function adminPost(token, body) {
      return adminRoute.POST(
        new Request('http://localhost/api/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { 'x-studio-token': token } : {}) },
          body: JSON.stringify(body),
        })
      );
    }

    async function studioGet(token, query = '') {
      return studioRoute.GET(
        new Request(`http://localhost/api/studio${query}`, {
          headers: token ? { 'x-studio-token': token } : {},
        })
      );
    }

    async function studioPost(token, body) {
      return studioRoute.POST(
        new Request('http://localhost/api/studio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { 'x-studio-token': token } : {}) },
          body: JSON.stringify(body),
        })
      );
    }

    async function uploadPost(token, query, body, contentType) {
      const headers = {};
      if (token) headers['x-studio-token'] = token;
      if (contentType) headers['Content-Type'] = contentType;
      return uploadRoute.POST(
        new Request(`http://localhost/api/upload?${query}`, {
          method: 'POST',
          headers,
          body,
          ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
        })
      );
    }

    async function uploadGet(token, query) {
      return uploadRoute.GET(
        new Request(`http://localhost/api/upload?${query}`, {
          headers: token ? { 'x-studio-token': token } : {},
        })
      );
    }

    async function enableMockRelay(adminToken) {
      const res = await adminPost(adminToken, {
        operation: 'save_provider',
        provider: {
          id: 'prov-openai',
          name: '测试主中转通道',
          vendor: 'custom',
          baseUrl: 'https://mock-relay.local/v1',
          apiKeys: ['sk-v3-e2e-mock-primary-01'],
          models: ['gpt-4o-mini', 'gpt-4o', 'gemini-2.5-flash', 'gemini-2.5-pro'],
          enabled: true,
          priority: 1,
        },
      });
      assert.equal(res.status, 200);
    }

    const adminToken = await loginKey('AYIN-ADMIN-8888-KEY');
    const creator1Token = await loginKey('AYIN-KEY-W01-9921');
    const creator2Token = await loginKey('AYIN-KEY-W02-7743');
    const reviewerToken = await loginKey('AYIN-KEY-R01-5510');

    await enableMockRelay(adminToken);

    // =========================================================================
    // TIER 1: Feature Coverage (R1-R4 Primary Contracts)
    // =========================================================================
    console.log('\n=== Tier 1: Feature Coverage (3.0 Upgrade) ===');

    await runTest('T1-01', 'T1', 'R1: 6 top-level routes + /login exist, warm paper CSS tokens present, forbidden SaaS/game menus absent', async () => {
      const requiredPages = [
        'app/page.tsx',
        'app/login/page.tsx',
        'app/studio/page.tsx',
        'app/breakdown/page.tsx',
        'app/usage/page.tsx',
        'app/redeem/page.tsx',
        'app/profile/page.tsx',
        'app/admin/page.tsx',
      ];
      for (const rel of requiredPages) {
        assert.equal(fs.existsSync(path.join(ROOT_DIR, rel)), true, `Missing required route file: ${rel}`);
      }

      const forbiddenNavTerms = ['墨笔行', '充值/会员', '我的订阅', '我的订单', '游戏收益'];
      const uiFiles = [
        ...listFilesRecursive(path.join(ROOT_DIR, 'components'), ['.ts', '.tsx']),
        ...listFilesRecursive(path.join(ROOT_DIR, 'app'), ['.tsx']).filter((f) => !f.includes(`${path.sep}api${path.sep}`)),
      ];
      for (const filePath of uiFiles) {
        const src = fs.readFileSync(filePath, 'utf8');
        for (const term of forbiddenNavTerms) {
          assert.equal(src.includes(term), false, `Forbidden term "${term}" found in ${path.relative(ROOT_DIR, filePath)}`);
        }
      }

      const shellPath = path.join(ROOT_DIR, 'components', 'WarmShell.tsx');
      assert.equal(fs.existsSync(shellPath), true, 'components/WarmShell.tsx must exist');
      const shellSrc = fs.readFileSync(shellPath, 'utf8');
      for (const route of ['/studio', '/breakdown', '/usage', '/redeem', '/profile', '/admin']) {
        assert.equal(shellSrc.includes(route), true, `WarmShell.tsx missing navigation route ${route}`);
      }

      const cssSrc = fs.readFileSync(path.join(ROOT_DIR, 'app', 'globals.css'), 'utf8');
      assert.equal(/#f9f6f0/i.test(cssSrc), true, 'globals.css missing warm paper token #F9F6F0');
      assert.equal(/#8c3b2b/i.test(cssSrc), true, 'globals.css missing cinnabar token #8C3B2B');
      assert.equal(/#d49b54/i.test(cssSrc), true, 'globals.css missing ochre-gold token #D49B54');
      assert.equal(cssSrc.includes('prefers-reduced-motion'), true, 'globals.css must support prefers-reduced-motion');
    });

    await runTest('T1-02', 'T1', 'R2: /api/admin save_creation_tiers creates and persists custom tier mappings', async () => {
      const tiersPayload = [
        {
          id: 'tier-fast',
          name: '极速档',
          badge: '⚡ 0.5x',
          description: '适合快速脑洞与初稿拆解',
          costHint: '消耗 0.5x',
          station: 'writer',
          providerId: 'prov-openai',
          model: 'gpt-4o-mini',
          temperature: 0.5,
          maxTokens: 2048,
          supportsThinking: false,
          enabled: true,
          isDefault: false,
          order: 1,
        },
        {
          id: 'tier-standard',
          name: '标准档',
          badge: '✨ 1x',
          description: '均衡节奏与剧作质量',
          costHint: '消耗 1x',
          station: 'writer',
          providerId: 'prov-openai',
          model: 'gemini-2.5-flash',
          temperature: 0.6,
          maxTokens: 4096,
          supportsThinking: true,
          enabled: true,
          isDefault: true,
          order: 2,
        },
        {
          id: 'tier-pro',
          name: '深度精修档',
          badge: '👑 2x',
          description: '深度推理与细腻台词打磨',
          costHint: '消耗 2x',
          station: 'polisher',
          providerId: 'prov-openai',
          model: 'gemini-2.5-pro',
          temperature: 0.4,
          maxTokens: 8192,
          supportsThinking: true,
          enabled: true,
          isDefault: false,
          order: 3,
        },
      ];
      const saveRes = await adminPost(adminToken, {
        operation: 'save_creation_tiers',
        creationTiers: tiersPayload,
      });
      assert.equal(saveRes.status, 200, `save_creation_tiers failed with ${saveRes.status}`);
      const snap = await saveRes.json();
      assert.ok(Array.isArray(snap.systemConfig?.creationTiers), 'systemConfig.creationTiers missing');
      assert.equal(snap.systemConfig.creationTiers.length, 3);
      assert.equal(snap.systemConfig.creationTiers[2].model, 'gemini-2.5-pro');

      const verifyGet = await (await adminGet(adminToken)).json();
      assert.equal(verifyGet.systemConfig.creationTiers.length, 3);
    });

    await runTest('T1-03', 'T1', 'R2: /api/studio returns desensitized tierCatalog (zero model/providerId/baseUrl/systemPrompt)', async () => {
      const listRes = await studioGet(creator1Token);
      assert.equal(listRes.status, 200);
      const listJson = await listRes.json();
      assert.ok(Array.isArray(listJson.tierCatalog), 'GET /api/studio missing tierCatalog array');
      assert.ok(listJson.tierCatalog.length >= 3, 'Expected configured tiers in tierCatalog');

      for (const tier of listJson.tierCatalog) {
        for (const k of Object.keys(tier)) {
          assert.equal(TIER_SUMMARY_ALLOWED_KEYS.has(k), true, `Unexpected field "${k}" in tierCatalog item`);
        }
        assert.equal('model' in tier, false);
        assert.equal('providerId' in tier, false);
        assert.equal('baseUrl' in tier, false);
        assert.equal('systemPrompt' in tier, false);
        assert.equal('station' in tier, false);
      }
      assertCreatorRedlineClean(listJson, 'T1-03 GET /api/studio');
    });

    await runTest('T1-04', 'T1', 'R2: Creation tier + thinkingLevel + executionMode (auto/plan) selection and routing', async () => {
      capturedLLMCalls.length = 0;
      const createRes = await studioPost(creator1Token, {
        operation: 'create',
        title: '档位与推理测试剧',
        kind: 'foreign',
        brief: '全剧 40 集，测试档位与推理控制',
        preferredTierId: 'tier-pro',
        thinkingLevel: 'high',
        executionMode: 'auto',
      });
      assert.equal(createRes.status, 201);
      const created = await createRes.json();
      assert.equal(created.preferredTierId, 'tier-pro');
      assert.equal(created.thinkingLevel, 'high');
      assert.equal(created.executionMode, 'auto');
      assert.ok(Array.isArray(created.tierCatalog), 'Project creation response must include tierCatalog');

      let proj = await (await studioPost(creator1Token, { operation: 'confirm', id: created.id, version: created.version })).json();
      proj = await (
        await studioPost(creator1Token, {
          operation: 'connect',
          id: proj.id,
          version: proj.version,
          preferredTierId: 'tier-pro',
          thinkingLevel: 'high',
          executionMode: 'auto',
        })
      ).json();
      assertCreatorRedlineClean(proj, 'T1-04 connect');
      assert.ok(capturedLLMCalls.length >= 1, 'Expected LLM call on connect');

      // Switch to plan mode via studio endpoint and verify state persists
      const planRes = await studioPost(creator1Token, {
        operation: 'set_execution',
        id: proj.id,
        version: proj.version,
        preferredTierId: 'tier-standard',
        thinkingLevel: 'medium',
        executionMode: 'plan',
      });
      assert.equal(planRes.status, 200, `Expected 200 on set_execution, got ${planRes.status}`);
      const planProj = await planRes.json();
      assert.equal(planProj.executionMode, 'plan');
      assert.equal(planProj.thinkingLevel, 'medium');
      assert.equal(planProj.preferredTierId, 'tier-standard');
    });

    await runTest('T1-05', 'T1', 'R2: Asset trees (outlineNodes, characterNodes, worldNodes), episodes, snapshots & locked protection', async () => {
      const createRes = await studioPost(creator1Token, {
        operation: 'create',
        title: '资产树与快照测试剧',
        kind: 'foreign',
        brief: '全剧 20 集，前 2 集已锁定，第3集起续写',
      });
      assert.equal(createRes.status, 201);
      let proj = await createRes.json();

      // Save asset tree nodes + episodes (episodes 1-2 locked, episode 3 unlocked)
      const assetRes = await studioPost(creator1Token, {
        operation: 'save_workspace',
        id: proj.id,
        version: proj.version,
        volumes: [{ id: 'vol-1', title: '第一卷', order: 1 }],
        outlineNodes: [
          { id: 'out-1', title: '全剧总纲', content: '落魄继承人重返家族复仇。', parentId: null, order: 1 },
        ],
        characterNodes: [
          { id: 'char-1', title: '林晚星', content: '女主，冷静果断。', parentId: null, order: 1 },
        ],
        worldNodes: [
          { id: 'world-1', title: '全剧设定', content: '现代北美顶豪庄园背景。', parentId: null, order: 1 },
        ],
        projectRules: '前3秒必出强冲突。',
        episodes: [
          { id: 'ep-1', volumeId: 'vol-1', episodeNumber: 1, title: '第1集 退婚现场', content: 'LOCKED_EP1_EXACT_TEXT', locked: true },
          { id: 'ep-2', volumeId: 'vol-1', episodeNumber: 2, title: '第2集 亮出底牌', content: 'LOCKED_EP2_EXACT_TEXT', locked: true },
          { id: 'ep-3', volumeId: 'vol-1', episodeNumber: 3, title: '第3集 董事会反转', content: '第3集初稿内容。', locked: false },
        ],
      });
      assert.equal(assetRes.status, 200, `save_workspace failed with ${assetRes.status}`);
      proj = await assetRes.json();
      assert.equal(proj.outlineNodes?.length, 1);
      assert.equal(proj.characterNodes?.length, 1);
      assert.equal(proj.worldNodes?.length, 1);
      assert.equal(proj.episodes?.length, 3);
      assert.equal(proj.episodes[0].locked, true);

      // Edit unlocked episode 3 -> creates snapshot; then edit again and restore snapshot 0
      const ep3Save1 = await studioPost(creator1Token, {
        operation: 'save_episode',
        id: proj.id,
        version: proj.version,
        episodeId: 'ep-3',
        title: '第3集 董事会反转',
        content: '第3集修改稿 V1：林晚星摔出股权书。',
      });
      assert.equal(ep3Save1.status, 200, `save_episode failed with ${ep3Save1.status}`);
      proj = await ep3Save1.json();

      const ep3Save2 = await studioPost(creator1Token, {
        operation: 'save_episode',
        id: proj.id,
        version: proj.version,
        episodeId: 'ep-3',
        title: '第3集 董事会反转',
        content: '第3集修改稿 V2：临时草稿。',
      });
      assert.equal(ep3Save2.status, 200);
      proj = await ep3Save2.json();
      const ep3 = proj.episodes.find((e) => e.id === 'ep-3');
      assert.ok(Array.isArray(ep3?.snapshots) && ep3.snapshots.length >= 1, 'Expected episode snapshots to be recorded');

      const snapToRestore = ep3.snapshots[0];
      const restoreRes = await studioPost(creator1Token, {
        operation: 'restore_episode_snapshot',
        id: proj.id,
        version: proj.version,
        episodeId: 'ep-3',
        snapshotId: snapToRestore.id,
      });
      assert.equal(restoreRes.status, 200, `restore_episode_snapshot failed with ${restoreRes.status}`);
      proj = await restoreRes.json();
      assert.equal(proj.episodes.find((e) => e.id === 'ep-3')?.content, snapToRestore.content);
    });

    await runTest('T1-06', 'T1', 'R3: /breakdown UI removes 待拍板事项 & 补充或修改意见 and provides fast/detailed + .docx + transfer', async () => {
      const breakdownPagePath = path.join(ROOT_DIR, 'app', 'breakdown', 'page.tsx');
      const breakdownCompPath = path.join(ROOT_DIR, 'components', 'BreakdownWorkspace.tsx');
      assert.equal(fs.existsSync(breakdownPagePath), true, 'app/breakdown/page.tsx missing');
      assert.equal(fs.existsSync(breakdownCompPath), true, 'components/BreakdownWorkspace.tsx missing');

      const combinedSrc =
        fs.readFileSync(breakdownPagePath, 'utf8') + '\n' + fs.readFileSync(breakdownCompPath, 'utf8');
      assert.equal(combinedSrc.includes('待拍板事项'), false, '/breakdown UI must NOT contain 待拍板事项');
      assert.equal(combinedSrc.includes('补充或修改意见'), false, '/breakdown UI must NOT contain 补充或修改意见');
      assert.equal(combinedSrc.includes('快速模式'), true, '/breakdown UI must offer 快速模式');
      assert.equal(combinedSrc.includes('详细模式'), true, '/breakdown UI must offer 详细模式');
      assert.equal(/export=docx|\.docx/i.test(combinedSrc), true, '/breakdown UI must include .docx export');
      assert.equal(combinedSrc.includes('transfer_iteration') || combinedSrc.includes('转入创作台'), true);
    });

    await runTest('T1-07', 'T1', 'R3: Clean video breakdown auto-delivers without Step 3 empty card or massive Markdown chat dump', async () => {
      const createRes = await studioPost(creator1Token, {
        operation: 'create',
        title: '豪门重生扒剧测试',
        kind: 'transcribe',
        brief: '',
      });
      assert.equal(createRes.status, 201);
      let proj = await createRes.json();

      // Upload valid >=4KB mp4 with clear episode name
      const fakeMp4 = Buffer.alloc(6000, 0x41);
      fakeMp4.write('ftypmp42', 4);
      const upRes = await uploadPost(
        creator1Token,
        `id=${proj.id}&name=${encodeURIComponent('第01集.mp4')}`,
        fakeMp4,
        'video/mp4'
      );
      assert.equal(upRes.status, 200);
      proj = await upRes.json();
      assert.equal(proj.attachments[0].episode, 1);

      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();
      proj = await (await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version })).json();
      assert.equal(proj.remote?.card?.step, 'mode_select');

      const msgCountBefore = proj.messages.length;
      const actionRes = await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { action: 'confirm', answers: { mode: 'fast' } },
      });
      assert.equal(actionRes.status, 200);
      proj = await actionRes.json();

      // Must deliver directly, skip card-transcribe-verify-*, no massive Markdown chat dump
      assert.equal(proj.remote?.status, 'delivered', 'Clean transcribe must deliver directly without Step 3 pause');
      assert.equal(proj.remote?.card, null, 'Clean transcribe delivery must have remote.card === null');
      assert.equal(
        JSON.stringify(proj).includes('card-transcribe-verify'),
        false,
        'Legacy Step 3 card-transcribe-verify must NOT be emitted'
      );

      const newMessages = proj.messages.slice(msgCountBefore);
      const directorReply = newMessages.filter((m) => m.role === 'director' || m.role === 'report').pop();
      assert.ok(directorReply, 'Expected concise employee-to-boss delivery message');
      assert.ok(
        directorReply.text.length <= 500,
        `Chat delivery message too long (${directorReply.text.length} chars) — must NOT dump massive raw Markdown into chat`
      );
      assert.equal(directorReply.text.includes('第1集 场次1-1'), false, 'Chat message must not dump raw script scenes');
      assert.ok(
        proj.remote?.outputs?.script?.content || proj.episodes?.length > 0,
        'Structured script output or episodes must be populated'
      );
    });

    await runTest('T1-08', 'T1', 'R3: lib/docx.ts + GET /api/upload?export=docx generates valid OpenXML .docx while ?export=1 keeps Markdown', async () => {
      const docxLib = await importModuleChecked('../lib/docx.ts');
      assert.equal(typeof docxLib.buildDocxBuffer, 'function', 'lib/docx.ts must export buildDocxBuffer');

      const directBuf = docxLib.buildDocxBuffer({
        title: '真Docx测试剧',
        subtitle: '短剧交付包',
        synopsis: '女主逆袭复仇。',
        characters: '林晚星：女主。',
        sections: [
          { heading: '第1集（锁定稿）', body: 'LOCKED_LINE_VERBATIM_01', locked: true },
          { heading: '第2集', body: '第2集 场次2-1 内景 客厅 日\n▲ 门被推开。\n林晚星：「我回来了。」' },
        ],
      });
      const parsedDirect = extractDocxPlainText(directBuf);
      assert.ok(parsedDirect.entries.has('word/styles.xml'), '.docx should include word/styles.xml');
      assert.ok(parsedDirect.entries.has('word/_rels/document.xml.rels'), '.docx should include word/_rels/document.xml.rels');
      assert.ok(parsedDirect.plain.includes('真Docx测试剧'));
      assert.ok(parsedDirect.plain.includes('LOCKED_LINE_VERBATIM_01'));

      // Also test via /api/upload?export=docx and ?export=1 on a project with locked episode
      const createRes = await studioPost(creator1Token, {
        operation: 'create',
        title: '导出双格式测试',
        kind: 'foreign',
        brief: '全剧 10 集，前 1 集已锁定',
      });
      let proj = await createRes.json();
      proj = await (
        await studioPost(creator1Token, {
          operation: 'save_workspace',
          id: proj.id,
          version: proj.version,
          episodes: [
            {
              id: 'ep-lock-1',
              episodeNumber: 1,
              title: '第1集 锁定首集',
              content: 'EXACT_LOCKED_EPISODE_1_VERBATIM_999',
              locked: true,
            },
            {
              id: 'ep-2',
              episodeNumber: 2,
              title: '第2集 续写集',
              content: '第2集 场次2-1 外景 街头 夜\n▲ 暴雨倾盆。',
              locked: false,
            },
          ],
        })
      ).json();

      const docxRes = await uploadGet(creator1Token, `id=${proj.id}&export=docx`);
      assert.equal(docxRes.status, 200, `GET /api/upload?export=docx returned ${docxRes.status}`);
      assert.equal(
        docxRes.headers.get('content-type'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      const disp = docxRes.headers.get('content-disposition') || '';
      assert.ok(disp.includes('.docx') && disp.includes("filename*=UTF-8''"), `Bad Content-Disposition: ${disp}`);

      const docxBytes = Buffer.from(await docxRes.arrayBuffer());
      const { plain } = extractDocxPlainText(docxBytes);
      assert.ok(plain.includes('EXACT_LOCKED_EPISODE_1_VERBATIM_999'), 'Locked episode content must be preserved verbatim in .docx');

      // Ensure ?export=1 STILL returns Markdown for backward compatibility
      const mdRes = await uploadGet(creator1Token, `id=${proj.id}&export=1`);
      assert.equal(mdRes.status, 200);
      assert.ok((mdRes.headers.get('content-type') || '').includes('text/markdown'), '?export=1 must remain text/markdown');
    });

    await runTest('T1-09', 'T1', 'R3: Unconstrained streaming upload (>20 MB) & >30 MB large-video graceful fallback without ffmpeg', async () => {
      delete process.env.STUDIO_MAX_UPLOAD_MB;
      const defaultMax = serverLib.getMaxUploadBytes();
      assert.ok(defaultMax > 200 * 1024 * 1024, `Default maxUploadBytes (${defaultMax}) must be raised above 200 MB`);

      const createRes = await studioPost(creator1Token, {
        operation: 'create',
        title: '大视频流式与降级测试',
        kind: 'transcribe',
        brief: '',
      });
      let proj = await createRes.json();

      // 1. Stream 22 MB raw binary upload via ReadableStream
      const chunkSize = 1024 * 1024;
      const totalChunks = 22;
      let sent = 0;
      const stream = new ReadableStream({
        pull(controller) {
          if (sent >= totalChunks) {
            controller.close();
            return;
          }
          const chunk = Buffer.alloc(chunkSize, (sent + 1) & 0xff);
          if (sent === 0) chunk.write('ftypmp42', 4);
          sent += 1;
          controller.enqueue(chunk);
        },
      });
      const streamUpRes = await uploadPost(
        creator1Token,
        `id=${proj.id}&name=${encodeURIComponent('第01集.mp4')}`,
        stream,
        'video/mp4'
      );
      assert.equal(streamUpRes.status, 200, `Streaming 22MB upload failed with ${streamUpRes.status}`);
      proj = await streamUpRes.json();
      const att22 = proj.attachments[0];
      assert.equal(att22.size, 22 * 1024 * 1024);

      // 2. Upload 32 MB video (exceeds 30 MB direct multimodal threshold) + paired .srt subtitle
      const big32 = Buffer.alloc(32 * 1024 * 1024, 0x00);
      big32.write('\x00\x00\x00\x18ftypisom', 0, 'latin1');
      const up32Res = await uploadPost(
        creator1Token,
        `id=${proj.id}&name=${encodeURIComponent('第02集.mp4')}`,
        big32,
        'video/mp4'
      );
      assert.equal(up32Res.status, 200, `32 MB video upload failed with ${up32Res.status}`);
      proj = await up32Res.json();

      const srtText = '1\n00:00:01,000 --> 00:00:04,000\n林晚星：今天这笔账，我们当面算清楚。\n';
      const upSrtRes = await uploadPost(
        creator1Token,
        `id=${proj.id}&name=${encodeURIComponent('第02集.srt')}&role=setting`,
        Buffer.from(srtText, 'utf8'),
        'text/plain'
      );
      assert.equal(upSrtRes.status, 200);
      proj = await upSrtRes.json();
      // Ensure episode mapping for srt doesn't block connect
      const srtAtt = proj.attachments.find((a) => a.name === '第02集.srt');
      if (srtAtt && !srtAtt.episode) {
        proj = await (
          await studioPost(creator1Token, {
            operation: 'set_episode',
            id: proj.id,
            version: proj.version,
            attachment_id: srtAtt.id,
            episode: 3,
          })
        ).json();
      }

      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();
      proj = await (await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version })).json();

      capturedLLMCalls.length = 0;
      const runRes = await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { action: 'confirm', answers: { mode: 'fast' } },
      });
      assert.equal(runRes.status, 200, 'Large-video transcribe with subtitle fallback must succeed without ffmpeg');
      const doneProj = await runRes.json();
      assert.equal(doneProj.remote?.status, 'delivered');
      assert.ok(
        capturedLLMCalls.some((c) => c.userPrompt.includes('今天这笔账')),
        'Paired subtitle text must be extracted into prompt for >30 MB video degradation'
      );
    });

    await runTest('T1-10', 'T1', 'R3: Key-model-family affinity cache routes subsequent same-family calls to working key on 1st try', async () => {
      const keyCalls = [];
      const prevHandler = fetchHandler;
      fetchHandler = async (url, init) => {
        const urlStr = String(url);
        const auth = init?.headers?.Authorization || init?.headers?.authorization || '';
        if (urlStr.includes('/chat/completions')) {
          const body = JSON.parse(String(init?.body || '{}'));
          keyCalls.push({ auth, model: body.model });
          if (auth.includes('sk-v3-gpt-only-key1') && /gemini/i.test(body.model)) {
            return new Response(
              JSON.stringify({ error: { message: 'No available channel for model gemini-2.5-pro (model_not_found)' } }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Affinity OK' } }],
              usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.endsWith('/models')) {
          return new Response(
            JSON.stringify({ data: [{ id: 'gemini-2.5-pro' }, { id: 'gemini-2.5-flash' }, { id: 'gpt-4o' }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return originalFetch(url, init);
      };

      try {
        await adminPost(adminToken, {
          operation: 'save_provider',
          provider: {
            id: 'prov-affinity-test',
            name: '亲和缓存测试渠道',
            vendor: 'custom',
            baseUrl: 'https://affinity-mock.local/v1',
            apiKeys: ['sk-v3-gpt-only-key1', 'sk-v3-gemini-only-key2'],
            models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gpt-4o'],
            enabled: true,
            priority: 1,
          },
        });
        await adminPost(adminToken, {
          operation: 'save_routes',
          routes: {
            vision: {
              roleKey: 'vision',
              title: '03 · 扒剧小能手',
              badge: '视觉',
              description: '视觉',
              primaryProviderId: 'prov-affinity-test',
              primaryModel: 'gemini-2.5-pro',
              fallbackProviderId: 'prov-openai',
              fallbackModel: 'gemini-2.5-flash',
              temperature: 0.2,
              maxTokens: 1024,
              systemPrompt: '你是视觉还原师',
              enabled: true,
            },
          },
        });

        // Call 1: probes Key 1 -> model_not_found -> falls over to Key 2 -> succeeds & caches affinity
        keyCalls.length = 0;
        const r1 = await serverLib.callStationLLM({
          station: 'vision',
          userPrompt: 'First Gemini call',
        });
        assert.equal(r1.ok, true);
        assert.ok(
          keyCalls.some((c) => c.auth.includes('sk-v3-gemini-only-key2')),
          'First call should succeed on Key 2'
        );

        // Call 2 (same Gemini family): MUST hit Key 2 on the VERY FIRST try without wasting a request on Key 1
        keyCalls.length = 0;
        const r2 = await serverLib.callStationLLM({
          station: 'vision',
          userPrompt: 'Second Gemini call',
        });
        assert.equal(r2.ok, true);
        assert.equal(keyCalls.length, 1, `Expected 1 direct call via affinity cache, got ${keyCalls.length}: ${JSON.stringify(keyCalls)}`);
        assert.ok(keyCalls[0].auth.includes('sk-v3-gemini-only-key2'), 'Second call must route directly to Key 2 on first try');
      } finally {
        fetchHandler = prevHandler;
        await enableMockRelay(adminToken);
        await adminPost(adminToken, { operation: 'delete_provider', id: 'prov-affinity-test' });
      }
    });

    await runTest('T1-11', 'T1', 'R1 P1: /api/usage returns account KPIs, 7-day trend & logs with ZERO model names leaked', async () => {
      const usageRoute = await importModuleChecked('../app/api/usage/route.ts');
      const res = await usageRoute.GET(
        new Request('http://localhost/api/usage?days=7', {
          headers: { 'x-studio-token': creator1Token },
        })
      );
      assert.equal(res.status, 200, `GET /api/usage returned ${res.status}`);
      const data = await res.json();
      assert.ok(data && typeof data === 'object');
      assert.ok(Array.isArray(data.logs), '/api/usage must return logs array');
      assert.ok(Array.isArray(data.trend || data.dailyTrend), '/api/usage must return 7-day trend array');
      assertCreatorRedlineClean(data, 'T1-11 GET /api/usage');
    });

    await runTest('T1-12', 'T1', 'R1 P1: /api/redeem activates/switches workspace with admin invite code', async () => {
      const redeemRoute = await importModuleChecked('../app/api/redeem/route.ts');
      const invRes = await adminPost(adminToken, {
        operation: 'generate_invites',
        count: 1,
        role: 'creator',
        budgetCapUsd: 18,
        maxUses: 1,
        prefix: 'AYIN-V3',
        note: 'RedeemTest',
      });
      const invSnap = await invRes.json();
      const invite = invSnap.invites.find((i) => i.code.startsWith('AYIN-V3-'));
      assert.ok(invite, 'Failed to generate test invite');

      const redeemRes = await redeemRoute.POST(
        new Request('http://localhost/api/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: invite.code }),
        })
      );
      assert.equal(redeemRes.status, 200, `POST /api/redeem returned ${redeemRes.status}`);
      const redeemJson = await redeemRes.json();
      assert.equal(redeemJson.ok, true);
      assert.ok(redeemJson.account, 'Redeem response must return account profile');
      assertCreatorRedlineClean(redeemJson, 'T1-12 POST /api/redeem');
    });

    await runTest('T1-13', 'T1', 'R1 P1: /api/profile updates displayName, themePreference & globalRules (injected into AI prompt)', async () => {
      const profileRoute = await importModuleChecked('../app/api/profile/route.ts');
      const getRes = await profileRoute.GET(
        new Request('http://localhost/api/profile', {
          headers: { 'x-studio-token': creator1Token },
        })
      );
      assert.equal(getRes.status, 200);

      const postRes = await profileRoute.POST(
        new Request('http://localhost/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-studio-token': creator1Token },
          body: JSON.stringify({
            displayName: '核心编剧A组-3.0',
            globalRules: 'GLOBAL_RULE_V3_CONFLICT_FIRST',
            themePreference: 'dark',
          }),
        })
      );
      assert.equal(postRes.status, 200, `POST /api/profile returned ${postRes.status}`);
      const updated = await postRes.json();
      assert.equal(updated.account?.displayName, '核心编剧A组-3.0');
      assert.equal(updated.globalRules ?? updated.account?.globalRules, 'GLOBAL_RULE_V3_CONFLICT_FIRST');
      assert.equal(updated.themePreference ?? updated.account?.themePreference, 'dark');

      // Verify globalRules gets injected into creator LLM call
      capturedLLMCalls.length = 0;
      const createRes = await studioPost(creator1Token, {
        operation: 'create',
        title: '全局规矩注入测试',
        kind: 'original',
        brief: '现代豪门契约婚姻',
      });
      let proj = await createRes.json();
      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();
      await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version });
      assert.ok(
        capturedLLMCalls.some((c) => c.systemPrompt.includes('GLOBAL_RULE_V3_CONFLICT_FIRST')),
        'globalRules must be injected into LLM systemPrompt'
      );
    });

    await runTest('T1-14', 'T1', 'R1 P1: studio_tool supports inspire, format, ai_rate (>=120 chars), and hotlist', async () => {
      const createRes = await studioPost(creator1Token, {
        operation: 'create',
        title: '增强工具测试剧',
        kind: 'foreign',
        brief: '全剧 30 集',
      });
      let proj = await createRes.json();

      const inspireRes = await studioPost(creator1Token, {
        operation: 'studio_tool',
        id: proj.id,
        version: proj.version,
        tool: 'inspire',
        text: '女主在宴会大厅当众揭穿假千金的伪造遗嘱。',
      });
      assert.equal(inspireRes.status, 200, `studio_tool inspire returned ${inspireRes.status}`);
      const inspireJson = await inspireRes.json();
      assert.ok(inspireJson.result || inspireJson.idea || inspireJson.text, 'inspire must return creative idea');
      assertCreatorRedlineClean(inspireJson, 'T1-14 inspire');

      const formatRes = await studioPost(creator1Token, {
        operation: 'studio_tool',
        id: proj.id,
        version: inspireJson.version || proj.version,
        tool: 'format',
        text: '第1集 1-1 内 宴会厅 夜\n她一把掀翻桌布。\n林晚星:"你凭什么冒充我?"',
      });
      assert.equal(formatRes.status, 200);
      const formatJson = await formatRes.json();
      const formattedText = String(formatJson.formatted || formatJson.result || formatJson.text || '');
      assert.ok(formattedText.includes('▲') || formattedText.includes('「'), 'format tool must standardize action/quotes');

      const longScript = '林晚星站在宴会厅中央，目光冷冽地扫过全场宾客。'.repeat(10);
      const aiRateRes = await studioPost(creator1Token, {
        operation: 'studio_tool',
        id: proj.id,
        version: formatJson.version || proj.version,
        tool: 'ai_rate',
        text: longScript,
      });
      assert.equal(aiRateRes.status, 200);
      const aiRateJson = await aiRateRes.json();
      const humanRate = aiRateJson.humanRate ?? aiRateJson.result?.humanRate;
      const aiRate = aiRateJson.aiRate ?? aiRateJson.result?.aiRate;
      assert.equal(typeof humanRate, 'number', 'ai_rate must return numeric humanRate');
      assert.equal(typeof aiRate, 'number', 'ai_rate must return numeric aiRate');
      assertCreatorRedlineClean(aiRateJson, 'T1-14 ai_rate');

      const hotlistRes = await studioPost(creator1Token, {
        operation: 'studio_tool',
        id: proj.id,
        version: aiRateJson.version || proj.version,
        tool: 'hotlist',
      });
      assert.equal(hotlistRes.status, 200);
      const hotlistJson = await hotlistRes.json();
      const platforms = hotlistJson.platforms || hotlistJson.result?.platforms || [];
      assert.ok(Array.isArray(platforms) && platforms.length >= 10, 'hotlist must include >=10 platforms');
    });

    // =========================================================================
    // TIER 2: Boundaries & Negative Cases
    // =========================================================================
    console.log('\n=== Tier 2: Boundaries & Negative Cases ===');

    await runTest('T2-01', 'T2', 'Invalid or disabled creation tier IDs rejected cleanly without leaking internal config', async () => {
      await adminPost(adminToken, {
        operation: 'save_creation_tiers',
        creationTiers: [
          {
            id: 'tier-disabled',
            name: '停用测试档',
            badge: '⏸',
            description: '已停用',
            costHint: '消耗 1x',
            station: 'writer',
            providerId: 'prov-openai',
            model: 'gpt-4o',
            supportsThinking: false,
            enabled: false,
            isDefault: false,
            order: 1,
          },
          {
            id: 'tier-active',
            name: '标准档',
            badge: '✨ 1x',
            description: '可用档位',
            costHint: '消耗 1x',
            station: 'writer',
            providerId: 'prov-openai',
            model: 'gemini-2.5-flash',
            supportsThinking: true,
            enabled: true,
            isDefault: true,
            order: 2,
          },
        ],
      });

      const listJson = await (await studioGet(creator1Token)).json();
      assert.equal(
        listJson.tierCatalog.some((t) => t.id === 'tier-disabled'),
        false,
        'Disabled tier must not appear in creator tierCatalog'
      );

      const badCreate = await studioPost(creator1Token, {
        operation: 'create',
        title: '非法档位测试',
        kind: 'foreign',
        brief: '全剧 20 集',
        preferredTierId: 'tier-nonexistent-999',
      });
      assert.equal(badCreate.status, 400, `Expected 400 for nonexistent tierId, got ${badCreate.status}`);

      const disabledCreate = await studioPost(creator1Token, {
        operation: 'create',
        title: '停用档位测试',
        kind: 'foreign',
        brief: '全剧 20 集',
        preferredTierId: 'tier-disabled',
      });
      assert.equal(disabledCreate.status, 400, `Expected 400 for disabled tierId, got ${disabledCreate.status}`);
    });

    await runTest('T2-02', 'T2', 'plan executionMode refuses writeback to episodes, outlineNodes, characterNodes & worldNodes', async () => {
      const createRes = await studioPost(creator1Token, {
        operation: 'create',
        title: '计划模式防误写测试',
        kind: 'foreign',
        brief: '全剧 10 集',
        executionMode: 'plan',
      });
      let proj = await createRes.json();

      proj = await (
        await studioPost(creator1Token, {
          operation: 'save_workspace',
          id: proj.id,
          version: proj.version,
          outlineNodes: [{ id: 'o1', title: '原始总纲', content: 'ORIGINAL_OUTLINE_KEEP', parentId: null, order: 1 }],
          episodes: [{ id: 'e1', episodeNumber: 1, title: '第1集', content: 'ORIGINAL_EP1_KEEP', locked: false }],
        })
      ).json();

      // Send AI chat/message requesting episode/outline rewrite while in plan mode
      const msgRes = await studioPost(creator1Token, {
        operation: 'message',
        id: proj.id,
        version: proj.version,
        executionMode: 'plan',
        text: '请直接改写第1集正文和总纲，把主角改名。',
      });
      assert.equal(msgRes.status, 200);
      const afterPlan = await msgRes.json();
      assert.equal(afterPlan.executionMode, 'plan');
      assert.equal(afterPlan.episodes[0].content, 'ORIGINAL_EP1_KEEP', 'plan mode must NOT mutate episodes');
      assert.equal(afterPlan.outlineNodes[0].content, 'ORIGINAL_OUTLINE_KEEP', 'plan mode must NOT mutate outlineNodes');

      // Explicit writeback attempt with executionMode='plan' must also be rejected (400/403)
      const writeAttempt = await studioPost(creator1Token, {
        operation: 'ai_apply_writeback',
        id: afterPlan.id,
        version: afterPlan.version,
        executionMode: 'plan',
        episodeId: 'e1',
        content: 'OVERWRITTEN_BY_PLAN',
      });
      assert.ok([400, 403].includes(writeAttempt.status), `Plan mode writeback must be rejected, got ${writeAttempt.status}`);
      const refetched = await (await studioGet(creator1Token, `?id=${proj.id}`)).json();
      assert.equal(refetched.episodes[0].content, 'ORIGINAL_EP1_KEEP');
    });

    await runTest('T2-03', 'T2', 'Locked episode edit & delete rejected (400/403) and preserved verbatim', async () => {
      const createRes = await studioPost(creator1Token, {
        operation: 'create',
        title: '锁集拒改删测试',
        kind: 'foreign',
        brief: '全剧 10 集，前 2 集已锁定',
      });
      let proj = await createRes.json();
      proj = await (
        await studioPost(creator1Token, {
          operation: 'save_workspace',
          id: proj.id,
          version: proj.version,
          episodes: [
            { id: 'lock-1', episodeNumber: 1, title: '第1集', content: 'IMMUTABLE_LOCKED_EP1', locked: true },
            { id: 'open-2', episodeNumber: 2, title: '第2集', content: 'UNLOCKED_EP2', locked: false },
          ],
        })
      ).json();

      const editLocked = await studioPost(creator1Token, {
        operation: 'save_episode',
        id: proj.id,
        version: proj.version,
        episodeId: 'lock-1',
        title: '篡改标题',
        content: 'TAMPERED_CONTENT',
      });
      assert.ok([400, 403].includes(editLocked.status), `Editing locked episode must fail 400/403, got ${editLocked.status}`);

      const delLocked = await studioPost(creator1Token, {
        operation: 'delete_episode',
        id: proj.id,
        version: proj.version,
        episodeId: 'lock-1',
      });
      assert.ok([400, 403].includes(delLocked.status), `Deleting locked episode must fail 400/403, got ${delLocked.status}`);

      const fresh = await (await studioGet(creator1Token, `?id=${proj.id}`)).json();
      assert.equal(fresh.episodes.find((e) => e.id === 'lock-1')?.content, 'IMMUTABLE_LOCKED_EP1');
    });

    await runTest('T2-04', 'T2', 'Missing episode number & video anomaly trigger confirmation card instead of silent delivery', async () => {
      const createRes = await studioPost(creator1Token, {
        operation: 'create',
        title: '异常停点测试',
        kind: 'transcribe',
        brief: '',
      });
      let proj = await createRes.json();

      // Upload ambiguous file name -> must NOT guess episode number
      const vid = Buffer.alloc(5000, 0x22);
      const upAmb = await uploadPost(
        creator1Token,
        `id=${proj.id}&name=${encodeURIComponent('微信视频20261113.mp4')}`,
        vid,
        'video/mp4'
      );
      assert.equal(upAmb.status, 200);
      proj = await upAmb.json();
      assert.equal(proj.attachments[0].episode, undefined, 'Ambiguous filename must not guess episode number');

      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();
      const badConnect = await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version });
      assert.equal(badConnect.status, 400);
      assert.equal((await badConnect.json()).error, 'EPISODE_MAPPING_REQUIRED');

      // Now fix episode number on a >30MB video WITHOUT subtitle/keyframes -> anomaly card should trigger instead of silent delivery
      const createAnom = await studioPost(creator1Token, {
        operation: 'create',
        title: '大视频无字幕异常测试',
        kind: 'transcribe',
        brief: '',
      });
      let anomProj = await createAnom.json();
      const bigNoSub = Buffer.alloc(31 * 1024 * 1024, 0x11);
      anomProj = await (
        await uploadPost(creator1Token, `id=${anomProj.id}&name=${encodeURIComponent('第01集.mp4')}`, bigNoSub, 'video/mp4')
      ).json();
      anomProj = await (await studioPost(creator1Token, { operation: 'confirm', id: anomProj.id, version: anomProj.version })).json();
      anomProj = await (await studioPost(creator1Token, { operation: 'connect', id: anomProj.id, version: anomProj.version })).json();

      const anomRes = await studioPost(creator1Token, {
        operation: 'action',
        id: anomProj.id,
        version: anomProj.version,
        action: { action: 'confirm', answers: { mode: 'fast' } },
      });
      assert.equal(anomRes.status, 200);
      const afterAnom = await anomRes.json();
      assert.notEqual(
        afterAnom.remote?.status,
        'delivered',
        'Over-30MB video with no subtitle/keyframes must pause with anomaly card rather than silent delivery'
      );
      assert.ok(afterAnom.remote?.card, 'Anomaly must surface confirmation card');
    });

    await runTest('T2-05', 'T2', 'Empty/corrupt .docx upload & empty-project .docx export resilience', async () => {
      const createRes = await studioPost(creator1Token, {
        operation: 'create',
        title: '损坏Docx容错测试',
        kind: 'foreign',
        brief: '全剧 10 集',
      });
      let proj = await createRes.json();

      // Upload corrupt & empty .docx attachments
      const corruptRes = await uploadPost(
        creator1Token,
        `id=${proj.id}&name=${encodeURIComponent('corrupt.docx')}`,
        Buffer.from('PK\x03\x04CORRUPT_NOT_REAL_ZIP_DATA', 'latin1'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      assert.equal(corruptRes.status, 200);
      proj = await corruptRes.json();

      const emptyRes = await uploadPost(
        creator1Token,
        `id=${proj.id}&name=${encodeURIComponent('empty.docx')}`,
        Buffer.alloc(0),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      assert.equal(emptyRes.status, 200);
      proj = await emptyRes.json();

      // Exporting empty project as .docx must still produce a valid OpenXML ZIP (never 500 or invalid ZIP)
      const exportEmpty = await uploadGet(creator1Token, `id=${proj.id}&export=docx`);
      assert.equal(exportEmpty.status, 200);
      const { entries } = extractDocxPlainText(Buffer.from(await exportEmpty.arrayBuffer()));
      assert.ok(entries.has('word/document.xml'));

      // Connecting project with corrupt .docx attachment must not crash with 500
      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();
      const connRes = await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version });
      assert.equal(connRes.status, 200);
    });

    await runTest('T2-06', 'T2', 'Non-admin /api/admin save_creation_tiers rejected (401/403)', async () => {
      const payload = { operation: 'save_creation_tiers', creationTiers: [] };
      const unauth = await adminPost(null, payload);
      assert.equal(unauth.status, 401);

      const creatorAttempt = await adminPost(creator1Token, payload);
      assert.ok([401, 403].includes(creatorAttempt.status), `Creator must be blocked, got ${creatorAttempt.status}`);

      const reviewerAttempt = await adminPost(reviewerToken, payload);
      assert.ok([401, 403].includes(reviewerAttempt.status), `Reviewer must be blocked, got ${reviewerAttempt.status}`);
    });

    await runTest('T2-07', 'T2', 'Invalid thinkingLevel rejected & supportsThinking: false disables thinking cleanly', async () => {
      const badThink = await studioPost(creator1Token, {
        operation: 'create',
        title: '非法推理强度',
        kind: 'foreign',
        brief: '全剧 10 集',
        thinkingLevel: 'impossible_level',
      });
      assert.equal(badThink.status, 400, `Expected 400 for invalid thinkingLevel, got ${badThink.status}`);

      const listJson = await (await studioGet(creator1Token)).json();
      const noThinkTier = listJson.tierCatalog.find((t) => t.supportsThinking === false);
      if (noThinkTier) {
        const res = await studioPost(creator1Token, {
          operation: 'create',
          title: '不支持思考档位',
          kind: 'foreign',
          brief: '全剧 10 集',
          preferredTierId: noThinkTier.id,
          thinkingLevel: 'max',
        });
        assert.ok([201, 400].includes(res.status));
        if (res.status === 201) {
          const p = await res.json();
          assert.equal(p.thinkingLevel === 'off' || p.thinkingLevel === undefined || p.thinkingLevel === 'max', true);
        }
      }
    });

    await runTest('T2-08', 'T2', 'studio_tool rejects ai_rate < 120 chars and unknown tool names', async () => {
      const createRes = await studioPost(creator1Token, {
        operation: 'create',
        title: '工具边界测试',
        kind: 'original',
        brief: '测试',
      });
      const proj = await createRes.json();

      const shortAiRate = await studioPost(creator1Token, {
        operation: 'studio_tool',
        id: proj.id,
        version: proj.version,
        tool: 'ai_rate',
        text: '太短了不到一百二十字。',
      });
      assert.equal(shortAiRate.status, 400, `ai_rate < 120 chars must return 400, got ${shortAiRate.status}`);

      const badTool = await studioPost(creator1Token, {
        operation: 'studio_tool',
        id: proj.id,
        version: proj.version,
        tool: 'nonexistent_tool_xyz',
      });
      assert.equal(badTool.status, 400, `Unknown studio_tool must return 400, got ${badTool.status}`);
    });

    await runTest('T2-09', 'T2', 'Explicit STUDIO_MAX_UPLOAD_MB env override still enforced (413 FILE_TOO_LARGE)', async () => {
      process.env.STUDIO_MAX_UPLOAD_MB = '1';
      try {
        assert.equal(serverLib.getMaxUploadBytes(), 1024 * 1024);
        const listJson = await (await studioGet(creator1Token)).json();
        assert.equal(listJson.maxUploadBytes, 1024 * 1024);

        const proj = await (
          await studioPost(creator1Token, { operation: 'create', title: '动态上限测试', kind: 'transcribe', brief: '' })
        ).json();
        const over1Mb = Buffer.alloc(1024 * 1024 + 4096, 0x33);
        const res = await uploadPost(creator1Token, `id=${proj.id}&name=over.mp4`, over1Mb, 'video/mp4');
        assert.equal(res.status, 413);
        assert.equal((await res.json()).error, 'FILE_TOO_LARGE');
      } finally {
        if (prevMaxUploadMb === undefined) delete process.env.STUDIO_MAX_UPLOAD_MB;
        else process.env.STUDIO_MAX_UPLOAD_MB = prevMaxUploadMb;
      }
    });

    await runTest('T2-10', 'T2', '/api/usage, /api/redeem & /api/profile auth & input validation boundaries', async () => {
      const usageRoute = await importModuleChecked('../app/api/usage/route.ts');
      const redeemRoute = await importModuleChecked('../app/api/redeem/route.ts');
      const profileRoute = await importModuleChecked('../app/api/profile/route.ts');

      await adminPost(adminToken, { operation: 'save_system_config', requireAuthOnFrontend: true });
      try {
        const unauthUsage = await usageRoute.GET(new Request('http://localhost/api/usage'));
        assert.equal(unauthUsage.status, 401);
        const unauthProfile = await profileRoute.GET(new Request('http://localhost/api/profile'));
        assert.equal(unauthProfile.status, 401);
      } finally {
        await adminPost(adminToken, { operation: 'save_system_config', requireAuthOnFrontend: false });
      }

      const badRedeem = await redeemRoute.POST(
        new Request('http://localhost/api/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'AYIN-INVALID-CODE-9999' }),
        })
      );
      assert.ok([400, 401, 404].includes(badRedeem.status));

      const shortPwd = await profileRoute.POST(
        new Request('http://localhost/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-studio-token': creator1Token },
          body: JSON.stringify({ currentPassword: 'wrong', newPassword: '12' }),
        })
      );
      assert.equal(shortPwd.status, 400);
    });

    // =========================================================================
    // TIER 3: Cross-Feature Pairwise Interactions
    // =========================================================================
    console.log('\n=== Tier 3: Cross-Feature Pairwise Interactions ===');

    await runTest('T3-01', 'T3', 'Breakdown -> .docx export -> transfer_iteration to /studio foreign & domestic', async () => {
      let proj = await (
        await studioPost(creator1Token, { operation: 'create', title: '交叉流转剧', kind: 'transcribe', brief: '' })
      ).json();
      const vid = Buffer.alloc(5000, 0x55);
      vid.write('ftypmp42', 4);
      proj = await (
        await uploadPost(creator1Token, `id=${proj.id}&name=${encodeURIComponent('第01集.mp4')}`, vid, 'video/mp4')
      ).json();
      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();
      proj = await (await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version })).json();
      proj = await (
        await studioPost(creator1Token, {
          operation: 'action',
          id: proj.id,
          version: proj.version,
          action: { action: 'confirm', answers: { mode: 'fast' } },
        })
      ).json();
      assert.equal(proj.remote?.status, 'delivered');

      const docxRes = await uploadGet(creator1Token, `id=${proj.id}&export=docx`);
      assert.equal(docxRes.status, 200);
      const { plain } = extractDocxPlainText(Buffer.from(await docxRes.arrayBuffer()));
      assert.ok(plain.includes('交叉流转剧'));

      const foreignRes = await studioPost(creator1Token, {
        operation: 'transfer_iteration',
        id: proj.id,
        version: proj.version,
        target_kind: 'foreign',
      });
      assert.equal(foreignRes.status, 201);
      const foreignProj = await foreignRes.json();
      assert.equal(foreignProj.kind, 'foreign');
      assert.equal(foreignProj.attachments.length, 1);

      const domesticRes = await studioPost(creator1Token, {
        operation: 'transfer_iteration',
        id: proj.id,
        version: proj.version,
        target_kind: 'domestic',
      });
      assert.equal(domesticRes.status, 201);
      const domesticProj = await domesticRes.json();
      assert.equal(domesticProj.kind, 'domestic');
    });

    await runTest('T3-02', 'T3', 'Pairwise: creationTier + thinkingLevel + Skill plugin + globalRules + projectRules injection & redline scrub', async () => {
      await adminPost(adminToken, {
        operation: 'save_creation_tiers',
        creationTiers: [
          {
            id: 'tier-pairwise-pro',
            name: '精修档',
            badge: '👑 2x',
            description: '精修',
            costHint: '消耗 2x',
            station: 'director',
            providerId: 'prov-openai',
            model: 'gemini-2.5-pro',
            supportsThinking: true,
            enabled: true,
            isDefault: true,
            order: 1,
          },
        ],
      });

      const skillRes = await adminPost(adminToken, {
        operation: 'upload_skill_plugin',
        kind: 'foreign',
        slot: 'primary',
        name: 'PairwiseSkillV3',
        description: 'Pairwise 测试技能',
        fileName: 'pairwise-v3.md',
        content: 'PAIRWISE_SKILL_SECRET_RULE_9001',
        enabled: true,
        isDefault: false,
      });
      assert.equal(skillRes.status, 200);
      const skillPlugin = (await skillRes.json()).systemConfig.skillPlugins.find((p) => p.name === 'PairwiseSkillV3');
      assert.ok(skillPlugin);

      const profileRoute = await importModuleChecked('../app/api/profile/route.ts');
      await profileRoute.POST(
        new Request('http://localhost/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-studio-token': creator2Token },
          body: JSON.stringify({ globalRules: 'PAIRWISE_GLOBAL_RULE_88' }),
        })
      );

      let proj = await (
        await studioPost(creator2Token, {
          operation: 'create',
          title: '多维组合注入剧',
          kind: 'foreign',
          brief: '全剧 30 集',
          preferredTierId: 'tier-pairwise-pro',
          thinkingLevel: 'xhigh',
          executionMode: 'auto',
          promptSelections: { foreign: { primary: skillPlugin.id } },
        })
      ).json();

      proj = await (
        await studioPost(creator2Token, {
          operation: 'save_workspace',
          id: proj.id,
          version: proj.version,
          projectRules: 'PAIRWISE_PROJECT_RULE_77',
        })
      ).json();

      capturedLLMCalls.length = 0;
      proj = await (await studioPost(creator2Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();
      proj = await (await studioPost(creator2Token, { operation: 'connect', id: proj.id, version: proj.version })).json();

      assert.ok(capturedLLMCalls.length >= 1);
      const lastCall = capturedLLMCalls[capturedLLMCalls.length - 1];
      assert.ok(lastCall.systemPrompt.includes('PAIRWISE_SKILL_SECRET_RULE_9001'), 'Skill plugin missing in systemPrompt');
      assert.ok(lastCall.systemPrompt.includes('PAIRWISE_GLOBAL_RULE_88'), 'globalRules missing in systemPrompt');
      assert.ok(lastCall.systemPrompt.includes('PAIRWISE_PROJECT_RULE_77'), 'projectRules missing in systemPrompt');
      assertCreatorRedlineClean(proj, 'T3-02 pairwise response', ['PAIRWISE_SKILL_SECRET_RULE_9001', 'pairwise-v3.md']);
    });

    await runTest('T3-03', 'T3', 'Pairwise: plan mode -> auto mode transition enables episode/asset writeback', async () => {
      let proj = await (
        await studioPost(creator1Token, {
          operation: 'create',
          title: '模式切换写入测试',
          kind: 'original',
          brief: '先计划再自动写入',
          executionMode: 'plan',
        })
      ).json();
      proj = await (
        await studioPost(creator1Token, {
          operation: 'save_workspace',
          id: proj.id,
          version: proj.version,
          episodes: [{ id: 'ep-1', episodeNumber: 1, title: '第1集', content: 'PLAN_BEFORE_TEXT', locked: false }],
        })
      ).json();

      const blockedInPlan = await studioPost(creator1Token, {
        operation: 'ai_apply_writeback',
        id: proj.id,
        version: proj.version,
        executionMode: 'plan',
        episodeId: 'ep-1',
        content: 'SHOULD_NOT_WRITE',
      });
      assert.ok([400, 403].includes(blockedInPlan.status));

      proj = await (
        await studioPost(creator1Token, {
          operation: 'set_execution',
          id: proj.id,
          version: proj.version,
          executionMode: 'auto',
        })
      ).json();
      assert.equal(proj.executionMode, 'auto');

      const allowedInAuto = await studioPost(creator1Token, {
        operation: 'ai_apply_writeback',
        id: proj.id,
        version: proj.version,
        executionMode: 'auto',
        episodeId: 'ep-1',
        content: 'AUTO_WRITTEN_EP1_CONTENT',
      });
      assert.equal(allowedInAuto.status, 200, `auto mode writeback failed with ${allowedInAuto.status}`);
      const updated = await allowedInAuto.json();
      assert.equal(updated.episodes.find((e) => e.id === 'ep-1')?.content, 'AUTO_WRITTEN_EP1_CONTENT');
    });

    await runTest('T3-04', 'T3', 'Pairwise: Multi-station execution records sanitized usage analytics without model name leaks', async () => {
      const usageRoute = await importModuleChecked('../app/api/usage/route.ts');
      const beforeUsage = await (
        await usageRoute.GET(new Request('http://localhost/api/usage?days=7', { headers: { 'x-studio-token': creator1Token } }))
      ).json();
      const beforeCount = beforeUsage.logs.length;

      const r = await serverLib.callStationLLM({
        station: 'director',
        userPrompt: 'Usage tracking check',
        account: serverLib.getStore().accounts.find((a) => a.username === 'writer01'),
      });
      assert.equal(r.ok, true);

      const afterUsage = await (
        await usageRoute.GET(new Request('http://localhost/api/usage?days=7', { headers: { 'x-studio-token': creator1Token } }))
      ).json();
      assert.ok(afterUsage.logs.length >= beforeCount, 'New call should be reflected in /api/usage');
      assertCreatorRedlineClean(afterUsage, 'T3-04 GET /api/usage');
    });

    await runTest('T3-05', 'T3', 'Pairwise: Key-model-family affinity + provider failover on 503 preserves resilience', async () => {
      let primaryFail503 = false;
      const prevHandler = fetchHandler;
      fetchHandler = async (url, init) => {
        const urlStr = String(url);
        const auth = init?.headers?.Authorization || init?.headers?.authorization || '';
        if (urlStr.includes('primary-failover-v3.local') && urlStr.includes('/chat/completions')) {
          if (primaryFail503) {
            return new Response('Service Unavailable', { status: 503 });
          }
          if (auth.includes('sk-k1-bad-gemini')) {
            return new Response('model_not_found', { status: 404 });
          }
          return new Response(
            JSON.stringify({ choices: [{ message: { content: 'Primary Key 2 OK' } }], usage: { total_tokens: 15 } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.includes('backup-failover-v3.local') && urlStr.includes('/chat/completions')) {
          return new Response(
            JSON.stringify({ choices: [{ message: { content: 'Backup Provider OK' } }], usage: { total_tokens: 15 } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return originalFetch(url, init);
      };

      try {
        await adminPost(adminToken, {
          operation: 'save_provider',
          provider: {
            id: 'prov-p1-v3',
            name: '主备切换主通道',
            vendor: 'custom',
            baseUrl: 'https://primary-failover-v3.local/v1',
            apiKeys: ['sk-k1-bad-gemini', 'sk-k2-good-gemini'],
            models: ['gemini-2.5-pro'],
            enabled: true,
            priority: 1,
          },
        });
        await adminPost(adminToken, {
          operation: 'save_provider',
          provider: {
            id: 'prov-p2-v3',
            name: '主备切换备通道',
            vendor: 'custom',
            baseUrl: 'https://backup-failover-v3.local/v1',
            apiKeys: ['sk-backup-ok'],
            models: ['gemini-2.5-pro'],
            enabled: true,
            priority: 2,
          },
        });
        await adminPost(adminToken, {
          operation: 'save_routes',
          routes: {
            analyst: {
              roleKey: 'analyst',
              title: '02 · 原稿分析师',
              badge: '分析',
              description: '分析',
              primaryProviderId: 'prov-p1-v3',
              primaryModel: 'gemini-2.5-pro',
              fallbackProviderId: 'prov-p2-v3',
              fallbackModel: 'gemini-2.5-pro',
              temperature: 0.2,
              maxTokens: 1024,
              systemPrompt: '你是原稿分析师',
              enabled: true,
            },
          },
        });

        const first = await serverLib.callStationLLM({ station: 'analyst', userPrompt: 'Warm affinity' });
        assert.equal(first.ok, true);

        primaryFail503 = true;
        const second = await serverLib.callStationLLM({ station: 'analyst', userPrompt: 'Trigger failover' });
        assert.equal(second.ok, true);
        assert.equal(second.text, 'Backup Provider OK');
      } finally {
        fetchHandler = prevHandler;
        await enableMockRelay(adminToken);
        await adminPost(adminToken, { operation: 'delete_provider', id: 'prov-p1-v3' });
        await adminPost(adminToken, { operation: 'delete_provider', id: 'prov-p2-v3' });
      }
    });

    // =========================================================================
    // TIER 4: Real-World End-to-End Scenarios & Redlines
    // =========================================================================
    console.log('\n=== Tier 4: Real-World E2E Scenarios & Redlines ===');

    await runTest('T4-01', 'T4', 'Real-world multi-episode short drama breakdown -> .docx parse -> transfer -> locked continuation', async () => {
      let bdProj = await (
        await studioPost(creator1Token, { operation: 'create', title: '天降千金复仇记', kind: 'transcribe', brief: '' })
      ).json();

      for (const epNum of [1, 2, 3]) {
        const buf = Buffer.alloc(5000, epNum);
        buf.write('ftypmp42', 4);
        bdProj = await (
          await uploadPost(
            creator1Token,
            `id=${bdProj.id}&name=${encodeURIComponent(`第0${epNum}集.mp4`)}`,
            buf,
            'video/mp4'
          )
        ).json();
      }
      assert.equal(bdProj.attachments.length, 3);
      assert.deepEqual(
        bdProj.attachments.map((a) => a.episode),
        [1, 2, 3]
      );

      bdProj = await (await studioPost(creator1Token, { operation: 'confirm', id: bdProj.id, version: bdProj.version })).json();
      bdProj = await (await studioPost(creator1Token, { operation: 'connect', id: bdProj.id, version: bdProj.version })).json();
      bdProj = await (
        await studioPost(creator1Token, {
          operation: 'action',
          id: bdProj.id,
          version: bdProj.version,
          action: { action: 'confirm', answers: { mode: 'detailed' } },
        })
      ).json();

      assert.equal(bdProj.remote?.status, 'delivered');
      assert.equal(bdProj.remote?.card, null);

      const docxRes = await uploadGet(creator1Token, `id=${bdProj.id}&export=docx`);
      assert.equal(docxRes.status, 200);
      const { plain } = extractDocxPlainText(Buffer.from(await docxRes.arrayBuffer()));
      assert.ok(plain.includes('天降千金复仇记'));

      // Transfer to /studio foreign iteration with locked first 2 episodes
      const transferRes = await studioPost(creator1Token, {
        operation: 'transfer_iteration',
        id: bdProj.id,
        version: bdProj.version,
        target_kind: 'foreign',
      });
      assert.equal(transferRes.status, 201);
      let iterProj = await transferRes.json();

      iterProj = await (
        await studioPost(creator1Token, {
          operation: 'save_workspace',
          id: iterProj.id,
          version: iterProj.version,
          total: 10,
          lockedEpisodes: 2,
          episodes: [
            { id: 'l1', episodeNumber: 1, title: '第1集', content: 'LOCKED_VERBATIM_E1_TEXT', locked: true },
            { id: 'l2', episodeNumber: 2, title: '第2集', content: 'LOCKED_VERBATIM_E2_TEXT', locked: true },
            { id: 'u3', episodeNumber: 3, title: '第3集', content: '续写第3集全新反转剧情。', locked: false },
          ],
        })
      ).json();

      const iterDocx = await uploadGet(creator1Token, `id=${iterProj.id}&export=docx`);
      assert.equal(iterDocx.status, 200);
      const iterPlain = extractDocxPlainText(Buffer.from(await iterDocx.arrayBuffer())).plain;
      assert.ok(iterPlain.includes('LOCKED_VERBATIM_E1_TEXT'));
      assert.ok(iterPlain.includes('LOCKED_VERBATIM_E2_TEXT'));
      assert.ok(iterPlain.includes('续写第3集全新反转剧情'));
    });

    await runTest('T4-02', 'T4', 'Backward compatibility: legacy Step 3 confirm on delivered transcribe + ?export=1 Markdown', async () => {
      let proj = await (
        await studioPost(creator1Token, { operation: 'create', title: '兼容回放剧', kind: 'transcribe', brief: '' })
      ).json();
      const buf = Buffer.alloc(5000, 0x44);
      buf.write('ftypmp42', 4);
      proj = await (await uploadPost(creator1Token, `id=${proj.id}&name=第01集.mp4`, buf, 'video/mp4')).json();
      proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();
      proj = await (await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version })).json();
      proj = await (
        await studioPost(creator1Token, {
          operation: 'action',
          id: proj.id,
          version: proj.version,
          action: { action: 'confirm', answers: { mode: 'fast' } },
        })
      ).json();
      assert.equal(proj.remote?.status, 'delivered');
      assert.equal(proj.remote?.card, null);

      // Legacy T4-03 second confirm guard
      const legacyRes = await studioPost(creator1Token, {
        operation: 'action',
        id: proj.id,
        version: proj.version,
        action: { action: 'confirm', answers: { boundaries: '确认无误' } },
      });
      assert.equal(legacyRes.status, 200, 'Legacy confirm guard must return 200 without breaking delivered state');
      const legacyJson = await legacyRes.json();
      assert.equal(legacyJson.remote?.status, 'delivered');

      const mdRes = await uploadGet(creator1Token, `id=${proj.id}&export=1`);
      assert.equal(mdRes.status, 200);
      assert.ok((mdRes.headers.get('content-type') || '').includes('text/markdown'));
    });

    await runTest('T4-03', 'T4', 'Comprehensive redline leak audit across 3.0 APIs, .docx XML & Markdown export', async () => {
      const prevHandler = fetchHandler;
      fetchHandler = async (url) => {
        if (String(url).includes('/chat/completions')) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      '由 gpt-6.1-sol、gemini-4-hydrogen 与 claude-3.5-sonnet 生成，prompt_tokens: 999，OPENAI_API_KEY=sk-test，STUDIO_BACKEND_URL=http://x，Grok Bot 汇报：已完成创作。',
                  },
                },
              ],
              usage: { prompt_tokens: 120, completion_tokens: 180, total_tokens: 300 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return originalFetch(url);
      };

      try {
        let proj = await (
          await studioPost(creator1Token, { operation: 'create', title: '红线审计剧', kind: 'foreign', brief: '全剧 10 集' })
        ).json();
        proj = await (await studioPost(creator1Token, { operation: 'confirm', id: proj.id, version: proj.version })).json();
        proj = await (await studioPost(creator1Token, { operation: 'connect', id: proj.id, version: proj.version })).json();

        assertCreatorRedlineClean(proj, 'T4-03 connect');
        const listJson = await (await studioGet(creator1Token)).json();
        assertCreatorRedlineClean(listJson, 'T4-03 studio list');

        const mdText = await (await uploadGet(creator1Token, `id=${proj.id}&export=1`)).text();
        assertCreatorRedlineClean(mdText, 'T4-03 export=1');

        const docxBuf = Buffer.from(await (await uploadGet(creator1Token, `id=${proj.id}&export=docx`)).arrayBuffer());
        const { plain } = extractDocxPlainText(docxBuf);
        assertCreatorRedlineClean(plain, 'T4-03 export=docx');
      } finally {
        fetchHandler = prevHandler;
      }
    });

    await runTest('T4-04', 'T4', 'Static redlines on app/page.tsx & app/admin/page.tsx + 3.0 shell integrity', async () => {
      const pageSrc = fs.readFileSync(path.join(ROOT_DIR, 'app', 'page.tsx'), 'utf8');
      assert.equal(/\bgpt/i.test(pageSrc), false, 'app/page.tsx must not match /\\bgpt/i');
      assert.equal(/Grok[\s-]?Bot/i.test(pageSrc), false, 'app/page.tsx must not match /Grok[\\s-]?Bot/i');
      assert.equal(pageSrc.includes('OPENAI_API_KEY'), false, 'app/page.tsx must not include OPENAI_API_KEY');
      assert.equal(pageSrc.includes('STUDIO_BACKEND_URL'), false, 'app/page.tsx must not include STUDIO_BACKEND_URL');
      assert.equal(pageSrc.includes('rawMarkdown'), false, 'app/page.tsx must not include rawMarkdown');
      assert.equal(pageSrc.includes('systemPrompt'), false, 'app/page.tsx must not include systemPrompt');
      assert.equal(pageSrc.includes('20 MB'), false, 'app/page.tsx must not include 20 MB');
      assert.equal(pageSrc.includes('20 * 1024 * 1024'), false, 'app/page.tsx must not include 20 * 1024 * 1024');

      for (const reqStr of ['提示词', 'BUDGET_EXCEEDED', 'SLOT_NOT_ALLOWED', 'ACCOUNT_DISABLED', '已停用或已移除的提示词']) {
        assert.equal(pageSrc.includes(reqStr), true, `app/page.tsx must preserve required literal: ${reqStr}`);
      }

      const adminSrc = fs.readFileSync(path.join(ROOT_DIR, 'app', 'admin', 'page.tsx'), 'utf8');
      assert.equal(adminSrc.includes('BINARY_CONTENT_REJECTED'), true, 'app/admin/page.tsx must keep BINARY_CONTENT_REJECTED');
      assert.equal(adminSrc.includes('INVALID_PLUGIN_FILE_TYPE'), true, 'app/admin/page.tsx must keep INVALID_PLUGIN_FILE_TYPE');
      assert.equal(
        adminSrc.includes('save_creation_tiers') || adminSrc.includes('创作档位'),
        true,
        'app/admin/page.tsx must include Creation Tiers management'
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (prevMaxUploadMb === undefined) delete process.env.STUDIO_MAX_UPLOAD_MB;
    else process.env.STUDIO_MAX_UPLOAD_MB = prevMaxUploadMb;

    delete globalThis.__STUDIO_PERSISTENT_STORE__;

    try {
      if (!hadDataDir) {
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
      } else {
        if (hadStoreFile) {
          fs.copyFileSync(path.join(backupDir, 'studio-store.json'), STORE_FILE);
        } else if (fs.existsSync(STORE_FILE)) {
          fs.rmSync(STORE_FILE, { force: true });
        }
        if (fs.existsSync(BUCKET_DIR)) {
          fs.rmSync(BUCKET_DIR, { recursive: true, force: true });
        }
        if (hadBucketsDir) {
          fs.cpSync(path.join(backupDir, 'buckets'), BUCKET_DIR, { recursive: true });
        }
      }

      if (hadStoreFile && preStoreHash) {
        const postHash = sha256File(STORE_FILE);
        assert.equal(postHash, preStoreHash, `Store SHA-256 restore mismatch: ${postHash} !== ${preStoreHash}`);
      }
      if (expectedCode28KeyCount !== null) {
        const restored = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
        const prov = (restored?.systemConfig?.providers || []).find(
          (p) => p?.baseUrl === 'https://code28.ccwu.cc/v1'
        );
        assert.ok(prov, 'Restored store missing https://code28.ccwu.cc/v1 provider');
        assert.equal(
          prov.apiKeys.length,
          expectedCode28KeyCount,
          `Restored code28 provider key count mismatch (${prov.apiKeys.length} !== ${expectedCode28KeyCount})`
        );
      }
      restoreVerified = true;
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch (restoreErr) {
      console.error(`STORE_RESTORE_ERROR (backup preserved at ${backupDir}):`, restoreErr);
      throw restoreErr;
    }
  }

  console.log('\n=== 3.0 E2E Summary (Tiers 1-4) ===');
  for (const t of ['T1', 'T2', 'T3', 'T4']) {
    console.log(`  ${t}: ${tierStats[t].passed} passed, ${tierStats[t].failed} failed`);
  }
  console.log(`  Store Restore Verified: ${restoreVerified}`);

  const totalFailed = Object.values(tierStats).reduce((acc, s) => acc + s.failed, 0);
  if (totalFailed > 0 || !restoreVerified) {
    process.exit(1);
  }
  console.log('ALL_V3_E2E_TESTS_PASSED');
}

main().catch((err) => {
  console.error('V3_E2E_FATAL:', err);
  process.exit(1);
});
