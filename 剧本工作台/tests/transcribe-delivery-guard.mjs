import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

globalThis.fetch = async () => {
  throw new Error("Network access is forbidden in offline unit tests");
};

async function loadTsModule(relPath) {
  const absPath = path.resolve(process.cwd(), relPath);
  const source = fs.readFileSync(absPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: absPath,
  });
  const encoded = Buffer.from(transpiled.outputText, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

const guard = await loadTsModule("lib/transcribe-delivery-guard.ts");
const parser = await loadTsModule("lib/transcribe-parse.ts");

const {
  isKnownFakeTranscribeFallback,
  validateSingleEpisodeBody,
  inspectTranscribeBodiesDelivery,
  validateTranscribeBodies,
} = guard;

const { parseEpisodeBodiesFromSingleSource } = parser;

let passed = 0;
function runTest(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

// 1. 预期集数参数异常与缺集场景
runTest("rejects empty expected episodes", () => {
  const res = inspectTranscribeBodiesDelivery([], new Map());
  assert.equal(res.ok, false);
  assert.equal(validateTranscribeBodies([], new Map()), false);
});

runTest("rejects invalid or duplicate expected episodes", () => {
  const validBody = "第1集 场次1-1 内景 客厅 日\n▲ 林晚推门走进客厅，环顾四周。\n林晚：有人在家吗？";
  assert.equal(validateTranscribeBodies([0], new Map([[0, validBody]])), false);
  assert.equal(validateTranscribeBodies([-1], new Map([[-1, validBody]])), false);
  assert.equal(validateTranscribeBodies([1.5], new Map([[1.5, validBody]])), false);
  assert.equal(validateTranscribeBodies([1, 1], new Map([[1, validBody]])), false);
});

runTest("rejects non-Map bodies container", () => {
  const res = inspectTranscribeBodiesDelivery([1], null);
  assert.equal(res.ok, false);
  assert.deepEqual(res.missingEpisodes, [1]);
});

runTest("rejects missing single episode and reports missing middle episode in multi-episode", () => {
  const validEp1 = "第1集 场次1-1 内景 客厅 日\n▲ 林晚推门走进客厅。\n林晚：我回来了。";
  const validEp3 = "第3集 场次3-1 外景 街道 夜\n▲ 雨水打湿了路面，林晚加快脚步。\n林晚：必须赶在十点前到。";

  const singleRes = inspectTranscribeBodiesDelivery([1], new Map());
  assert.equal(singleRes.ok, false);
  assert.deepEqual(singleRes.missingEpisodes, [1]);
  assert.match(singleRes.reason, /缺少第 1 集/);

  const multiMap = new Map([
    [1, validEp1],
    [3, validEp3],
  ]);
  const multiRes = inspectTranscribeBodiesDelivery([1, 2, 3], multiMap);
  assert.equal(multiRes.ok, false);
  assert.deepEqual(multiRes.missingEpisodes, [2]);
  assert.deepEqual(multiRes.invalidEpisodes, []);
  assert.match(multiRes.reason, /缺少第 2 集/);
});

// 2. 空正文、空白、仅标题、仅场次标题
runTest("rejects empty, whitespace, episode-heading-only, and scene-heading-only bodies", () => {
  assert.equal(validateSingleEpisodeBody(1, ""), false);
  assert.equal(validateSingleEpisodeBody(1, "   \n\t  \n"), false);
  assert.equal(validateSingleEpisodeBody(1, "### 第 1 集"), false);
  assert.equal(validateSingleEpisodeBody(1, "第1集"), false);
  assert.equal(validateSingleEpisodeBody(1, "第1集 场次1-1 内景 客厅 日"), false);
  assert.equal(validateSingleEpisodeBody(1, "### 第 1 场 客厅（日·内）"), false);
});

// 3. 已知伪成功 fallback 与占位短语
runTest("detects and rejects all known fake transcribe fallbacks", () => {
  const fakes = [
    "【模拟测试稿】本内容并非实际视频还原，仅作结构占位。",
    "已按详细模式完成分集场次与台词还原，请查收。",
    "已按快速模式完成分集场次与台词还原。",
    "已完成该集结构梳理，本交付未单独写出故事梗概。",
    "当前暂无可交付正文，正文待补。",
  ];

  for (const text of fakes) {
    assert.equal(isKnownFakeTranscribeFallback(text), true);
    assert.equal(validateSingleEpisodeBody(1, text), false);
  }

  const fakeWithScene = [
    "第1集 场次1-1 内景 客厅 日",
    "▲ 林晚推门走进客厅（本稿为模拟测试稿，不是实际视频还原）。",
    "林晚：你好。",
  ].join("\n");
  assert.equal(isKnownFakeTranscribeFallback(fakeWithScene), true);
  assert.equal(validateSingleEpisodeBody(1, fakeWithScene), false);
});

// 4. 元信息区段拦截（含联动 transcribe-parse.ts 测试）
runTest("rejects metadata-only sections including character anchor table and synopsis", () => {
  const metaOnly = [
    "【全剧人物标准人名锚定表】",
    "- 林晚：女主角，冷静果断的调查记者",
    "- 顾沉：男主角，刑侦支队队长",
    "【本集核心剧情梗概】",
    "林晚在雨夜收到匿名线索，前往旧仓库调查失踪案真相。",
  ].join("\n");

  assert.equal(validateSingleEpisodeBody(1, metaOnly), false);

  const metaWithEmptyEpHeading = [
    metaOnly,
    "### 第 1 集",
  ].join("\n");
  assert.equal(validateSingleEpisodeBody(1, metaWithEmptyEpHeading), false);

  const parsed = parseEpisodeBodiesFromSingleSource(metaWithEmptyEpHeading, 1);
  assert.equal(validateTranscribeBodies([1], parsed), false);
});

runTest("accepts metadata sections when followed by valid script body and parses cleanly", () => {
  const fullSingleSource = [
    "【全剧人物标准人名锚定表】",
    "- 林晚：女主角，冷静果断的调查记者",
    "- 顾沉：男主角，刑侦支队队长",
    "【本集核心剧情梗概】",
    "林晚在雨夜收到匿名线索，前往旧仓库调查失踪案真相。",
    "【分集分场次还原剧本】",
    "### 第 1 集",
    "第1集 场次1-1 内景 旧仓库 夜",
    "▲ 手电筒光束扫过布满灰尘的货架，林晚蹲下身查看地上的脚印。",
    "林晚：脚印还很新，人刚走不久。",
    "顾沉：别碰现场，等技术队过来。",
  ].join("\n");

  const parsed = parseEpisodeBodiesFromSingleSource(fullSingleSource, 1);
  assert.equal(validateTranscribeBodies([1], parsed), true);
});

// 5. 孤立动作符号、说明文字、普通散文叙述拦截
runTest("rejects isolated action symbols, placeholder actions, notes-only, and plain prose", () => {
  assert.equal(validateSingleEpisodeBody(1, "▲"), false);
  assert.equal(validateSingleEpisodeBody(1, "▲   "), false);
  assert.equal(validateSingleEpisodeBody(1, "▲ 待补写"), false);
  assert.equal(validateSingleEpisodeBody(1, "▲ 无音轨"), false);
  assert.equal(validateSingleEpisodeBody(1, "▲ 略"), false);
  assert.equal(validateSingleEpisodeBody(1, "第1集 场次1-1 内景 客厅 日\n▲ 待补写"), false);
  assert.equal(validateSingleEpisodeBody(1, "（无音轨）"), false);
  assert.equal(validateSingleEpisodeBody(1, "> 待补写"), false);
  assert.equal(validateSingleEpisodeBody(1, "无法识别画面"), false);

  const plainProse = [
    "第一集主要讲述了林晚回到老宅后发现一封尘封多年的信件，", 
    "她决定顺着信件上的地址去寻找当年的知情人，从而揭开家族秘密。",
  ].join("\n");
  assert.equal(validateSingleEpisodeBody(1, plainProse), false);

  const metaKeyColonOnly = [
    "第1集 场次1-1 内景 客厅 日",
    "状态：已完成",
    "备注：画面较暗",
  ].join("\n");
  assert.equal(validateSingleEpisodeBody(1, metaKeyColonOnly), false);
});

// 6. 有效真实剧本（含局部无音轨标注或局部待人工补写）
runTest("accepts valid scripts with action+dialogue, partial no-audio note, or partial manual-fill tag", () => {
  const validActionAndDialogue = [
    "第1集 场次1-1 内景 咖啡馆 日",
    "▲ 咖啡机发出低沉的蒸汽声，林晚将牛皮纸袋推到桌子对面。",
    "林晚：你要的东西都在里面。",
    "[顾沉] 确认过没有备份？",
  ].join("\n");
  assert.equal(validateSingleEpisodeBody(1, validActionAndDialogue), true);

  const validWithNoAudioNote = [
    "### 第 1 场 走廊（夜·内）",
    "（无音轨）",
    "▲ 监控画面中，黑衣人戴着鸭舌帽快速穿过安全通道，消失在楼梯拐角。",
  ].join("\n");
  assert.equal(validateSingleEpisodeBody(1, validWithNoAudioNote), true);

  const validWithPartialTodoTag = [
    "场次1-2 外景 天台 日",
    "▲ 狂风吹起林晚的外套，她紧握栏杆望向远处港口。",
    "林晚：无论付出什么代价，我都会查到底。【待人工補寫】",
  ].join("\n");
  assert.equal(validateSingleEpisodeBody(1, validWithPartialTodoTag), true);

  const validMulti = new Map([
    [1, validActionAndDialogue],
    [2, validWithNoAudioNote],
  ]);
  const res = inspectTranscribeBodiesDelivery([1, 2], validMulti);
  assert.equal(res.ok, true);
  assert.deepEqual(res.missingEpisodes, []);
  assert.deepEqual(res.invalidEpisodes, []);
});

// 7. 混合缺失与无效集号的 reason 准确性与安全性检查
runTest("reports accurate missingEpisodes, invalidEpisodes, and clean Chinese reason", () => {
  const validEp1 = "第1集 场次1-1 内景 客厅 日\n▲ 林晚打开台灯翻阅档案。\n林晚：这页记录被人撕掉了。";
  const invalidEp3 = "### 第 3 集\n（无音轨）\n▲ 待补写";

  const res = inspectTranscribeBodiesDelivery(
    [1, 2, 3],
    new Map([
      [1, validEp1],
      [3, invalidEp3],
    ])
  );

  assert.equal(res.ok, false);
  assert.deepEqual(res.missingEpisodes, [2]);
  assert.deepEqual(res.invalidEpisodes, [3]);
  assert.match(res.reason, /缺少第 2 集/);
  assert.match(res.reason, /第 3 集正文无效/);
  assert.doesNotMatch(res.reason, /https?:\/\/|sk-|api[_-]?key|prompt|bodies|expected/i);
});

console.log(`PASS: ${passed} tests passed`);
