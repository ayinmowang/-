import assert from 'node:assert/strict';
import fs from 'node:fs';

await import('./transcribe-backend-ready-routes.mjs');

let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error('network forbidden in transcribe-raw-isolation');
};

const { getStore, saveProject, message } = await import(new URL('../lib/server.ts', import.meta.url).href);
const { GET } = await import(new URL('../app/api/studio/route.ts', import.meta.url).href);

const OWNER_TOKEN = 'test-owner-key';
const OTHER_TOKEN = 'test-other-key';
const PRIVATE_PATH = '.private-transcribe-evidence/PRIVATE_ONLY';
const PRIVATE_DIAG = 'PRIVATE_BACKEND_ONLY';
const SAFE_MSG = 'SAFE_VISIBLE_NOTE_FOR_OWNER';

const argv = process.argv.slice(2);
const realIdx = argv.indexOf('--real-input');
let RAW;
let synthetic = true;
let markers = [];
if (realIdx >= 0) {
  const realPath = argv[realIdx + 1];
  assert.ok(realPath, '--real-input requires a file path');
  const obj = JSON.parse(fs.readFileSync(realPath, 'utf8'));
  RAW = obj?.remote?.outputs?.transcribeDraft?.content;
  assert.ok(typeof RAW === 'string' && RAW.trim().length > 0, 'real input must contain remote.outputs.transcribeDraft.content');
  synthetic = false;
} else {
  markers = ['RAW_PRIVATE_ONLY', 'PEOPLE_MARKER_PRIVATE', 'SYNOPSIS_MARKER_PRIVATE', 'BODY_MARKER_PRIVATE'];
  RAW = [
    'RAW_PRIVATE_ONLY',
    '### 人物锚定表',
    '- PEOPLE_MARKER_PRIVATE：测试人物',
    '### 故事梗概',
    'SYNOPSIS_MARKER_PRIVATE 测试梗概',
    '### 第1集',
    'BODY_MARKER_PRIVATE 测试正文',
  ].join('\n');
}
const RAW_ESCAPED = JSON.stringify(RAW).slice(1, -1);

const forbidden = [RAW, RAW_ESCAPED, '.private-transcribe-evidence', PRIVATE_DIAG, 'PRIVATE_ONLY', ...markers];

function assertClean(text, label) {
  forbidden.forEach((f, i) => {
    assert.ok(!text.includes(f), `${label}: leaked forbidden value #${i}`);
  });
  assert.ok(!/transcribedraft/i.test(text), `${label}: reserved field present`);
}

function hasKeyDeep(value, re) {
  if (Array.isArray(value)) return value.some((v) => hasKeyDeep(v, re));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => re.test(k) || hasKeyDeep(v, re));
  }
  return false;
}

function call(id, token) {
  return GET(
    new Request(`http://localhost/api/studio?id=${encodeURIComponent(id)}`, {
      headers: token ? { 'x-studio-token': token } : {},
    })
  );
}

// Baseline: owner project with a safe message, no legacy draft.
const okRow = getStore().projects.ok;
assert.ok(okRow, 'fixture project ok must exist');
assert.equal(okRow.owner, 'owner');
const project = JSON.parse(okRow.data);
assert.ok(Array.isArray(project.episodes) && project.episodes.length >= 2, 'fixture has episodes 1 and 2');
project.episodes.slice(0, 2).forEach((ep) => {
  assert.ok(typeof ep.body === 'string' && ep.body.trim().length > 0, 'fixture episode body present');
});
project.remote = project.remote || {};
project.remote.outputs = project.remote.outputs || {};
assert.ok(project.remote.outputs.script, 'fixture has outputs.script');
message(project, 'user', SAFE_MSG);
const baselineData = JSON.stringify(project);
getStore().projects.ok.data = baselineData;

const baseRes = await call('ok', OWNER_TOKEN);
assert.equal(baseRes.status, 200, 'baseline owner GET');
const baseline = await baseRes.json();
assert.ok(JSON.stringify(baseline).includes(SAFE_MSG), 'safe message visible in baseline');
assert.ok(typeof baseline.remote.outputs.script.content === 'string' && baseline.remote.outputs.script.content.length > 0);

// Seed legacy draft into the persisted row.
const seeded = JSON.parse(baselineData);
seeded.remote.outputs.transcribeDraft = {
  title: '扒剧未验收草稿',
  content: RAW,
  version: 1,
  updatedAt: '2024-01-01T00:00:00.000Z',
  rawPath: PRIVATE_PATH,
  diagnostic: PRIVATE_DIAG,
};
const legacyData = JSON.stringify(seeded);
assert.ok(legacyData.includes(RAW_ESCAPED), 'legacy row seeded with raw');
getStore().projects.ok.data = legacyData;
const legacyVersion = getStore().projects.ok.version;
const legacyUpdated = getStore().projects.ok.updated_at;

// Owner GET over legacy row is clean.
const ownerRes = await call('ok', OWNER_TOKEN);
assert.equal(ownerRes.status, 200, 'owner GET status');
const ownerText = await ownerRes.text();
assertClean(ownerText, 'owner GET');
const ownerBody = JSON.parse(ownerText);
assert.ok(!hasKeyDeep(ownerBody, /^transcribedraft$/i), 'owner GET has no draft key');
assert.deepEqual(ownerBody.episodes, baseline.episodes, 'episodes unchanged by GET');
assert.deepEqual(ownerBody.remote.outputs, baseline.remote.outputs, 'outputs (script etc.) unchanged by GET');
assert.deepEqual(ownerBody.messages, baseline.messages, 'messages unchanged by GET');
assert.ok(ownerText.includes(SAFE_MSG), 'safe message still visible');
assert.ok(ownerBody.remote.outputs.script.content.length > 0, 'script content retained');

// GET must not mutate the legacy row.
const afterGetRow = getStore().projects.ok;
assert.ok(afterGetRow.data === legacyData, 'GET must not rewrite legacy row');
assert.equal(afterGetRow.version, legacyVersion);
assert.equal(afterGetRow.updated_at, legacyUpdated);

// Auth behavior preserved.
assert.equal((await call('ok', undefined)).status, 401, 'anonymous GET is 401');
assert.equal((await call('ok', OTHER_TOKEN)).status, 404, 'other user GET is 404');

// saveProject removes the draft from the returned and persisted project.
const saved = await saveProject(JSON.parse(legacyData), 'owner');
assertClean(JSON.stringify(saved), 'saveProject return');
assert.ok(!hasKeyDeep(saved, /^transcribedraft$/i), 'saved project has no draft key');
const persistedRow = getStore().projects.ok;
assertClean(persistedRow.data, 'persisted row');
assert.ok(Number(persistedRow.version) > Number(legacyVersion), 'saveProject increments version');
const persisted = JSON.parse(persistedRow.data);
assert.deepEqual(persisted.episodes, baseline.episodes, 'persisted episodes preserved');
assert.deepEqual(persisted.remote.outputs.script, baseline.remote.outputs.script, 'persisted script preserved');
assert.deepEqual(persisted.messages, baseline.messages, 'persisted messages preserved');

const afterSaveRes = await call('ok', OWNER_TOKEN);
assert.equal(afterSaveRes.status, 200);
const afterSaveText = await afterSaveRes.text();
assertClean(afterSaveText, 'owner GET after save');
const afterSave = JSON.parse(afterSaveText);
assert.deepEqual(afterSave.episodes, baseline.episodes);
assert.deepEqual(afterSave.remote.outputs, baseline.remote.outputs);
assert.deepEqual(afterSave.messages, baseline.messages);

// Ordinary non-transcribe project: script and custom output unchanged.
const fRow = getStore().projects['foreign-failed'];
assert.ok(fRow, 'fixture foreign-failed must exist');
const fOwner = fRow.owner;
const fToken = fOwner === 'other' ? OTHER_TOKEN : fOwner === 'owner' ? OWNER_TOKEN : null;
assert.ok(fToken, 'foreign-failed owner must be a known fixture account');
const fProject = JSON.parse(fRow.data);
fProject.remote = fProject.remote || {};
fProject.remote.outputs = fProject.remote.outputs || {};
fProject.remote.outputs.customOrdinary = {
  title: 'Ordinary note',
  content: 'ORDINARY_CUSTOM_CONTENT_KEEP',
  updatedAt: '2024-01-01T00:00:00.000Z',
  version: 1,
};
getStore().projects['foreign-failed'].data = JSON.stringify(fProject);

const fBeforeRes = await call('foreign-failed', fToken);
assert.equal(fBeforeRes.status, 200, 'foreign-failed owner GET before save');
const fBefore = await fBeforeRes.json();
assert.ok(fBefore.remote.outputs.script, 'ordinary script output present');
assert.equal(fBefore.remote.outputs.customOrdinary?.content, 'ORDINARY_CUSTOM_CONTENT_KEEP', 'custom output visible');

await saveProject(JSON.parse(getStore().projects['foreign-failed'].data), fOwner);
const fAfterRes = await call('foreign-failed', fToken);
assert.equal(fAfterRes.status, 200);
const fAfter = await fAfterRes.json();
assert.deepEqual(fAfter.remote.outputs.script, fBefore.remote.outputs.script, 'ordinary script unchanged');
assert.deepEqual(fAfter.remote.outputs.customOrdinary, fBefore.remote.outputs.customOrdinary, 'custom output unchanged');
assert.deepEqual(fAfter.episodes, fBefore.episodes, 'ordinary episodes/body unchanged');

assert.equal(fetchCalls, 0, 'no network calls');
console.log(`transcribe-raw-isolation: all passed (${synthetic ? 'synthetic' : 'real-input'})`);
