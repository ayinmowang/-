import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

globalThis.fetch = () => {
  throw new Error('Network disabled in offline test');
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

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

const { inspectTranscribeProjectDeliveryReady } = await import(
  pathToFileURL(path.join(repoRoot, 'lib/transcribe-delivery-ready.ts')).href
);

const workspacePath = path.join(repoRoot, 'components/BreakdownWorkspace.tsx');
const workspaceSrc = fs.readFileSync(workspacePath, 'utf8');
const gateMatch = workspaceSrc.match(
  /\/\/ BEGIN_TRANSCRIBE_UI_GATES[\s\S]*?\/\/ END_TRANSCRIBE_UI_GATES/,
);
assert.ok(gateMatch, 'Must contain BEGIN_TRANSCRIBE_UI_GATES..END_TRANSCRIBE_UI_GATES block');

const transpiled = ts.transpileModule(gateMatch[0], {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const { isDocxExportUrl, executeGuardedTransfer } = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`
);

let passed = 0;

// 1. isDocxExportUrl checks
assert.equal(isDocxExportUrl('/api/upload?id=p1&export=docx'), true);
assert.equal(isDocxExportUrl('/api/upload?export=docx&id=p1'), true);
assert.equal(isDocxExportUrl('/api/upload?id=p1&export=txt'), false);
assert.equal(isDocxExportUrl(''), false);
passed += 1;

const makeRichBody = (ep) =>
  [
    `第${ep}集`,
    `场次${ep}-1 内景 老宅客厅 夜`,
    '▲林深低声打开桌上的旧怀表，眼神紧盯窗外停靠的黑车。',
    '林深：这盘录像带里藏着三年前失踪案的真正时间线。',
  ].join('\n');

const baseAttachments = [
  { id: 'att-1', name: 'ep1.mp4', size: 1024, type: 'video/mp4', role: 'source', coveredEpisodes: [1], episode: 1 },
  { id: 'att-2', name: 'ep2.mp4', size: 1024, type: 'video/mp4', role: 'source', coveredEpisodes: [2], episode: 2 },
];

const makeProject = (remote, episodes) => ({
  id: 'proj-transcribe-1',
  kind: 'transcribe',
  total: 2,
  attachments: baseAttachments,
  episodes,
  remote,
});

const runTransferCase = async (project, targetKind = 'foreign') => {
  const apiCalls = [];
  const messages = [];
  const toasts = [];
  const navCalls = [];
  const busyStates = [];
  const result = await executeGuardedTransfer(
    project,
    false,
    targetKind,
    {
      inspectReady: inspectTranscribeProjectDeliveryReady,
      api: async (apiPath, body) => {
        apiCalls.push({ apiPath, body });
        return { id: 'proj-new-1' };
      },
      setBusy: (v) => busyStates.push(v),
      setBusyLabel: () => {},
      setError: (msg) => messages.push(msg),
      setToast: (msg) => toasts.push(msg),
      navigate: (url) => navCalls.push(url),
    },
  );
  return { result, apiCalls, messages, toasts, navCalls, busyStates };
};

// Case 1: delivered with empty episodes
{
  const res = await runTransferCase(
    makeProject({ status: 'delivered', stage: { key: 'delivery' } }, []),
  );
  assert.equal(res.apiCalls.length, 0);
  assert.equal(res.navCalls.length, 0);
  assert.ok(res.messages.length >= 1);
  passed += 1;
}

// Case 2: delivered missing episode 2
{
  const res = await runTransferCase(
    makeProject({ status: 'delivered', stage: { key: 'delivery' } }, [
      { episodeNumber: 1, body: makeRichBody(1) },
    ]),
  );
  assert.equal(res.apiCalls.length, 0);
  assert.equal(res.navCalls.length, 0);
  assert.ok(res.messages.length >= 1);
  passed += 1;
}

// Case 3: delivered with mock disclaimer even when remote.mode === 'test_channel'
{
  const res = await runTransferCase(
    makeProject({ status: 'delivered', mode: 'test_channel', stage: { key: 'delivery' } }, [
      { episodeNumber: 1, body: `${makeRichBody(1)}\n模拟测试稿（不是实际视频还原）` },
      { episodeNumber: 2, body: makeRichBody(2) },
    ]),
  );
  assert.equal(res.apiCalls.length, 0);
  assert.equal(res.navCalls.length, 0);
  assert.ok(res.messages.length >= 1);
  passed += 1;
}

// Case 4: stage.key === 'delivery' but status === 'ready'
{
  const res = await runTransferCase(
    makeProject({ status: 'ready', stage: { key: 'delivery' } }, [
      { episodeNumber: 1, body: makeRichBody(1) },
      { episodeNumber: 2, body: makeRichBody(2) },
    ]),
  );
  assert.equal(res.apiCalls.length, 0);
  assert.equal(res.navCalls.length, 0);
  passed += 1;
}

// Case 5: status === 'failed' even with prior valid episodes
{
  const res = await runTransferCase(
    makeProject({ status: 'failed', stage: { key: 'delivery' } }, [
      { episodeNumber: 1, body: makeRichBody(1) },
      { episodeNumber: 2, body: makeRichBody(2) },
    ]),
  );
  assert.equal(res.apiCalls.length, 0);
  assert.equal(res.navCalls.length, 0);
  passed += 1;
}

// Case 6: status === 'running'
{
  const res = await runTransferCase(
    makeProject({ status: 'running', stage: { key: 'transcribe' } }, [
      { episodeNumber: 1, body: makeRichBody(1) },
      { episodeNumber: 2, body: makeRichBody(2) },
    ]),
  );
  assert.equal(res.apiCalls.length, 0);
  assert.equal(res.navCalls.length, 0);
  passed += 1;
}

// Case 7: status === 'delivered' and valid bodies cover all mapped episodes [1, 2]
{
  const res = await runTransferCase(
    makeProject({ status: 'delivered', stage: { key: 'delivery' } }, [
      { episodeNumber: 1, body: makeRichBody(1) },
      { episodeNumber: 2, body: makeRichBody(2) },
    ]),
    'foreign',
  );
  assert.equal(res.result, true);
  assert.equal(res.apiCalls.length, 1);
  assert.equal(res.apiCalls[0].apiPath, '/api/studio');
  assert.equal(res.apiCalls[0].body.operation, 'transfer_iteration');
  assert.deepEqual(res.navCalls, ['/studio?id=proj-new-1']);
  passed += 1;
}

// Static structural assertions on BreakdownWorkspace.tsx
assert.equal(
  workspaceSrc.includes("status === 'delivered' || active.remote?.stage?.key === 'delivery'"),
  false,
  'Must remove old status/stage.key OR check'
);
assert.equal(
  workspaceSrc.includes("p.remote?.status === 'delivered'"),
  false,
  'Must remove raw p.remote?.status === delivered check in hall card'
);
assert.equal(
  workspaceSrc.includes('下载未完成占位稿 (.docx)'),
  false,
  'Must remove unverified placeholder docx download anchor text'
);
assert.ok(
  workspaceSrc.includes('inspectTranscribeProjectDeliveryReady'),
  'Must use shared inspectTranscribeProjectDeliveryReady'
);
assert.ok(
  workspaceSrc.includes('const cardReady = inspectTranscribeProjectDeliveryReady(p);') &&
    workspaceSrc.includes('const done = cardReady.ready;'),
  'Hall card done flag must use shared ready inspector'
);
assert.ok(
  workspaceSrc.includes('{isDelivered ? (') &&
    workspaceSrc.includes('暂未通过验收，不可下载 (.docx)'),
  'Top export bar must gate export=docx anchor behind isDelivered and render disabled button otherwise'
);
assert.ok(
  workspaceSrc.includes('!isDocxExportUrl(m.file.url) || isDelivered') &&
    workspaceSrc.includes('（未通过验收，暂不可下载）'),
  'Message file attachment must gate export=docx anchor behind isDelivered'
);
assert.ok(
  workspaceSrc.includes("handleTransfer('foreign')") &&
    workspaceSrc.includes("handleTransfer('domestic')") &&
    workspaceSrc.includes('executeGuardedTransfer(active, busy, targetKind,') &&
    (workspaceSrc.match(/aria-disabled=\{busy \|\| !isDelivered\}/g) || []).length >= 2,
  'Both transfer buttons must have disabled + aria-disabled and delegate to executeGuardedTransfer'
);
assert.ok(
  workspaceSrc.includes("active.remote.status === 'failed' || active.remote.status === 'delivered' ? 'alert' : 'status'") &&
    workspaceSrc.includes('{deliveryState.reason}'),
  'Must render persistent in-place status banner with role and deliveryState.reason'
);
assert.ok(
  workspaceSrc.includes("if (active.remote?.status === 'running')") &&
    workspaceSrc.includes('disabled={busy || !selectedMode || hasMissingEp || isTranscribeRunning}'),
  'Must prevent duplicate startTranscribeDirect while running'
);
assert.equal(
  /setInterval\s*\([^)]*startTranscribeDirect/.test(workspaceSrc),
  false,
  'Must not auto-retry startTranscribeDirect'
);
passed += 1;

console.log(`PASS (${passed} cases)`);
