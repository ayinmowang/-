import { register } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

process.env.STUDIO_LLM_FIXTURE = '1';
process.env.STEP2_REAL_API = process.env.STEP2_REAL_API === '1' ? '1' : '0';

// Extension resolve hook (same as tests/v3-e2e.mjs; no compiler package)
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


const authRoute = await import('../app/api/auth/route.ts');
const studioRoute = await import('../app/api/studio/route.ts');

// ---- Backup & Integrity Helpers ----
const DATA_DIR = path.join(ROOT, '.data');
const STORE_FILE = path.join(DATA_DIR, 'studio-store.json');
const BUCKETS_DIR = path.join(DATA_DIR, 'buckets');

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return 'MISSING';
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256Tree(dirPath) {
  if (!fs.existsSync(dirPath)) return 'MISSING_DIR';
  const hash = crypto.createHash('sha256');
  const entries = [];
  function walk(curr) {
    const items = fs.readdirSync(curr, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const item of items) {
      const full = path.join(curr, item.name);
      const rel = path.relative(dirPath, full);
      if (item.isDirectory()) {
        entries.push(`D:${rel}`);
        walk(full);
      } else if (item.isFile()) {
        entries.push(`F:${rel}:${sha256File(full)}`);
      }
    }
  }
  walk(dirPath);
  hash.update(entries.join('\n'));
  return hash.digest('hex');
}

const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-step2-writeback-bak-'));
const backupStoreFile = path.join(backupDir, 'studio-store.json');
const backupBucketsDir = path.join(backupDir, 'buckets');

const origStoreExisted = fs.existsSync(STORE_FILE);
const origBucketsExisted = fs.existsSync(BUCKETS_DIR);

if (origStoreExisted) {
  fs.copyFileSync(STORE_FILE, backupStoreFile);
}
if (origBucketsExisted) {
  fs.cpSync(BUCKETS_DIR, backupBucketsDir, { recursive: true });
}

const origStoreHash = origStoreExisted ? sha256File(backupStoreFile) : 'MISSING';
const origBucketsHash = origBucketsExisted ? sha256Tree(backupBucketsDir) : 'MISSING_DIR';

console.log(`[BACKUP] dir=${backupDir}`);
console.log(`[BACKUP] studio-store.json sha256=${origStoreHash}`);
console.log(`[BACKUP] buckets sha256=${origBucketsHash}`);

function restoreFromBackupAndVerify() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (origStoreExisted) {
    fs.copyFileSync(backupStoreFile, STORE_FILE);
  } else if (fs.existsSync(STORE_FILE)) {
    fs.rmSync(STORE_FILE, { force: true });
  }

  if (fs.existsSync(BUCKETS_DIR)) {
    fs.rmSync(BUCKETS_DIR, { recursive: true, force: true });
  }
  if (origBucketsExisted) {
    fs.cpSync(backupBucketsDir, BUCKETS_DIR, { recursive: true });
  }

  const restoredStoreHash = origStoreExisted ? sha256File(STORE_FILE) : 'MISSING';
  const restoredBucketsHash = origBucketsExisted ? sha256Tree(BUCKETS_DIR) : 'MISSING_DIR';

  console.log(`[RESTORE] studio-store.json sha256=${restoredStoreHash}`);
  console.log(`[RESTORE] buckets sha256=${restoredBucketsHash}`);

  assert.equal(restoredStoreHash, origStoreHash, 'Restored studio-store.json sha256 mismatch');
  assert.equal(restoredBucketsHash, origBucketsHash, 'Restored buckets sha256 mismatch');
  console.log(`[RESTORE] Verified OK. Backup preserved at ${backupDir}`);
}

// ---- Fetch Mock for LLM Endpoints ----
const originalFetch = globalThis.fetch;
const mockState = {
  delayMs: 0,
  failNext: false,
  emptyNext: false,
  callCount: 0,
};

function buildMockLlmPayload(promptText) {
  const lower = String(promptText || '').toLowerCase();
  if (lower.includes('character') || promptText.includes('人物') || promptText.includes('角色')) {
    return JSON.stringify({
      characters: [
        { name: '沈夜', role: '主角', trait: '冷静果决的调查员', arc: '从怀疑到破局' },
        { name: '林岚', role: '搭档', trait: '擅长古籍与密码破译', arc: '守护真相' },
      ],
      summary: '新增角色小传：沈夜、林岚',
    });
  }
  if (lower.includes('world') || promptText.includes('世界观') || promptText.includes('设定')) {
    return JSON.stringify({
      world: [
        { title: '雾港钟楼', category: '地标', detail: '每逢子夜钟声响起，时间流速出现三分钟偏差。' },
      ],
      summary: '新增世界观设定：雾港钟楼',
    });
  }
  if (lower.includes('hook') || promptText.includes('钩子') || promptText.includes('悬念')) {
    return '【集末强钩子】电报机突然吐出一张没有发报人编号的纸带，上面印着第3集主角自己的签名。';
  }
  if (lower.includes('outline') || promptText.includes('大纲') || promptText.includes('分集')) {
    return JSON.stringify({
      outline: [
        { episode: 3, title: '第三集：子夜回响', beat: '沈夜在雾港钟楼发现失踪案线索，触发时间偏差。' },
      ],
      summary: '生成大纲节点：第三集：子夜回响',
    });
  }
  return '第3集正文：夜雨倾盆，沈夜推开雾港档案室的铁门，桌上的怀表指针正逆向旋转，墙角暗格里露出一份尘封十年的实验记录。';
}

globalThis.fetch = async function mockedFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url || '';
  const isLlmCall =
    url.includes('chat/completions') ||
    url.includes('generativelanguage');

  if (!isLlmCall) {
    if (originalFetch) return originalFetch(input, init);
    throw new Error(`Unexpected unmocked fetch: ${url}`);
  }

  if (process.env.STEP2_REAL_API === '1' && originalFetch) {
    return originalFetch(input, init);
  }

  mockState.callCount += 1;

  if (mockState.delayMs > 0) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, mockState.delayMs);
      if (init?.signal) {
        init.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }
    });
  }

  if (mockState.failNext) {
    mockState.failNext = false;
    return new Response(JSON.stringify({ error: { message: 'Simulated upstream LLM failure' } }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  let rawBody = '';
  if (typeof init?.body === 'string') {
    rawBody = init.body;
  }
  const contentText = mockState.emptyNext ? '' : buildMockLlmPayload(rawBody);
  mockState.emptyNext = false;

  if (url.includes('generativelanguage')) {
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: contentText }],
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({
      id: `chatcmpl-mock-${Date.now()}`,
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: contentText },
          finish_reason: 'stop',
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

// ---- Seed Extraction from tests/v3-e2e.mjs (Never log secrets; never read store) ----
function extractSeeds() {
  const e2ePath = path.join(ROOT, 'tests', 'v3-e2e.mjs');
  const source = fs.readFileSync(e2ePath, 'utf8');
  const matches = [...source.matchAll(/loginKey\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.ok(matches.length >= 2, 'Expected at least 2 loginKey(...) entries in tests/v3-e2e.mjs');
  const adminKey = matches.find((k) => /admin/i.test(k));
  const creatorKey = matches.find((k) => k !== adminKey && !/admin/i.test(k));
  assert.ok(adminKey, 'Expected an admin seed key in tests/v3-e2e.mjs');
  assert.ok(creatorKey, 'Expected a creator seed key in tests/v3-e2e.mjs');
  return { adminKey, creatorKey };
}

let authToken = '';

function buildHeaders(withAuth = true, extra = {}) {
  const headers = {
    'content-type': 'application/json',
    ...extra,
  };
  if (withAuth && authToken) {
    headers['x-studio-token'] = authToken;
  }
  return headers;
}

async function loginKey(key) {
  const res = await authRoute.POST(
    new Request('http://127.0.0.1/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login_key', key }),
    })
  );
  assert.equal(res.status, 200, `Expected 200 on login_key, got ${res.status}`);
  const data = await res.json();
  const token = data && data.token;
  assert.ok(token && typeof token === 'string', 'Auth response missing token');
  return token;
}

async function loginAdmin() {
  const { adminKey } = extractSeeds();
  authToken = await loginKey(adminKey);
}

async function studioGet(params = {}, withAuth = true) {
  const url = new URL('http://localhost/api/studio');
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const req = new Request(url.toString(), {
    method: 'GET',
    headers: buildHeaders(withAuth),
  });
  const res = await studioRoute.GET(req);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-json
  }
  return { status: res.status, headers: res.headers, text, json };
}

async function studioPost(payload, options = {}) {
  const { withAuth = true, signal, rawStream = false } = options;
  const req = new Request('http://localhost/api/studio', {
    method: 'POST',
    headers: buildHeaders(withAuth),
    body: JSON.stringify(payload),
    signal,
  });
  const res = await studioRoute.POST(req);
  if (rawStream) {
    return res;
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-json
  }
  return { status: res.status, headers: res.headers, text, json };
}

function unwrapProject(respJson) {
  return respJson?.project || respJson?.data?.project || respJson?.data || respJson;
}

function getVersion(proj) {
  return proj?.version ?? proj?.rev ?? 0;
}

function getEpisodes(proj) {
  return proj?.episodes || proj?.script?.episodes || proj?.chapters || [];
}

function getEpisodeByNum(proj, epNum) {
  const eps = getEpisodes(proj);
  return eps.find((e) => Number(e.episodeNumber ?? e.number ?? e.index ?? e.ep) === epNum) || eps[epNum - 1];
}

function getEpisodeText(ep) {
  if (!ep) return '';
  const body = ep.body ?? '';
  const content = ep.content ?? '';
  return body || content;
}

function getOutlineNodes(proj) {
  return proj?.outlineNodes || proj?.outline?.nodes || proj?.outline || [];
}

function getCharacterNodes(proj) {
  return proj?.characterNodes || proj?.characters?.nodes || proj?.characters || [];
}

function getWorldNodes(proj) {
  return proj?.worldNodes || proj?.world?.nodes || proj?.world || [];
}

function fingerprintProject(proj) {
  const canonical = {
    executionMode: proj?.executionMode,
    lockedEpisodes: proj?.lockedEpisodes,
    outlineNodes: getOutlineNodes(proj),
    characterNodes: getCharacterNodes(proj),
    worldNodes: getWorldNodes(proj),
    episodes: getEpisodes(proj).map((e) => ({
      id: e.id,
      num: e.episodeNumber ?? e.number ?? e.index,
      locked: Boolean(e.locked),
      body: e.body ?? '',
      content: e.content ?? '',
    })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function parseSseEvents(rawText) {
  const events = [];
  const blocks = rawText.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    let eventName = 'message';
    const dataLines = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }
    const rawData = dataLines.join('\n');
    let parsed = null;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      // plain string
    }
    events.push({ event: eventName, raw: rawData, data: parsed });
  }
  return events;
}

// ---- Test Execution ----
let passed = 0;
async function runCase(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err);
    throw err;
  }
}

try {
  await loginAdmin();

  let projectId = '';
  let currentVersion = 0;

  // Create project with brief locking first 2 episodes out of 10
  await runCase('S2-01: Create project with brief "全剧 10 集，前 2 集已锁定"', async () => {
    const createRes = await studioPost({
      operation: 'create',
      title: `Step2回归测试-${Date.now()}`,
      kind: 'foreign',
      brief: '全剧 10 集，前 2 集已锁定。',
      executionMode: 'auto',
    });
    assert.ok(
      createRes.status === 200 || createRes.status === 201,
      `Expected create status 201 or 200, got ${createRes.status}: ${createRes.text}`
    );
    const proj = unwrapProject(createRes.json);
    projectId = proj?.id || createRes.json?.id;
    assert.ok(projectId, 'Project ID must be returned on create');
    currentVersion = getVersion(proj);

    const seedRes = await studioPost({
      operation: 'save_workspace',
      id: projectId,
      version: currentVersion,
      episodes: [
        { id: 'ep-1', episodeNumber: 1, title: '第1集', content: 'IMMUTABLE_1', locked: true },
        { id: 'ep-2', episodeNumber: 2, title: '第2集', content: 'IMMUTABLE_2', locked: true },
        { id: 'ep-3', episodeNumber: 3, title: '第3集', content: 'OPEN_3', locked: false },
      ],
    });
    assert.equal(seedRes.status, 200, `save_workspace failed: ${seedRes.text}`);
    const loaded = unwrapProject(seedRes.json) || unwrapProject((await studioGet({ id: projectId })).json);
    currentVersion = getVersion(loaded);
    assert.equal(loaded.lockedEpisodes, 2, 'lockedEpisodes should be 2');
    const ep1 = getEpisodeByNum(loaded, 1);
    const ep2 = getEpisodeByNum(loaded, 2);
    const ep3 = getEpisodeByNum(loaded, 3);
    assert.ok(ep1 && ep2 && ep3, 'Episodes 1-3 must exist');
    assert.equal(getEpisodeText(ep1), 'IMMUTABLE_1');
    assert.equal(getEpisodeText(ep2), 'IMMUTABLE_2');
    assert.equal(getEpisodeText(ep3), 'OPEN_3');
  });

  // Verify initial lock state on ep1/ep2 and client unlock prohibition
  await runCase('S2-02: Front-N lock enforcement & forbidden unlock on ep1', async () => {
    const beforeGet = await studioGet({ id: projectId });
    const beforeProj = unwrapProject(beforeGet.json);
    currentVersion = getVersion(beforeProj);
    const ep1Before = getEpisodeText(getEpisodeByNum(beforeProj, 1));
    const ep2Before = getEpisodeText(getEpisodeByNum(beforeProj, 2));

    // Attempt toggle_episode_lock locked:false on episode 1 -> must 403 EPISODE_LOCKED
    const unlockRes = await studioPost({
      operation: 'toggle_episode_lock',
      id: projectId,
      version: currentVersion,
      episodeNumber: 1,
      episodeIndex: 0,
      locked: false,
    });
    assert.equal(unlockRes.status, 403, `Expected 403 when unlocking locked front episode, got ${unlockRes.status}`);
    assert.equal(
      unlockRes.json?.error,
      'EPISODE_LOCKED',
      `Expected EPISODE_LOCKED code, got ${unlockRes.text}`
    );

    // Attempt save_episode on ep1 -> must be rejected and body unchanged
    const saveEp1 = await studioPost({
      operation: 'save_episode',
      id: projectId,
      version: currentVersion,
      episodeNumber: 1,
      episodeIndex: 0,
      body: '非法篡改第1集正文',
      content: '非法篡改第1集正文',
    });
    assert.ok(saveEp1.status === 403 || saveEp1.status === 409 || saveEp1.status === 400);

    // Attempt ai_apply_writeback on ep2 -> must be rejected and body unchanged
    const wbEp2 = await studioPost({
      operation: 'ai_apply_writeback',
      id: projectId,
      version: currentVersion,
      target: 'episode',
      episodeNumber: 2,
      episodeIndex: 1,
      executionMode: 'auto',
      text: '非法AI写回第2集',
      content: '非法AI写回第2集',
    });
    assert.ok(wbEp2.status === 403 || wbEp2.status === 409 || wbEp2.status === 400);

    // Attempt director_generate targeting ep1 & hook on ep2 -> must not modify ep1/ep2
    await studioPost({
      operation: 'director_generate',
      id: projectId,
      version: currentVersion,
      task: 'episode',
      episodeNumber: 1,
      episodeIndex: 0,
      client_id: 'client-lock-ep1',
    });
    const midProj = unwrapProject((await studioGet({ id: projectId })).json);
    currentVersion = getVersion(midProj);

    await studioPost({
      operation: 'director_generate',
      id: projectId,
      version: currentVersion,
      task: 'hook',
      episodeNumber: 2,
      episodeIndex: 1,
      client_id: 'client-lock-ep2-hook',
    });

    const afterProj = unwrapProject((await studioGet({ id: projectId })).json);
    currentVersion = getVersion(afterProj);
    assert.equal(getEpisodeText(getEpisodeByNum(afterProj, 1)), ep1Before, 'Ep1 text must remain unchanged');
    assert.equal(getEpisodeText(getEpisodeByNum(afterProj, 2)), ep2Before, 'Ep2 text must remain unchanged');

    // Episode 3 must be writable
    const saveEp3 = await studioPost({
      operation: 'save_episode',
      id: projectId,
      version: currentVersion,
      episodeNumber: 3,
      episodeIndex: 2,
      body: '第3集初始可写验证正文',
      content: '第3集初始可写验证正文',
    });
    assert.ok(saveEp3.status === 200 || saveEp3.status === 201, `Ep3 should be writable, got ${saveEp3.status}`);
    const ep3Proj = unwrapProject((await studioGet({ id: projectId })).json);
    currentVersion = getVersion(ep3Proj);
    const ep3Obj = getEpisodeByNum(ep3Proj, 3);
    assert.equal(ep3Obj.body, '第3集初始可写验证正文');
    assert.equal(ep3Obj.content, '第3集初始可写验证正文');
  });

  // Auto mode director_generate for all 5 tasks: outline, characters, world, hook, episode
  await runCase('S2-03: Auto mode director_generate 5 tasks writeback & body===content', async () => {
    const modeRes = await studioPost({
      operation: 'set_execution',
      id: projectId,
      version: currentVersion,
      executionMode: 'auto',
      mode: 'auto',
    });
    assert.ok(modeRes.status === 200 || modeRes.status === 201);
    currentVersion = getVersion(unwrapProject((await studioGet({ id: projectId })).json));

    const tasks = [
      { task: 'outline', client_id: 'auto-task-outline' },
      { task: 'characters', client_id: 'auto-task-characters' },
      { task: 'world', client_id: 'auto-task-world' },
      { task: 'episode', episodeNumber: 3, episodeIndex: 2, client_id: 'auto-task-episode' },
      { task: 'hook', episodeNumber: 3, episodeIndex: 2, client_id: 'auto-task-hook' },
    ];

    for (const item of tasks) {
      const res = await studioPost({
        operation: 'director_generate',
        id: projectId,
        version: currentVersion,
        executionMode: 'auto',
        ...item,
      });
      assert.ok(res.status === 200 || res.status === 201, `Task ${item.task} failed: ${res.status} ${res.text}`);
      const latest = unwrapProject((await studioGet({ id: projectId })).json);
      currentVersion = getVersion(latest);
    }

    const finalProj = unwrapProject((await studioGet({ id: projectId })).json);
    assert.ok(getOutlineNodes(finalProj).length > 0, 'outlineNodes must be populated');
    assert.ok(getCharacterNodes(finalProj).length > 0, 'characterNodes must be populated');
    assert.ok(getWorldNodes(finalProj).length > 0, 'worldNodes must be populated');

    const ep3 = getEpisodeByNum(finalProj, 3);
    assert.ok(ep3, 'Episode 3 must exist');
    assert.equal(ep3.body, ep3.content, 'Episode 3 body and content must be identical');
    assert.ok(
      /挂卡|档案馆|林砚|第一场/.test(String(ep3.body || '')),
      'Episode 3 body must contain generated hook/episode fixture content'
    );
    assert.notEqual(String(ep3.body || '').trim(), 'OPEN_3');
    assert.notEqual(String(ep3.body || '').trim(), '第3集初始可写验证正文');
  });

  // Plan mode read-only enforcement
  await runCase('S2-04: Plan mode rejects ai_apply_writeback (403 PLAN_MODE_READ_ONLY) & keeps assets immutable', async () => {
    const setPlan = await studioPost({
      operation: 'set_execution',
      id: projectId,
      version: currentVersion,
      executionMode: 'plan',
      mode: 'plan',
    });
    assert.ok(setPlan.status === 200 || setPlan.status === 201);

    const beforeProj = unwrapProject((await studioGet({ id: projectId })).json);
    currentVersion = getVersion(beforeProj);
    const beforeFp = fingerprintProject(beforeProj);

    // Even if client passes executionMode: 'auto' in payload, server executionMode is 'plan' -> 403 PLAN_MODE_READ_ONLY
    const wbRes = await studioPost({
      operation: 'ai_apply_writeback',
      id: projectId,
      version: currentVersion,
      executionMode: 'auto',
      target: 'episode',
      episodeNumber: 3,
      episodeIndex: 2,
      text: '计划模式下尝试强行写回',
      content: '计划模式下尝试强行写回',
    });
    assert.equal(wbRes.status, 403, `Expected 403 in plan mode, got ${wbRes.status}`);
    assert.equal(
      wbRes.json?.error,
      'PLAN_MODE_READ_ONLY',
      `Expected PLAN_MODE_READ_ONLY, got ${wbRes.text}`
    );

    // director_generate in plan mode should succeed as proposal without mutating assets
    const genPlanRes = await studioPost({
      operation: 'director_generate',
      id: projectId,
      version: currentVersion,
      task: 'outline',
      client_id: 'plan-mode-gen-1',
    });
    assert.ok(genPlanRes.status === 200 || genPlanRes.status === 201);

    const afterProj = unwrapProject((await studioGet({ id: projectId })).json);
    currentVersion = getVersion(afterProj);
    const afterFp = fingerprintProject(afterProj);
    assert.equal(afterFp, beforeFp, 'Project assets must remain verbatim identical in plan mode');

    // Switch back to auto mode for subsequent tests
    await studioPost({
      operation: 'set_execution',
      id: projectId,
      version: currentVersion,
      executionMode: 'auto',
      mode: 'auto',
    });
    currentVersion = getVersion(unwrapProject((await studioGet({ id: projectId })).json));
  });

  // Concurrency 409 PROJECT_BUSY with two different client_ids
  await runCase('S2-05: Concurrent director_generate with different client_ids returns 409 PROJECT_BUSY', async () => {
    mockState.delayMs = 180;
    const prevDelay = process.env.STUDIO_LLM_FIXTURE_DELAY_MS;
    process.env.STUDIO_LLM_FIXTURE_DELAY_MS = '180';
    try {
      const p1 = studioPost({
        operation: 'director_generate',
        id: projectId,
        version: currentVersion,
        task: 'world',
        client_id: 'concurrent-client-A',
      });
      // Slight stagger so client-A acquires project lock first
      await new Promise((r) => setTimeout(r, 25));
      const p2 = studioPost({
        operation: 'director_generate',
        id: projectId,
        version: currentVersion,
        task: 'characters',
        client_id: 'concurrent-client-B',
      });

      const [res1, res2] = await Promise.all([p1, p2]);
      assert.ok(res1.status === 200 || res1.status === 201, `First request should succeed, got ${res1.status}`);
      assert.equal(res2.status, 409, `Second concurrent request must return 409, got ${res2.status}`);
      assert.equal(
        res2.json?.error,
        'PROJECT_BUSY',
        `Expected PROJECT_BUSY, got ${res2.text}`
      );
    } finally {
      mockState.delayMs = 0;
      if (prevDelay === undefined) delete process.env.STUDIO_LLM_FIXTURE_DELAY_MS;
      else process.env.STUDIO_LLM_FIXTURE_DELAY_MS = prevDelay;
    }
    currentVersion = getVersion(unwrapProject((await studioGet({ id: projectId })).json));
  });

  // Idempotency with same client_id
  await runCase('S2-06: Idempotent director_generate with same client_id produces zero duplicate nodes & zero diff', async () => {
    const clientId = 'idempotent-client-999';
    const firstRes = await studioPost({
      operation: 'director_generate',
      id: projectId,
      version: currentVersion,
      task: 'characters',
      client_id: clientId,
    });
    assert.ok(firstRes.status === 200 || firstRes.status === 201);

    const afterFirstProj = unwrapProject((await studioGet({ id: projectId })).json);
    currentVersion = getVersion(afterFirstProj);
    const nodesCount1 = getCharacterNodes(afterFirstProj).length;
    const ep3Body1 = getEpisodeText(getEpisodeByNum(afterFirstProj, 3));
    const fp1 = fingerprintProject(afterFirstProj);

    const secondRes = await studioPost({
      operation: 'director_generate',
      id: projectId,
      version: currentVersion,
      task: 'characters',
      client_id: clientId,
    });
    assert.ok(secondRes.status === 200 || secondRes.status === 201);

    const afterSecondProj = unwrapProject((await studioGet({ id: projectId })).json);
    currentVersion = getVersion(afterSecondProj);
    const nodesCount2 = getCharacterNodes(afterSecondProj).length;
    const ep3Body2 = getEpisodeText(getEpisodeByNum(afterSecondProj, 3));
    const fp2 = fingerprintProject(afterSecondProj);

    assert.equal(nodesCount2, nodesCount1, 'Duplicate character nodes must not be added on idempotent retry');
    assert.equal(ep3Body2.length - ep3Body1.length, 0, 'Body diff must be 0');
    assert.equal(fp2, fp1, 'Project fingerprint must be unchanged on idempotent retry');
  });

  // Upstream failure & empty output do not write partial state
  await runCase('S2-07: LLM error and empty text leave project fingerprint unchanged', async () => {
    const beforeProj = unwrapProject((await studioGet({ id: projectId })).json);
    currentVersion = getVersion(beforeProj);
    const beforeFp = fingerprintProject(beforeProj);

    // 1) Upstream failure
    mockState.failNext = true;
    const prevForce = process.env.STUDIO_LLM_FIXTURE_FORCE;
    process.env.STUDIO_LLM_FIXTURE_FORCE = 'fail';
    const failRes = await studioPost({
      operation: 'director_generate',
      id: projectId,
      version: currentVersion,
      task: 'episode',
      episodeNumber: 4,
      episodeIndex: 3,
      client_id: 'fail-client-1',
    });
    assert.ok(failRes.status >= 400, `Expected error status on LLM failure, got ${failRes.status}`);

    const afterFailProj = unwrapProject((await studioGet({ id: projectId })).json);
    assert.equal(fingerprintProject(afterFailProj), beforeFp, 'Fingerprint must not change on LLM failure');

    process.env.STUDIO_LLM_FIXTURE_FORCE = 'empty';
    // 2) Empty text response
    mockState.emptyNext = true;
    const emptyRes = await studioPost({
      operation: 'director_generate',
      id: projectId,
      version: currentVersion,
      task: 'episode',
      episodeNumber: 4,
      episodeIndex: 3,
      client_id: 'empty-client-1',
    });
    assert.ok(emptyRes.status >= 400 || emptyRes.json?.ok === false || fingerprintProject(unwrapProject((await studioGet({ id: projectId })).json)) === beforeFp);

    const afterEmptyProj = unwrapProject((await studioGet({ id: projectId })).json);
    currentVersion = getVersion(afterEmptyProj);
    assert.equal(fingerprintProject(afterEmptyProj), beforeFp, 'Fingerprint must not change on empty LLM output');
    if (prevForce === undefined) delete process.env.STUDIO_LLM_FIXTURE_FORCE;
    else process.env.STUDIO_LLM_FIXTURE_FORCE = prevForce;
  });

  // SSE streaming in auto mode & plan mode + secret/URL/model sanitization
  await runCase('S2-08: SSE stages (auto vs plan), integer elapsedSec, and sanitized output', async () => {
    const forbiddenLeakPatterns = [
      /https?:\/\//i,
      /\bsk-(?:proj-|ant-|or-v1-)?[A-Za-z0-9_-]{16,}\b/,
      /AIza[0-9A-Za-z-_]{20,}/,
      /gpt-4|gpt-3\.5|gemini-1\.5|gemini-2\.0|claude-3/i,
      /OPENAI_API_KEY|GEMINI_API_KEY|API_KEY/i,
    ];

    // Auto mode SSE
    const autoSseRes = await studioPost(
      {
        operation: 'director_generate',
        id: projectId,
        version: currentVersion,
        task: 'episode',
        episodeNumber: 4,
        episodeIndex: 3,
        stream: true,
        client_id: 'sse-auto-client-1',
      },
      { rawStream: true }
    );
    assert.equal(autoSseRes.status, 200);
    const autoRaw = await autoSseRes.text();
    for (const re of forbiddenLeakPatterns) {
      assert.ok(!re.test(autoRaw), `SSE auto output leaked sensitive pattern ${re}`);
    }

    const autoEvents = parseSseEvents(autoRaw);
    const stageNames = autoEvents
      .map((e) => e.data?.stage || e.data?.phase || e.data?.status || e.raw)
      .filter(Boolean);
    const joinedStages = stageNames.join(' | ');

    const expectedAutoStages = ['思考中', '起稿中', '正在写入', '已写入完成'];
    let lastPos = -1;
    for (const st of expectedAutoStages) {
      const idx = joinedStages.indexOf(st);
      assert.ok(idx > lastPos, `Auto SSE missing or out-of-order stage "${st}" in: ${joinedStages}`);
      lastPos = idx;
    }

    for (const ev of autoEvents) {
      if (ev.data && typeof ev.data.elapsedSec !== 'undefined') {
        assert.ok(
          Number.isInteger(ev.data.elapsedSec),
          `elapsedSec must be integer, got ${ev.data.elapsedSec}`
        );
      }
    }

    currentVersion = getVersion(unwrapProject((await studioGet({ id: projectId })).json));

    // Switch to Plan mode and test SSE
    await studioPost({
      operation: 'set_execution',
      id: projectId,
      version: currentVersion,
      executionMode: 'plan',
      mode: 'plan',
    });
    currentVersion = getVersion(unwrapProject((await studioGet({ id: projectId })).json));

    const planSseRes = await studioPost(
      {
        operation: 'director_generate',
        id: projectId,
        version: currentVersion,
        task: 'outline',
        stream: true,
        client_id: 'sse-plan-client-1',
      },
      { rawStream: true }
    );
    assert.equal(planSseRes.status, 200);
    const planRaw = await planSseRes.text();
    for (const re of forbiddenLeakPatterns) {
      assert.ok(!re.test(planRaw), `SSE plan output leaked sensitive pattern ${re}`);
    }
    assert.ok(!planRaw.includes('正在写入'), 'Plan mode SSE must NOT include "正在写入"');

    // Restore auto mode
    await studioPost({
      operation: 'set_execution',
      id: projectId,
      version: currentVersion,
      executionMode: 'auto',
      mode: 'auto',
    });
    currentVersion = getVersion(unwrapProject((await studioGet({ id: projectId })).json));
  });

  // director_cancel preserves assets
  await runCase('S2-09: director_cancel leaves project assets unchanged', async () => {
    const beforeProj = unwrapProject((await studioGet({ id: projectId })).json);
    currentVersion = getVersion(beforeProj);
    const beforeFp = fingerprintProject(beforeProj);

    mockState.delayMs = 200;
    const cancelClientId = 'cancel-client-777';
    const prevDelay = process.env.STUDIO_LLM_FIXTURE_DELAY_MS;
    process.env.STUDIO_LLM_FIXTURE_DELAY_MS = '200';
    try {
      const genPromise = studioPost({
        operation: 'director_generate',
        id: projectId,
        version: currentVersion,
        task: 'world',
        client_id: cancelClientId,
      });

      await new Promise((r) => setTimeout(r, 25));

      const cancelRes = await studioPost({
        operation: 'director_cancel',
        id: projectId,
        version: currentVersion,
        client_id: cancelClientId,
      });
      assert.ok(cancelRes.status === 200 || cancelRes.status === 202 || cancelRes.status === 204);

      await genPromise.catch(() => null);
    } finally {
      mockState.delayMs = 0;
      if (prevDelay === undefined) delete process.env.STUDIO_LLM_FIXTURE_DELAY_MS;
      else process.env.STUDIO_LLM_FIXTURE_DELAY_MS = prevDelay;
    }

    const afterProj = unwrapProject((await studioGet({ id: projectId })).json);
    currentVersion = getVersion(afterProj);
    assert.equal(fingerprintProject(afterProj), beforeFp, 'Assets must remain unchanged after director_cancel');
  });

  // Unauthenticated write returns 401/403 and locked episodes remain intact
  await runCase('S2-10: Unauthenticated write returns 401/403 and locked episodes remain unchanged', async () => {
    const beforeProj = unwrapProject((await studioGet({ id: projectId })).json);
    currentVersion = getVersion(beforeProj);
    const ep1Before = getEpisodeText(getEpisodeByNum(beforeProj, 1));
    const beforeFp = fingerprintProject(beforeProj);

    const unauthRes = await studioPost(
      {
        operation: 'save_episode',
        id: projectId,
        version: currentVersion,
        episodeNumber: 1,
        episodeIndex: 0,
        body: '无token非法写入',
        content: '无token非法写入',
      },
      { withAuth: false }
    );
    assert.ok(
      unauthRes.status === 401 || unauthRes.status === 403,
      `Expected 401 or 403 without token, got ${unauthRes.status}`
    );

    const afterProj = unwrapProject((await studioGet({ id: projectId })).json);
    assert.equal(getEpisodeText(getEpisodeByNum(afterProj, 1)), ep1Before, 'Locked episode must remain unchanged');
    assert.equal(fingerprintProject(afterProj), beforeFp, 'Project fingerprint must remain unchanged');
  });

  console.log(`ALL ${passed} STEP2 WRITEBACK & LOCK TESTS PASSED`);
} finally {
  globalThis.fetch = originalFetch;
  restoreFromBackupAndVerify();
}
