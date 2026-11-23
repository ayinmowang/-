import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-full-video-'));
fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));

for (const name of ['gemini-native-sse', 'strict-native-station']) {
  const source = fs.readFileSync(path.join(root, 'lib', `${name}.ts`), 'utf8');
  const out = ts.transpileModule(source, {
    fileName: `${name}.ts`,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  fs.writeFileSync(path.join(tmpDir, `${name}.js`), out.outputText);
}

const nodeRequire = createRequire(path.join(tmpDir, 'index.js'));
const gem = nodeRequire('./gemini-native-sse.js');
const strict = nodeRequire('./strict-native-station.js');

const KEY = 'test-key-SECRET-9f8e7d6c5b4a';
process.env.STUDIO_STRICT_NATIVE_GEMINI = '1';
process.env.STUDIO_STRICT_NATIVE_API_KEY = KEY;

// MOCK STUB ONLY: 24 bytes with an ftyp box header. This is not real media
// and is not evidence that Gemini accepts any actual video.
const MOCK_MP4_BYTES = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from('ftypisom'),
  Buffer.from([0, 0, 2, 0]),
  Buffer.from('isomiso2'),
]);
const MOCK_MP4_B64 = MOCK_MP4_BYTES.toString('base64');

const MOCK_JPEG_B64 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]).toString('base64');

const video = (base64 = MOCK_MP4_B64, extra = {}) => ({
  name: 'mock.mp4',
  mimeType: 'video/mp4',
  base64,
  ...extra,
});
const jpeg = () => ({ name: 'f.jpg', mimeType: 'image/jpeg', base64: MOCK_JPEG_B64 });

function makeFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return responder(calls.length);
  };
  fn.calls = calls;
  return fn;
}

function sse(chunks, { finish = 'STOP' } = {}) {
  return chunks
    .map((text, i) => {
      const last = i === chunks.length - 1;
      const cand = { content: { role: 'model', parts: [{ text }] } };
      if (last && finish) cand.finishReason = finish;
      const payload = { candidates: [cand] };
      if (last) {
        payload.usageMetadata = { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 };
      }
      return `data: ${JSON.stringify(payload)}\n\n`;
    })
    .join('');
}

const sseResponse = (body) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });

function collect(obj, key, out = []) {
  if (Array.isArray(obj)) {
    for (const v of obj) collect(v, key, out);
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (k === key) out.push(v);
      collect(v, key, out);
    }
  }
  return out;
}

async function withFlag(value, fn) {
  const prev = process.env.STUDIO_STRICT_NATIVE_FULL_VIDEO;
  if (value === undefined) delete process.env.STUDIO_STRICT_NATIVE_FULL_VIDEO;
  else process.env.STUDIO_STRICT_NATIVE_FULL_VIDEO = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.STUDIO_STRICT_NATIVE_FULL_VIDEO;
    else process.env.STUDIO_STRICT_NATIVE_FULL_VIDEO = prev;
  }
}

const USER_PROMPT = '请转录第3集的完整内容';

function runStation(fetchImpl, overrides = {}, ...rest) {
  // Omitted third argument means flag '1'; an explicit undefined means the flag is absent.
  const flag = rest.length === 0 ? '1' : rest[0];
  return withFlag(flag, () =>
    strict.runStrictNativeStation({
      station: 'vision',
      userPrompt: USER_PROMPT,
      transcribeMode: 'fast',
      mediaAttachments: [video()],
      fetchImpl,
      ...overrides,
    })
  );
}

const hasChinese = (s) => /[\u4e00-\u9fff]/.test(s);

test('flag on + fast + one valid MP4: sends full unchanged video in one POST and keeps raw text exact', async () => {
  const chunks = ['\n  第一段，', '第二段。  \n'];
  const fetchImpl = makeFetch(() => sseResponse(sse(chunks)));
  const res = await runStation(fetchImpl);

  assert.equal(fetchImpl.calls.length, 1);
  const { init } = fetchImpl.calls[0];
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  const body = JSON.parse(init.body);
  const inline = collect(body, 'inline_data');
  assert.equal(inline.length, 1);
  assert.equal(inline[0].mime_type, 'video/mp4');
  assert.equal(inline[0].data, MOCK_MP4_B64);

  const texts = collect(body, 'text').filter((t) => typeof t === 'string').join('\n');
  assert.ok(texts.includes(USER_PROMPT));
  assert.ok(!texts.includes('第1集'));
  assert.ok(!/未使用任何音轨|无音频|仅基于.*抽样/.test(texts));
  assert.ok(/声音|音频|音/.test(texts));

  assert.equal(res.ok, true);
  assert.equal(res.rawText, chunks.join(''));
  assert.equal(res.text, chunks.join('').trim());
  assert.ok(!res.text.includes('媒体采样说明'));
  assert.deepEqual(res.audit.mediaMimes, ['video/mp4']);
  assert.equal(res.audit.mediaCount, 1);
});

test('flag on: JPEGs never replace or accompany the video', async () => {
  const fetchImpl = makeFetch(() => sseResponse(sse(['ok'])));
  await runStation(fetchImpl, { mediaAttachments: [jpeg(), video(), jpeg()] });
  assert.equal(fetchImpl.calls.length, 1);
  const inline = collect(JSON.parse(fetchImpl.calls[0].init.body), 'inline_data');
  assert.deepEqual(inline.map((p) => p.mime_type), ['video/mp4']);
});

const tooShort = Buffer.from([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]).toString('base64');
const noFtyp = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('abcdisom'), Buffer.alloc(12)]).toString('base64');
const oversizeBytes = Buffer.alloc(19 * 1024 * 1024 + 3);
Buffer.from('ftypisom').copy(oversizeBytes, 4);
const oversize = oversizeBytes.toString('base64');

const rejectCases = {
  'missing video (only JPEG)': { mediaAttachments: [jpeg()] },
  'no attachments': { mediaAttachments: [] },
  'wrong video mime': { mediaAttachments: [video(MOCK_MP4_B64, { mimeType: 'video/quicktime' })] },
  'multiple videos': { mediaAttachments: [video(), video()] },
  'too short': { mediaAttachments: [video(tooShort)] },
  'no ftyp at offset 4': { mediaAttachments: [video(noFtyp)] },
  'oversize (>19MiB)': { mediaAttachments: [video(oversize)] },
  'whitespace in base64': { mediaAttachments: [video(`${MOCK_MP4_B64.slice(0, 8)} ${MOCK_MP4_B64.slice(8)}`)] },
  'non-base64 characters': { mediaAttachments: [video('!!!!' + MOCK_MP4_B64.slice(4))] },
  'data URI': { mediaAttachments: [video(`data:video/mp4;base64,${MOCK_MP4_B64}`)] },
  'URL in base64 field': { mediaAttachments: [video('https://example.com/a.mp4')] },
  'url field present': { mediaAttachments: [video(MOCK_MP4_B64, { url: 'https://example.com/a.mp4' })] },
  'dataUri field present': { mediaAttachments: [video(MOCK_MP4_B64, { dataUri: 'data:video/mp4;base64,AAAA' })] },
  'detailed mode': { transcribeMode: 'detailed' },
  'mode missing': { transcribeMode: undefined },
};

for (const [name, overrides] of Object.entries(rejectCases)) {
  test(`flag on rejects before fetch: ${name}`, async () => {
    const fetchImpl = makeFetch(() => sseResponse(sse(['x'])));
    const res = await runStation(fetchImpl, { mediaAttachments: [jpeg(), video()], ...overrides });
    assert.equal(fetchImpl.calls.length, 0);
    assert.equal(res.ok, false);
    assert.equal(res.text, null);
    assert.equal(res.rawText, undefined);
    assert.ok(typeof res.error === 'string' && hasChinese(res.error));
    assert.ok(!JSON.stringify(res).includes(KEY));
  });
}

test('detailed mode error states the capability limit', async () => {
  const fetchImpl = makeFetch(() => sseResponse(sse(['x'])));
  const res = await runStation(fetchImpl, { transcribeMode: 'detailed' });
  assert.equal(fetchImpl.calls.length, 0);
  assert.ok(res.error.includes('详细'));
});

test('flag absent keeps legacy behavior: video alone is ignored and nothing is fetched', async () => {
  for (const flag of [undefined, '0', 'true']) {
    const fetchImpl = makeFetch(() => sseResponse(sse(['x'])));
    const res = await runStation(fetchImpl, {}, flag);
    assert.equal(fetchImpl.calls.length, 0);
    assert.equal(res.ok, false);
  }
});

test('flag absent keeps legacy JPEG path with notice and no rawText mutation', async () => {
  const fetchImpl = makeFetch(() => sseResponse(sse(['画面文字'])));
  const res = await runStation(fetchImpl, { transcribeMode: undefined, mediaAttachments: [jpeg()] }, undefined);
  assert.equal(fetchImpl.calls.length, 1);
  const inline = collect(JSON.parse(fetchImpl.calls[0].init.body), 'inline_data');
  assert.deepEqual(inline.map((p) => p.mime_type), ['image/jpeg']);
  assert.equal(res.ok, true);
  assert.ok(res.text.includes('媒体采样说明'));
  assert.equal(res.rawText, '画面文字');
});

test('HTTP error: single POST, no retry, no key leak', async () => {
  const fetchImpl = makeFetch(
    () => new Response(JSON.stringify({ error: { message: `bad request key=${KEY}` } }), { status: 500 })
  );
  const res = await runStation(fetchImpl);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(res.ok, false);
  assert.equal(res.text, null);
  assert.equal(res.rawText, undefined);
  assert.ok(!JSON.stringify(res).includes(KEY));
});

test('MAX_TOKENS: single POST, failure, no retry', async () => {
  const fetchImpl = makeFetch(() => sseResponse(sse(['部分内容'], { finish: 'MAX_TOKENS' })));
  const res = await runStation(fetchImpl);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(res.ok, false);
  assert.equal(res.text, null);
  assert.equal(res.rawText, undefined);
  assert.ok(!JSON.stringify(res).includes(KEY));
});

test('no STOP finish reason: single POST, failure, no retry', async () => {
  const fetchImpl = makeFetch(() => sseResponse(sse(['无结束标记'], { finish: null })));
  const res = await runStation(fetchImpl);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(res.ok, false);
  assert.equal(res.text, null);
  assert.equal(res.rawText, undefined);
});

async function callPost(images) {
  const fetchImpl = makeFetch(() => sseResponse(sse(['ok'])));
  let threw = false;
  let result;
  try {
    result = await gem.postNativeOnce({ apiKey: KEY, userText: 'hello', images }, fetchImpl);
  } catch {
    threw = true;
  }
  return { fetchImpl, threw, result };
}

test('builder (via postNativeOnce): valid MP4 emits video/mp4 inline_data', async () => {
  const { fetchImpl, threw } = await callPost([video()]);
  assert.equal(threw, false);
  assert.equal(fetchImpl.calls.length, 1);
  const inline = collect(JSON.parse(fetchImpl.calls[0].init.body), 'inline_data');
  assert.equal(inline.length, 1);
  assert.equal(inline[0].mime_type, 'video/mp4');
  assert.equal(inline[0].data, MOCK_MP4_B64);
});

test('builder (via postNativeOnce): JPEG still emits image/jpeg', async () => {
  const { fetchImpl, threw } = await callPost([jpeg()]);
  assert.equal(threw, false);
  assert.equal(fetchImpl.calls.length, 1);
  const inline = collect(JSON.parse(fetchImpl.calls[0].init.body), 'inline_data');
  assert.equal(inline[0].mime_type, 'image/jpeg');
});

const builderInvalid = {
  'unsupported mime': [video(MOCK_MP4_B64, { mimeType: 'video/webm' })],
  'no ftyp': [video(noFtyp)],
  'too short': [video(tooShort)],
  oversize: [video(oversize)],
  'whitespace in MP4 base64': [video(`${MOCK_MP4_B64.slice(0, 8)}\n${MOCK_MP4_B64.slice(8)}`)],
  'data URI': [video(`data:video/mp4;base64,${MOCK_MP4_B64}`)],
  URL: [video('https://example.com/a.mp4')],
  'url field': [video(MOCK_MP4_B64, { url: 'https://example.com/a.mp4' })],
};

for (const [name, images] of Object.entries(builderInvalid)) {
  test(`builder (via postNativeOnce) rejects before fetch: ${name}`, async () => {
    const { fetchImpl, threw, result } = await callPost(images);
    assert.equal(fetchImpl.calls.length, 0);
    assert.ok(threw || (result && result.ok === false));
  });
}

test('source wiring: project mode and raw callback before sanitize', () => {
  const serverSrc = fs.readFileSync(path.join(root, 'lib', 'server.ts'), 'utf8');
  const strictSrc = fs.readFileSync(path.join(root, 'lib', 'strict-native-station.ts'), 'utf8');

  assert.match(
    serverSrc,
    /project\?:\s*Pick<Project,\s*'kind'\s*\|\s*'promptSelections'\s*\|\s*'transcribeMode'>/
  );
  const start = serverSrc.indexOf('runStrictNativeStation({');
  assert.ok(start >= 0);
  assert.match(serverSrc.slice(start, start + 600), /transcribeMode:\s*params\.project\?\.transcribeMode/);

  const rawCall = 'params.onRawText(strictRes.rawText ?? strictRes.text,';
  const rawIdx = serverSrc.indexOf(rawCall, start);
  assert.ok(rawIdx > start, 'raw callback must use rawText ?? text');
  const lineEnd = serverSrc.indexOf('\n', rawIdx);
  assert.ok(!serverSrc.slice(rawIdx, lineEnd).includes('logEntry'));
  const sanIdx = serverSrc.indexOf('sanitizeForClient(strictRes.text)', start);
  assert.ok(sanIdx > rawIdx, 'sanitize must come after the raw callback');
  assert.ok(!serverSrc.includes('onRawText(sanitizeForClient'));

  assert.ok(strictSrc.includes('rawText: res.text,'));
  assert.ok(strictSrc.includes("STUDIO_STRICT_NATIVE_FULL_VIDEO === '1'"));
});
