// Helper-contract tests for parseTranscribeDeliveryBodies (offline, no HTTP/route E2E).
import ts from 'typescript';
import fs from 'node:fs';
import assert from 'node:assert/strict';

async function loadTsModule(relativePath) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    fileName: relativePath,
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

const parseModule = await loadTsModule('../lib/transcribe-parse.ts');
const guardModule = await loadTsModule('../lib/transcribe-delivery-guard.ts');
const strict = parseModule.parseTranscribeDeliveryBodies;
const { parseEpisodeBodiesFromSingleSource, mergePerSourceEpisodeBodies } = parseModule;
const { inspectTranscribeBodiesDelivery } = guardModule;

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed++;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

const entries = (map) => Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
const keys = (map) => entries(map).map(([ep]) => ep);
const makeBody = (n) => `第${n}集 场次${n}-1 内景 客厅 日\n▲ 林晚推门走进客厅，环顾四周。\n林晚：有人在家吗？`;
const validBody = '第1集 场次1-1 内景 客厅 日\n▲ 林晚推门走进客厅，环顾四周。\n林晚：有人在家吗？';
const PEOPLE = '【全剧人物标准人名锚定表】\n林晚：女主，二十五岁\n周衍：男主';
const SYNOPSIS = '【本集核心剧情梗概】\n林晚回到家中，发现周衍已在客厅等候。';
const BODY_HEADING = '【分集分场次还原剧本】';
const twoScenes = `${validBody}\n第1集 场次1-2 外景 院子 夜\n▲ 周衍站在树下。\n周衍：你终于来了。`;

function expectEmpty(label, text, episodes) {
  const out = strict(text, episodes);
  assert.ok(out instanceof Map, `${label}: must return a Map`);
  assert.equal(out.size, 0, `${label}: expected empty Map, got ${JSON.stringify(entries(out))}`);
}

await test('fixture matches the guard test constant', () => {
  assert.equal(makeBody(1), validBody);
});

await test('actual three-section reply: exact body, metadata excluded, no added H3', () => {
  const reply = [PEOPLE, '', SYNOPSIS, '', BODY_HEADING, validBody].join('\n');
  const out = strict(reply, [1]);
  assert.deepEqual(entries(out), [[1, validBody]]);
  const body = out.get(1);
  assert.ok(!body.includes('【'));
  assert.ok(!body.includes('女主'));
  assert.ok(!/^#{1,6}\s/m.test(body));
  assert.ok(body.startsWith('第1集 场次1-1 内景 客厅 日'));
});

await test('repeated scene lines of the same episode stay one episode', () => {
  const reply = [PEOPLE, SYNOPSIS, BODY_HEADING, twoScenes].join('\n\n');
  assert.deepEqual(entries(strict(reply, [1])), [[1, twoScenes]]);
});

await test('following non-body section is cut off', () => {
  const reply = [PEOPLE, SYNOPSIS, BODY_HEADING, twoScenes, '【自检】\n全部通过'].join('\n\n');
  assert.deepEqual(entries(strict(reply, [1])), [[1, twoScenes]]);
});

await test('body markers 【正文】 and 【剧本正文】 are supported', () => {
  for (const marker of ['【正文】', '【剧本正文】']) {
    const reply = [PEOPLE, SYNOPSIS, marker, validBody].join('\n');
    assert.deepEqual(entries(strict(reply, [1])), [[1, validBody]], marker);
  }
});

await test('singleton without explicit episode, clear marked scene, trusted [10]', () => {
  const body = '场次1-1 内景 书房 夜\n▲ 周衍翻开账本。\n周衍：果然是这样。';
  assert.deepEqual(entries(strict(`【正文】\n${body}`, [10])), [[10, body]]);
});

await test('multi-episode scene lines without H3 split by scene episode', () => {
  const reply = [BODY_HEADING, twoScenes, makeBody(2)].join('\n');
  const out = strict(reply, [1, 2]);
  assert.deepEqual(entries(out), [[1, twoScenes], [2, makeBody(2)]]);
});

await test('old independent H2 and H3 documents remain compatible', () => {
  const h2 = `## 第1集\n${makeBody(1)}\n\n## 第2集\n${makeBody(2)}`;
  assert.deepEqual(entries(strict(h2, [1, 2])), [
    [1, `## 第1集\n${makeBody(1)}`],
    [2, `## 第2集\n${makeBody(2)}`],
  ]);
  const h3 = `### 第1集\n${makeBody(1)}\n\n### 第2集\n${makeBody(2)}`;
  assert.deepEqual(keys(strict(h3, [1, 2])), [1, 2]);
});

await test('sparse [1,10] and [1,12] map exactly with no filling', () => {
  const doc10 = `### 第1集\n${makeBody(1)}\n\n### 第10集\n${makeBody(10)}`;
  const out10 = strict(doc10, [1, 10]);
  assert.deepEqual(keys(out10), [1, 10]);
  assert.equal(out10.get(10), `### 第10集\n${makeBody(10)}`);
  const doc12 = `## 第1集\n${makeBody(1)}\n\n## 第12集\n${makeBody(12)}`;
  assert.deepEqual(keys(strict(doc12, [1, 12])), [1, 12]);
});

await test('invalid sourceEpisodes or text return empty', () => {
  for (const eps of [[], [0], [301], [1, 1], [1.5], [NaN], ['1'], null, undefined, 1]) {
    expectEmpty(`eps=${JSON.stringify(eps)}`, validBody, eps);
  }
  expectEmpty('null text', null, [1]);
  expectEmpty('blank text', '  \n ', [1]);
});

await test('metadata-only and blank body return empty', () => {
  expectEmpty('no marker, meta only', `${PEOPLE}\n\n${SYNOPSIS}`, [1]);
  expectEmpty('marker, blank body', `${PEOPLE}\n${SYNOPSIS}\n${BODY_HEADING}\n`, [1]);
  expectEmpty('marker followed by people table', `${BODY_HEADING}\n${PEOPLE}`, [1]);
  expectEmpty('marker followed by synopsis', `${PEOPLE}\n${BODY_HEADING}\n${SYNOPSIS}`, [1]);
});

await test('headerless bodies need marker and genuine structure', () => {
  const unmarked = '场次1-1 内景 书房 夜\n▲ 周衍翻开账本。\n周衍：果然是这样。';
  expectEmpty('no marker', unmarked, [10]);
  expectEmpty('marker + prose', '【正文】\n这是一段普通的叙述文字。林晚说：你好。', [10]);
  expectEmpty('marker + scene only', '【正文】\n场次1-1 内景 书房 夜', [10]);
  expectEmpty('marker + dialogue without scene', '【正文】\n林晚：你好。\n▲ 她转身。', [10]);
  expectEmpty('headerless for multi mapping', `【正文】\n${unmarked}`, [1, 10]);
  const legacy = parseEpisodeBodiesFromSingleSource('随便一段文字', 10);
  assert.equal(legacy.get(10), '随便一段文字');
});

await test('placeholder and fake bodies return empty', () => {
  expectEmpty('fake phrase', '### 第1集\n暂无正文', [1]);
  expectEmpty('only 略', '### 第1集\n略', [1]);
  expectEmpty('heading only', '### 第1集', [1]);
  expectEmpty('fake phrase inside real body', `${BODY_HEADING}\n${validBody}\n（此处省略）`, [1]);
  expectEmpty('placeholder with marker', '【正文】\n暂无正文', [10]);
});

await test('wrong, out-of-mapping and multiple episodes return empty', () => {
  expectEmpty('singleton wrong scene episode', `${BODY_HEADING}\n${makeBody(2)}`, [3]);
  expectEmpty('singleton wrong heading', `### 第2集\n${makeBody(2)}`, [1]);
  expectEmpty('singleton explicit multiple', `### 第1集\n${makeBody(1)}\n### 第2集\n${makeBody(2)}`, [1]);
  expectEmpty('singleton scenes of two episodes', `${BODY_HEADING}\n${makeBody(1)}\n${makeBody(2)}`, [1]);
  expectEmpty('extra episode outside mapping', `## 第1集\n${makeBody(1)}\n## 第3集\n${makeBody(3)}`, [1, 2]);
  expectEmpty('mapped episode missing', `### 第1集\n${makeBody(1)}`, [1, 10]);
});

await test('conflicting episode numbers in scene lines return empty', () => {
  expectEmpty('H3 1 then scene of 2', `### 第1集\n${makeBody(2)}`, [1, 2]);
  expectEmpty('scene 1,2,1', `${BODY_HEADING}\n${makeBody(1)}\n${makeBody(2)}\n${makeBody(1)}`, [1, 2]);
  expectEmpty('duplicate non-adjacent headings', `## 第1集\n${makeBody(1)}\n## 第2集\n${makeBody(2)}\n## 第1集\n${makeBody(1)}`, [1, 2]);
});

await test('duplicate markers, preamble, fences and JSON return empty', () => {
  expectEmpty('duplicate markers', `【正文】\n${validBody}\n【剧本正文】\n${validBody}`, [1]);
  expectEmpty('preamble prose', `好的，以下是结果：\n【正文】\n${validBody}`, [1]);
  expectEmpty('code fence wrapper', '```\n' + `【正文】\n${validBody}` + '\n```', [1]);
  expectEmpty('json wrapper', JSON.stringify({ episode: 1, body: validBody, meta: PEOPLE }), [1]);
  expectEmpty('duplicate synopsis', `${SYNOPSIS}\n${SYNOPSIS}\n【正文】\n${validBody}`, [1]);
});

await test('legacy permissive parser still accepts multi-heading documents', () => {
  const doc = '## 第1集\nA内容\n## 第2集\nB内容';
  const single = parseEpisodeBodiesFromSingleSource(doc);
  assert.deepEqual(keys(single), [1, 2]);
  assert.ok(single.get(1).includes('A内容'));
  const merged = mergePerSourceEpisodeBodies([
    { episode: 1, text: `### 第1集\n${makeBody(1)}` },
    { episode: 10, text: `### 第10集\n${makeBody(10)}` },
  ]);
  assert.deepEqual(keys(merged), [1, 10]);
});

await test('real guard accepts valid helper output and refuses invalid', () => {
  const three = strict([PEOPLE, SYNOPSIS, BODY_HEADING, validBody].join('\n'), [1]);
  assert.equal(inspectTranscribeBodiesDelivery([1], three).ok, true);

  const sparse = strict(`### 第1集\n${makeBody(1)}\n\n### 第10集\n${makeBody(10)}`, [1, 10]);
  assert.equal(inspectTranscribeBodiesDelivery([1, 10], sparse).ok, true);

  const rejected = strict('### 第1集\n暂无正文', [1]);
  assert.equal(rejected.size, 0);
  const emptyResult = inspectTranscribeBodiesDelivery([1], rejected);
  assert.equal(emptyResult.ok, false);
  assert.ok(emptyResult.missingEpisodes.includes(1));

  assert.equal(inspectTranscribeBodiesDelivery([1], new Map([[1, '暂无正文']])).ok, false);
  assert.equal(inspectTranscribeBodiesDelivery([1, 10], new Map([[1, validBody]])).ok, false);
});

if (failed > 0) {
  console.error(`${failed} test(s) failed`);
  process.exitCode = 1;
}
