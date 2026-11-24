#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
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
const origFixture = process.env.STUDIO_LLM_FIXTURE;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'step6-creative-'));

function extractZipEntry(zipBuf, targetName) {
  let offset = 0;
  while (offset + 30 <= zipBuf.length) {
    if (zipBuf.readUInt32LE(offset) !== 0x04034b50) break;
    const method = zipBuf.readUInt16LE(offset + 8);
    const compSize = zipBuf.readUInt32LE(offset + 18);
    const nameLen = zipBuf.readUInt16LE(offset + 26);
    const extraLen = zipBuf.readUInt16LE(offset + 28);
    const name = zipBuf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const compData = zipBuf.subarray(dataStart, dataStart + compSize);
    if (name === targetName) {
      if (method === 0) return compData.toString('utf8');
      if (method === 8) return zlib.inflateRawSync(compData).toString('utf8');
    }
    offset = dataStart + compSize;
  }
  return null;
}

try {
  process.chdir(tmp);
  delete process.env.STUDIO_LLM_FIXTURE;
  delete globalThis.__STUDIO_PERSISTENT_STORE__;

  const server = await imp('lib/server.ts');
  const studio = await imp('app/api/studio/route.ts');
  const docx = await imp('lib/docx.ts');
  const { runDirectorGenerate } = await imp('lib/director-generate.ts');

  const store = server.getStore();

  // 1. All 6 default station routes must use whitelisted models
  for (const [role, route] of Object.entries(store.systemConfig.routes)) {
    assert.equal(server.isAllowedRelayModel(route.primaryModel), true, `route.${role}.primaryModel (${route.primaryModel}) must be whitelisted`);
    assert.equal(server.isAllowedRelayModel(route.fallbackModel), true, `route.${role}.fallbackModel (${route.fallbackModel}) must be whitelisted`);
    assert.equal(server.isAllowedRelayModel(route.fallbackModel2), true, `route.${role}.fallbackModel2 (${route.fallbackModel2}) must be whitelisted`);
  }

  // Configure mock provider
  store.systemConfig.providers = store.systemConfig.providers.map((pr) =>
    pr.id === 'prov-openai' || pr.id === 'prov-gemini'
      ? { ...pr, enabled: true, baseUrl: 'https://mock-relay.local/v1', apiKeys: ['sk-test-offline'] }
      : { ...pr, enabled: false }
  );
  const TOKEN = store.accounts[0].accessKey;
  const H = { 'content-type': 'application/json', 'x-studio-token': TOKEN };

  const seenPrompts = [];
  let forceFail = false;

  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body || '{}'));
    const userMsg =
      body.messages?.find((m) => m.role === 'user')?.content ||
      body.contents?.[0]?.parts?.map((pt) => pt.text || '').join('\n') ||
      '';
    seenPrompts.push({ url: String(url), model: body.model || '', prompt: String(userMsg) });

    if (forceFail) {
      return new Response(JSON.stringify({ error: { message: 'mock upstream fail' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    let reply = '总编剧复述确认：已核对集数与核心要求，建议强化开篇三秒反差钩子。';
    if (userMsg.includes('终审复核')) {
      reply = [
        '### 终审精修总结',
        '全剧已过节奏与台词张力终审，前序锁定稿一字未动。',
        '',
        '## 第4集',
        '4-1 慈善晚宴主厅 夜 内',
        '人物：梅森、艾玛',
        '△ 聚光灯落在宴会厅中央，艾玛挽着梅森的手步入会场。',
        '艾玛：准备好迎接他们的表情了吗？',
      ].join('\n');
    } else if (userMsg.includes('核心人物小传') && userMsg.includes('分集细纲')) {
      reply = [
        '### 核心人物小传',
        '- 梅森：重生商界奇才，表面克制实则步步为营。',
        '- 艾玛：冷静敏锐的投行执行长，与梅森双向奔赴。',
        '',
        '### 分集细纲（首批 10 集）',
        '第1集：病房重逢；第2集：锁定旧案；第3集：董事会打脸反杀。',
        '',
        '## 第1集',
        '试图覆盖锁定第1集（测试守卫必须拦截）。',
        '',
        '## 第3集',
        '3-1 董事会会议室 日 内',
        '人物：梅森、艾玛、反派董事',
        '△ 梅森推开大门，将原始股权协议摔在桌面，全场哗然。',
        '梅森：今天起，这间会议室的规矩由我来定。',
      ].join('\n');
    } else if (userMsg.includes('提供 2-3 套主线与对手升级方案')) {
      reply = '### ★ 首推方案 A：契约反杀线\n简化主线单：被陷害的重生继承人借联姻夺回家族控制权，在 30 集付费卡点当众亮出股权底牌。';
    } else if (userMsg.includes('桥段出海四级诊断')) {
      reply = '### 四级诊断\n第一道门（世界观）：豪门家族信托博弈。\n第二道门（人设）：女主冷面反杀。\n第三道门（桥段替换）：用董事会公开对赌替代传统家宴冲突。';
    }

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: reply }, finish_reason: 'stop' }],
        usage: { total_tokens: 120 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  async function callApi(payload) {
    const res = await studio.POST(
      new Request('http://localhost/api/studio', {
        method: 'POST',
        headers: H,
        body: JSON.stringify(payload),
      })
    );
    const json = await res.json();
    return { status: res.status, json };
  }

  // 2. Foreign workflow with lockedEpisodes = 2 -> must preserve EP1/EP2 verbatim, hydrate EP3/EP4, attach .docx card
  const LOCKED_EP1_TEXT = 'LOCKED_EP1_VERBATIM_BODY_DO_NOT_TOUCH';
  const LOCKED_EP2_TEXT = 'LOCKED_EP2_VERBATIM_BODY_DO_NOT_TOUCH';
  let { status, json: fProj } = await callApi({
    operation: 'create',
    title: '契约回归·国外迭代测试',
    kind: 'foreign',
    brief: '全剧 10 集，前 2 集已锁定，从第 3 集续写商战复仇与双强拉扯。UNIQUE_BRIEF_TOKEN_FOREIGN',
  });
  assert.equal(status, 201);
  assert.equal(fProj.lockedEpisodes, 2);

  // Seed locked EP1 & EP2
  ({ json: fProj } = await callApi({
    operation: 'save_workspace',
    id: fProj.id,
    version: fProj.version,
    episodes: [
      { id: 'ep-1', episodeNumber: 1, title: '第 1 集', body: LOCKED_EP1_TEXT, locked: true },
      { id: 'ep-2', episodeNumber: 2, title: '第 2 集', body: LOCKED_EP2_TEXT, locked: true },
    ],
  }));
  ({ json: fProj } = await callApi({ operation: 'confirm', id: fProj.id, version: fProj.version }));
  ({ json: fProj } = await callApi({ operation: 'connect', id: fProj.id, version: fProj.version }));

  // Step 2: mainline
  ({ json: fProj } = await callApi({
    operation: 'action', id: fProj.id, version: fProj.version,
    action: { action_id: 'f-a1', action: 'confirm', version: fProj.remote.version, answers: { scope: 'ok' } },
  }));
  assert.equal(fProj.remote.stage.key, 'mainline_understood');
  assert.ok(fProj.outlineNodes.length >= 1, 'foreign mainline must hydrate outlineNodes');
  assert.ok(
    seenPrompts[seenPrompts.length - 1].prompt.includes('UNIQUE_BRIEF_TOKEN_FOREIGN'),
    'stage prompt must carry project brief context'
  );

  // Step 3: script_episodes (LLM output attempts to overwrite EP1 -> MUST be ignored; EP3 MUST be hydrated)
  ({ json: fProj } = await callApi({
    operation: 'action', id: fProj.id, version: fProj.version,
    action: { action_id: 'f-a2', action: 'confirm', version: fProj.remote.version, answers: { selection: 'A', understood: true } },
  }));
  assert.equal(fProj.remote.stage.key, 'script_episodes');
  assert.equal(fProj.episodes.find((e) => e.episodeNumber === 1)?.body, LOCKED_EP1_TEXT, 'locked EP1 must remain verbatim');
  assert.equal(fProj.episodes.find((e) => e.episodeNumber === 2)?.body, LOCKED_EP2_TEXT, 'locked EP2 must remain verbatim');
  assert.ok(fProj.episodes.find((e) => e.episodeNumber === 3)?.body.includes('董事会会议室'), 'unlocked EP3 must be hydrated');
  assert.ok(fProj.characterNodes.length >= 1, 'foreign script_episodes must hydrate characterNodes');

  // Step 4: delivery
  ({ json: fProj } = await callApi({
    operation: 'action', id: fProj.id, version: fProj.version,
    action: { action_id: 'f-a3', action: 'confirm', version: fProj.remote.version, answers: { ending: 'ok' } },
  }));
  assert.equal(fProj.remote.status, 'delivered');
  assert.ok(fProj.episodes.find((e) => e.episodeNumber === 4)?.body.includes('慈善晚宴'), 'delivery must hydrate EP4');
  assert.equal(fProj.episodes.find((e) => e.episodeNumber === 1)?.body, LOCKED_EP1_TEXT, 'locked EP1 still verbatim after delivery');
  assert.ok(
    fProj.messages.some((m) => m.file?.url === `/api/upload?id=${fProj.id}&export=docx`),
    'delivery must attach clickable .docx file card'
  );
  const fDocxBuf = docx.buildDocxBuffer(docx.projectToDocxInput(fProj));
  const fXml = extractZipEntry(fDocxBuf, 'word/document.xml') || '';
  assert.ok(fXml.includes(LOCKED_EP1_TEXT) && fXml.includes('董事会会议室') && fXml.includes('慈善晚宴'));

  // 3. Domestic workflow (includes 3-gates -> worldNodes -> mainline -> script -> delivery + honest failure check)
  let { json: dProj } = await callApi({
    operation: 'create',
    title: '豪门出海·国内迭代测试',
    kind: 'domestic',
    brief: '全剧 12 集，国内豪门复仇剧本土化出海改造。UNIQUE_BRIEF_TOKEN_DOMESTIC',
  });
  ({ json: dProj } = await callApi({ operation: 'confirm', id: dProj.id, version: dProj.version }));
  ({ json: dProj } = await callApi({ operation: 'connect', id: dProj.id, version: dProj.version }));

  // Honest failure test: when LLM fails in real mode, must NOT advance cursor or fake success
  forceFail = true;
  const { json: dFail } = await callApi({
    operation: 'action', id: dProj.id, version: dProj.version,
    action: { action_id: 'd-fail', action: 'confirm', version: dProj.remote.version, answers: { scope: 'ok' } },
  });
  assert.equal(dFail.remote.status, 'failed', 'failed LLM stage must NOT fake success');
  assert.equal(dFail.remote.cursor, 1, 'failed stage must roll back cursor');
  forceFail = false;

  // Resume and complete domestic 4 stages
  dProj = dFail;
  ({ json: dProj } = await callApi({
    operation: 'action', id: dProj.id, version: dProj.version,
    action: { action_id: 'd-a1', action: 'confirm', version: dProj.remote.version, answers: { scope: 'ok' } },
  }));
  assert.equal(dProj.remote.stage.key, 'domestic_gates');
  assert.ok(dProj.worldNodes.length >= 1, 'domestic gates must hydrate worldNodes');

  ({ json: dProj } = await callApi({
    operation: 'action', id: dProj.id, version: dProj.version,
    action: { action_id: 'd-a2', action: 'confirm', version: dProj.remote.version, answers: { worldview_gate: 'ok' } },
  }));
  assert.equal(dProj.remote.stage.key, 'mainline_understood');

  ({ json: dProj } = await callApi({
    operation: 'action', id: dProj.id, version: dProj.version,
    action: { action_id: 'd-a3', action: 'confirm', version: dProj.remote.version, answers: { selection: 'A', understood: true } },
  }));
  assert.equal(dProj.remote.stage.key, 'script_episodes');

  ({ json: dProj } = await callApi({
    operation: 'action', id: dProj.id, version: dProj.version,
    action: { action_id: 'd-a4', action: 'confirm', version: dProj.remote.version, answers: { ending: 'ok' } },
  }));
  assert.equal(dProj.remote.status, 'delivered');
  const dDocxXml = extractZipEntry(docx.buildDocxBuffer(docx.projectToDocxInput(dProj)), 'word/document.xml') || '';
  assert.ok(dDocxXml.includes('桥段出海四级诊断与三道门方案'), 'domestic docx must include Gates section');

  // 4. Original workflow + director_generate context injection check
  let { json: oProj } = await callApi({
    operation: 'create',
    title: '时间银行·原创短剧测试',
    kind: 'original',
    brief: '全剧 8 集，女主用剩余寿命交易记忆破局反杀。UNIQUE_BRIEF_TOKEN_ORIGINAL',
  });
  ({ json: oProj } = await callApi({ operation: 'confirm', id: oProj.id, version: oProj.version }));
  ({ json: oProj } = await callApi({ operation: 'connect', id: oProj.id, version: oProj.version }));
  ({ json: oProj } = await callApi({
    operation: 'action', id: oProj.id, version: oProj.version,
    action: { action_id: 'o-a1', action: 'confirm', version: oProj.remote.version, answers: { total: 8, audience: '女频' } },
  }));
  assert.equal(oProj.remote.stage.key, 'script_episodes');
  assert.ok(seenPrompts[seenPrompts.length - 1].prompt.includes('UNIQUE_BRIEF_TOKEN_ORIGINAL'));
  ({ json: oProj } = await callApi({
    operation: 'action', id: oProj.id, version: oProj.version,
    action: { action_id: 'o-a2', action: 'confirm', version: oProj.remote.version, answers: { ending: 'ok' } },
  }));
  assert.equal(oProj.remote.status, 'delivered');
  assert.ok(oProj.episodes.length >= 1 && oProj.characterNodes.length >= 1 && oProj.outlineNodes.length >= 1);

  // Verify director_generate injects full project context
  let capturedDirPrompt = '';
  const dirRes = await runDirectorGenerate({
    project: oProj,
    task: 'episode',
    episodeNumber: 5,
    text: '写第5集银行金库摊牌戏',
    fixtureMode: false,
    callLLM: async ({ userPrompt }) => {
      capturedDirPrompt = userPrompt;
      return { ok: true, text: '# 第5集 金库摊牌\n5-1 地下金库 夜 内\n△ 女主亮出时间契约。' };
    },
  });
  assert.equal(dirRes.ok, true);
  assert.ok(capturedDirPrompt.includes('时间银行·原创短剧测试'), 'director_generate must inject title');
  assert.ok(capturedDirPrompt.includes('UNIQUE_BRIEF_TOKEN_ORIGINAL'), 'director_generate must inject brief');
  assert.ok(capturedDirPrompt.includes('已有大纲'), 'director_generate must inject existing outline');
  assert.ok(capturedDirPrompt.includes('已有人物设定'), 'director_generate must inject existing characters');
  assert.ok(capturedDirPrompt.includes('上一集'), 'director_generate must inject previous episode continuity');

  console.log('PASS: step6-creative-workflows (routes whitelist, foreign/domestic/original stages, locked guard, honest failure, workspace hydration, docx, director context)');
} finally {
  globalThis.fetch = origFetch;
  if (origFixture === undefined) delete process.env.STUDIO_LLM_FIXTURE;
  else process.env.STUDIO_LLM_FIXTURE = origFixture;
  delete globalThis.__STUDIO_PERSISTENT_STORE__;
  process.chdir(origCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
}
