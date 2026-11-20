import assert from 'node:assert/strict';
import * as transcribeParse from '../lib/transcribe-parse.ts';

const {
  parseEpisodeBodiesFromSingleSource,
  mergePerSourceEpisodeBodies,
  assembleScriptFromEpisodeBodies,
  extractSynopsisOrPlaceholder,
} = transcribeParse;

assert.equal(typeof parseEpisodeBodiesFromSingleSource, 'function');
assert.equal(typeof mergePerSourceEpisodeBodies, 'function');
assert.equal(typeof assembleScriptFromEpisodeBodies, 'function');
assert.equal(typeof extractSynopsisOrPlaceholder, 'function');

const SYNOPSIS_PLACEHOLDER = '（本交付未单独写出故事梗概，请直接阅读分集正文。）';

// 1. Five separate single-source drafts with generic intro headers before ### 第 N 集
const sources = [1, 2, 3, 4, 5].map((epNum) => {
  const text = [
    `## 导语（第 ${epNum} 集）`,
    `通用导语说明：第 ${epNum} 集独立拉片结构提示，仅属于本集。`,
    '',
    `### 第 ${epNum} 集`,
    `### 第 1 场  第 ${epNum} 集核查室（日 · 内）`,
    `【本集独有线索-${epNum}】主角打开编号 ${epNum}00${epNum} 的档案箱，发现核心证物。`,
  ].join('\n');
  return { episodeNumber: epNum, text };
});

const mergedMap = mergePerSourceEpisodeBodies(sources);
const getMergedBody = (epNum) => {
  if (mergedMap instanceof Map) return mergedMap.get(epNum) || '';
  if (Array.isArray(mergedMap)) {
    const found = mergedMap.find((x) => Number(x.episodeNumber) === epNum);
    return found ? found.body || '' : '';
  }
  return mergedMap?.[epNum] || mergedMap?.[String(epNum)] || '';
};

for (let epNum = 1; epNum <= 5; epNum++) {
  const body = getMergedBody(epNum);
  assert.ok(body.includes(`## 导语（第 ${epNum} 集）`), `Episode ${epNum} must retain its own generic intro`);
  assert.ok(body.includes(`### 第 ${epNum} 集`), `Episode ${epNum} must retain ### 第 ${epNum} 集`);
  assert.ok(body.includes(`【本集独有线索-${epNum}】`), `Episode ${epNum} must retain its unique body`);
  // Must NOT treat scene line "### 第 1 场  第 N 集核查室" as a new episode boundary splitting content away
  assert.ok(body.includes(`### 第 1 场  第 ${epNum} 集核查室（日 · 内）`), `Scene header with 第 ${epNum} 集 must stay inside episode ${epNum}`);

  if (epNum < 5) {
    assert.ok(!body.includes(`## 导语（第 ${epNum + 1} 集）`), `Episode ${epNum} must NOT absorb episode ${epNum + 1} intro`);
    assert.ok(!body.includes(`### 第 ${epNum + 1} 集`), `Episode ${epNum} must NOT absorb ### 第 ${epNum + 1} 集`);
    assert.ok(!body.includes(`【本集独有线索-${epNum + 1}】`), `Episode ${epNum} must NOT absorb episode ${epNum + 1} body`);
  }
}

const assembledBodies = new Map(
  [1, 2, 3, 4, 5].map((epNum) => [epNum, getMergedBody(epNum)]),
);
const assembled = assembleScriptFromEpisodeBodies(assembledBodies);
for (let epNum = 1; epNum <= 5; epNum++) {
  const headers = assembled.match(new RegExp(`^###\\s*第\\s*0*${epNum}\\s*集\\s*$`, 'mg')) || [];
  assert.equal(headers.length, 1, `Assembled script must contain exactly one ### 第 ${epNum} 集`);
  assert.ok(assembled.includes(`【本集独有线索-${epNum}】`), `Assembled script missing episode ${epNum} unique clue`);
}

// Synopsis placeholder when no synopsis section exists
const synopsisResult = extractSynopsisOrPlaceholder(assembled);
assert.equal(synopsisResult, SYNOPSIS_PLACEHOLDER, 'Must return exact placeholder when no synopsis section exists');
assert.notEqual(synopsisResult, assembled.slice(0, 600), 'Synopsis must not fall back to first 600 chars of script');

// 2. Boundary check: even if raw texts with `## 导语（第 N 集）` are joined first, single-source parse must not leak ep 2 intro or body into ep 1
const joinedRaw = sources.map((s) => s.text).join('\n\n');
const joinedParsed = parseEpisodeBodiesFromSingleSource(joinedRaw, 1);
const joinedEp1 = joinedParsed instanceof Map
  ? joinedParsed.get(1) || ''
  : Array.isArray(joinedParsed)
    ? (joinedParsed.find((x) => Number(x.episodeNumber) === 1)?.body || '')
    : (joinedParsed?.[1] || joinedParsed?.['1'] || '');
assert.ok(
  !joinedEp1.includes('## 导语（第 2 集）'),
  'Single-source parse must not leak ep 2 intro heading into ep 1 when `## 导语（第 N 集）` boundaries exist',
);
assert.ok(
  !joinedEp1.includes('【本集独有线索-2】'),
  'Single-source parse must not leak ep 2 unique body into ep 1 when `## 导语（第 N 集）` boundaries exist',
);

// 3. Single multi-episode document with transition section header before ### 第 2 集
const singleMultiDoc = [
  '### 第 1 集',
  '### 第 1 场  第 1 集核查室',
  '第 1 集独有正文内容 Alpha。',
  '',
  '## 五、分集结构脚本（模拟测试稿 · 第 2 集）',
  '第 2 集分集导语说明。',
  '### 第 2 集',
  '第 2 集独有正文内容 Beta。',
].join('\n');

const singleParsed = parseEpisodeBodiesFromSingleSource(singleMultiDoc, 1);
const getSingleEp = (epNum) => {
  if (singleParsed instanceof Map) return singleParsed.get(epNum) || '';
  if (Array.isArray(singleParsed)) {
    const found = singleParsed.find((x) => Number(x.episodeNumber) === epNum);
    return found ? found.body || '' : '';
  }
  return singleParsed?.[epNum] || singleParsed?.[String(epNum)] || '';
};

const parsedEp1 = getSingleEp(1);
const parsedEp2 = getSingleEp(2);
assert.ok(parsedEp1.includes('第 1 集独有正文内容 Alpha。'), 'Single multi-doc ep 1 must keep its body');
assert.ok(parsedEp1.includes('### 第 1 场  第 1 集核查室'), 'Scene line with 第 1 集 must not split ep 1');
assert.ok(!parsedEp1.includes('## 五、分集结构脚本（模拟测试稿 · 第 2 集）'), 'Ep 2 section intro must not stay at end of ep 1');
assert.ok(parsedEp2.includes('## 五、分集结构脚本（模拟测试稿 · 第 2 集）'), 'Ep 2 section intro must belong to ep 2');
assert.ok(parsedEp2.includes('### 第 2 集'), 'Ep 2 must contain ### 第 2 集');
assert.ok(parsedEp2.includes('第 2 集独有正文内容 Beta。'), 'Ep 2 must contain its unique body');

// 4. Two distinct valid segments for the same episode must not be swallowed by substring/includes checks
const duplicateEpSources = [
  {
    episodeNumber: 1,
    text: '### 第 1 集\n第一段合法正文：女主在雨夜街头捡到关键录音笔。',
  },
  {
    episodeNumber: 1,
    text: '### 第 1 集\n第二段合法正文：男主在次日清晨破译录音笔里的密文。',
  },
];
const mergedSameEp = mergePerSourceEpisodeBodies(duplicateEpSources);
const combinedEp1 = mergedSameEp instanceof Map
  ? mergedSameEp.get(1) || ''
  : Array.isArray(mergedSameEp)
    ? (mergedSameEp.find((x) => Number(x.episodeNumber) === 1)?.body || '')
    : (mergedSameEp?.[1] || mergedSameEp?.['1'] || '');

assert.ok(combinedEp1.includes('第一段合法正文：女主在雨夜街头捡到关键录音笔。'), 'First valid segment for ep 1 must be preserved');
assert.ok(combinedEp1.includes('第二段合法正文：男主在次日清晨破译录音笔里的密文。'), 'Second distinct valid segment for ep 1 must not be swallowed');

console.log('step3-c3-parse-boundaries: ALL PASSED');
