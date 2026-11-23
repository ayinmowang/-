import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

globalThis.fetch = async () => {
  throw new Error('Network access is forbidden in offline regression tests');
};

const ROOT = process.cwd();
const guardPath = path.join(ROOT, 'lib', 'transcribe-delivery-guard.ts');
const parsePath = path.join(ROOT, 'lib', 'transcribe-parse.ts');
const routePath = path.join(ROOT, 'app', 'api', 'studio', 'route.ts');

async function loadTsModule(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled, 'utf8').toString('base64')}`;
  return import(dataUrl);
}

const guardMod = await loadTsModule(guardPath);
const parseMod = await loadTsModule(parsePath);
const routeSrc = fs.readFileSync(routePath, 'utf8');

const BEGIN_MARKER = '// BEGIN_TRANSCRIBE_DELIVERY_GUARD';
const END_MARKER = '// END_TRANSCRIBE_DELIVERY_GUARD';
const beginIdx = routeSrc.indexOf(BEGIN_MARKER);
const endIdx = routeSrc.indexOf(END_MARKER);

assert.ok(beginIdx !== -1, 'route.ts must contain BEGIN_TRANSCRIBE_DELIVERY_GUARD');
assert.ok(endIdx !== -1 && endIdx > beginIdx, 'route.ts must contain END_TRANSCRIBE_DELIVERY_GUARD after begin');

const populateIdx = routeSrc.indexOf('populateTranscribeWorkspace(p, combinedRawOutput, perSourceChunks);');
const deliveredIdx = routeSrc.indexOf("p.remote.status = 'delivered';");
assert.ok(populateIdx > endIdx, 'guard must appear before populateTranscribeWorkspace');
assert.ok(deliveredIdx > populateIdx, 'delivered status must appear after populateTranscribeWorkspace');

const fakeEpText = '完成该集结构梳理。';
const fakeEpMatches = routeSrc.match(/完成该集结构梳理/g) || [];
assert.equal(fakeEpMatches.length, 2, 'expected 2 episode-level placeholder fallbacks in route.ts');
for (const line of routeSrc.split('\n')) {
  if (line.includes('完成该集结构梳理') || line.includes('已完成《${p.title}》分集拆解')) {
    const idx = routeSrc.indexOf(line);
    const windowBefore = routeSrc.slice(Math.max(0, idx - 220), idx);
    assert.ok(
      windowBefore.includes('isLlmFixture()'),
      `Placeholder fallback must be gated by isLlmFixture(): ${line.trim()}`,
    );
  }
}

const guardTsSnippet = routeSrc.slice(beginIdx + BEGIN_MARKER.length, endIdx);
const guardJsSnippet = ts.transpileModule(guardTsSnippet, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function buildRealStrictMapHelper() {
  const sf = ts.createSourceFile('route.ts', routeSrc, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  let fnNode = null;
  sf.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.name.text === 'parseStrictTranscribeDeliveryMap') {
      fnNode = node;
    }
  });
  assert.ok(fnNode, 'parseStrictTranscribeDeliveryMap must exist in route source');
  const fnJs = ts.transpileModule(fnNode.getText(sf), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  assert.equal(typeof parseMod.parseTranscribeDeliveryBodies, 'function');
  const real = new Function(
    'parseTranscribeDeliveryBodies',
    `${fnJs}\nreturn parseStrictTranscribeDeliveryMap;`,
  )(parseMod.parseTranscribeDeliveryBodies);
  assert.equal(typeof real, 'function');
  return real;
}
const realStrictMapHelper = buildRealStrictMapHelper();

const runGuardInner = new AsyncFunction(
  'ctx',
  'parseStrictTranscribeDeliveryMap',
  'logTf',
  `
  const {
    isLlmFixture,
    sanitizeForClient,
    combinedRawOutput,
    perSourceChunks,
    mergePerSourceEpisodeBodies,
    parseEpisodeBodiesFromSingleSource,
    uniqueValidSourceEpisodes,
    inspectTranscribeBodiesDelivery,
    p,
    nextCursor,
    message,
    saveProject,
    user,
    withCatalogs,
  } = ctx;
  ${guardJsSnippet}
  return undefined;
  `,
);

function buildRealLogTf(tfCtx) {
  const sf = ts.createSourceFile('route.ts', routeSrc, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const found = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'logTf') found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  assert.equal(found.length, 1, 'exactly one logTf declaration must exist in route source');
  assert.ok(found[0].initializer, 'logTf must have an initializer');
  const js = ts.transpileModule(`const logTf = ${found[0].initializer.getText(sf)};`, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const real = new Function('tfCtx', `${js}\nreturn logTf;`)(tfCtx);
  assert.equal(typeof real, 'function');
  return real;
}

function assertGuardLogs(logs, rejected, tfCtx) {
  const events = logs.map((args) => {
    assert.equal(args.length, 1);
    assert.equal(typeof args[0], 'string');
    return JSON.parse(args[0]);
  });
  if (!rejected) {
    assert.equal(events.length, 0, 'non-rejected guard run must emit no logs');
    return;
  }
  assert.equal(events.length, 1, 'rejected guard run must emit exactly one log');
  const ev = events[0];
  assert.deepEqual(Object.keys(ev).sort(), ['actionId', 'code', 'correlationId', 'elapsedMs', 'event', 'projectId']);
  assert.equal(ev.event, 'transcribe_action_failed');
  assert.equal(ev.code, 'TRANSCRIBE_DELIVERY_REJECTED');
  assert.equal(ev.correlationId, tfCtx.cid);
  assert.equal(ev.projectId, tfCtx.pid);
  assert.equal(ev.actionId, tfCtx.actionId);
  assert.ok(Number.isFinite(ev.elapsedMs) && ev.elapsedMs >= 0, 'elapsedMs must be finite and nonnegative');
  const text = JSON.stringify(ev);
  for (const pat of FORBIDDEN_SECRET_PATTERNS) {
    if (pat instanceof RegExp) {
      pat.lastIndex = 0;
      assert.ok(!pat.test(text), `log leaked forbidden pattern ${pat}`);
    } else {
      assert.ok(!text.includes(String(pat)), 'log leaked forbidden pattern');
    }
  }
}

async function runGuard(ctx) {
  let helperCalls = 0;
  const logs = [];
  const statusBefore = ctx.p && ctx.p.remote && ctx.p.remote.status;
  const tfCtx = {
    key: 'synthetic-tf-key',
    cid: 'synthetic-correlation-id',
    pid: ctx.p.id,
    actionId: 'synthetic-action-id',
    startedAt: Date.now(),
  };
  const realLogTf = buildRealLogTf(tfCtx);
  let fixtureSeen = false;
  const countedHelper = (...args) => {
    helperCalls += 1;
    return realStrictMapHelper(...args);
  };
  const wrappedCtx = {
    ...ctx,
    isLlmFixture: (...args) => {
      const r = ctx.isLlmFixture(...args);
      if (r) fixtureSeen = true;
      return r;
    },
  };
  let result;
  const origConsoleError = console.error;
  try {
    console.error = (...args) => { logs.push(args); };
    try {
      result = await runGuardInner(wrappedCtx, countedHelper, realLogTf);
    } finally {
      console.error = origConsoleError;
    }
  } finally {
    if (!fixtureSeen && helperCalls === 0) {
      throw new Error('real parseStrictTranscribeDeliveryMap was not invoked in a non-fixture guard run');
    }
  }
  const rejected = ctx.p.remote.status === 'failed' && statusBefore !== 'failed';
  assertGuardLogs(logs, rejected, tfCtx);
  return result;
}

function sanitizeForClientStub(text) {
  return String(text || '')
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, '[REDACTED_TOKEN]')
    .replace(/system_prompt\s*[:=]\s*[^\n]+/gi, '[REDACTED_PROMPT]');
}

function uniqueValidSourceEpisodesStub(attachments) {
  const set = new Set();
  for (const att of attachments || []) {
    if (Number.isInteger(att.episode) && att.episode > 0) {
      set.add(att.episode);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

function createBaseProject() {
  const existingEp1 = {
    episode: 1,
    title: '第1集 旧有效正文',
    script: '第1集 场次1-1 内景 咖啡馆 日\n▲ 林夏推门走进咖啡馆，环顾四周。\n林夏：请问有人在吗？\n▲ 服务生从吧台后探出头。',
  };
  const existingScript = existingEp1.script;
  const existingSynopsis = { title: '故事梗概', content: '既有完整故事梗概正文。', version: 2 };
  const existingCharacters = { title: '人物小传', content: '林夏：女主，冷静果断。', version: 2 };
  const existingEpisodes = [existingEp1];

  const p = {
    id: 'proj-test-1',
    title: '测试短剧',
    attachments: [
      { id: 'a1', name: 'ep1.mp4', episode: 1 },
      { id: 'a2', name: 'ep2.mp4', episode: 2 },
    ],
    episodes: existingEpisodes,
    remote: {
      status: 'running',
      stage: { key: 'transcribing', title: '正在扒剧' },
      card: { type: 'progress_card', title: '进行中' },
      cursor: 3,
      progress: { total_steps: 4, completed_steps: 3 },
      outputs: {
        script: existingScript,
        synopsis: existingSynopsis,
        characters: existingCharacters,
      },
    },
  };

  return {
    p,
    snapshots: {
      existingEpisodes,
      existingEp1,
      existingScript,
      existingSynopsis,
      existingCharacters,
    },
  };
}

const FORBIDDEN_SECRET_PATTERNS = [/sk-[a-zA-Z0-9_-]{8,}/, /Bearer\s+/i, /gpt-4|claude-|gemini-/i, /system_prompt/i];

let passedCount = 0;

// Test 1: Missing episode ([1, 2] expected, only episode 1 returned)
{
  const { p, snapshots } = createBaseProject();
  const messages = [];
  let saveCalls = 0;
  const res = await runGuard({
    isLlmFixture: () => false,
    sanitizeForClient: sanitizeForClientStub,
    combinedRawOutput:
      '### 分场剧本\n第1集 场次1-1 内景 客厅 日\n▲ 陈默坐在沙发上看手机，眉头紧锁。\n陈默：这件事不能再拖了。\n▲ 门铃突然响起，陈默起身走向玄关。',
    perSourceChunks: undefined,
    mergePerSourceEpisodeBodies: parseMod.mergePerSourceEpisodeBodies,
    parseEpisodeBodiesFromSingleSource: parseMod.parseEpisodeBodiesFromSingleSource,
    uniqueValidSourceEpisodes: uniqueValidSourceEpisodesStub,
    inspectTranscribeBodiesDelivery: guardMod.inspectTranscribeBodiesDelivery,
    p,
    nextCursor: 3,
    message: (_proj, role, text) => messages.push({ role, text }),
    saveProject: async (proj) => {
      saveCalls += 1;
      return proj;
    },
    user: { id: 'u1' },
    withCatalogs: (proj) => ({ project: proj }),
  });

  assert.ok(res instanceof Response, 'missing episode must return Response');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.project.remote.status, 'failed');
  assert.equal(body.project.remote.stage.key, 'transcribe_incomplete');
  assert.equal(body.project.remote.card, null);
  assert.equal(body.project.remote.cursor, 2);
  assert.ok(
    body.project.remote.progress.completed_steps < body.project.remote.progress.total_steps,
    'completed_steps must roll back below total_steps',
  );
  assert.equal(saveCalls, 1, 'saveProject must be called once');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'director');
  assert.ok(messages[0].text.includes('重试'), 'director message must instruct user to retry');
  for (const pat of FORBIDDEN_SECRET_PATTERNS) {
    assert.ok(!pat.test(messages[0].text), `director message leaked sensitive info: ${messages[0].text}`);
  }
  assert.equal(p.episodes, snapshots.existingEpisodes, 'existing episodes array reference must remain untouched');
  assert.equal(p.episodes[0], snapshots.existingEp1);
  assert.equal(p.remote.outputs.script, snapshots.existingScript);
  assert.equal(p.remote.outputs.synopsis, snapshots.existingSynopsis);
  assert.equal(p.remote.outputs.characters, snapshots.existingCharacters);
  assert.ok(!('transcribeDraft' in p.remote.outputs), 'failed delivery must not write transcribeDraft');
  assert.ok(!JSON.stringify(p.remote.outputs).includes('扒剧未验收草稿'), 'no draft title in outputs');
  assert.ok(!JSON.stringify(p.remote.outputs).includes('sk-secret1234567890'), 'no secret marker in outputs');
  passedCount += 1;
}

// Test 2: Meta-only output (character anchors + synopsis only, with secret token sanitized in draft)
{
  const { p, snapshots } = createBaseProject();
  let saveCalls = 0;
  const failureMessages = [];
  const metaOnlyRaw =
    '### 故事梗概\n林夏与顾言在都市职场重逢，联手揭开商业机密。\n\n### 人物锚定表\n- 林夏：女主，独立设计师\n- 顾言：男主，投资总监\n调试密钥：sk-secret1234567890';
  const res = await runGuard({
    isLlmFixture: () => false,
    sanitizeForClient: sanitizeForClientStub,
    combinedRawOutput: metaOnlyRaw,
    perSourceChunks: undefined,
    mergePerSourceEpisodeBodies: parseMod.mergePerSourceEpisodeBodies,
    parseEpisodeBodiesFromSingleSource: parseMod.parseEpisodeBodiesFromSingleSource,
    uniqueValidSourceEpisodes: uniqueValidSourceEpisodesStub,
    inspectTranscribeBodiesDelivery: guardMod.inspectTranscribeBodiesDelivery,
    p,
    nextCursor: 2,
    message: (...args) => {
      failureMessages.push(args.filter((a) => typeof a === 'string').join(' '));
    },
    saveProject: async (proj) => {
      saveCalls += 1;
      return proj;
    },
    user: { id: 'u1' },
    withCatalogs: (proj) => ({ project: proj }),
  });

  assert.ok(res instanceof Response, 'meta-only output must fail closed');
  assert.equal(saveCalls, 1);
  assert.equal(p.remote.status, 'failed');
  assert.equal(p.remote.stage.key, 'transcribe_incomplete');
  assert.ok(!('transcribeDraft' in p.remote.outputs), 'meta-only failure must not write transcribeDraft');
  assert.ok(!JSON.stringify(p.remote.outputs).includes('sk-secret1234567890'), 'no secret in outputs');
  assert.ok(!JSON.stringify(p.remote.outputs).includes('林夏与顾言在都市职场重逢'), 'no raw text in outputs');
  const failureText = failureMessages.join('\n');
  assert.ok(failureMessages.length > 0, 'rejection message must be captured, not noop');
  assert.ok(failureText.includes('未交付'), 'rejection states not delivered');
  assert.ok(failureText.includes('重试'), 'rejection mentions manual retry');
  assert.ok(!failureText.includes(metaOnlyRaw), 'rejection must not contain raw output');
  assert.ok(!failureText.includes('sk-secret1234567890'), 'rejection must not contain secret');
  assert.ok(!failureText.includes('林夏与顾言在都市职场重逢'), 'rejection must not contain raw text');
  assert.ok(!failureText.includes('扒剧未验收草稿'), 'rejection must not claim a draft exists');
  assert.equal(p.episodes, snapshots.existingEpisodes);
  assert.equal(p.remote.outputs.script, snapshots.existingScript);
  passedCount += 1;
}

// Test 3: Placeholder / empty output fails closed without overwriting valid outputs
{
  const { p, snapshots } = createBaseProject();
  let saveCalls = 0;
  const res = await runGuard({
    isLlmFixture: () => false,
    sanitizeForClient: sanitizeForClientStub,
    combinedRawOutput: '',
    perSourceChunks: [
      { episode: 1, text: '' },
      { episode: 2, text: '第2集 场次1-1 内景 场景 日\n▲ 完成该集结构梳理。' },
    ],
    mergePerSourceEpisodeBodies: parseMod.mergePerSourceEpisodeBodies,
    parseEpisodeBodiesFromSingleSource: parseMod.parseEpisodeBodiesFromSingleSource,
    uniqueValidSourceEpisodes: uniqueValidSourceEpisodesStub,
    inspectTranscribeBodiesDelivery: guardMod.inspectTranscribeBodiesDelivery,
    p,
    nextCursor: 1,
    message: () => {},
    saveProject: async (proj) => {
      saveCalls += 1;
      return proj;
    },
    user: { id: 'u1' },
    withCatalogs: (proj) => ({ project: proj }),
  });

  assert.ok(res instanceof Response, 'placeholder/empty output must fail closed');
  assert.equal(saveCalls, 1);
  assert.equal(p.remote.status, 'failed');
  assert.equal(p.remote.cursor, 0);
  assert.equal(p.episodes, snapshots.existingEpisodes);
  assert.equal(p.remote.outputs.script, snapshots.existingScript);
  assert.equal(p.remote.outputs.synopsis, snapshots.existingSynopsis);
  assert.equal(p.remote.outputs.characters, snapshots.existingCharacters);
  passedCount += 1;
}

// Test 4: Complete valid episode bodies pass through (returns undefined) in real mode
{
  const { p } = createBaseProject();
  let saveCalls = 0;
  const validChunks = [
    {
      episode: 1,
      text: '第1集 场次1-1 内景 办公室 日\n▲ 林夏将合同放在桌上，神情严肃。\n林夏：这份条款我不能签。\n▲ 顾言抬起头看着她，微微皱眉。\n顾言：先听我把条件说完。',
    },
    {
      episode: 2,
      text: '第2集 场次2-1 外景 街道 夜\n▲ 雨点打在车窗上，林夏独自走在人行道。\n林夏：既然如此，我们就各自按规矩办事。\n▲ 顾言撑伞追了上来，拦在她面前。\n顾言：等等，别急着下结论。',
    },
  ];
  const res = await runGuard({
    isLlmFixture: () => false,
    sanitizeForClient: sanitizeForClientStub,
    combinedRawOutput: validChunks.map((c) => c.text).join('\n\n'),
    perSourceChunks: validChunks,
    mergePerSourceEpisodeBodies: parseMod.mergePerSourceEpisodeBodies,
    parseEpisodeBodiesFromSingleSource: parseMod.parseEpisodeBodiesFromSingleSource,
    uniqueValidSourceEpisodes: uniqueValidSourceEpisodesStub,
    inspectTranscribeBodiesDelivery: guardMod.inspectTranscribeBodiesDelivery,
    p,
    nextCursor: 3,
    message: () => {},
    saveProject: async (proj) => {
      saveCalls += 1;
      return proj;
    },
    user: { id: 'u1' },
    withCatalogs: (proj) => ({ project: proj }),
  });

  assert.equal(res, undefined, 'valid complete episode bodies must pass guard and continue to delivery');
  assert.equal(saveCalls, 0, 'guard must not save failed state when delivery check passes');
  assert.equal(p.remote.status, 'running');
  passedCount += 1;
}

// Test 5: Fixture mode bypasses guard for backward compatibility
{
  const { p } = createBaseProject();
  let saveCalls = 0;
  const res = await runGuard({
    isLlmFixture: () => true,
    sanitizeForClient: sanitizeForClientStub,
    combinedRawOutput: `第1集 场次1-1 内景 场景 日\n▲ ${fakeEpText}`,
    perSourceChunks: undefined,
    mergePerSourceEpisodeBodies: parseMod.mergePerSourceEpisodeBodies,
    parseEpisodeBodiesFromSingleSource: parseMod.parseEpisodeBodiesFromSingleSource,
    uniqueValidSourceEpisodes: uniqueValidSourceEpisodesStub,
    inspectTranscribeBodiesDelivery: guardMod.inspectTranscribeBodiesDelivery,
    p,
    nextCursor: 3,
    message: () => {},
    saveProject: async (proj) => {
      saveCalls += 1;
      return proj;
    },
    user: { id: 'u1' },
    withCatalogs: (proj) => ({ project: proj }),
  });

  assert.equal(res, undefined, 'fixture mode must bypass guard');
  assert.equal(saveCalls, 0);
  passedCount += 1;
}

console.log(`PASS: ${passedCount} tests passed`);
