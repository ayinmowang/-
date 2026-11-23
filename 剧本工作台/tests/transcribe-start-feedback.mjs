import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// 1. 禁止网络请求
globalThis.fetch = async () => {
  throw new Error('Network access is forbidden in offline tests');
};

// 2. 注册相对无后缀 .ts 解析钩子
const loaderSource = `
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\\.[a-z0-9]+$/i.test(specifier) && context.parentURL) {
    const parentPath = fileURLToPath(context.parentURL);
    const candidate = new URL(specifier + '.ts', pathToFileURL(parentPath));
    if (fs.existsSync(fileURLToPath(candidate))) {
      return { url: candidate.href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript;charset=utf-8,${encodeURIComponent(loaderSource)}`);

const {
  inspectTranscribeProjectDeliveryReady,
  resolveTranscribeStartFeedback,
} = await import('../lib/transcribe-delivery-ready.ts');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspacePath = path.resolve(__dirname, '../components/BreakdownWorkspace.tsx');
const workspaceSource = fs.readFileSync(workspacePath, 'utf8');

let caseCount = 0;
function runCase(name, fn) {
  fn();
  caseCount += 1;
}

const VALID_EP1_BODY = [
  '第1集',
  '1-1 日 内 咖啡馆',
  '人物：林夏、周明',
  '▲林夏推门走进咖啡馆，环顾四周后径直走向靠窗的卡座坐下。',
  '林夏：你迟到了十分钟，合同带了吗？',
  '▲周明从公文包里取出牛皮纸袋放在桌上，推到林夏面前。',
  '周明：全在这里，签完字今天就能正式启动。',
].join('\n');

const VALID_EP2_BODY = [
  '第2集',
  '2-1 夜 外 写字楼天台',
  '人物：林夏、陈默',
  '▲夜风吹起林夏的外套，她握紧手机看着远处的霓虹灯火。',
  '陈默：董事会那边已经收到风声了，明早九点前必须给出答复。',
  '▲林夏深吸一口气，转身看向身后的安全门。',
  '林夏：告诉他们，明早我会准时出席。',
].join('\n');

function makeMappedAttachment(id, name, episodes) {
  return {
    id,
    name,
    size: 1024,
    type: 'video/mp4',
    role: 'source',
    coveredEpisodes: episodes,
    ...(episodes.length === 1 ? { episode: episodes[0] } : {}),
  };
}

// 静态接线校验：BreakdownWorkspace 必须导入共享模块并调用 resolveTranscribeStartFeedback
runCase('wiring: BreakdownWorkspace imports from ../lib/transcribe-delivery-ready', () => {
  const collectTargetValueNamedImports = (sourceText, fileName = 'BreakdownWorkspace.tsx') => {
    const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const imported = new Set();
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt)) continue;
      if (!ts.isStringLiteral(stmt.moduleSpecifier) || stmt.moduleSpecifier.text !== '../lib/transcribe-delivery-ready') {
        continue;
      }
      const clause = stmt.importClause;
      if (!clause || clause.isTypeOnly) continue;
      if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
      for (const spec of clause.namedBindings.elements) {
        if (spec.isTypeOnly) continue;
        imported.add((spec.propertyName ?? spec.name).text);
      }
    }
    return imported;
  };

  const negativeSample = collectTargetValueNamedImports(`
    import { resolveTranscribeStartFeedback, inspectTranscribeProjectDeliveryReady } from '../lib/other-module';
    import resolveTranscribeStartFeedback from '../lib/transcribe-delivery-ready';
    import { type resolveTranscribeStartFeedback, unrelatedHelper } from '../lib/transcribe-delivery-ready';
  `, 'negative.tsx');
  assert.ok(!negativeSample.has('resolveTranscribeStartFeedback'));
  assert.ok(!negativeSample.has('inspectTranscribeProjectDeliveryReady'));

  const validReverseMultiline = collectTargetValueNamedImports(`
    import {
      resolveTranscribeStartFeedback,
      inspectTranscribeProjectDeliveryReady,
    } from '../lib/transcribe-delivery-ready';
  `, 'positive.tsx');
  assert.ok(validReverseMultiline.has('resolveTranscribeStartFeedback'));
  assert.ok(validReverseMultiline.has('inspectTranscribeProjectDeliveryReady'));

  const actualImports = collectTargetValueNamedImports(workspaceSource);
  assert.ok(
    actualImports.has('resolveTranscribeStartFeedback'),
    'Expected value named import resolveTranscribeStartFeedback from ../lib/transcribe-delivery-ready',
  );
  assert.ok(
    actualImports.has('inspectTranscribeProjectDeliveryReady'),
    'Expected value named import inspectTranscribeProjectDeliveryReady from ../lib/transcribe-delivery-ready',
  );
  assert.ok(!workspaceSource.includes('BEGIN_TRANSCRIBE_START_FEEDBACK'));
  assert.match(workspaceSource, /startTranscribeDirect[\s\S]*resolveTranscribeStartFeedback\(/);
});

// 场景 1：delivered 但 episodes 为空 / 缺 outputs.script
runCase('case 1: delivered with empty episodes and missing outputs.script', () => {
  const project = {
    total: 2,
    attachments: [
      makeMappedAttachment('a1', 'ep1.mp4', [1]),
      makeMappedAttachment('a2', 'ep2.mp4', [2]),
    ],
    episodes: [],
    remote: {
      status: 'delivered',
      outputs: {},
    },
  };
  const ready = inspectTranscribeProjectDeliveryReady(project);
  const fb = resolveTranscribeStartFeedback(project);
  assert.equal(ready.ready, false);
  assert.equal(fb.success, false);
  assert.equal(fb.toast, '');
  assert.ok(fb.error.length > 0);
});

// 场景 2：delivered 含占位/模拟文本，即使带 remote.mode: 'test_channel' 也拦截
runCase('case 2: delivered with fake placeholder text and test_channel mode', () => {
  const projectA = {
    total: 1,
    attachments: [makeMappedAttachment('a1', 'ep1.mp4', [1])],
    episodes: [],
    remote: {
      status: 'delivered',
      mode: 'test_channel',
      outputs: {
        script: {
          content: '第1集\n1-1 日 内 房间\n▲模拟测试稿（不是实际视频还原）\n角色：暂无可交付正文',
        },
      },
    },
  };
  const readyA = inspectTranscribeProjectDeliveryReady(projectA);
  const fbA = resolveTranscribeStartFeedback(projectA);
  assert.equal(readyA.ready, false);
  assert.equal(readyA.code, 'FAKE_PLACEHOLDER_SCRIPT');
  assert.equal(fbA.success, false);
  assert.equal(fbA.toast, '');

  const projectB = {
    total: 1,
    attachments: [makeMappedAttachment('a1', 'ep1.mp4', [1])],
    episodes: [{ episodeNumber: 1, body: '第1集\n暂无可交付正文' }],
    remote: {
      status: 'delivered',
      mode: 'test_channel',
      outputs: {
        script: {
          content: '第1集\n暂无可交付正文',
        },
      },
    },
  };
  const readyB = inspectTranscribeProjectDeliveryReady(projectB);
  const fbB = resolveTranscribeStartFeedback(projectB);
  assert.equal(readyB.ready, false);
  assert.equal(fbB.success, false);
  assert.equal(fbB.toast, '');
});

// 场景 3：delivered 缺目标集（预期 1、2 集，仅有第 1 集有效正文）
runCase('case 3: delivered missing episode 2', () => {
  const project = {
    total: 2,
    attachments: [
      makeMappedAttachment('a1', 'ep1.mp4', [1]),
      makeMappedAttachment('a2', 'ep2.mp4', [2]),
    ],
    episodes: [{ episodeNumber: 1, body: VALID_EP1_BODY }],
    remote: {
      status: 'delivered',
      outputs: {
        script: { content: VALID_EP1_BODY },
      },
    },
  };
  const ready = inspectTranscribeProjectDeliveryReady(project);
  const fb = resolveTranscribeStartFeedback(project);
  assert.equal(ready.ready, false);
  assert.equal(ready.code, 'DELIVERY_CONTENT_INVALID');
  assert.deepEqual(ready.missingEpisodes, [2]);
  assert.equal(fb.success, false);
  assert.equal(fb.toast, '');
  assert.match(fb.error, /第2集/);
});

// 场景 4：delivered 无 attachments 且 total: null，或有未映射 / 重叠源素材 -> fail closed
runCase('case 4: fail closed on unknown expected episodes, unmapped, or overlapping attachments', () => {
  const unknownTarget = {
    total: null,
    attachments: [],
    episodes: [{ episodeNumber: 1, body: VALID_EP1_BODY }],
    remote: {
      status: 'delivered',
      outputs: { script: { content: VALID_EP1_BODY } },
    },
  };
  const r1 = inspectTranscribeProjectDeliveryReady(unknownTarget);
  assert.equal(r1.ready, false);
  assert.equal(r1.code, 'EXPECTED_EPISODES_UNKNOWN');
  assert.equal(resolveTranscribeStartFeedback(unknownTarget).success, false);

  const unmappedProject = {
    total: 1,
    attachments: [
      {
        id: 'u1',
        name: 'raw_video.mp4',
        size: 1024,
        type: 'video/mp4',
        role: 'source',
      },
    ],
    episodes: [{ episodeNumber: 1, body: VALID_EP1_BODY }],
    remote: {
      status: 'delivered',
      outputs: { script: { content: VALID_EP1_BODY } },
    },
  };
  const r2 = inspectTranscribeProjectDeliveryReady(unmappedProject);
  assert.equal(r2.ready, false);
  assert.equal(r2.code, 'EPISODE_MAPPING_REQUIRED');
  assert.equal(resolveTranscribeStartFeedback(unmappedProject).success, false);

  const overlapProject = {
    total: 2,
    attachments: [
      makeMappedAttachment('o1', 'ep1_2.mp4', [1, 2]),
      makeMappedAttachment('o2', 'ep2.mp4', [2]),
    ],
    episodes: [
      { episodeNumber: 1, body: VALID_EP1_BODY },
      { episodeNumber: 2, body: VALID_EP2_BODY },
    ],
    remote: {
      status: 'delivered',
      outputs: { script: { content: `${VALID_EP1_BODY}\n\n${VALID_EP2_BODY}` } },
    },
  };
  const r3 = inspectTranscribeProjectDeliveryReady(overlapProject);
  assert.equal(r3.ready, false);
  assert.equal(r3.code, 'EPISODE_COVERAGE_CONFLICT');
  assert.equal(resolveTranscribeStartFeedback(overlapProject).success, false);
});

// 场景 5：delivered 完整有效 -> ready=true, success=true, toast 精确匹配, error=''
runCase('case 5: delivered with complete valid episodes', () => {
  const project = {
    total: 2,
    attachments: [
      makeMappedAttachment('a1', 'ep1.mp4', [1]),
      makeMappedAttachment('a2', 'ep2.mp4', [2]),
    ],
    episodes: [
      { episodeNumber: 1, body: VALID_EP1_BODY },
      { episodeNumber: 2, body: VALID_EP2_BODY },
    ],
    remote: {
      status: 'delivered',
      outputs: {
        script: { content: `${VALID_EP1_BODY}\n\n${VALID_EP2_BODY}` },
      },
    },
  };
  const ready = inspectTranscribeProjectDeliveryReady(project);
  const fb = resolveTranscribeStartFeedback(project);
  assert.equal(ready.ready, true);
  assert.equal(ready.code, 'DELIVERED_READY');
  assert.deepEqual(ready.expectedEpisodes, [1, 2]);
  assert.deepEqual(ready.missingEpisodes, []);
  assert.deepEqual(ready.invalidEpisodes, []);
  assert.equal(fb.success, true);
  assert.equal(fb.toast, '扒剧已完成，规范 Word（.docx）已可直接下载！');
  assert.equal(fb.error, '');
});

// 场景 6：failed（含 stage.key='transcribe_incomplete'）即使 episodes 仍有完整旧有效正文 -> ready=false
runCase('case 6: failed status overrides stale valid episodes', () => {
  const baseValid = {
    total: 2,
    attachments: [
      makeMappedAttachment('a1', 'ep1.mp4', [1]),
      makeMappedAttachment('a2', 'ep2.mp4', [2]),
    ],
    episodes: [
      { episodeNumber: 1, body: VALID_EP1_BODY },
      { episodeNumber: 2, body: VALID_EP2_BODY },
    ],
  };

  const incompleteProj = {
    ...baseValid,
    remote: {
      status: 'failed',
      stage: { key: 'transcribe_incomplete' },
      outputs: { script: { content: `${VALID_EP1_BODY}\n\n${VALID_EP2_BODY}` } },
    },
  };
  const r1 = inspectTranscribeProjectDeliveryReady(incompleteProj);
  const fb1 = resolveTranscribeStartFeedback(incompleteProj);
  assert.equal(r1.ready, false);
  assert.equal(r1.code, 'TRANSCRIBE_INCOMPLETE');
  assert.equal(fb1.success, false);
  assert.equal(fb1.toast, '');
  assert.ok(!/检查提示词/.test(fb1.error));

  const failedProj = {
    ...baseValid,
    remote: {
      status: 'failed',
      stage: { key: 'transcribe' },
      outputs: { script: { content: `${VALID_EP1_BODY}\n\n${VALID_EP2_BODY}` } },
    },
  };
  const r2 = inspectTranscribeProjectDeliveryReady(failedProj);
  const fb2 = resolveTranscribeStartFeedback(failedProj);
  assert.equal(r2.ready, false);
  assert.equal(r2.code, 'TRANSCRIBE_FAILED');
  assert.equal(fb2.success, false);
  assert.equal(fb2.toast, '');
  assert.ok(!/检查提示词/.test(fb2.error));
});

// 场景 7：running 与 stage.key='delivery' 但 status='ready' -> ready=false，且 running 不诱导重试
runCase('case 7: running and non-delivered ready status', () => {
  const runningProj = {
    total: 1,
    attachments: [makeMappedAttachment('a1', 'ep1.mp4', [1])],
    episodes: [{ episodeNumber: 1, body: VALID_EP1_BODY }],
    remote: {
      status: 'running',
      stage: { key: 'transcribe' },
    },
  };
  const rRunning = inspectTranscribeProjectDeliveryReady(runningProj);
  const fbRunning = resolveTranscribeStartFeedback(runningProj);
  assert.equal(rRunning.ready, false);
  assert.equal(rRunning.code, 'TRANSCRIBE_RUNNING');
  assert.equal(fbRunning.success, false);
  assert.equal(fbRunning.toast, '');
  assert.ok(!/(重新触发|请重试|点击重试|检查提示词)/.test(fbRunning.error));

  const readyNotDeliveredProj = {
    total: 1,
    attachments: [makeMappedAttachment('a1', 'ep1.mp4', [1])],
    episodes: [{ episodeNumber: 1, body: VALID_EP1_BODY }],
    remote: {
      status: 'ready',
      stage: { key: 'delivery' },
      outputs: { script: { content: VALID_EP1_BODY } },
    },
  };
  const rReady = inspectTranscribeProjectDeliveryReady(readyNotDeliveredProj);
  const fbReady = resolveTranscribeStartFeedback(readyNotDeliveredProj);
  assert.equal(rReady.ready, false);
  assert.equal(rReady.code, 'TRANSCRIBE_NOT_DELIVERED');
  assert.equal(fbReady.success, false);
  assert.equal(fbReady.toast, '');
  assert.ok(!/检查提示词/.test(fbReady.error));
});

// 场景 8：messages 含敏感或任意 director 原文 -> error 绝不回显该 director 文本
runCase('case 8: never leak or echo raw director messages', () => {
  const sensitiveText = 'Upstream error from gemini-4-carbon at https://x.test/k with stack trace';
  const customRawText = '自定义内部报错原文_INTERNAL_TRACE_9981';

  const projSensitive = {
    total: 1,
    attachments: [makeMappedAttachment('a1', 'ep1.mp4', [1])],
    episodes: [],
    messages: [{ role: 'director', text: sensitiveText }],
    remote: { status: 'failed' },
  };
  const fb1 = resolveTranscribeStartFeedback(projSensitive);
  assert.equal(fb1.success, false);
  assert.equal(fb1.toast, '');
  assert.ok(!fb1.error.includes('gemini-4-carbon'));
  assert.ok(!fb1.error.includes('https://x.test/k'));
  assert.ok(!fb1.error.includes(sensitiveText));

  const projCustom = {
    total: 1,
    attachments: [makeMappedAttachment('a1', 'ep1.mp4', [1])],
    episodes: [],
    messages: [{ role: 'director', text: customRawText }],
    remote: { status: 'waiting_confirm' },
  };
  const fb2 = resolveTranscribeStartFeedback(projCustom);
  assert.equal(fb2.success, false);
  assert.equal(fb2.toast, '');
  assert.ok(!fb2.error.includes(customRawText));
  assert.ok(!fb2.error.includes('INTERNAL_TRACE_9981'));
});

console.log(`PASS (${caseCount} cases)`);
