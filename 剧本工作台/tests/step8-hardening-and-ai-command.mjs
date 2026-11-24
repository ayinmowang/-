#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const LOADER = `
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\\.[a-z0-9]+$/i.test(specifier) && context.parentURL?.startsWith('file:')) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    for (const ext of ['.ts', '.tsx', '.js', '.mjs']) {
      const candidate = path.resolve(parentDir, specifier + ext);
      if (fs.existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript;base64,${Buffer.from(LOADER).toString('base64')}`);

const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const origCwd = process.cwd();
const origFetch = globalThis.fetch;
const origDisableRl = process.env.STUDIO_DISABLE_RATE_LIMIT;
const origFixture = process.env.STUDIO_LLM_FIXTURE;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'step8-hardening-ai-'));

try {
  process.chdir(tmp);
  delete process.env.STUDIO_DISABLE_RATE_LIMIT;
  delete process.env.STUDIO_LLM_FIXTURE;
  delete globalThis.__STUDIO_PERSISTENT_STORE__;

  const server = await imp('lib/server.ts');
  const videoCompress = await imp('lib/video-compress.ts');
  const transcribeJobs = await imp('lib/transcribe-jobs.ts');
  const authRoute = await imp('app/api/auth/route.ts');
  const profileRoute = await imp('app/api/profile/route.ts');
  const adminRoute = await imp('app/api/admin/route.ts');
  const studioRoute = await imp('app/api/studio/route.ts');

  // =========================================================================
  // 1. pruneTranscodeCache: TTL + LRU cap + protectFile
  // =========================================================================
  const cacheDir = path.join(tmp, 'transcode-cache-test');
  fs.mkdirSync(cacheDir, { recursive: true });
  const nowSec = Date.now() / 1000;
  const fExpired = path.join(cacheDir, 'expired.mp4');
  const fOld = path.join(cacheDir, 'old.mp4');
  const fMid = path.join(cacheDir, 'mid.mp4');
  const fProtected = path.join(cacheDir, 'protected.mp4');
  fs.writeFileSync(fExpired, Buffer.alloc(1024, 1));
  fs.writeFileSync(fOld, Buffer.alloc(1024, 2));
  fs.writeFileSync(fMid, Buffer.alloc(1024, 3));
  fs.writeFileSync(fProtected, Buffer.alloc(1024, 4));
  fs.utimesSync(fExpired, nowSec - 48 * 3600, nowSec - 48 * 3600);
  fs.utimesSync(fOld, nowSec - 2 * 3600, nowSec - 2 * 3600);
  fs.utimesSync(fMid, nowSec - 600, nowSec - 600);
  fs.utimesSync(fProtected, nowSec - 72 * 3600, nowSec - 72 * 3600);

  const pruned = videoCompress.pruneTranscodeCache(cacheDir, fProtected, {
    maxBytes: 2200,
    ttlMs: 24 * 3600 * 1000,
  });
  assert.equal(fs.existsSync(fProtected), true, 'protectFile must never be evicted');
  assert.equal(fs.existsSync(fExpired), false, 'TTL-expired cache file must be evicted');
  assert.equal(fs.existsSync(fOld), false, 'oldest non-protected file must be evicted to satisfy maxBytes');
  assert.equal(fs.existsSync(fMid), true, 'newest non-protected file fitting in cap must survive');
  assert.equal(pruned.removed, 2, 'should report 2 removed files');
  assert.equal(pruned.freedBytes, 2048, 'should report 2048 freed bytes');

  // =========================================================================
  // 2. Password scrypt hashing, legacy plaintext auto-upgrade, & rate limit
  // =========================================================================
  const h1 = server.hashPassword('MySecret123!');
  const h2 = server.hashPassword('MySecret123!');
  assert.ok(h1.startsWith('scrypt$'), 'hashPassword must use scrypt$ format');
  assert.notEqual(h1, h2, 'salted hashes of same password must differ');
  const v1 = server.verifyPassword('MySecret123!', h1);
  assert.equal(v1.ok, true);
  assert.equal(v1.needsUpgrade, false);
  const vBad = server.verifyPassword('WrongPass', h1);
  assert.equal(vBad.ok, false);
  const vLegacy = server.verifyPassword('legacy-plain', 'legacy-plain');
  assert.equal(vLegacy.ok, true);
  assert.equal(vLegacy.needsUpgrade, true);

  const store = server.getStore();
  const writerAcc = store.accounts.find((a) => a.username === 'writer01');
  assert.ok(writerAcc, 'writer01 default account must exist');
  const legacyPlain = writerAcc.password;
  assert.ok(!legacyPlain.startsWith('scrypt$'), 'initial seeded password is legacy plaintext');

  // Legacy plaintext login succeeds and upgrades stored password to scrypt$
  const loginRes = await authRoute.POST(
    new Request('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
      body: JSON.stringify({ action: 'login', username: 'writer01', password: legacyPlain }),
    })
  );
  assert.equal(loginRes.status, 200, 'legacy plaintext login must succeed');
  const loginJson = await loginRes.json();
  assert.ok(loginJson.token);
  const upgradedWriter = server.getStore().accounts.find((a) => a.username === 'writer01');
  assert.ok(upgradedWriter.password.startsWith('scrypt$'), 'password must auto-upgrade to scrypt$ after login');

  // Subsequent login against scrypt$ hash works
  const loginRes2 = await authRoute.POST(
    new Request('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
      body: JSON.stringify({ action: 'login', username: 'writer01', password: legacyPlain }),
    })
  );
  assert.equal(loginRes2.status, 200, 'second login against upgraded scrypt$ hash must succeed');

  // /api/profile update_password verifies current scrypt$ password and hashes new password
  const profRes = await profileRoute.POST(
    new Request('http://localhost/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-studio-token': loginJson.token },
      body: JSON.stringify({ currentPassword: legacyPlain, newPassword: 'NewStrongPassword88' }),
    })
  );
  assert.equal(profRes.status, 200, 'profile password update must succeed');
  const afterProf = server.getStore().accounts.find((a) => a.username === 'writer01');
  assert.ok(afterProf.password.startsWith('scrypt$'), 'updated profile password must be scrypt$ hashed');
  assert.equal(server.verifyPassword('NewStrongPassword88', afterProf.password).ok, true);

  // /api/admin create_account hashes password on creation
  const adminAcc = server.getStore().accounts.find((a) => a.username === 'ayin');
  const adminToken = server.createSessionForAccount(adminAcc);
  const createAccRes = await adminRoute.POST(
    new Request('http://localhost/api/admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-studio-token': adminToken },
      body: JSON.stringify({
        operation: 'create_account',
        username: 'hashed_user',
        password: 'AdminCreatedPass99',
        displayName: '哈希测试号',
        role: 'creator',
        budgetCapUsd: 5,
      }),
    })
  );
  assert.equal(createAccRes.status, 200, 'admin create_account must succeed');
  const createdUser = server.getStore().accounts.find((a) => a.username === 'hashed_user');
  assert.ok(createdUser?.password.startsWith('scrypt$'), 'admin-created account password must be scrypt$ hashed');

  // Admin GET snapshot must never leak raw scrypt$ hashes or plaintext passwords
  const admSnapRes = await adminRoute.GET(new Request('http://localhost/api/admin', { headers: { 'x-studio-token': adminToken } }));
  assert.equal(admSnapRes.status, 200);
  const admSnap = await admSnapRes.json();
  for (const a of admSnap.accounts) {
    assert.equal(a.password, '••••••••', 'admin snapshot must redact password field');
    assert.equal(String(a.password).includes('scrypt$'), false, 'admin snapshot must never expose scrypt$ hash');
  }

  // Rate limiting: 20 wrong password attempts from same IP trip HTTP 429 RATE_LIMITED
  for (let i = 0; i < 20; i++) {
    const badRes = await authRoute.POST(
      new Request('http://localhost/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.77' },
        body: JSON.stringify({ action: 'login', username: 'hashed_user', password: 'wrong-password-' + i }),
      })
    );
    assert.equal(badRes.status, 401, `attempt ${i + 1} should return 401 before threshold`);
  }
  const blockedRes = await authRoute.POST(
    new Request('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ action: 'login', username: 'hashed_user', password: 'AdminCreatedPass99' }),
    })
  );
  assert.equal(blockedRes.status, 429, '21st attempt from rate-limited IP must return 429');
  assert.equal((await blockedRes.json()).error, 'RATE_LIMITED');

  // Fresh IP can still log in immediately
  const freshIpRes = await authRoute.POST(
    new Request('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.88' },
      body: JSON.stringify({ action: 'login', username: 'hashed_user', password: 'AdminCreatedPass99' }),
    })
  );
  assert.equal(freshIpRes.status, 200, 'fresh IP must not be blocked by another IP rate limit');

  // =========================================================================
  // 3. delete_project cleans up bucket files and transcribe checkpoint
  // =========================================================================
  const HAdmin = { 'content-type': 'application/json', 'x-studio-token': adminToken };
  async function callStudio(payload) {
    const res = await studioRoute.POST(
      new Request('http://localhost/api/studio', {
        method: 'POST',
        headers: HAdmin,
        body: JSON.stringify(payload),
      })
    );
    const json = await res.json();
    return { status: res.status, json };
  }

  const cDel = await callStudio({
    operation: 'create',
    title: '待清理磁盘测试剧',
    kind: 'original',
    brief: '测试删除项目时一并清理附件桶和断点文件',
  });
  assert.equal(cDel.status, 201);
  const delProj = cDel.json;

  // Write a real bucket object and transcribe checkpoint for this project
  const attId = 'att-cleanup-1';
  const bucketKey = `${adminAcc.username}/${delProj.id}/${attId}`;
  const bucketPath = server.resolveSafeBucketPath(bucketKey);
  fs.mkdirSync(path.dirname(bucketPath), { recursive: true });
  fs.writeFileSync(bucketPath, Buffer.from('dummy-video-bytes-for-cleanup'));

  const storedDelProj = await server.getProject(delProj.id, adminAcc.username);
  storedDelProj.attachments.push({
    id: attId,
    name: 'cleanup-ep1.mp4',
    type: 'video/mp4',
    size: 29,
    slot: 'video',
    episode: 1,
    createdAt: new Date().toISOString(),
  });
  const savedDelProj = await server.saveProject(storedDelProj, adminAcc.username);

  transcribeJobs.saveTranscribeCheckpoint(adminAcc.username, delProj.id, {
    projectId: delProj.id,
    owner: adminAcc.username,
    updatedAt: new Date().toISOString(),
    episodes: {
      '1': {
        episode: 1,
        body: 'ep1 body',
        charCount: 8,
        model: 'gemini-4-hydrogen',
        completedAt: new Date().toISOString(),
      },
    },
  });
  assert.equal(fs.existsSync(bucketPath), true, 'bucket file must exist before delete_project');
  assert.ok(transcribeJobs.loadTranscribeCheckpoint(adminAcc.username, delProj.id), 'checkpoint must exist before delete_project');

  const delRes = await callStudio({
    operation: 'delete_project',
    id: delProj.id,
    version: savedDelProj.version,
  });
  assert.equal(delRes.status, 200, 'delete_project must succeed');
  assert.equal(delRes.json.ok, true);
  assert.equal(delRes.json.reclaimedFiles, 1, 'should reclaim 1 bucket object');
  assert.equal(fs.existsSync(bucketPath), false, 'bucket file must be deleted from disk');
  assert.equal(transcribeJobs.loadTranscribeCheckpoint(adminAcc.username, delProj.id), null, 'transcribe checkpoint must be cleared');
  await assert.rejects(() => server.getProject(delProj.id, adminAcc.username), /NOT_FOUND/, 'project must be removed from DB');

  // =========================================================================
  // 4. Right-side AI command: in-place nodeId edit, auto-snapshot before ep edit,
  //    existing draft injection, user message bubble, and locked guard
  // =========================================================================
  const liveStore = server.getStore();
  liveStore.systemConfig.providers = liveStore.systemConfig.providers.map((pr) =>
    pr.id === 'prov-openai' || pr.id === 'prov-gemini'
      ? { ...pr, enabled: true, baseUrl: 'https://mock-relay.local/v1', apiKeys: ['sk-test-offline'] }
      : { ...pr, enabled: false }
  );
  server.flushPersistentStore();

  const seenPrompts = [];
  const seenSystems = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || '{}'));
    const sysMsg =
      body.messages?.find((m) => m.role === 'system')?.content ||
      body.systemInstruction?.parts?.map((pt) => pt.text || '').join('\n') ||
      '';
    const userMsg =
      body.messages?.find((m) => m.role === 'user')?.content ||
      body.contents?.[0]?.parts?.map((pt) => pt.text || '').join('\n') ||
      '';
    seenSystems.push(String(sysMsg));
    seenPrompts.push(String(userMsg));
    const reply = userMsg.includes('总大纲改得节奏更快')
      ? '【改写后总大纲】女主重生回婚礼前夜，直接掀桌反杀渣男与白莲花。'
      : '3-1 宴会厅 日 内\n人物：林晚、顾沉\n△ 林晚将红酒直接泼在顾沉脸上，全场死寂。\n林晚：退婚书签好了，滚。';
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: reply } }],
        usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  let { status: stCreate, json: aiProj } = await callStudio({
    operation: 'create',
    title: '右侧指令改写测试剧',
    kind: 'original',
    brief: '都市豪门复仇爽剧，前3集强冲突。',
  });
  assert.equal(stCreate, 201);

  const ep3Before = '3-1 客厅 日 内\n林晚默默忍受羞辱，没有反击。';
  const outlineNodeId = 'node-outline-1';
  ({ json: aiProj } = await callStudio({
    operation: 'save_workspace',
    id: aiProj.id,
    version: aiProj.version,
    outlineNodes: [
      {
        id: outlineNodeId,
        title: '总大纲',
        body: '【原大纲】温和慢热版本',
        updatedAt: new Date().toISOString(),
      },
    ],
    episodes: [
      {
        id: 'ep-1-locked',
        episodeNumber: 1,
        title: '第 1 集',
        body: 'LOCKED-VERBATIM-EP1',
        locked: true,
        snapshots: [],
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'ep-3-open',
        episodeNumber: 3,
        title: '第 3 集',
        body: ep3Before,
        locked: false,
        snapshots: [],
        updatedAt: new Date().toISOString(),
      },
    ],
  }));

  // 4a. In-place episode edit: injects current draft, creates pre-edit snapshot, logs user + director bubbles
  const epEditRes = await callStudio({
    operation: 'director_generate',
    id: aiProj.id,
    version: aiProj.version,
    task: 'episode',
    episodeNumber: 3,
    text: '把第3集开场改得更有火药味，直接泼红酒反杀',
  });
  assert.equal(epEditRes.status, 200, 'episode director_generate must succeed');
  aiProj = epEditRes.json;
  const updatedEp3 = aiProj.episodes.find((e) => e.episodeNumber === 3);
  assert.ok(updatedEp3.body.includes('红酒直接泼在顾沉脸上'), 'EP3 body must be updated in place');
  assert.equal(updatedEp3.snapshots.length, 1, 'must automatically snapshot original EP3 before AI overwrite');
  assert.equal(updatedEp3.snapshots[0].body, ep3Before, 'snapshot must preserve exact pre-edit body');
  assert.ok(updatedEp3.snapshots[0].note.includes('AI 改写前快照'), 'snapshot note must explain AI pre-edit backup');
  assert.ok(seenPrompts[seenPrompts.length - 1].includes('林晚默默忍受羞辱'), 'LLM prompt must include current episode draft');
  assert.ok(seenSystems[seenSystems.length - 1].includes('绝对禁止输出“收到”'), 'episode systemPromptOverride must block stage-1 recap chatter');
  assert.ok(
    aiProj.messages.some((m) => m.role === 'user' && String(m.text || '').includes('直接泼红酒反杀')),
    'user command must be recorded as a user chat bubble'
  );
  assert.ok(
    aiProj.messages.some((m) => m.role !== 'user' && String(m.text || '').includes('历史版本') && String(m.text || '').includes('快照')),
    'director message must confirm snapshot backup'
  );

  // 4b. In-place asset node edit via nodeId (updates existing node without creating duplicate)
  const nodeEditRes = await callStudio({
    operation: 'director_generate',
    id: aiProj.id,
    version: aiProj.version,
    task: 'outline',
    nodeId: outlineNodeId,
    text: '把总大纲改得节奏更快、前3集直接掀桌',
  });
  assert.equal(nodeEditRes.status, 200, 'nodeId director_generate must succeed');
  aiProj = nodeEditRes.json;
  assert.equal(aiProj.outlineNodes.length, 1, 'must update existing outline node in-place without duplicating');
  assert.ok(aiProj.outlineNodes[0].body.includes('改写后总大纲'));
  assert.ok(seenPrompts[seenPrompts.length - 1].includes('温和慢热版本'), 'LLM prompt must include current node draft');

  // 4c. Locked episode must refuse overwrite
  const lockRes = await callStudio({
    operation: 'director_generate',
    id: aiProj.id,
    version: aiProj.version,
    task: 'episode',
    episodeNumber: 1,
    text: '强行改写锁定集',
  });
  assert.ok([403, 409, 423].includes(lockRes.status), `locked episode must reject AI overwrite with 403/409/423, got ${lockRes.status}`);
  const latestProj = await server.getProject(aiProj.id, adminAcc.username);
  const ep1After = latestProj.episodes.find((e) => e.episodeNumber === 1);
  assert.equal(ep1After.body, 'LOCKED-VERBATIM-EP1', 'locked episode text must remain untouched');

  // 4d. studio_tool format preserves △ action markers and scene headers without double ▲ △
  const fmtRes = await callStudio({
    operation: 'studio_tool',
    id: aiProj.id,
    version: aiProj.version,
    tool: 'format',
    text: '3-1 顾家客厅 日 内\n人物：林晚、顾沉\n△ 林晚将退婚书甩在桌上。\n林晚：退婚！',
  });
  assert.equal(fmtRes.status, 200);
  assert.equal(fmtRes.json.formatted.includes('▲ △'), false, 'format must not double-prefix ▲ △');
  assert.ok(fmtRes.json.formatted.includes('3-1 顾家客厅 日 内'), 'format must preserve scene header cleanly');

  // =========================================================================
  // 5. StudioWorkspace.tsx static guards for right-side AI panel & UI clarity
  // =========================================================================
  const uiSrc = fs.readFileSync(path.join(ROOT, 'components', 'StudioWorkspace.tsx'), 'utf8');
  assert.ok(uiSrc.includes('aiCommandMode'), 'StudioWorkspace must expose aiCommandMode toggle');
  assert.ok(uiSrc.includes('resolveSmartDirectorIntent'), 'StudioWorkspace must include smart intent router');
  assert.ok(uiSrc.includes('📥 应用到当前编辑区'), 'StudioWorkspace must offer 1-click apply to active editor');
  assert.ok(uiSrc.includes('currentEp.episodeNumber'), 'StudioWorkspace must use currentEp.episodeNumber');
  assert.equal(uiSrc.includes('(currentEp as any).number'), false, 'must not contain broken (currentEp as any).number');
  assert.ok(uiSrc.includes("whiteSpace: 'nowrap'"), 'Row 1 toolbar buttons must prevent awkward wrapping');
  assert.ok(uiSrc.includes('120 字'), 'AI rate check must give friendly hint for short drafts (<120 chars)');
  assert.ok(uiSrc.includes('toolOutput?.platforms'), 'trending modal must render structured platforms without React #31 object crash');
  assert.ok(uiSrc.includes('toolOutput.reason'), 'ai-rate modal must render reason string without React #31 object crash');

  console.log('PASS: step8-hardening-and-ai-command (cache prune + scrypt/rate-limit + delete_project cleanup + AI in-place command & snapshots + UI guards)');
} finally {
  globalThis.fetch = origFetch;
  if (origDisableRl === undefined) delete process.env.STUDIO_DISABLE_RATE_LIMIT;
  else process.env.STUDIO_DISABLE_RATE_LIMIT = origDisableRl;
  if (origFixture === undefined) delete process.env.STUDIO_LLM_FIXTURE;
  else process.env.STUDIO_LLM_FIXTURE = origFixture;
  process.chdir(origCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
}
