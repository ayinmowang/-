import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import ts from 'typescript';
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
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'transcribe-recover-'));
process.chdir(tmp);
delete process.env.STUDIO_LLM_FIXTURE;
let fetchCalls = 0;
globalThis.fetch = () => {
  fetchCalls++;
  throw new Error('network forbidden');
};
const imp = (p) => import(new URL(p, root).href);
const { getStore, saveProject } = await imp('lib/server.ts');
const upload = await imp('app/api/upload/route.ts');
const studio = await imp('app/api/studio/route.ts');
const { extractManuscriptTextFromBuffer } = await imp('lib/manuscript-extract.ts');
const { projectToDocxInput } = await imp('lib/docx.ts');
const { prepareSavedTranscribeRecovery } = await imp('scripts/recover-saved-transcribe.mjs');

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

const SIMP = 'SIMP_ONLY_7731';
const TRAD = 'TRAD_ONLY_7732';
const PRE = 'RAW_PRIVATE_ONLY_1841';
const PRIV = '.private-transcribe-evidence/zz-marker';
const simp = (n) => [
  `**第${n}集 场次${n}-1 内景 老宅客厅 夜**`,
  '▲林深低声打开桌上的旧怀表，眼神紧盯窗外停靠的黑车。',
  '林深：这盘录像带里藏着三年前失踪案的真正时间线。',
  '▲苏晴推门而入，把湿透的外套甩在沙发上。',
  `苏晴：风声走漏得太快，${SIMP} 已经在路上了。`,
  `**第${n}集 场次${n}-2 外景 旧码头 晨**`,
  '▲海雾压住栈桥，林深蹲下身捡起半截烧焦的船票。',
  '林深：船票上的日期，比报案记录早了整整三天。',
].join('\n');
const trad = (n) => [
  `**第${n}集 場次${n}-1 內景 老宅客廳 夜**`,
  '▲林深低聲打開桌上的舊懷錶，眼神緊盯窗外停靠的黑車。',
  '林深：這盤錄像帶裡藏著三年前失蹤案的真正時間線。',
  '▲蘇晴推門而入，把濕透的外套甩在沙發上。',
  `蘇晴：風聲走漏得太快，${TRAD} 已經在路上了。`,
  `**第${n}集 場次${n}-2 外景 舊碼頭 晨**`,
  '▲海霧壓住棧橋，林深蹲下身撿起半截燒焦的船票。',
  '林深：船票上的日期，比報案記錄早了整整三天。',
].join('\n');
const mkRaw = (s, t) => [
  '### 【说明】',
  `${PRE} ${PRIV}`,
  '### 1. 【全剧人物标准人名锚定表】',
  '- 林深：男，三十岁，沉默的调查员',
  '- 苏晴：女，二十八岁，追查真相的记者',
  '### 2. 【本集核心剧情梗概】',
  '林深与苏晴在老宅追查三年前的失踪案线索。',
  '### 3. 【分集分场次还原剧本】',
  ...(t ? ['#### 一、 繁體單集版', t] : []),
  '#### 二、 简体全集版',
  s,
].join('\n');

const now = new Date().toISOString();
const foreign = { title: '外部', content: 'FOREIGN_KEEP_3310', updatedAt: now, version: 1 };
const failed = {
  id: 'p-rec', title: '恢复测试', kind: 'transcribe', total: 1, brief: '', messages: [],
  attachments: [{ id: 'att-1', name: 'ep1.mp4', size: 1024, type: 'video/mp4', role: 'source', episode: 1, coveredEpisodes: null }],
  requirements: [], archived: false, createdAt: now, updatedAt: now, version: 1, confirmed: true,
  volumes: [], episodes: [], outlineNodes: [], characterNodes: [], worldNodes: [], promptSelections: {},
  transcribeDraft: 'DRAFT_X_5521',
  transcribeMode: 'fast',
  remote: {
    id: 'r-rec', version: 1, mode: 'test_channel', status: 'failed',
    stage: { key: 'transcribe_incomplete', title: '未完成' }, cursor: 1,
    progress: { completed_steps: 1, total_steps: 2 }, card: null,
    outputs: { script: { title: '剧本', content: '占位', updatedAt: now, version: 1 }, foreignOutput: foreign },
    messages: [],
  },
};
store.projects['p-rec'] = { owner: 'owner', data: JSON.stringify(failed), version: 1, updated_at: now };
const rowData = () => store.projects['p-rec'].data;

// rejections: no mutation of project, store, or raw
const rejects = async (p, r) => {
  const b = JSON.stringify(p);
  const d = rowData();
  await assert.rejects(() => prepareSavedTranscribeRecovery(p, r));
  assert.equal(JSON.stringify(p), b);
  assert.equal(rowData(), d);
};
const good = mkRaw(simp(1), trad(1));
assert.ok(good.startsWith('### 【说明】\n'));
await rejects(failed, good.slice('### 【说明】\n'.length));
await rejects(failed, mkRaw(simp(1), ''));
await rejects(failed, mkRaw(simp(2), trad(2)));
await rejects(failed, mkRaw(simp(1), simp(1)));
await rejects(failed, 'fake short response');
await rejects(failed, JSON.stringify({ auditId: 'audit_x', sourceEpisodes: [1], textLength: 10 }));
await rejects({ ...failed, kind: 'foreign' }, good);

// preparation
const orig = JSON.parse(rowData());
const origSnap = JSON.stringify(orig);
const rawCopy = String(good);
const prepared = await prepareSavedTranscribeRecovery(orig, good);
assert.equal(JSON.stringify(orig), origSnap);
assert.equal(good, rawCopy);
assert.equal(prepared.remote.status, 'delivered');
assert.equal(prepared.remote.stage.key, 'delivery');
assert.equal(prepared.remote.stage.title, '已存响应离线恢复交付');
assert.equal(prepared.remote.cursor, 2);
assert.equal(prepared.remote.card, null);
assert.equal(prepared.remote.mode, 'test_channel');
assert.equal(prepared.transcribeMode, 'fast');
assert.deepEqual(prepared.remote.progress, { completed_steps: 2, total_steps: 2 });
assert.deepEqual(prepared.remote.outputs.foreignOutput, foreign);
assert.equal(prepared.episodes.length, 1);
assert.ok(prepared.episodes[0].body.includes(SIMP) && !prepared.episodes[0].body.includes(TRAD));
assert.ok(prepared.remote.outputs.script.content.includes(SIMP) && !prepared.remote.outputs.script.content.includes(TRAD));
const alt = prepared.remote.outputs.scriptTraditional;
assert.ok(alt.content.includes(TRAD) && !alt.content.includes(SIMP) && alt.version === 1 && alt.title);
assert.match(alt.content, /### 第 1 集/);
assert.match(JSON.stringify(prepared.messages), /离线恢复/);
for (const bad of [PRE, PRIV, 'DRAFT_X_5521']) assert.ok(!JSON.stringify(prepared).includes(bad));

// real save + persistence
const saved = await saveProject(prepared, 'owner');
assert.equal(saved.version, 2);
assert.equal(JSON.parse(rowData()).version, 2);
const hdr = (k) => (k ? { 'x-studio-token': k } : {});
const sget = (q, k) => studio.GET(new Request(`http://localhost/api/studio${q}`, { headers: hdr(k) }));
const r1 = await sget('?id=p-rec', 'test-owner-key');
assert.equal(r1.status, 200);
const t1 = await r1.text();
const pj = JSON.parse(t1);
assert.equal(pj.version, 2);
assert.equal(pj.remote.status, 'delivered');
assert.ok(pj.remote.outputs.scriptTraditional.content.includes(TRAD));
const rl = await sget('', 'test-owner-key');
assert.equal(rl.status, 200);
const tl = await rl.text();
assert.ok(JSON.parse(tl).projects.some((p) => p.id === 'p-rec'));
for (const t of [t1, tl, rowData()]) for (const bad of [PRE, PRIV, 'DRAFT_X_5521']) assert.ok(!t.includes(bad));
assert.equal((await sget('?id=p-rec')).status, 401);
assert.equal((await sget('?id=p-rec', 'test-other-key')).status, 404);

// Word export through the real route
const get = (q, k) => upload.GET(new Request(`http://localhost/api/upload?id=p-rec&${q}`, { headers: hdr(k) }));
const dq = 'export=docx';
const rw = await get(dq, 'test-owner-key');
assert.equal(rw.status, 200);
const buf = Buffer.from(await rw.arrayBuffer());
assert.ok(buf[0] === 0x50 && buf[1] === 0x4b);
assert.equal((await get(dq)).status, 401);
assert.equal((await get(dq, 'test-other-key')).status, 404);
const ext = extractManuscriptTextFromBuffer(buf, 'out.docx');
assert.equal(ext.error, undefined);
const text = ext.text;
const count = (s, sub) => s.split(sub).length - 1;
const HEAD = '附：繁體版分集劇本';
assert.equal(count(text, SIMP), 1);
assert.equal(count(text, TRAD), 1);
assert.equal(count(text, HEAD), 1);
assert.ok(text.indexOf(SIMP) < text.indexOf(HEAD) && text.indexOf(HEAD) < text.indexOf(TRAD));
for (const bad of [PRE, PRIV, 'DRAFT_X_5521']) assert.ok(!text.includes(bad));

// DOCX mapping: invalid alternate rejects, absent alternate unchanged
const saved2 = JSON.parse(rowData());
const withAlt = (c) => {
  const p = structuredClone(saved2);
  if (c === undefined) delete p.remote.outputs.scriptTraditional;
  else p.remote.outputs.scriptTraditional.content = c;
  return p;
};
for (const c of ['', 'metadata only, no episodes', `### 第 2 集\n${trad(2)}`]) {
  await assert.rejects(async () => projectToDocxInput(withAlt(c)), /[\u4e00-\u9fff]/);
}
assert.ok(!JSON.stringify(await projectToDocxInput(withAlt(undefined))).includes(HEAD));
assert.ok(JSON.stringify(await projectToDocxInput(withAlt(saved2.remote.outputs.scriptTraditional.content))).includes(HEAD));

// CLI: unknown flag refuses before any store access
const t2 = await fs.mkdtemp(path.join(os.tmpdir(), 'transcribe-recover-cli-'));
const cli = spawnSync(
  process.execPath,
  ['--experimental-strip-types', fileURLToPath(new URL('scripts/recover-saved-transcribe.mjs', root)), '--bogus'],
  { cwd: t2, encoding: 'utf8' },
);
assert.notEqual(cli.status, 0);
assert.match(cli.stderr, /refused/);
assert.ok(!cli.stdout.includes('ok') && !cli.stderr.includes(PRIV));
await assert.rejects(fs.stat(path.join(t2, '.data')), { code: 'ENOENT' });

// actual pin-predicate test (not a full CLI/filesystem application):
// AST-extract the exact PIN/need/pinned declarations from the trusted local CLI source
const pinSrc = await fs.readFile(fileURLToPath(new URL('scripts/recover-saved-transcribe.mjs', root)), 'utf8');
const pinSf = ts.createSourceFile('recover-saved-transcribe.mjs', pinSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const pinDecls = { PIN: [], need: [], pinned: [] };
const walkPin = (n) => {
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && Object.hasOwn(pinDecls, n.name.text)) {
    pinDecls[n.name.text].push(n);
  }
  ts.forEachChild(n, walkPin);
};
walkPin(pinSf);
for (const k of Object.keys(pinDecls)) {
  assert.equal(pinDecls[k].length, 1);
  assert.ok(pinDecls[k][0].initializer && (pinDecls[k][0].parent.flags & ts.NodeFlags.Const));
}
const pinCode = ['PIN', 'need', 'pinned'].map((k) => `const ${pinDecls[k][0].getText(pinSf)};`).join('\n');
const { PIN, pinned } = new Function(`${pinCode}\nreturn { PIN, pinned };`)();
const pinProject = structuredClone(failed);
pinProject.id = PIN.project;
pinProject.version = PIN.version;
pinProject.transcribeMode = 'fast';
pinProject.remote.mode = 'test_channel';
pinProject.processedActionIds = [PIN.action];
assert.ok(pinProject.transcribeMode === 'fast' && pinProject.remote.mode === 'test_channel');
assert.ok(pinProject.remote.status === 'failed' && pinProject.remote.stage.key === 'transcribe_incomplete');
const pinStore = {
  projects: { [PIN.project]: { owner: PIN.owner, data: JSON.stringify(pinProject), version: PIN.version, updated_at: now } },
  auditLogs: [{ id: PIN.audit, projectId: PIN.project }],
};
const pinSnap = JSON.stringify(pinStore);
const pinBase = pinned(pinStore);
assert.ok(pinBase.project.id === PIN.project && pinBase.row.owner === PIN.owner);
assert.ok(JSON.stringify(pinStore) === pinSnap);
const pinVariant = (mut) => {
  const s = structuredClone(pinStore);
  const row = s.projects[PIN.project];
  const p = JSON.parse(row.data);
  mut(s, row, p);
  row.data = JSON.stringify(p);
  return s;
};
assert.throws(() => pinned(pinVariant((s, row) => { row.owner = `${PIN.owner}-x`; })), /refused/);
assert.throws(() => pinned(pinVariant((s) => { s.auditLogs = []; })), /refused/);
assert.throws(() => pinned(pinVariant((s, row, p) => { p.processedActionIds = [`${PIN.action}-x`]; })), /refused/);
assert.throws(() => pinned(pinVariant((s, row, p) => {
  row.version = PIN.version + 1;
  p.version = PIN.version + 1;
  p.remote.status = 'delivered';
  p.remote.stage = { key: 'delivery', title: '已存响应离线恢复交付' };
})), /refused/);
assert.ok(JSON.stringify(pinStore) === pinSnap);

assert.equal(fetchCalls, 0);
console.log('transcribe-saved-recovery: ok (prepare, save, GET, anon-owner, Word-XML, pin-repeat, fetch0)');
