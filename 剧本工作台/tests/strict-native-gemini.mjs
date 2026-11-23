import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-native-'));
fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));
for (const modName of ['gemini-native-sse', 'strict-native-station']) {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'lib', `${modName}.ts`), 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  fs.writeFileSync(path.join(tmpDir, `${modName}.js`), out.outputText);
}
const require = createRequire(path.join(tmpDir, 'index.js'));
const { NATIVE_GEMINI_URL } = require('./gemini-native-sse.js');
const { runStrictNativeStation, isStrictNativeGeminiEnabled } = require('./strict-native-station.js');

const FAKE_KEY = 'AIzaSyTestSecretKey9876543210XYZ';
const VALID_JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');
const FAKE_MP4_B64 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]).toString('base64');
const makeSse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

// 1. Disabled & missing key & no jpeg -> 0 fetch
assert.equal(isStrictNativeGeminiEnabled({}), false);
assert.equal(await runStrictNativeStation({ station: 'vision', userPrompt: 'hi', fetchImpl: () => { throw new Error('no'); } }, {}), null);
let calls = 0;
const countFetch = async () => { calls += 1; throw new Error('unexpected'); };
const noKey = await runStrictNativeStation({ station: 'vision', userPrompt: 'hi', mediaAttachments: [{ name: 'a.jpg', mimeType: 'image/jpeg', base64: VALID_JPEG_B64 }], fetchImpl: countFetch }, { STUDIO_STRICT_NATIVE_GEMINI: '1' });
assert.equal(noKey.ok, false); assert.equal(calls, 0);
const noFrame = await runStrictNativeStation({ station: 'vision', userPrompt: 'hi', mediaAttachments: [{ name: 'ep1.mp4', mimeType: 'video/mp4', base64: FAKE_MP4_B64 }, { name: 'bad.jpg', mimeType: 'image/jpeg', base64: FAKE_MP4_B64 }], fetchImpl: countFetch }, { STUDIO_STRICT_NATIVE_GEMINI: '1', STUDIO_STRICT_NATIVE_API_KEY: FAKE_KEY });
assert.equal(noFrame.ok, false); assert.equal(calls, 0);

// 2. Valid JPEG + mp4 -> 1 POST, inline_data only, chunked SSE + thoughts usage
let postCount = 0;
const chunkedFetch = async (url, init) => {
  postCount += 1;
  assert.equal(url, NATIVE_GEMINI_URL);
  assert.equal(init.redirect, 'error');
  assert.equal(new Headers(init.headers).get('User-Agent'), 'curl/8.5.0');
  const body = JSON.parse(init.body);
  const parts = body.contents[0].parts;
  assert.equal(parts.length, 2);
  assert.equal(parts[0].inline_data.mime_type, 'image/jpeg');
  assert.equal(JSON.stringify(body).includes('image_url'), false);
  const sse = makeSse([
    { candidates: [{ content: { parts: [{ text: '第一段' }] } }], usageMetadata: { promptTokenCount: 100 } },
    { candidates: [{ content: { parts: [{ text: '第二段' }] }, finishReason: 'STOP' }], usageMetadata: { candidatesTokenCount: 50, thoughtsTokenCount: 30, totalTokenCount: 180 } },
  ]);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) { c.enqueue(enc.encode(sse.slice(0, 25))); c.enqueue(enc.encode(sse.slice(25))); c.close(); }
  });
  return new Response(stream, { status: 200 });
};
const okRes = await runStrictNativeStation({ station: 'vision', userPrompt: '分析画面', mediaAttachments: [{ name: 'ep1.mp4', mimeType: 'video/mp4', base64: FAKE_MP4_B64 }, { name: 'f1.jpg', mimeType: 'image/jpeg', base64: VALID_JPEG_B64 }], fetchImpl: chunkedFetch }, { STUDIO_STRICT_NATIVE_GEMINI: '1', STUDIO_STRICT_NATIVE_API_KEY: FAKE_KEY });
assert.equal(postCount, 1); assert.equal(okRes.ok, true); assert.equal(okRes.audit.usageStatus, 'known'); assert.equal(okRes.audit.tokens, 180); assert.equal(okRes.audit.thoughtTokens, 30); assert.ok(okRes.text.includes('第一段第二段')); assert.ok(okRes.text.includes('媒体采样说明'));

// 3. Missing usage -> unknown
const unknownRes = await runStrictNativeStation({ station: 'vision', userPrompt: '分析', mediaAttachments: [{ name: 'f1.jpg', mimeType: 'image/jpeg', base64: VALID_JPEG_B64 }], fetchImpl: async () => new Response(makeSse([{ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }]), { status: 200 }) }, { STUDIO_STRICT_NATIVE_GEMINI: '1', STUDIO_STRICT_NATIVE_API_KEY: FAKE_KEY });
assert.equal(unknownRes.ok, true); assert.equal(unknownRes.audit.usageStatus, 'unknown'); assert.equal(unknownRes.audit.tokens, 0);

// 4. Errors (401/429/502/network/SAFETY/MAX_TOKENS/no STOP) -> no retry, no secret leak
for (const mock of [
  async () => new Response(`bad ${FAKE_KEY}`, { status: 401 }),
  async () => new Response('rate', { status: 429 }),
  async () => new Response('bad gw', { status: 502 }),
  async () => { throw new Error(`net ${FAKE_KEY}`); },
  async () => new Response(makeSse([{ candidates: [{ finishReason: 'SAFETY' }] }]), { status: 200 }),
  async () => new Response(makeSse([{ candidates: [{ content: { parts: [{ text: 'cut' }] }, finishReason: 'MAX_TOKENS' }] }]), { status: 200 }),
  async () => new Response(makeSse([{ candidates: [{ content: { parts: [{ text: 'partial' }] } }] }]), { status: 200 }),
]) {
  let n = 0;
  const errRes = await runStrictNativeStation({ station: 'vision', userPrompt: 'x', mediaAttachments: [{ name: 'f1.jpg', mimeType: 'image/jpeg', base64: VALID_JPEG_B64 }], fetchImpl: async (...a) => { n += 1; return mock(...a); } }, { STUDIO_STRICT_NATIVE_GEMINI: '1', STUDIO_STRICT_NATIVE_API_KEY: FAKE_KEY });
  assert.equal(n, 1); assert.equal(errRes.ok, false); assert.equal(JSON.stringify(errRes).includes(FAKE_KEY), false); assert.equal(JSON.stringify(errRes).includes('code28'), false);
}

// 5. Timeout -> 1 fetch
let tCalls = 0;
const toRes = await runStrictNativeStation({ station: 'vision', userPrompt: 'x', timeoutMs: 10, mediaAttachments: [{ name: 'f1.jpg', mimeType: 'image/jpeg', base64: VALID_JPEG_B64 }], fetchImpl: (_u, init) => { tCalls += 1; return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))); } }, { STUDIO_STRICT_NATIVE_GEMINI: '1', STUDIO_STRICT_NATIVE_API_KEY: FAKE_KEY });
assert.equal(tCalls, 1); assert.equal(toRes.ok, false);

console.log('PASSED', tmpDir);
