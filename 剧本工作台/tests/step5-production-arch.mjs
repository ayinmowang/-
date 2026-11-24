import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hookCode = `
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
register(`data:text/javascript;base64,${Buffer.from(hookCode).toString('base64')}`);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origCwd = process.cwd();
const origFetch = globalThis.fetch;
const origFixture = process.env.STUDIO_LLM_FIXTURE;
const origStrict = process.env.STUDIO_STRICT_NATIVE_GEMINI;
const origFullVideo = process.env.STUDIO_STRICT_NATIVE_FULL_VIDEO;
const origStrictKey = process.env.STUDIO_STRICT_NATIVE_API_KEY;
const origFfmpegDisabled = process.env.STUDIO_FFMPEG_DISABLED;
const origFfmpegPath = process.env.STUDIO_FFMPEG_PATH;
const origConcurrency = process.env.STUDIO_TRANSCRIBE_CONCURRENCY;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'step5-prod-arch-'));
const imp = (rel) => import(new URL(rel, new URL('../', import.meta.url)).href);

function makeValidV72Episode(epNum) {
  return [
    `## 第${epNum}集`,
    '',
    '【正文】',
    `${epNum}-1 客厅 日 内`,
    '人物：林夏、周明',
    '',
    `△ 第${epNum}集林夏推门进入客厅，将一份文件放到周明面前的木桌上。`,
    `林夏（压低声音）：第${epNum}集的证据我都带来了，你现在还打算否认吗？`,
    '△ 周明神色一变，伸手合上桌面文件夹。',
    '周明：先坐下，把门关上再说。',
  ].join('\n');
}

function makeFakeMp4(bytes = 5000, fill = 0x22) {
  const buf = Buffer.alloc(bytes, fill);
  buf.write('\x00\x00\x00\x18ftypmp42', 0, 'latin1');
  return buf;
}

try {
  process.chdir(tmp);
  delete process.env.STUDIO_LLM_FIXTURE;
  delete process.env.STUDIO_STRICT_NATIVE_GEMINI;
  delete process.env.STUDIO_STRICT_NATIVE_FULL_VIDEO;
  delete process.env.STUDIO_STRICT_NATIVE_API_KEY;
  delete process.env.STUDIO_FFMPEG_DISABLED;
  delete process.env.STUDIO_FFMPEG_PATH;

  const {
    getStore,
    flushPersistentStore,
    callStationLLM,
    isAllowedRelayModel,
    saveProjectProgress,
    resolveSafeBucketPath,
  } = await imp('lib/server.ts');
  const { resolveFfmpegBinary, prepareCompressedVideoForLLM } = await imp('lib/video-compress.ts');
  const { isFfmpegDisabled } = await imp('lib/upload-guard.ts');
  const {
    PROCESS_BOOT_AT_MS,
    getTranscribeCheckpointPath,
    loadTranscribeCheckpoint,
    saveTranscribeCheckpoint,
    clearTranscribeCheckpoint,
    isTranscribeJobRunning,
  } = await imp('lib/transcribe-jobs.ts');
  const studio = await imp('app/api/studio/route.ts');

  // -------------------------------------------------------------------------
  // 1. resolveFfmpegBinary & isFfmpegDisabled & small-MP4 compression skip
  // -------------------------------------------------------------------------
  {
    const bin = resolveFfmpegBinary();
    assert.equal(bin.available, true, 'ffmpeg-static or system ffmpeg must be available');
    assert.ok(bin.path && fs.existsSync(bin.path), 'resolved ffmpeg binary must exist on disk');
    assert.equal(isFfmpegDisabled(), false, 'isFfmpegDisabled() must return false when ffmpeg resolves');

    process.env.STUDIO_FFMPEG_PATH = bin.path;
    const envBin = resolveFfmpegBinary();
    assert.equal(envBin.available, true);
    assert.equal(envBin.source, 'env');
    delete process.env.STUDIO_FFMPEG_PATH;

    process.env.STUDIO_FFMPEG_DISABLED = '1';
    assert.equal(resolveFfmpegBinary().available, false);
    assert.equal(isFfmpegDisabled(), true);
    delete process.env.STUDIO_FFMPEG_DISABLED;

    const smallMp4 = path.join(tmp, 'small.mp4');
    fs.writeFileSync(smallMp4, makeFakeMp4(8192));
    const prep = await prepareCompressedVideoForLLM({
      bucketPath: smallMp4,
      cacheKey: 'small-test',
      mode: 'fast',
    });
    assert.equal(prep.compressed, false, 'MP4 <= 3MB threshold must skip transcoding');
    assert.equal(prep.filePath, smallMp4);
  }

  // -------------------------------------------------------------------------
  // 2. callStationLLM fallback model preservation + /v1beta SSE + 403/524 retry rules
  // -------------------------------------------------------------------------
  {
    const store = getStore();
    store.accounts = [
      {
        id: 'acc-1',
        username: 'owner',
        displayName: 'owner',
        role: 'creator',
        password: 'x',
        accessKey: 'k-owner',
        status: 'active',
        budgetCapUsd: 0,
        budgetUsedUsd: 0,
        tokensUsed: 0,
        allowedFlows: ['transcribe', 'foreign', 'domestic', 'original'],
        note: '',
        createdAt: new Date().toISOString(),
      },
    ];
    store.systemConfig.requireAuthOnFrontend = true;
    store.systemConfig.backendUrl = '';
    store.systemConfig.mode = 'direct_llm';
    store.systemConfig.providers = [
      {
        id: 'prov-gemini',
        name: 'Test Relay',
        vendor: 'custom',
        baseUrl: 'https://mock-relay.invalid/v1',
        apiKeys: ['sk-test-key-1', 'sk-test-key-2'],
        models: ['gemini-4-carbon', 'gemini-4-argon', 'gemini-4-neon'],
        enabled: true,
        priority: 1,
      },
    ];
    store.systemConfig.routes.vision = {
      roleKey: 'vision',
      title: 'Vision',
      badge: 'v',
      description: 'v',
      primaryProviderId: 'prov-gemini',
      primaryModel: 'gemini-4-carbon',
      fallbackProviderId: 'prov-gemini',
      fallbackModel: 'gemini-4-argon',
      temperature: 0.15,
      maxTokens: 2048,
      systemPrompt: 'sys',
      enabled: true,
    };

    // 2a. Fallback preservation: primary 500 -> fallback must use gemini-4-argon (NOT overwritten to carbon)
    const seen = [];
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      const body = JSON.parse(String(init?.body || '{}'));
      const model = body.model || (u.match(/\/models\/([^:?/]+):/) || [])[1] || '';
      seen.push({ url: u, model });
      if (model === 'gemini-4-carbon') {
        return new Response('Primary error', { status: 500 });
      }
      if (u.includes('/v1beta/')) {
        // Test /v1beta 404 -> automatic fallback to /v1/chat/completions
        return new Response('Not Found', { status: 404 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'FALLBACK_ARGON_OK' } }],
          usage: { total_tokens: 25 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const resFallback = await callStationLLM({
      station: 'vision',
      userPrompt: 'test fallback preservation',
      providerIdOverride: 'prov-gemini',
      modelOverride: 'gemini-4-carbon',
      mediaAttachments: [{ name: 'ep1.mp4', mimeType: 'video/mp4', base64: makeFakeMp4(4096).toString('base64') }],
    });
    assert.equal(resFallback.ok, true);
    assert.equal(resFallback.text, 'FALLBACK_ARGON_OK');
    assert.ok(
      seen.some((s) => s.url.includes('/v1beta/models/gemini-4-carbon:streamGenerateContent')),
      'video relay call must try /v1beta SSE first',
    );
    assert.ok(
      seen.some((s) => s.model === 'gemini-4-argon' && s.url.includes('/chat/completions')),
      `fallback must preserve gemini-4-argon (not clobber to carbon), got ${JSON.stringify(seen)}`,
    );

    // 2b. /v1beta native SSE response parsing
    const v1betaCalls = [];
    globalThis.fetch = async (url) => {
      v1betaCalls.push(String(url));
      const ssePayload = [
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'V1BETA_PART1_' }] } }] })}`,
        '',
        `data: ${JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'PART2' }] }, finishReason: 'STOP' }],
          usageMetadata: { totalTokenCount: 88 },
        })}`,
        '',
      ].join('\n');
      return new Response(ssePayload, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    const resV1Beta = await callStationLLM({
      station: 'vision',
      userPrompt: 'v1beta sse',
      providerIdOverride: 'prov-gemini',
      modelOverride: 'gemini-4-carbon',
      mediaAttachments: [{ name: 'ep1.mp4', mimeType: 'video/mp4', base64: makeFakeMp4(4096).toString('base64') }],
    });
    assert.equal(resV1Beta.ok, true);
    assert.equal(resV1Beta.text, 'V1BETA_PART1_PART2');
    assert.equal(v1betaCalls.length, 1);
    assert.ok(v1betaCalls[0].includes('/v1beta/models/gemini-4-carbon:streamGenerateContent?alt=sse'));

    // 2c. 403 insufficient_user_quota aborts immediately without retrying keys or fallback
    let calls403 = 0;
    globalThis.fetch = async () => {
      calls403 += 1;
      return new Response(JSON.stringify({ error: { message: 'insufficient_user_quota' } }), { status: 403 });
    };
    const res403 = await callStationLLM({
      station: 'vision',
      userPrompt: 'quota test',
      providerIdOverride: 'prov-gemini',
      modelOverride: 'gemini-4-carbon',
    });
    assert.equal(res403.ok, false);
    assert.equal(res403.nonRetryable, true);
    assert.equal(calls403, 1, 'HTTP 403 must abort immediately after 1 call');

    // 2d. HTTP 524 returns timedOutTargets and excludeTargets prevents retrying the exact same target
    let calls524 = 0;
    globalThis.fetch = async () => {
      calls524 += 1;
      return new Response('Cloudflare 524 timeout', { status: 524 });
    };
    const res524 = await callStationLLM({
      station: 'vision',
      userPrompt: '524 test',
      providerIdOverride: 'prov-gemini',
      modelOverride: 'gemini-4-carbon',
    });
    assert.equal(res524.ok, false);
    assert.ok(Array.isArray(res524.timedOutTargets) && res524.timedOutTargets.length >= 1);
    const beforeExclude = calls524;
    const res524Retry = await callStationLLM({
      station: 'vision',
      userPrompt: '524 test retry',
      providerIdOverride: 'prov-gemini',
      modelOverride: 'gemini-4-carbon',
      excludeTargets: new Set(res524.timedOutTargets),
    });
    assert.equal(res524Retry.ok, false);
    assert.equal(calls524, beforeExclude, 'excludeTargets must prevent retrying identical timed-out target');

    // 2e. /v1beta shorthand alias ('gemini4c') on HTTP 403 and 524 must make exactly 1 HTTP call
    let aliasCalls403 = 0;
    const aliasUrls403 = [];
    globalThis.fetch = async (url) => {
      aliasCalls403 += 1;
      aliasUrls403.push(String(url));
      return new Response(JSON.stringify({ error: { message: 'insufficient_user_quota' } }), { status: 403 });
    };
    const resAlias403 = await callStationLLM({
      station: 'vision',
      userPrompt: 'v1beta alias 403 test',
      providerIdOverride: 'prov-gemini',
      modelOverride: 'gemini4c',
      mediaAttachments: [{ name: 'ep1.mp4', mimeType: 'video/mp4', base64: makeFakeMp4(4096).toString('base64') }],
    });
    assert.equal(resAlias403.ok, false);
    assert.equal(resAlias403.nonRetryable, true);
    assert.equal(aliasCalls403, 1, `/v1beta shorthand alias 403 must make 1 call, got ${JSON.stringify(aliasUrls403)}`);

    let aliasCalls524 = 0;
    const aliasUrls524 = [];
    globalThis.fetch = async (url) => {
      aliasCalls524 += 1;
      aliasUrls524.push(String(url));
      return new Response('Cloudflare 524 timeout', { status: 524 });
    };
    const resAlias524 = await callStationLLM({
      station: 'vision',
      userPrompt: 'v1beta alias 524 test',
      providerIdOverride: 'prov-gemini',
      modelOverride: 'gemini4c',
      mediaAttachments: [{ name: 'ep1.mp4', mimeType: 'video/mp4', base64: makeFakeMp4(4096).toString('base64') }],
    });
    assert.equal(resAlias524.ok, false);
    assert.equal(aliasCalls524, 2, `expected 1 call for gemini4c + 1 call for fallback argon, got ${JSON.stringify(aliasUrls524)}`);
    assert.ok(
      !aliasUrls524.some((u) => u.includes('gemini-4-carbon')),
      `/v1beta shorthand alias 524 must NOT retry normalized gemini-4-carbon, got ${JSON.stringify(aliasUrls524)}`,
    );
    assert.ok(
      aliasUrls524.some((u) => u.includes('gemini4c')) && aliasUrls524.some((u) => u.includes('gemini-4-argon')),
      `expected gemini4c -> fallback gemini-4-argon, got ${JSON.stringify(aliasUrls524)}`,
    );

    // 2f. /v1beta sends thinkingBudget: 0 when thinkingLevel is 'off'/undefined, and strips on 400 rejection
    const thinkBodies = [];
    globalThis.fetch = async (_url, init) => {
      const parsed = JSON.parse(String(init?.body || '{}'));
      thinkBodies.push(parsed.generationConfig || {});
      if (thinkBodies.length === 1) {
        return new Response(
          JSON.stringify({ error: { message: 'thinkingBudget is not supported for this model' } }),
          { status: 400 },
        );
      }
      const sse = `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'THINK0_FALLBACK_OK' }] }, finishReason: 'STOP' }],
        usageMetadata: { totalTokenCount: 24 },
      })}\n\n`;
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const resThink0 = await callStationLLM({
      station: 'vision',
      userPrompt: 'v1beta thinkingBudget 0 test',
      providerIdOverride: 'prov-gemini',
      modelOverride: 'gemini-4-argon',
      thinkingLevel: 'off',
      mediaAttachments: [{ name: 'ep1.mp4', mimeType: 'video/mp4', base64: makeFakeMp4(4096).toString('base64') }],
    });
    assert.equal(resThink0.ok, true);
    assert.equal(resThink0.text, 'THINK0_FALLBACK_OK');
    assert.equal(thinkBodies.length, 2);
    assert.deepEqual(thinkBodies[0].thinkingConfig, { thinkingBudget: 0 }, 'thinkingLevel=off must send thinkingBudget: 0 on /v1beta');
    assert.equal(thinkBodies[1].thinkingConfig, undefined, '400 rejection must strip thinkingConfig on retry');
  }

  // -------------------------------------------------------------------------
  // 3. STUDIO_STRICT_NATIVE_GEMINI=1 bypasses compression (byte-exact MP4)
  // -------------------------------------------------------------------------
  {
    const store = getStore();
    const rawVideo = makeFakeMp4(3.5 * 1024 * 1024, 0x37); // > 3MB threshold
    const rawSha = crypto.createHash('sha256').update(rawVideo).digest('hex');
    const pid = 'proj-strict-bypass';
    const attId = 'att-strict-1';
    const bucketPath = resolveSafeBucketPath(`owner/${pid}/${attId}`);
    fs.mkdirSync(path.dirname(bucketPath), { recursive: true });
    fs.writeFileSync(bucketPath, rawVideo);

    const now = new Date().toISOString();
    const proj = {
      id: pid,
      title: '原生绕过压缩测试',
      kind: 'transcribe',
      total: 1,
      brief: '',
      messages: [],
      attachments: [
        { id: attId, name: 'ep01.mp4', size: rawVideo.length, type: 'video/mp4', role: 'source', episode: 1, coveredEpisodes: [1] },
      ],
      requirements: [],
      archived: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
      confirmed: true,
      remoteId: 'r-strict',
      preferredTierId: 'tier-standard',
      remote: {
        id: 'r-strict',
        version: 1,
        mode: 'test_channel',
        status: 'waiting_confirm',
        stage: { key: 'recap', title: 'recap' },
        cursor: 1,
        progress: { completed_steps: 1, total_steps: 2 },
        card: { id: 'card-mode', step: 'recap', title: 'mode', fields: ['mode'], questions: [] },
        outputs: {},
        messages: [],
      },
    };
    store.projects[pid] = { owner: 'owner', data: JSON.stringify(proj), version: 1, updated_at: now };

    let sentBase64 = '';
    globalThis.fetch = async (_url, init) => {
      const parsed = JSON.parse(String(init?.body || '{}'));
      sentBase64 = parsed.contents[0].parts.find((p) => p.inline_data)?.inline_data?.data || '';
      const sse = `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: makeValidV72Episode(1) }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
      })}\n\n`;
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };

    process.env.STUDIO_STRICT_NATIVE_GEMINI = '1';
    process.env.STUDIO_STRICT_NATIVE_FULL_VIDEO = '1';
    process.env.STUDIO_STRICT_NATIVE_API_KEY = 'sk-strict-test';
    try {
      const resp = await studio.POST(
        new Request('http://localhost/api/studio', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-studio-token': 'k-owner' },
          body: JSON.stringify({
            id: pid,
            version: 1,
            operation: 'action',
            action: { action: 'confirm', action_id: 'act-strict-1', answers: { mode: 'fast' } },
          }),
        }),
      );
      assert.equal(resp.status, 200);
      const sentBytes = Buffer.from(sentBase64, 'base64');
      const sentSha = crypto.createHash('sha256').update(sentBytes).digest('hex');
      assert.equal(sentSha, rawSha, 'strict native mode must send byte-identical original MP4 without compression');
    } finally {
      delete process.env.STUDIO_STRICT_NATIVE_GEMINI;
      delete process.env.STUDIO_STRICT_NATIVE_FULL_VIDEO;
      delete process.env.STUDIO_STRICT_NATIVE_API_KEY;
    }
  }

  // -------------------------------------------------------------------------
  // 4. Async batch job + checkpoint resume + GET raw isolation
  // -------------------------------------------------------------------------
  {
    const store = getStore();
    const pid = 'proj-async-resume';
    const now = new Date().toISOString();
    const v1 = makeFakeMp4(5000, 0x11);
    const v2 = makeFakeMp4(5000, 0x22);
    for (const [attId, buf] of [
      ['att-e1', v1],
      ['att-e2', v2],
    ]) {
      const bp = resolveSafeBucketPath(`owner/${pid}/${attId}`);
      fs.mkdirSync(path.dirname(bp), { recursive: true });
      fs.writeFileSync(bp, buf);
    }
    const proj = {
      id: pid,
      title: '异步断点续跑剧',
      kind: 'transcribe',
      total: 2,
      brief: '',
      messages: [],
      attachments: [
        { id: 'att-e1', name: 'ep01.mp4', size: v1.length, type: 'video/mp4', role: 'source', episode: 1, coveredEpisodes: [1] },
        { id: 'att-e2', name: 'ep02.mp4', size: v2.length, type: 'video/mp4', role: 'source', episode: 2, coveredEpisodes: [2] },
      ],
      requirements: [],
      archived: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
      confirmed: true,
      remoteId: 'r-async',
      preferredTierId: 'tier-standard',
      remote: {
        id: 'r-async',
        version: 1,
        mode: 'test_channel',
        status: 'waiting_confirm',
        stage: { key: 'recap', title: 'recap' },
        cursor: 1,
        progress: { completed_steps: 1, total_steps: 2 },
        card: { id: 'card-mode', step: 'recap', title: 'mode', fields: ['mode'], questions: [] },
        outputs: {},
        messages: [],
      },
    };
    store.projects[pid] = { owner: 'owner', data: JSON.stringify(proj), version: 1, updated_at: now };

    const calledEpsRun1 = [];
    globalThis.fetch = async (_url, init) => {
      const bodyStr = String(init?.body || '');
      const epMatch = bodyStr.match(/第 (\d+) 集/);
      const epNum = epMatch ? Number(epMatch[1]) : 1;
      calledEpsRun1.push(epNum);
      if (epNum === 2) {
        return new Response(JSON.stringify({ error: { message: 'insufficient_user_quota' } }), { status: 403 });
      }
      const sse = `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: makeValidV72Episode(epNum) }] }, finishReason: 'STOP' }],
        usageMetadata: { totalTokenCount: 60 },
      })}\n\n`;
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };

    const startRes = await studio.POST(
      new Request('http://localhost/api/studio', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-studio-token': 'k-owner' },
        body: JSON.stringify({
          id: pid,
          version: 1,
          async: true,
          operation: 'action',
          action: { action: 'confirm', action_id: 'act-async-1', answers: { mode: 'fast' } },
        }),
      }),
    );
    assert.equal(startRes.status, 200);
    const startJson = await startRes.json();
    assert.equal(startJson.remote.status, 'running', 'async submit must return immediately with status=running');
    assert.ok(startJson.remote.transcribeJob, 'async submit must include transcribeJob metadata');

    // Poll GET /api/studio until partial failure settles
    let latestGet = null;
    for (let i = 0; i < 60; i++) {
      const g = await studio.GET(
        new Request(`http://localhost/api/studio?id=${pid}`, { headers: { 'x-studio-token': 'k-owner' } }),
      );
      latestGet = await g.json();
      if (latestGet.remote.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(latestGet.remote.status, 'failed');
    assert.deepEqual(latestGet.remote.transcribeJob.completedEpisodes, [1]);
    assert.deepEqual(latestGet.remote.transcribeJob.failedEpisodes, [2]);
    assert.ok(!JSON.stringify(latestGet).includes('transcribe-checkpoints'), 'GET must never expose checkpoint path');
    assert.ok(!JSON.stringify(latestGet).includes('证据我都带来了'), 'GET must not expose raw checkpoint text on failed batch');

    const cp = loadTranscribeCheckpoint('owner', pid);
    assert.ok(cp && cp.episodes[1], 'checkpoint must persist completed episode 1 on disk');
    assert.equal(fs.existsSync(getTranscribeCheckpointPath('owner', pid)), true);

    // Resume run: ep1 MUST be skipped (0 fetch calls for ep1), only ep2 runs
    const calledEpsRun2 = [];
    globalThis.fetch = async (_url, init) => {
      const bodyStr = String(init?.body || '');
      const epMatch = bodyStr.match(/第 (\d+) 集/);
      const epNum = epMatch ? Number(epMatch[1]) : 2;
      calledEpsRun2.push(epNum);
      const sse = `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: makeValidV72Episode(epNum) }] }, finishReason: 'STOP' }],
        usageMetadata: { totalTokenCount: 60 },
      })}\n\n`;
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };

    const resumeRes = await studio.POST(
      new Request('http://localhost/api/studio', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-studio-token': 'k-owner' },
        body: JSON.stringify({
          id: pid,
          version: latestGet.version,
          async: true,
          operation: 'action',
          action: { action: 'confirm', action_id: 'act-async-2', answers: { mode: 'fast' } },
        }),
      }),
    );
    assert.equal(resumeRes.status, 200);

    let finalGet = null;
    for (let i = 0; i < 60; i++) {
      const g = await studio.GET(
        new Request(`http://localhost/api/studio?id=${pid}`, { headers: { 'x-studio-token': 'k-owner' } }),
      );
      finalGet = await g.json();
      if (finalGet.remote.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(finalGet.remote.status, 'delivered');
    assert.deepEqual(calledEpsRun2, [2], 'resumed batch must skip already-validated episode 1');
    assert.equal(finalGet.episodes.length, 2);
    assert.equal(fs.existsSync(getTranscribeCheckpointPath('owner', pid)), false, 'checkpoint must be cleared after full delivery');
    clearTranscribeCheckpoint('owner', pid);
  }

  // -------------------------------------------------------------------------
  // 4b. Async pause with startJson.version after background version bump + stays paused
  // -------------------------------------------------------------------------
  {
    const store = getStore();
    const pid = 'proj-async-pause';
    const now = new Date().toISOString();
    const eps = [1, 2, 3, 4];
    const atts = [];
    for (const ep of eps) {
      const attId = `att-pause-${ep}`;
      const buf = makeFakeMp4(5000, 0x30 + ep);
      const bp = resolveSafeBucketPath(`owner/${pid}/${attId}`);
      fs.mkdirSync(path.dirname(bp), { recursive: true });
      fs.writeFileSync(bp, buf);
      atts.push({
        id: attId,
        name: `ep0${ep}.mp4`,
        size: buf.length,
        type: 'video/mp4',
        role: 'source',
        episode: ep,
        coveredEpisodes: [ep],
      });
    }
    const proj = {
      id: pid,
      title: '异步暂停回归测试',
      kind: 'transcribe',
      total: 4,
      brief: '',
      messages: [],
      attachments: atts,
      requirements: [],
      archived: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
      confirmed: true,
      remoteId: 'r-pause',
      preferredTierId: 'tier-standard',
      remote: {
        id: 'r-pause',
        version: 1,
        mode: 'test_channel',
        status: 'waiting_confirm',
        stage: { key: 'recap', title: 'recap' },
        cursor: 1,
        progress: { completed_steps: 1, total_steps: 2 },
        card: { id: 'card-mode', step: 'recap', title: 'mode', fields: ['mode'], questions: [] },
        outputs: {},
        messages: [],
      },
    };
    store.projects[pid] = { owner: 'owner', data: JSON.stringify(proj), version: 1, updated_at: now };

    process.env.STUDIO_TRANSCRIBE_CONCURRENCY = '2';
    const calledEpsPause = [];
    let abortObserved = 0;
    let inFlightCount = 0;
    let bothStartedResolve;
    const bothStarted = new Promise((r) => {
      bothStartedResolve = r;
    });

    globalThis.fetch = (_url, init) => {
      const bodyStr = String(init?.body || '');
      const epMatch = bodyStr.match(/第 (\d+) 集/);
      const epNum = epMatch ? Number(epMatch[1]) : 1;
      calledEpsPause.push(epNum);
      inFlightCount += 1;
      if (inFlightCount === 2) bothStartedResolve();
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          abortObserved += 1;
          reject(new DOMException('Aborted', 'AbortError'));
        };
        if (init?.signal?.aborted) {
          onAbort();
          return;
        }
        init?.signal?.addEventListener('abort', onAbort, { once: true });
        setTimeout(() => {
          init?.signal?.removeEventListener('abort', onAbort);
          const sse = `data: ${JSON.stringify({
            candidates: [{ content: { parts: [{ text: makeValidV72Episode(epNum) }] }, finishReason: 'STOP' }],
            usageMetadata: { totalTokenCount: 60 },
          })}\n\n`;
          resolve(new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
        }, 300);
      });
    };

    try {
      const startRes = await studio.POST(
        new Request('http://localhost/api/studio', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-studio-token': 'k-owner' },
          body: JSON.stringify({
            id: pid,
            version: 1,
            async: true,
            operation: 'action',
            action: { action: 'confirm', action_id: 'act-pause-start', answers: { mode: 'fast' } },
          }),
        }),
      );
      assert.equal(startRes.status, 200);
      const startJson = await startRes.json();
      assert.equal(startJson.remote.status, 'running');

      // Wait until both concurrency=2 episodes are in-flight and background progress has bumped store version
      await bothStarted;
      for (let i = 0; i < 40; i++) {
        if (store.projects[pid].version > startJson.version) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.ok(
        store.projects[pid].version > startJson.version,
        `expected background syncProgressToStore to bump version past ${startJson.version}, got ${store.projects[pid].version}`,
      );

      // Pause using the stale startJson.version -> must succeed (NOT 409 CONFLICT)
      const pauseRes = await studio.POST(
        new Request('http://localhost/api/studio', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-studio-token': 'k-owner' },
          body: JSON.stringify({
            id: pid,
            version: startJson.version,
            operation: 'action',
            action: { action: 'pause', action_id: 'act-pause-1' },
          }),
        }),
      );
      assert.equal(pauseRes.status, 200, 'pause with startJson.version must not 409 CONFLICT');
      const pauseJson = await pauseRes.json();
      assert.equal(pauseJson.remote.status, 'paused');

      // Wait for job runtime to exit completely and verify status remains 'paused' (NOT overwritten to 'failed')
      for (let i = 0; i < 60; i++) {
        if (!isTranscribeJobRunning('owner', pid)) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(isTranscribeJobRunning('owner', pid), false);
      await new Promise((r) => setTimeout(r, 40));

      const afterPauseGet = await (
        await studio.GET(new Request(`http://localhost/api/studio?id=${pid}`, { headers: { 'x-studio-token': 'k-owner' } }))
      ).json();
      assert.equal(afterPauseGet.remote.status, 'paused', 'paused status must persist after job settles');
      assert.equal(afterPauseGet.remote.stage?.key, 'transcribe_paused');
      assert.ok(abortObserved >= 1, 'AbortController must abort in-flight fetch requests immediately');
      assert.ok(!calledEpsPause.includes(3) && !calledEpsPause.includes(4), `queued eps 3/4 must never dispatch, got ${calledEpsPause}`);
    } finally {
      clearTranscribeCheckpoint('owner', pid);
      delete process.env.STUDIO_TRANSCRIBE_CONCURRENCY;
    }
  }

  // -------------------------------------------------------------------------
  // 4c. Orphaned remote.status==='running' reconciliation after prior-boot timestamp
  // -------------------------------------------------------------------------
  {
    const store = getStore();
    const pidGet = 'proj-orphan-get';
    const pidPost = 'proj-orphan-post';
    const priorStartedAt = new Date(PROCESS_BOOT_AT_MS - 60_000).toISOString();
    const priorUpdatedAt = new Date(PROCESS_BOOT_AT_MS - 30_000).toISOString();

    for (const pid of [pidGet, pidPost]) {
      const v1 = makeFakeMp4(5000, 0x41);
      const v2 = makeFakeMp4(5000, 0x42);
      for (const [attId, buf] of [
        ['att-o1', v1],
        ['att-o2', v2],
      ]) {
        const bp = resolveSafeBucketPath(`owner/${pid}/${attId}`);
        fs.mkdirSync(path.dirname(bp), { recursive: true });
        fs.writeFileSync(bp, buf);
      }
      saveTranscribeCheckpoint('owner', pid, {
        projectId: pid,
        transcribeMode: 'fast',
        attachmentIds: ['att-o1', 'att-o2'],
        updatedAt: priorUpdatedAt,
        episodes: {
          1: { text: makeValidV72Episode(1), updatedAt: priorUpdatedAt, elapsedMs: 120 },
        },
      });
      const proj = {
        id: pid,
        title: `重启孤儿任务-${pid}`,
        kind: 'transcribe',
        total: 2,
        brief: '',
        messages: [],
        attachments: [
          { id: 'att-o1', name: 'ep01.mp4', size: v1.length, type: 'video/mp4', role: 'source', episode: 1, coveredEpisodes: [1] },
          { id: 'att-o2', name: 'ep02.mp4', size: v2.length, type: 'video/mp4', role: 'source', episode: 2, coveredEpisodes: [2] },
        ],
        requirements: [],
        archived: false,
        createdAt: priorStartedAt,
        updatedAt: priorUpdatedAt,
        version: 3,
        confirmed: true,
        transcribeMode: 'fast',
        remoteId: `r-${pid}`,
        preferredTierId: 'tier-standard',
        remote: {
          id: `r-${pid}`,
          version: 2,
          mode: 'test_channel',
          status: 'running',
          stage: { key: 'transcribe_running', title: '扒剧处理中' },
          cursor: 2,
          progress: { completed_steps: 2, total_steps: 2 },
          card: null,
          outputs: {},
          messages: [],
          transcribeJob: {
            jobId: `dead-job-${pid}`,
            startedAt: priorStartedAt,
            updatedAt: priorUpdatedAt,
            totalEpisodes: 2,
            completedEpisodes: [1],
            failedEpisodes: [],
            inFlightEpisodes: [2],
            episodeProgress: { 1: { status: 'done', elapsedMs: 120 }, 2: { status: 'running' } },
          },
        },
      };
      store.projects[pid] = { owner: 'owner', data: JSON.stringify(proj), version: 3, updated_at: priorUpdatedAt };
    }

    // GET reconciles orphaned prior-boot job to failed + transcribe_incomplete
    const getOrphanRes = await studio.GET(
      new Request(`http://localhost/api/studio?id=${pidGet}`, { headers: { 'x-studio-token': 'k-owner' } }),
    );
    assert.equal(getOrphanRes.status, 200);
    const getOrphanJson = await getOrphanRes.json();
    assert.equal(getOrphanJson.remote.status, 'failed');
    assert.equal(getOrphanJson.remote.stage?.key, 'transcribe_incomplete');
    assert.deepEqual(getOrphanJson.remote.transcribeJob.inFlightEpisodes, []);

    // Direct POST confirm on orphaned prior-boot job (without prior GET) reconciles and resumes Ep 2 (no 409)
    const calledOrphanEps = [];
    globalThis.fetch = async (_url, init) => {
      const bodyStr = String(init?.body || '');
      const epMatch = bodyStr.match(/第 (\d+) 集/);
      const epNum = epMatch ? Number(epMatch[1]) : 2;
      calledOrphanEps.push(epNum);
      const sse = `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: makeValidV72Episode(epNum) }] }, finishReason: 'STOP' }],
        usageMetadata: { totalTokenCount: 60 },
      })}\n\n`;
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const postOrphanRes = await studio.POST(
      new Request('http://localhost/api/studio', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-studio-token': 'k-owner' },
        body: JSON.stringify({
          id: pidPost,
          version: 3,
          async: true,
          operation: 'action',
          action: { action: 'confirm', action_id: 'act-orphan-resume', answers: { mode: 'fast' } },
        }),
      }),
    );
    assert.equal(postOrphanRes.status, 200, 'orphaned prior-boot job confirm must not 409 TRANSCRIBE_ALREADY_RUNNING');
    let orphanFinal = null;
    for (let i = 0; i < 60; i++) {
      const g = await studio.GET(
        new Request(`http://localhost/api/studio?id=${pidPost}`, { headers: { 'x-studio-token': 'k-owner' } }),
      );
      orphanFinal = await g.json();
      if (orphanFinal.remote.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(orphanFinal.remote.status, 'delivered');
    assert.deepEqual(calledOrphanEps, [2], 'resumed orphan job must skip checkpointed Ep 1 and run Ep 2 only');

    clearTranscribeCheckpoint('owner', pidGet);
    clearTranscribeCheckpoint('owner', pidPost);
  }

  // -------------------------------------------------------------------------
  // 5. Atomic flushPersistentStore & concurrent saveProjectProgress serialization
  // -------------------------------------------------------------------------
  {
    const pid = 'proj-async-resume';
    const beforeVer = JSON.parse(JSON.stringify(getStore().projects[pid].version));
    await Promise.all([
      saveProjectProgress(pid, 'owner', (latest) => {
        latest.requirements.push('req-a');
      }),
      saveProjectProgress(pid, 'owner', (latest) => {
        latest.requirements.push('req-b');
      }),
      saveProjectProgress(pid, 'owner', (latest) => {
        latest.requirements.push('req-c');
      }),
    ]);
    flushPersistentStore();
    const afterRow = getStore().projects[pid];
    assert.equal(afterRow.version, beforeVer + 3, 'concurrent saveProjectProgress must serialize cleanly');
    const afterProj = JSON.parse(afterRow.data);
    assert.ok(afterProj.requirements.includes('req-a'));
    assert.ok(afterProj.requirements.includes('req-b'));
    assert.ok(afterProj.requirements.includes('req-c'));

    const dataDir = path.join(tmp, '.data');
    const tmpFiles = fs.readdirSync(dataDir).filter((n) => n.includes('.tmp.'));
    assert.equal(tmpFiles.length, 0, 'atomic flush must leave zero temp files');
    assert.ok(JSON.parse(fs.readFileSync(path.join(dataDir, 'studio-store.json'), 'utf8')));
  }

  // -------------------------------------------------------------------------
  // 6. Static checks on BreakdownWorkspace.tsx, next.config.mjs, deploy/
  // -------------------------------------------------------------------------
  {
    const bw = fs.readFileSync(path.join(repoRoot, 'components/BreakdownWorkspace.tsx'), 'utf8');
    assert.ok(
      bw.includes('const needCanvasFallback = isVideo && f.size > MULTIMODAL_VIDEO_CAP_BYTES && ffmpegAvailable === false;'),
      'BreakdownWorkspace line 262 must require BOTH >30MB and ffmpegAvailable === false',
    );
    assert.ok(bw.includes('async: true'), 'BreakdownWorkspace must send async: true');
    assert.ok(bw.includes('2500'), 'BreakdownWorkspace must poll every 2500ms while running');
    assert.ok(bw.includes('服务端未启用 ffmpeg'), 'BreakdownWorkspace must warn when ffmpeg is missing for >8MB videos');

    const nextCfg = fs.readFileSync(path.join(repoRoot, 'next.config.mjs'), 'utf8');
    assert.ok(nextCfg.includes("serverExternalPackages: ['ffmpeg-static']"));
    assert.ok(nextCfg.includes('unoptimized: true'));

    const nginxCfg = fs.readFileSync(path.join(repoRoot, 'deploy/nginx-studio-workbench.conf'), 'utf8');
    assert.ok(nginxCfg.includes('client_max_body_size 256m'));
    assert.ok(nginxCfg.includes('proxy_request_buffering off'));
    assert.ok(nginxCfg.includes('proxy_buffering off'));
    assert.ok(nginxCfg.includes('proxy_read_timeout 180s'));

    const svcCfg = fs.readFileSync(path.join(repoRoot, 'deploy/studio-workbench.service'), 'utf8');
    assert.ok(
      svcCfg.includes('Environment=PATH=/opt/studio-workbench-3/.runtime/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'),
      'systemd service must set PATH with .runtime/node/bin',
    );
    assert.ok(fs.existsSync(path.join(repoRoot, 'deploy/env.production.example')));

    const vcSrc = fs.readFileSync(path.join(repoRoot, 'lib/video-compress.ts'), 'utf8');
    assert.ok(vcSrc.includes('trunc(min(${shortEdge},iw)/2)*2'));
    assert.ok(vcSrc.includes('trunc(min(${shortEdge},ih)/2)*2'));
    assert.ok(vcSrc.includes('${maxBytes}:'));

    // 7. Fast model whitelist (gemini-4-hydrogen & gemini-3.8-flash) + default vision route
    assert.equal(isAllowedRelayModel('gemini-4-hydrogen'), true);
    assert.equal(isAllowedRelayModel('gemini4h'), true);
    assert.equal(isAllowedRelayModel('hydrogen'), true);
    assert.equal(isAllowedRelayModel('gemini-3.8-flash'), true);
    assert.equal(isAllowedRelayModel('gemini3.8'), true);
    assert.equal(isAllowedRelayModel('gemini-2.5-pro'), false);
    assert.equal(isAllowedRelayModel('gpt-4o'), false);
  }

  console.log('PASS: step5-production-arch (ffmpeg, fallback preservation, /v1beta SSE, 403/524 retry, strict native bypass, async pause/checkpoint/resume, orphan reconcile, atomic store, UI/deploy)');
} finally {
  globalThis.fetch = origFetch;
  if (origFixture === undefined) delete process.env.STUDIO_LLM_FIXTURE;
  else process.env.STUDIO_LLM_FIXTURE = origFixture;
  if (origStrict === undefined) delete process.env.STUDIO_STRICT_NATIVE_GEMINI;
  else process.env.STUDIO_STRICT_NATIVE_GEMINI = origStrict;
  if (origFullVideo === undefined) delete process.env.STUDIO_STRICT_NATIVE_FULL_VIDEO;
  else process.env.STUDIO_STRICT_NATIVE_FULL_VIDEO = origFullVideo;
  if (origStrictKey === undefined) delete process.env.STUDIO_STRICT_NATIVE_API_KEY;
  else process.env.STUDIO_STRICT_NATIVE_API_KEY = origStrictKey;
  if (origFfmpegDisabled === undefined) delete process.env.STUDIO_FFMPEG_DISABLED;
  else process.env.STUDIO_FFMPEG_DISABLED = origFfmpegDisabled;
  if (origFfmpegPath === undefined) delete process.env.STUDIO_FFMPEG_PATH;
  else process.env.STUDIO_FFMPEG_PATH = origFfmpegPath;
  if (origConcurrency === undefined) delete process.env.STUDIO_TRANSCRIBE_CONCURRENCY;
  else process.env.STUDIO_TRANSCRIBE_CONCURRENCY = origConcurrency;
  delete globalThis.__STUDIO_PERSISTENT_STORE__;
  delete globalThis.__STUDIO_TRANSCRIBE_JOBS__;
  process.chdir(origCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
}
