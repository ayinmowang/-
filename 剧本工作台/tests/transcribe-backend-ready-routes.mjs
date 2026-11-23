import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { register } from 'node:module';
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
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'transcribe-ready-'));
process.chdir(tmp);
delete process.env.STUDIO_LLM_FIXTURE;
globalThis.fetch = () => {
  throw new Error('network forbidden');
};
const imp = (p) => import(new URL(p, root).href);
const { getStore } = await imp('lib/server.ts');
const upload = await imp('app/api/upload/route.ts');
const studio = await imp('app/api/studio/route.ts');
const store = await getStore();
const acct = (id, key) => ({
  id, username: id, accessKey: key, status: 'active', role: 'creator',
  budgetUsedUsd: 0, budgetCapUsd: 0, allowedFlows: ['transcribe', 'foreign', 'domestic'],
});
store.accounts = [acct('owner', 'test-owner-key'), acct('other', 'test-other-key')];
store.systemConfig ||= {};
Object.assign(store.systemConfig, {
  requireAuthOnFrontend: true, providers: [], backendUrl: '', backendToken: '', mode: 'direct_llm',
});
store.projects = {};
const makeRichBody = (ep) =>
  [
    `第${ep}集`,
    `场次${ep}-1 内景 老宅客厅 夜`,
    '▲林深低声打开桌上的旧怀表，眼神紧盯窗外停靠的黑车。',
    '林深：这盘录像带里藏着三年前失踪案的真正时间线。',
  ].join('\n');
const ep = (n, extra = '') => ({
  id: `ep-${n}`, episodeNumber: n, title: `第${n}集`, body: makeRichBody(n) + extra, locked: false,
});
const seed = (id, o = {}) => {
  const { kind = 'transcribe', status = 'delivered', stage = 'delivery', episodes = [ep(1), ep(2)] } = o;
  const now = new Date().toISOString();
  const content = episodes.map((e) => e.body).join('\n\n');
  const project = {
    id, title: '回归测试', kind, total: 2, brief: '测试简介', messages: [],
    attachments: [1, 2].map((n) => ({
      id: `att-${n}`, name: `ep${n}.txt`, size: 1024, type: 'text/plain',
      role: 'source', episode: n, coveredEpisodes: [n],
    })),
    requirements: [], archived: false, createdAt: now, updatedAt: now, version: 1, confirmed: true,
    volumes: [{ id: 'vol-1', title: '第一卷', episodes }], episodes,
    outlineNodes: [], characterNodes: [], worldNodes: [], promptSelections: {},
    remote: {
      id: `r-${id}`, version: 1, status, stage: { key: stage, title: stage }, cursor: 2,
      progress: { completed_steps: 2, total_steps: 2 }, card: null,
      outputs: { script: { title: '剧本', content, updatedAt: now, version: 1 } }, messages: [],
    },
  };
  store.projects[id] = { owner: 'owner', data: JSON.stringify(project), version: 1, updated_at: now };
};
const snap = () => JSON.stringify(store.projects);
const hdr = (k) => (k ? { 'x-studio-token': k } : {});
const get = (id, q, k) =>
  upload.GET(new Request(`http://localhost/api/upload?id=${id}&${q}`, { headers: hdr(k) }));
const transfer = (id, k, target = 'foreign') =>
  studio.POST(new Request('http://localhost/api/studio', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...hdr(k) },
    body: JSON.stringify({
      operation: 'transfer_iteration', id, version: 1, target_kind: target,
      ready: true, remote: { status: 'delivered' },
    }),
  }));
const OWNER = 'test-owner-key';
const ALIASES = ['export=docx', 'format=docx'];
const denied = {
  'delivered-empty': { episodes: [] },
  'delivered-missing-ep2': { episodes: [ep(1)] },
  'delivered-placeholder': { episodes: [ep(1), ep(2, '\n模拟测试稿（不是实际视频还原）')] },
  'failed-with-bodies': { status: 'failed', stage: 'qa' },
  'ready-stage-delivery': { status: 'ready', stage: 'delivery' },
  'running-with-bodies': { status: 'running', stage: 'writing' },
};
const expectDenied = async (r, label) => {
  assert.equal(r.status, 409, label);
  assert.match(r.headers.get('content-type') || '', /json/, label);
  assert.ok(!/officedocument/.test(r.headers.get('content-type') || ''), label);
  const j = await r.json();
  assert.equal(j.code, 'TRANSCRIBE_NOT_READY', label);
  assert.match(String(j.error), /[\u4e00-\u9fff]/, label);
};
for (const [name, o] of Object.entries(denied)) {
  seed(name, o);
  const before = snap();
  for (const q of ALIASES) {
    await expectDenied(await get(name, q, OWNER), `${name} ${q}`);
    assert.equal(snap(), before, `${name} ${q} mutated store`);
  }
  await expectDenied(await transfer(name, OWNER), `${name} transfer`);
  assert.equal(snap(), before, `${name} transfer mutated store`);
}
seed('ok');
let before = snap();
for (const q of ALIASES) {
  assert.equal((await get('ok', q)).status, 401, `no token ${q}`);
  assert.equal((await get('ok', q, 'test-other-key')).status, 404, `other ${q}`);
}
assert.equal((await transfer('ok', undefined)).status, 401);
assert.equal((await transfer('ok', 'test-other-key')).status, 404);
assert.equal(snap(), before, 'auth failures mutated store');
for (const q of ALIASES) {
  const r = await get('ok', q, OWNER);
  assert.equal(r.status, 200, `valid ${q}`);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK', `docx bytes ${q}`);
}
before = snap();
const srcBefore = JSON.stringify(store.projects.ok);
const rows = Object.keys(store.projects).length;
const tr = await transfer('ok', OWNER);
assert.equal(tr.status, 201);
const tj = await tr.json();
const nid = tj.id || tj.project?.id;
assert.ok(nid && store.projects[nid] && nid !== 'ok', 'new project id');
assert.equal(Object.keys(store.projects).length, rows + 1);
assert.equal(JSON.stringify(store.projects.ok), srcBefore, 'source changed');
seed('foreign-failed', { kind: 'foreign', status: 'failed', stage: 'qa' });
before = snap();
assert.equal((await get('foreign-failed', 'export=docx', OWNER)).status, 200);
const ft = await transfer('foreign-failed', OWNER);
assert.equal(ft.status, 400);
assert.equal(snap(), before, 'non-transcribe transfer mutated store');
console.log(`PASS transcribe backend readiness routes (${Object.keys(denied).length} denied cases, auth, valid, non-transcribe)`);
console.log(`Isolated cwd preserved: ${tmp}`);
