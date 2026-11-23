import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadTs(rel) {
  const file = path.join(root, rel);
  const src = fs.readFileSync(file, 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    fileName: file,
  }).outputText;
  const mod = new Module(file, null);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  mod._compile(out, file);
  return mod.exports;
}

const { parseTranscribeDeliveryVariants, parseTranscribeDeliveryBodies } = loadTs('lib/transcribe-parse.ts');
const { inspectTranscribeBodiesDelivery } = loadTs('lib/transcribe-delivery-guard.ts');

const HEAD = [
  '### 1. 【全剧人物标准人名锚定表】',
  'META_PERSON_ONLY',
  '### 2. 【本集核心剧情梗概】',
  'META_SYNOPSIS_ONLY',
  '### 3. 【分集分场次还原剧本】',
].join('\n');

const TRAD_H = '#### 一、 繁體單集版';
const SIMP_H = '#### 二、 简体全集版';

const SIMP_LINES = [
  '▲ 昏暗杂乱的卧室内，电脑屏幕亮着，泡面桶堆在桌角，朱投戴着耳机盯着屏幕，手指飞快敲击键盘。',
  '**朱投**：妈妈，我们再开一把。',
  '▲ 母亲推开房门，手里端着一碗热腾腾的面条，看着满地的外卖盒，叹了口气，把碗放在书桌上。',
  '**母亲**：先吃饭，吃完再玩，你已经连续打了一整夜，身体会垮掉的。',
  '**朱投**：就这一把，赢了我马上去睡觉，我保证不骗你。',
  '▲ 母亲沉默片刻，伸手拉上窗帘，挡住缝隙里透进来的晨光，转身走出房间，轻轻带上了门。',
  '▲ 朱投摘下耳机，盯着关闭的房门看了很久，屏幕里的角色还站在原地，倒计时一秒一秒地跳动。',
  '**朱投**：其实我也想好好吃一顿饭，可是我已经停不下来了。',
];

const TRAD_LINES = [
  '▲ 昏暗雜亂的臥室內，電腦螢幕亮著，泡麵桶堆在桌角，朱投戴著耳機盯著螢幕，手指飛快敲擊鍵盤。',
  '**朱投**：媽媽，我們再開一把。',
  '▲ 母親推開房門，手裡端著一碗熱騰騰的麵條，看著滿地的外賣盒，嘆了口氣，把碗放在書桌上。',
  '**母親**：先吃飯，吃完再玩，你已經連續打了一整夜，身體會垮掉的。',
  '**朱投**：就這一把，贏了我馬上去睡覺，我保證不騙你。',
  '▲ 母親沉默片刻，伸手拉上窗簾，擋住縫隙裡透進來的晨光，轉身走出房間，輕輕帶上了門。',
  '▲ 朱投摘下耳機，盯著關閉的房門看了很久，螢幕裡的角色還站在原地，倒數計時一秒一秒地跳動。',
  '**朱投**：其實我也想好好吃一頓飯，可是我已經停不下來了。',
];

function sceneLine(ep, trad) {
  return trad
    ? `**第${ep}集 場次${ep}-1 內景 朱投臥室 日**`
    : `**第${ep}集 场次${ep}-1 内景 朱投卧室 日**`;
}

function block(ep, trad) {
  return [sceneLine(ep, trad)].concat(trad ? TRAD_LINES : SIMP_LINES).join('\n');
}

function blocks(eps, trad) {
  return eps.map((ep) => block(ep, trad)).join('\n');
}

function real(eps) {
  return [HEAD, TRAD_H, blocks(eps, true), SIMP_H, blocks(eps, false)].join('\n');
}

function assertEmpty(v, label) {
  assert.equal(v.primary.size, 0, `${label}: primary`);
  assert.equal(v.simplified, undefined, `${label}: simplified`);
  assert.equal(v.traditional, undefined, `${label}: traditional`);
}

const cases = [];
function test(name, fn) {
  cases.push([name, fn]);
}

test('real format: primary is simplified once, traditional retained, no metadata', () => {
  const v = parseTranscribeDeliveryVariants(real([1]), [1]);
  assert.deepEqual(Array.from(v.primary.keys()), [1]);
  assert.deepEqual(Array.from(v.simplified.keys()), [1]);
  assert.deepEqual(Array.from(v.traditional.keys()), [1]);
  const primary = v.primary.get(1);
  const trad = v.traditional.get(1);
  assert.equal(primary, v.simplified.get(1));
  assert.equal(primary, blocks([1], false));
  assert.equal(trad, blocks([1], true));
  assert.equal((primary.match(/电脑屏幕/g) || []).length, 1);
  assert.ok(!primary.includes('電腦螢幕'));
  assert.ok(trad.includes('場次1-1 內景'));
  assert.ok(!trad.includes('电脑屏幕'));
  for (const body of [primary, trad]) {
    assert.ok(!/META_|【|全剧人物|核心剧情|繁體單集版|简体全集版|####/.test(body));
  }
});

test('parseTranscribeDeliveryBodies delegates to variants.primary', () => {
  const text = real([1]);
  const bodies = parseTranscribeDeliveryBodies(text, [1]);
  assert.deepEqual(Array.from(bodies.entries()), Array.from(parseTranscribeDeliveryVariants(text, [1]).primary.entries()));
  assert.equal(parseTranscribeDeliveryBodies(text, []).size, 0);
  assert.equal(parseTranscribeDeliveryBodies(text, [1, 1]).size, 0);
  assert.equal(parseTranscribeDeliveryBodies(text, [0]).size, 0);
});

test('guard accepts the primary body', () => {
  const v = parseTranscribeDeliveryVariants(real([1]), [1]);
  const r = inspectTranscribeBodiesDelivery([1], v.primary);
  assert.equal(r.ok, true, r.reason);
  const t = inspectTranscribeBodiesDelivery([1], v.traditional);
  assert.equal(t.ok, true, t.reason);
});

test('version order and label aliases', () => {
  const text = [HEAD, '#### 簡體全集版', blocks([1], false), '#### 繁体单集版', blocks([1], true)].join('\n');
  const v = parseTranscribeDeliveryVariants(text, [1]);
  assert.equal(v.primary.get(1), blocks([1], false));
  assert.equal(v.traditional.get(1), blocks([1], true));
});

test('arbitrary headings are not version boundaries', () => {
  const text = [HEAD, '#### 一、 精修版', blocks([1], false), '#### 二、 终稿版', blocks([1], false)].join('\n');
  const v = parseTranscribeDeliveryVariants(text, [1]);
  assert.equal(v.simplified, undefined);
  assert.equal(v.traditional, undefined);
});

test('wrong episode in either version is rejected', () => {
  assertEmpty(
    parseTranscribeDeliveryVariants([HEAD, TRAD_H, blocks([2], true), SIMP_H, blocks([1], false)].join('\n'), [1]),
    'wrong trad'
  );
  assertEmpty(
    parseTranscribeDeliveryVariants([HEAD, TRAD_H, blocks([1], true), SIMP_H, blocks([2], false)].join('\n'), [1]),
    'wrong simp'
  );
  assertEmpty(
    parseTranscribeDeliveryVariants([HEAD, TRAD_H, blocks([1], true), SIMP_H, blocks([1, 2], false)].join('\n'), [1]),
    'multi in simp'
  );
});

test('duplicate, single or empty version headings are rejected', () => {
  assertEmpty(
    parseTranscribeDeliveryVariants([HEAD, TRAD_H, blocks([1], true), TRAD_H, blocks([1], true), SIMP_H, blocks([1], false)].join('\n'), [1]),
    'dup trad + simp'
  );
  assertEmpty(
    parseTranscribeDeliveryVariants([HEAD, TRAD_H, blocks([1], true), '#### 繁體版', blocks([1], true)].join('\n'), [1]),
    'two trad'
  );
  assertEmpty(
    parseTranscribeDeliveryVariants([HEAD, SIMP_H, blocks([1], false), SIMP_H, blocks([1], false)].join('\n'), [1]),
    'two simp'
  );
  assertEmpty(parseTranscribeDeliveryVariants([HEAD, SIMP_H, blocks([1], false)].join('\n'), [1]), 'only simp');
  assertEmpty(parseTranscribeDeliveryVariants([HEAD, TRAD_H, '', SIMP_H, blocks([1], false)].join('\n'), [1]), 'empty trad');
  assertEmpty(parseTranscribeDeliveryVariants([HEAD, TRAD_H, blocks([1], true), SIMP_H].join('\n'), [1]), 'empty simp');
});

test('metadata only, missing body, fake, fence and JSON are rejected', () => {
  const meta = HEAD.split('\n').slice(0, 4).join('\n');
  assertEmpty(parseTranscribeDeliveryVariants(meta, [1]), 'people+synopsis');
  assertEmpty(parseTranscribeDeliveryVariants(HEAD, [1]), 'marker only');
  const fakeSimp = [HEAD, TRAD_H, blocks([1], true), SIMP_H, sceneLine(1, false) + '\n暂无正文'].join('\n');
  assertEmpty(parseTranscribeDeliveryVariants(fakeSimp, [1]), 'fake simp');
  const fakeTrad = [HEAD, TRAD_H, sceneLine(1, true) + '\n占位', SIMP_H, blocks([1], false)].join('\n');
  assertEmpty(parseTranscribeDeliveryVariants(fakeTrad, [1]), 'fake trad');
  assertEmpty(parseTranscribeDeliveryVariants('```\n' + real([1]) + '\n```', [1]), 'fence');
  assertEmpty(parseTranscribeDeliveryVariants(JSON.stringify({ 1: blocks([1], false) }), [1]), 'json');
});

test('guard rejects missing, fake and scene-only bodies', () => {
  const missing = inspectTranscribeBodiesDelivery([1], new Map());
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missingEpisodes, [1]);
  assert.equal(inspectTranscribeBodiesDelivery([1], new Map([[1, '暂无正文']])).ok, false);
  assert.equal(inspectTranscribeBodiesDelivery([1], new Map([[1, sceneLine(1, true)]])).ok, false);
});

for (const eps of [[1, 10], [1, 12]]) {
  test(`sparse ${JSON.stringify(eps)} keeps strict source mapping`, () => {
    const v = parseTranscribeDeliveryVariants(real(eps), eps);
    assert.deepEqual(Array.from(v.primary.keys()), eps);
    assert.deepEqual(Array.from(v.traditional.keys()), eps);
    assert.equal(v.primary.get(eps[1]), block(eps[1], false));
    assert.equal(v.traditional.get(eps[1]), block(eps[1], true));
    assertEmpty(parseTranscribeDeliveryVariants(real([1]), eps), 'missing episode');
    assertEmpty(parseTranscribeDeliveryVariants(real([1, 2]), eps), 'wrong episode');
  });
}

test('legacy independent H3 and H2 replies keep primary semantics without alternates', () => {
  const sceneOnly = (ep) => `场次${ep}-1 内景 朱投卧室 日`;
  const h3 = ['### 第1集', sceneOnly(1), SIMP_LINES.join('\n'), '### 第2集', sceneOnly(2), SIMP_LINES.join('\n')].join('\n');
  const v3 = parseTranscribeDeliveryVariants(h3, [1, 2]);
  assert.deepEqual(Array.from(v3.primary.keys()), [1, 2]);
  assert.equal(v3.simplified, undefined);
  assert.equal(v3.traditional, undefined);
  const h2 = ['## 第1集 标题', sceneOnly(1), SIMP_LINES.join('\n'), '## 第2集 标题', sceneOnly(2), SIMP_LINES.join('\n')].join('\n');
  assert.deepEqual(Array.from(parseTranscribeDeliveryBodies(h2, [1, 2]).keys()), [1, 2]);
  const marked = ['【分集分场次还原剧本】', '### 第1集', sceneOnly(1), SIMP_LINES.join('\n')].join('\n');
  const vm = parseTranscribeDeliveryVariants(marked, [1]);
  assert.deepEqual(Array.from(vm.primary.keys()), [1]);
  assert.equal(vm.traditional, undefined);
  assertEmpty(parseTranscribeDeliveryVariants(h3, [1, 3]), 'legacy wrong mapping');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`not ok - ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}
if (failed > 0) {
  console.error(`${failed} of ${cases.length} failed`);
  process.exit(1);
}
console.log(`${cases.length} passed`);
