// Runs tests/transcribe-backend-ready-routes.mjs first (isolated tmp cwd, accounts, schema).
// Deadline cases use a synthetic clock: setTimeout(120000) becomes 10ms and is restored in finally.
// Synthetic stubs only; this is not live provider or video evidence.
import assert from 'node:assert/strict';
await import('./transcribe-backend-ready-routes.mjs');
const imp = (p) => import(new URL(`../${p}`, import.meta.url).href);
const { getStore } = await imp('lib/server.ts');
const studio = await imp('app/api/studio/route.ts');
const { postNativeOnce } = await imp('lib/gemini-native-sse.ts');
const SECRET = 'fake-native-secret';
const OWNER = 'test-owner-key';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');
process.env.STUDIO_STRICT_NATIVE_GEMINI = '1';
process.env.STUDIO_STRICT_NATIVE_API_KEY = SECRET;
delete process.env.STUDIO_STRICT_NATIVE_FULL_VIDEO;
delete process.env.STUDIO_LLM_FIXTURE;
const store = await getStore();
store.systemConfig.creationTiers = [{
  id: 'native-test', name: 'native-test', badge: 'test', description: 'synthetic native test tier', costHint: 'test',
  station: 'vision', enabled: true, isDefault: true, order: 1,
  model: 'gemini-4-carbon',
  maxTokens: 1024, supportsThinking: false,
}];
const baseP = JSON.parse(store.projects.ok.data);
const seed = (id) => {
  const p = structuredClone(baseP);
  Object.assign(p, { id, remoteId: `r-${id}`, processedActionIds: [], transcribeMode: null, preferredTierId: 'native-test', version: 1 });
  Object.assign(p.remote, {
    id: `r-${id}`, mode: 'test_channel', status: 'waiting_confirm', stage: { key: 'recap', title: 'recap' },
    cursor: 1, transcribeMode: null, progress: { completed_steps: 1, total_steps: 3 },
    card: { id: 'card-mode', step: 'recap', title: '模式', fields: ['understood', 'mode'], questions: [{ question: '选择模式' }] },
  });
  store.projects[id] = { owner: 'owner', data: JSON.stringify(p), version: 1, updated_at: new Date().toISOString() };
  return p;
};
const row = (id) => JSON.parse(store.projects[id].data);
const act = (id, version, actionId, token = OWNER) =>
  studio.POST(new Request('http://localhost/api/studio', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-studio-token': token } : {}) },
    body: JSON.stringify({
      id, version, operation: 'action', preferredTierId: 'native-test', thinkingLevel: 'off', executionMode: 'auto',
      action: { action: 'confirm', action_id: actionId, answers: { understood: true, mode: 'fast' },
        keyframes: [{ name: 'k1.jpg', mimeType: 'image/jpeg', base64: JPEG }] },
    }),
  }));
const stream = (init) => new Response(new ReadableStream({
  start(c) { init.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError'))); },
}), { status: 200 });
const run = async (name, stub, o) => {
  const id = `tf-${name}`;
  const before = seed(id);
  let calls = 0;
  globalThis.fetch = (...a) => { calls++; return stub(...a); };
  const seen = new Set((store.auditLogs || []).map((l) => l.id));
  const realST = globalThis.setTimeout;
  if (o.fast) globalThis.setTimeout = (fn, ms, ...a) => realST(fn, ms === 120000 ? 10 : ms, ...a);
  let r;
  try { r = await act(id, 1, `a-${name}`); } finally { globalThis.setTimeout = realST; }
  const text = await r.text();
  assert.equal(r.status, 502, name);
  assert.match(JSON.parse(text).error, /[\u4e00-\u9fff]/, name);
  assert.ok(!text.includes(JPEG) && !/fake-native|gemini|prompt|ECONNRESET|read boom/i.test(text), `${name} leak`);
  assert.equal(calls, 1, `${name} fetch count`);
  const after = row(id);
  assert.equal(after.remote.status, 'failed', name);
  assert.equal(after.remote.stage.key, 'transcribe_failed', name);
  assert.equal(after.remote.card, null, name);
  assert.equal(after.transcribeMode, 'fast', name);
  assert.ok(after.processedActionIds.includes(`a-${name}`), name);
  for (const k of ['episodes', 'volumes']) assert.deepEqual(after[k], before[k], `${name} ${k}`);
  assert.deepEqual(after.remote.outputs, before.remote.outputs, `${name} outputs`);
  const raw = store.projects[id].data;
  assert.ok(!raw.includes(JPEG) && !raw.includes(SECRET) && !raw.includes('diagnostic'), `${name} persisted leak`);
  const d = (store.auditLogs || []).find((l) => l.diagnostic && !seen.has(l.id))?.diagnostic;
  assert.ok(d, `${name} diagnostic`);
  assert.ok([].concat(o.phase).includes(d.lastPhase), `${name} phase ${d.lastPhase}`);
  assert.equal(d.timeoutMs, 120000);
  assert.equal(typeof d.elapsedMs, 'number');
  assert.ok(!JSON.stringify(d).includes(SECRET) && !JSON.stringify(d).includes(JPEG));
  if (o.code) assert.equal(d.reasonCode, o.code, name);
  else { assert.notEqual(d.reasonCode, 'OK'); assert.match(d.reasonCode, /^[A-Z][A-Z0-9_]*$/); }
  if (o.local !== undefined) assert.equal(d.localDeadline, o.local, name);
  if (o.status) assert.equal(d.httpStatus, o.status, name);
};
await run('request', () => Promise.reject(new TypeError(`ECONNRESET ${SECRET}`)), { code: 'REQUEST_FAILED', local: false, phase: 'request_start' });
await run('stream', () => Promise.resolve(new Response(new ReadableStream({ pull(c) { c.error(new Error('read boom')); } }), { status: 200 })),
  { code: 'STREAM_READ_FAILED', local: false, phase: 'response_body', status: 200 });
await run('malformed', () => Promise.resolve(new Response('data: {bad json\n\n', { status: 200 })), { phase: ['parse', 'complete'], status: 200 });
await run('deadline', (_u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))),
  { fast: true, code: 'REQUEST_FAILED', local: true, phase: 'request_start' });
await run('deadline-body', (_u, init) => Promise.resolve(stream(init)),
  { fast: true, code: 'STREAM_READ_FAILED', local: true, phase: 'response_body', status: 200 });
await run('external-abort', () => Promise.reject(new DOMException('aborted', 'AbortError')), { code: 'REQUEST_FAILED', local: false, phase: 'request_start' });
// In-flight duplicate with the persisted version and a new action id: rejected, no extra fetch.
{
  seed('tf-dup');
  let calls = 0, release, started;
  const gate = new Promise((r) => { release = r; });
  const startedP = new Promise((r) => { started = r; });
  globalThis.fetch = () => { calls++; started(); return gate.then(() => { throw new TypeError('late failure'); }); };
  const first = act('tf-dup', 1, 'a-dup');
  await startedP;
  assert.equal(row('tf-dup').remote.status, 'running');
  assert.equal(row('tf-dup').transcribeMode, 'fast');
  const second = await act('tf-dup', row('tf-dup').version, 'a-dup-2');
  assert.equal(second.status, 409);
  assert.equal(calls, 1);
  assert.equal(row('tf-dup').remote.status, 'running');
  release();
  assert.equal((await first).status, 502);
  assert.equal(row('tf-dup').remote.status, 'failed');
  assert.equal(calls, 1);
}
// Auth and ownership denial stay unchanged and never reach fetch.
{
  seed('tf-auth');
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('network forbidden'); };
  const snap = store.projects['tf-auth'].data;
  assert.equal((await act('tf-auth', 1, 'a-x', '')).status, 401);
  assert.equal((await act('tf-auth', 1, 'a-x', 'test-other-key')).status, 404);
  assert.equal(calls, 0);
  assert.equal(store.projects['tf-auth'].data, snap);
}
// Direct phase callback: two-arg form still works, phase names are fixed.
{
  const ok = () => Promise.resolve(new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }] })}\n\n`, { status: 200 }));
  const args = { apiKey: SECRET, userText: 'hello', images: [], temperature: 0, maxOutputTokens: 16 };
  const seq = [];
  await postNativeOnce(args, ok, (ph, st) => seq.push([ph, st]));
  assert.deepEqual(seq.map((x) => x[0]), ['payload_prepare', 'request_start', 'response_headers', 'response_body', 'first_chunk', 'body_complete', 'parse', 'complete']);
  assert.equal(seq.find((x) => x[0] === 'response_headers')[1], 200);
  assert.equal((await postNativeOnce(args, ok)).status, 200);
}
console.log('PASS transcribe failure boundary (6 failure cases, duplicate, auth, phases)');
