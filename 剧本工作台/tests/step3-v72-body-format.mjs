import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

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

const root = new URL('../', import.meta.url);
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'step3-v72-format-'));
process.chdir(tmp);
delete process.env.STUDIO_LLM_FIXTURE;

globalThis.fetch = () => {
  throw new Error('network forbidden in offline V7.2 format contract test');
};

const imp = (p) => import(new URL(p, root).href);
const formatMod = await imp('lib/transcribe-format.ts');
const parseMod = await imp('lib/transcribe-parse.ts');
const guardMod = await imp('lib/transcribe-delivery-guard.ts');
const docxMod = await imp('lib/docx.ts');
const serverMod = await imp('lib/server.ts');
const studioRoute = await imp('app/api/studio/route.ts');
const uploadRoute = await imp('app/api/upload/route.ts');
const { extractManuscriptTextFromBuffer } = await imp('lib/manuscript-extract.ts');

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

// ---------------------------------------------------------------------------
// 1. Prompt guidance alignment (no legacy ▲ or 旧单行场头)
// ---------------------------------------------------------------------------
assert.ok(!formatMod.TRANSCRIBE_V72_OUTPUT_GUIDE.includes('▲'), 'outputGuide must not require ▲');
assert.ok(formatMod.TRANSCRIBE_V72_OUTPUT_GUIDE.includes('△'), 'outputGuide must require △');
assert.ok(formatMod.TRANSCRIBE_V72_OUTPUT_GUIDE.includes('## 第N集'), 'outputGuide must require ## 第N集');
assert.ok(formatMod.TRANSCRIBE_V72_OUTPUT_GUIDE.includes('【正文】'), 'outputGuide must require 【正文】');
assert.ok(formatMod.TRANSCRIBE_V72_OUTPUT_GUIDE.includes('人物：'), 'outputGuide must require two-line 人物：');
assert.ok(!formatMod.TRANSCRIBE_V72_VISION_SYSTEM_PROMPT.includes('▲'), 'vision systemPrompt must not require ▲');
assert.ok(formatMod.TRANSCRIBE_V72_VISION_SYSTEM_PROMPT.includes('△'), 'vision systemPrompt must require △');

// ---------------------------------------------------------------------------
// 2. Parser & Delivery Guard accept V7.2 format (single & multi-episode, simp & trad, long parentheticals)
// ---------------------------------------------------------------------------
const v72Single = [
  '## 第1集',
  '',
  '【正文】',
  '1-1 办公室 日 内',
  '人物：林晓、周明',
  '',
  '△ 林晓推门进入，将文件放到周明面前。',
  '林晓（压低声音，眼神紧盯合同签字栏）：你看清楚再签。',
  '△ 周明翻开文件，手停在签名处，抬头看向林晓。',
  '【人物字幕：周明 项目总监】',
  '周明：谁给你的？',
].join('\n');

const parsedSingle = parseMod.parseTranscribeDeliveryBodies(v72Single, [1]);
assert.equal(parsedSingle.size, 1, 'parser must accept V7.2 single episode');
assert.equal(guardMod.inspectTranscribeBodiesDelivery([1], parsedSingle).ok, true, 'guard must accept V7.2 single episode');
assert.equal(formatMod.inspectV72BodyFormat(v72Single, 1).ok, true, 'V7.2 format check must pass');

const v72Multi = [
  v72Single,
  '',
  '---',
  '',
  '## 第2集',
  '',
  '【正文】',
  '2-1 走廊 夜 内',
  '人物：周明',
  '',
  '△ 走廊灯光忽明忽暗，周明握着手机靠在墙边。',
  '周明（电话声）：文件已经送到她手里了，马上查来源。',
].join('\n');

const parsedMulti = parseMod.parseTranscribeDeliveryBodies(v72Multi, [1, 2]);
assert.deepEqual(Array.from(parsedMulti.keys()).sort((a, b) => a - b), [1, 2], 'parser must accept V7.2 multi-episode');
assert.equal(guardMod.inspectTranscribeBodiesDelivery([1, 2], parsedMulti).ok, true, 'guard must accept V7.2 multi-episode');

// Reject empty V7.2 body `## 第1集\n\n【正文】`
assert.equal(parseMod.parseTranscribeDeliveryBodies('## 第1集\n\n【正文】', [1]).size, 0, 'empty V7.2 body must be rejected');

// Traditional V7.2 scene line `1-1 客廳 日 內`
const v72TradSingle = [
  '## 第1集',
  '',
  '【正文】',
  '1-1 客廳 日 內',
  '人物：林曉、周明',
  '',
  '△ 林曉推門進入，將文件放到周明面前。',
  '林曉：你看清楚再簽。',
].join('\n');
const parsedTradSingle = parseMod.parseTranscribeDeliveryBodies(v72TradSingle, [1]);
assert.equal(parsedTradSingle.size, 1, 'parser must accept traditional V7.2');
assert.equal(guardMod.inspectTranscribeBodiesDelivery([1], parsedTradSingle).ok, true, 'guard must accept traditional V7.2');

// ---------------------------------------------------------------------------
// 3. Legacy -> V7.2 mechanical normalization (exact 08:37 rules, 100% dialogue parity)
// ---------------------------------------------------------------------------
const legacySimp = [
  '### 第 1 集',
  '**第1集 场次1-1 内景 客厅 日**',
  '　　▲ 陈浩戴着耳机盯着电脑屏幕（字幕弹出人物介绍：【陈浩 男主】）。',
  '**陈浩（对着耳机麦克风，语气谄媚夹带喘息）**：妈妈，我们再开一把。[cite: 1]',
  '**第1集 场次1-2 内景 客厅 日**',
  '▲ 赵梅和陈建国并肩坐在沙发上（字幕弹出人物介绍：【赵梅 母亲】）。',
  '**赵梅（伸手轻拍陈建国的手背安抚）**：别气了，先看体检单。',
  '**陈建国**：这孩子再这样下去真要出事。',
  '**第1集 场次1-3 内景 走廊 日**',
  '▲ 陈建国右手扶住桌沿（特写手部失力发白滑落），随即重重摔倒在地。',
  '▲ 门缝处隐约可见赵梅焦急哭喊的身影。',
  '**陈浩**：吵什么吵，别打扰我打游戏！',
  '▲ 画面逐渐暗场黑屏。[cite: 1]',
  '---',
].join('\n');

const normalizedSimp = formatMod.normalizeTranscribeEpisodeBodyV72(legacySimp, 1, { traditional: false });
const checkSimp = formatMod.inspectV72BodyFormat(normalizedSimp, 1);
assert.equal(checkSimp.ok, true, `normalized simplified failed V7.2 check: ${checkSimp.issues.join('; ')}`);

// Exact 100% dialogue & speaker parity
assert.deepEqual(
  formatMod.extractDialogueLinesForParity(normalizedSimp),
  formatMod.extractDialogueLinesForParity(legacySimp),
  'dialogue lines & speakers must match 100% verbatim',
);
assert.equal(formatMod.extractDialogueLinesForParity(normalizedSimp).length, 4);

// Specific 08:37 mechanical assertions
assert.ok(normalizedSimp.startsWith('## 第1集\n\n【正文】\n1-1 客厅 日 内\n人物：陈浩\n'), '1-1 header & no hallucinated 妈妈 in 人物：');
assert.ok(normalizedSimp.includes('【人物字幕：陈浩 男主】'), 'character subtitle must be split onto own line');
assert.ok(normalizedSimp.includes('1-2 客厅 日 内\n人物：赵梅、陈建国'), '1-2 header & two characters');
assert.ok(
  normalizedSimp.includes('△ 陈建国右手扶住桌沿（特写手部失力发白滑落），随即重重摔倒在地。'),
  'mid-sentence parenthetical must NOT be split',
);
assert.ok(normalizedSimp.includes('1-3 走廊 日 内\n人物：陈建国、赵梅、陈浩'), '1-3 includes action-visible 赵梅 & 陈建国 + speaker 陈浩');
assert.ok(!normalizedSimp.includes('▲'), 'must not contain ▲');
assert.ok(!normalizedSimp.includes('[cite:'), 'must not contain [cite:]');
assert.ok(!normalizedSimp.includes('暗场黑屏'), 'must drop pure end-of-scene blackout transition');
assert.ok(!normalizedSimp.endsWith('---'), 'single-episode body must not end with ---');
assert.ok(!normalizedSimp.includes('**'), 'must not keep ** around speakers or scene headings');

const legacyTrad = [
  '### 第 1 集',
  '**第1集 場次1-1 內景 客廳 日**',
  '▲ 陳浩戴著耳機盯著電腦螢幕（字幕彈出人物介紹：【陳浩 男主】）。',
  '**陳浩（對著耳機麥克風，語氣諂媚夾帶喘息）**：媽媽，我們再開一把。',
  '▲ 畫面逐漸暗場黑屏。',
  '---',
].join('\n');
const normalizedTrad = formatMod.normalizeTranscribeEpisodeBodyV72(legacyTrad, 1, { traditional: true });
assert.equal(formatMod.inspectV72BodyFormat(normalizedTrad, 1).ok, true, 'normalized traditional must pass V7.2 check');
assert.ok(normalizedTrad.includes('1-1 客廳 日 內\n人物：陳浩'), 'traditional keeps 內');
assert.ok(normalizedTrad.includes('【人物字幕：陳浩 男主】'));
assert.ok(!normalizedTrad.includes('暗場黑屏'));

// ---------------------------------------------------------------------------
// 4. API normalize_transcribe_format + Word DOCX alignment (zero indent, no dup heading, web == Word)
// ---------------------------------------------------------------------------
const store = await serverMod.getStore();
store.accounts = [
  {
    id: 'owner',
    username: 'owner',
    accessKey: 'v72-owner-key',
    status: 'active',
    role: 'creator',
    budgetUsedUsd: 0,
    budgetCapUsd: 0,
    allowedFlows: ['transcribe', 'foreign', 'domestic', 'original'],
  },
];
store.systemConfig ||= {};
Object.assign(store.systemConfig, {
  requireAuthOnFrontend: true,
  providers: [],
  backendUrl: '',
  backendToken: '',
  mode: 'direct_llm',
});
store.projects = {};

const now = new Date().toISOString();
const seededProj = {
  id: 'p-v72-sync',
  title: 'V72格式统一验收测试',
  kind: 'transcribe',
  total: 1,
  brief: '',
  messages: [],
  attachments: [
    { id: 'att-1', name: 'ep01.mp4', size: 1024, type: 'video/mp4', role: 'source', episode: 1, coveredEpisodes: [1] },
  ],
  requirements: [],
  archived: false,
  createdAt: now,
  updatedAt: now,
  version: 1,
  confirmed: true,
  transcribeMode: 'fast',
  volumes: [{ id: 'vol-1', title: '第一卷', order: 1 }],
  episodes: [
    { id: 'ep-tr-1', volumeId: 'vol-1', episodeNumber: 1, title: '第 1 集', body: legacySimp, locked: false, updatedAt: now },
  ],
  outlineNodes: [{ id: 'out-tr-1', title: '全剧剧情梗概', body: parseMod.SYNOPSIS_PLACEHOLDER, order: 1, updatedAt: now }],
  characterNodes: [
    { id: 'char-tr-1', title: '核心角色锚定表', body: '人物定位与声线锚定已完成整理，详见交付 Word 文档。', order: 1, updatedAt: now },
  ],
  worldNodes: [],
  promptSelections: {},
  remote: {
    id: 'r-v72',
    version: 1,
    mode: 'test_channel',
    status: 'delivered',
    stage: { key: 'delivery', title: '已交付' },
    cursor: 2,
    progress: { completed_steps: 2, total_steps: 2 },
    card: null,
    outputs: {
      synopsis: { title: '故事梗概', content: parseMod.SYNOPSIS_PLACEHOLDER, updatedAt: now, version: 1 },
      characters: { title: '核心人物锚定表', content: '人物锚定表已归档。', updatedAt: now, version: 1 },
      script: { title: '分集扒剧还原正文', content: legacySimp, updatedAt: now, version: 1 },
      scriptTraditional: { title: '繁體版分集劇本', content: legacyTrad, updatedAt: now, version: 1 },
    },
    messages: [],
  },
};
store.projects['p-v72-sync'] = { owner: 'owner', data: JSON.stringify(seededProj), version: 1, updated_at: now };

const normRes = await studioRoute.POST(
  new Request('http://localhost/api/studio', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-studio-token': 'v72-owner-key' },
    body: JSON.stringify({ operation: 'normalize_transcribe_format', id: 'p-v72-sync', version: 1 }),
  }),
);
assert.equal(normRes.status, 200);
const normProj = await normRes.json();
assert.equal(normProj.episodes[0].title, '第1集');
assert.equal(normProj.episodes[0].body, normalizedSimp);
assert.equal(normProj.remote.outputs.script.content, normalizedSimp);
assert.equal(normProj.remote.outputs.scriptTraditional.content, normalizedTrad);
assert.equal(normProj.episodes[0].snapshots.length, 1, 'must save auto snapshot before normalization');

// Download DOCX through real upload route & inspect XML + text parity
const docxRes = await uploadRoute.GET(
  new Request('http://localhost/api/upload?id=p-v72-sync&export=docx', {
    headers: { 'x-studio-token': 'v72-owner-key' },
  }),
);
assert.equal(docxRes.status, 200);
const docxBuf = Buffer.from(await docxRes.arrayBuffer());
const stylesXml = extractZipEntry(docxBuf, 'word/styles.xml');
const documentXml = extractZipEntry(docxBuf, 'word/document.xml');
assert.ok(stylesXml && documentXml, 'docx XML parts must exist');

// Zero-indent assertions in Word XML
assert.ok(stylesXml.includes('w:firstLine="0" w:left="0"'), 'styles.xml must explicitly declare firstLine=0 left=0');
assert.ok(!stylesXml.includes('w:left="240"'), 'styles.xml must not indent ActionLine by 240');
assert.ok(documentXml.includes('w:firstLine="0" w:left="0"'), 'document.xml paragraphs must declare firstLine=0 left=0');
assert.ok(documentXml.includes('w:val="SceneHeading"'), 'V7.2 scene headers must render with SceneHeading style');
assert.ok(documentXml.includes('w:val="ActionLine"'), 'V7.2 △ lines must render with ActionLine style');

const extractedDocx = extractManuscriptTextFromBuffer(docxBuf, 'out.docx');
assert.equal(extractedDocx.error, undefined);
const docxText = extractedDocx.text;

// No duplicate episode heading & no placeholder synopsis/character sections
assert.ok(!docxText.includes('第 1 集 · 第 1 集'), 'Word must not duplicate 第 1 集 · 第 1 集');
assert.ok(!docxText.includes('一、故事梗概'), 'clean transcribe Word must not emit placeholder synopsis section');
assert.ok(!docxText.includes('二、人物小传与锚定表'), 'clean transcribe Word must not emit placeholder character section');
assert.ok(!docxText.includes('▲'), 'Word must not contain ▲');
assert.ok(!docxText.includes('[cite:'), 'Word must not contain [cite:]');
assert.ok(docxText.includes('【正文】'), 'Word must contain 【正文】');
assert.ok(docxText.includes('1-1 客厅 日 内'), 'Word main body must contain V7.2 scene header');
assert.ok(docxText.includes('附：繁體版分集劇本'), 'Word must retain bilingual traditional appendix');
assert.ok(docxText.includes('1-1 客廳 日 內'), 'Word traditional appendix must use V7.2 traditional header');

// Every dialogue line from web body must appear verbatim in Word
for (const dlg of formatMod.extractDialogueLinesForParity(normProj.remote.outputs.script.content)) {
  assert.ok(docxText.includes(dlg), `Word missing web dialogue line: ${dlg}`);
}

// ---------------------------------------------------------------------------
// 5. Offline CLI sync script (dry-run leaves file unchanged; apply backs up & syncs)
// ---------------------------------------------------------------------------
const cliStorePath = path.join(tmp, 'offline-store.json');
const cliStoreSeed = {
  accounts: store.accounts,
  invites: [],
  sessions: {},
  systemConfig: store.systemConfig,
  auditLogs: [{ id: 'audit-1', projectId: 'p-v72-sync' }],
  projects: {
    'p-v72-sync': { owner: 'owner', data: JSON.stringify(seededProj), version: 7, updated_at: now },
  },
};
await fs.writeFile(cliStorePath, JSON.stringify(cliStoreSeed, null, 2), 'utf8');
const cliScript = fileURLToPath(new URL('scripts/sync-transcribe-format-v72.mjs', root));

const dryRun = spawnSync(process.execPath, [cliScript, '--store', cliStorePath, '--dry-run'], { encoding: 'utf8' });
assert.equal(dryRun.status, 0, dryRun.stderr);
const dryJson = JSON.parse(dryRun.stdout);
assert.equal(dryJson.mode, 'dry-run');
assert.equal(dryJson.changedProjects, 1);
assert.equal(dryJson.backupPath, null);
// File on disk must be untouched after dry-run
assert.equal(JSON.parse(await fs.readFile(cliStorePath, 'utf8')).projects['p-v72-sync'].version, 7);

const applyRun = spawnSync(process.execPath, [cliScript, '--store', cliStorePath, '--apply'], { encoding: 'utf8' });
assert.equal(applyRun.status, 0, applyRun.stderr);
const applyJson = JSON.parse(applyRun.stdout);
assert.equal(applyJson.mode, 'apply');
assert.equal(applyJson.changedProjects, 1);
assert.ok(applyJson.backupPath && (await fs.stat(applyJson.backupPath)).isFile(), 'apply must write backup file');

const syncedDisk = JSON.parse(await fs.readFile(cliStorePath, 'utf8'));
assert.equal(syncedDisk.projects['p-v72-sync'].version, 8);
assert.equal(syncedDisk.auditLogs.length, 1, 'auditLogs must remain untouched');
const syncedProj = JSON.parse(syncedDisk.projects['p-v72-sync'].data);
assert.equal(syncedProj.episodes[0].body, normalizedSimp);
assert.equal(syncedProj.remote.outputs.scriptTraditional.content, normalizedTrad);

// ---------------------------------------------------------------------------
// 6. Relay mid-line chunk wrap repair (e.g. OpenAI-compat SSE aggregation quirks)
// ---------------------------------------------------------------------------
const brokenRelayRaw = [
  '## 第',
  '17集',
  '',
  '【正文】',
  '',
  '17-1 卧室 日 内',
  '',
  '人物：林深、苏晴',
  '',
  '△ 林',
  '深坐在书桌前翻看旧档案',
  '',
  '林深：好，我绝对不会',
  '多想',
  '',
  '17-2 走',
  '廊 日 内',
  '人物：值班护士、林深',
  '',
  '△ 门外传来敲',
  '门声',
  '',
  '值班护士：你必须为她考虑，',
  '你知道吗？',
].join('\n');

const repairedRelay = formatMod.repairBrokenRelayLineWraps(brokenRelayRaw);
assert.ok(repairedRelay.includes('## 第17集'), 'broken ## 第\\n17集 must be repaired');
assert.ok(repairedRelay.includes('17-2 走廊 日 内\n人物：值班护士、林深'), 'broken scene header must be repaired without merging 人物：');
assert.ok(repairedRelay.includes('△ 林深坐在书桌前翻看旧档案'), 'broken action line must be repaired');
assert.ok(repairedRelay.includes('林深：好，我绝对不会多想'), 'broken dialogue line must be repaired');
assert.ok(repairedRelay.includes('值班护士：你必须为她考虑，你知道吗？'), 'broken multi-clause dialogue must be repaired');

const parsedRepaired = parseMod.parseTranscribeDeliveryBodies(repairedRelay, [17]);
assert.equal(parsedRepaired.size, 1, 'repaired relay output must pass strict parser');
assert.equal(guardMod.inspectTranscribeBodiesDelivery([17], parsedRepaired).ok, true, 'repaired relay output must pass delivery guard');
const normRepaired = formatMod.normalizeTranscribeEpisodeBodyV72(parsedRepaired.get(17), 17);
assert.equal(formatMod.inspectV72BodyFormat(normRepaired, 17).ok, true, 'normalized repaired output must pass V7.2 check');

// Must NOT merge lines following already-complete standalone headers/markers
const negKeep = formatMod.repairBrokenRelayLineWraps('### 第1集\n暂无正文');
assert.equal(negKeep, '### 第1集\n暂无正文', 'complete episode heading must not merge next line');
assert.equal(parseMod.parseTranscribeDeliveryBodies(negKeep, [1]).size, 0, 'negative placeholder must still be rejected');

console.log('PASS: step3-v72-body-format (prompts, parser, guard, normalizer, relay-wrap-repair, web==Word XML, offline sync CLI)');
