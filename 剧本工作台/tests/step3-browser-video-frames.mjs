/**
 * Step 3 Task C2 verification:
 * - In-process mock unit assertions on lib/browser-video-frames.ts
 *   (fallback limit copy, canvas frame extraction, empty/black frame filtering, timestamping, AbortSignal cancellation)
 * - IMPORTANT: Uses in-process mock video/canvas objects — NOT real browser E2E acceptance and NOT real video viewing.
 * - Does NOT call real external LLM relays or bundle real episode mp4 files.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register, createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const _req = createRequire(import.meta.url);
const _tsEntryUrl = pathToFileURL(_req.resolve('typescript')).href;
const _tmpHookDir = fs.mkdtempSync(path.join(os.tmpdir(), 'step3-ts-hook-'));
const _tmpHookFile = path.join(_tmpHookDir, 'ts-hook.mjs');
process.on('exit', () => {
  try {
    fs.rmSync(_tmpHookDir, { recursive: true, force: true });
  } catch {}
});

const loaderCode = `
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from ${JSON.stringify(_tsEntryUrl)};

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if ((specifier.startsWith('.') || specifier.startsWith('/')) && !specifier.endsWith('.ts')) {
      for (const ext of ['.ts', '.tsx']) {
        try {
          return await nextResolve(specifier + ext, context);
        } catch {}
      }
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const source = fs.readFileSync(fileURLToPath(url), 'utf8');
    const out = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: fileURLToPath(url),
    });
    return {
      format: 'module',
      shortCircuit: true,
      source: out.outputText,
    };
  }
  return nextLoad(url, context);
}
`;

fs.writeFileSync(_tmpHookFile, loaderCode, 'utf8');
register(pathToFileURL(_tmpHookFile).href);

const modUrl = pathToFileURL(path.join(repoRoot, 'lib', 'browser-video-frames.ts')).href;
const {
  MULTIMODAL_VIDEO_CAP_BYTES,
  extractVideoFramesWithCanvas,
  describeFallbackLimits,
} = await import(modUrl);

function createMockHarness({ durationSec = 8, emptyTimestamps = [], abortAfterSeekCount = null } = {}) {
  const revoked = [];
  let createdCount = 0;
  let seekCount = 0;
  let abortController = null;

  const urlApi = {
    createObjectURL() {
      createdCount += 1;
      return `blob:mock-stress-sample-${createdCount}`;
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  };

  class MockEventTarget {
    constructor() {
      this._listeners = new Map();
    }
    addEventListener(type, fn) {
      const list = this._listeners.get(type) || [];
      list.push(fn);
      this._listeners.set(type, list);
    }
    removeEventListener(type, fn) {
      const list = this._listeners.get(type) || [];
      this._listeners.set(
        type,
        list.filter((item) => item !== fn),
      );
    }
    dispatch(type) {
      const list = [...(this._listeners.get(type) || [])];
      for (const fn of list) fn({ type });
    }
  }

  const video = new MockEventTarget();
  video.src = '';
  video._currentTime = 0;
  video.duration = durationSec;
  video.videoWidth = 1280;
  video.videoHeight = 720;
  video.readyState = 0;
  video.load = () => {
    queueMicrotask(() => {
      video.readyState = 2;
      video.dispatch('loadedmetadata');
      video.dispatch('loadeddata');
    });
  };
  Object.defineProperty(video, 'currentTime', {
    get() {
      return video._currentTime;
    },
    set(val) {
      video._currentTime = val;
      seekCount += 1;
      if (abortAfterSeekCount !== null && seekCount >= abortAfterSeekCount && abortController) {
        abortController.abort();
        return;
      }
      queueMicrotask(() => {
        video.dispatch('seeked');
      });
    },
  });

  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        drawImage() {},
        getImageData(_x, _y, w, h) {
          const isEmpty = emptyTimestamps.some((t) => Math.abs(t - video._currentTime) < 0.05);
          const len = Math.max(4, w * h * 4);
          const data = new Uint8ClampedArray(len);
          if (!isEmpty) {
            for (let i = 0; i < len; i += 4) {
              data[i] = 180;
              data[i + 1] = 120;
              data[i + 2] = 90;
              data[i + 3] = 255;
            }
          }
          return { data };
        },
      };
    },
    toBlob(cb, type = 'image/jpeg') {
      const payload = new Uint8Array([0xff, 0xd8, Math.round(video._currentTime) & 0xff, 0xff, 0xd9]);
      cb(new Blob([payload], { type }));
    },
  };

  const mockDocument = {
    createElement(tag) {
      if (tag === 'video') return video;
      if (tag === 'canvas') return canvas;
      throw new Error(`Unexpected tag: ${tag}`);
    },
  };

  return {
    mockDocument,
    urlApi,
    revoked,
    bindAbortController(ctrl) {
      abortController = ctrl;
    },
  };
}

// 1. Cap constant check
assert.equal(MULTIMODAL_VIDEO_CAP_BYTES, 30 * 1024 * 1024, 'MULTIMODAL_VIDEO_CAP_BYTES should equal 30MB');

// 2. Fallback limits copy assertions
const noFfmpegNoSub = describeFallbackLimits({
  hasAudioTrack: false,
  hasSubtitleSource: false,
  ffmpegAvailable: false,
});
const joinedNoFfmpeg = noFfmpegNoSub.join(' ');
assert.match(joinedNoFfmpeg, /浏览器 video\+canvas 抽帧/, 'must declare browser video+canvas frame extraction when ffmpegAvailable=false');
assert.match(joinedNoFfmpeg, /未使用音轨、不能假装听到/, 'must declare audio track is unused');
assert.match(joinedNoFfmpeg, /无字幕来源，不编造对白/, 'must declare no subtitle source and no fabricated dialogue');

const unknownFfmpegWithSub = describeFallbackLimits({
  hasAudioTrack: undefined,
  hasSubtitleSource: true,
  ffmpegAvailable: undefined,
});
const joinedUnknown = unknownFfmpegWithSub.join(' ');
assert.doesNotMatch(joinedUnknown, /已用\s*ffmpeg/i, 'must never claim ffmpeg was used when ffmpegAvailable is unknown');
assert.match(joinedUnknown, /未使用音轨、不能假装听到/, 'unknown audio track must still warn against pretending to hear');
assert.doesNotMatch(joinedUnknown, /无字幕来源，不编造对白/, 'should omit missing-subtitle warning when subtitle source exists');

// 3. In-process mock video+canvas extraction with empty-frame filtering
const harness1 = createMockHarness({
  durationSec: 6,
  emptyTimestamps: [0, 4],
});
// 压力样本 / 非真实剧集：仅用于本地 mock 提取验证
const syntheticSampleBlob = new Blob([new Uint8Array(1024)], { type: 'video/mp4' });
const res1 = await extractVideoFramesWithCanvas(syntheticSampleBlob, {
  maxFrames: 4,
  intervalSec: 2,
  document: harness1.mockDocument,
  urlApi: harness1.urlApi,
});

assert.equal(res1.skippedEmpty, 2, 'should skip 2 black/transparent empty frames');
assert.equal(res1.frameCount, 2, 'should keep 2 valid frames');
assert.equal(res1.frames.length, 2);
assert.ok(
  Math.abs(res1.frames[0].timestampSec - 2) <= 0.05,
  `first valid frame timestamp should be near 2s, got ${res1.frames[0].timestampSec}`,
);
assert.ok(
  res1.frames[1].timestampSec >= 5.9 && res1.frames[1].timestampSec <= 6,
  `second valid frame timestamp should be near tail (5.9s..6s), got ${res1.frames[1].timestampSec}`,
);
assert.ok(res1.frames[0].blob instanceof Blob, 'each valid frame should produce an image Blob');
assert.equal(harness1.revoked.length, 1, 'object URL must be revoked after extraction');

// 4. AbortSignal cancellation
const harness2 = createMockHarness({
  durationSec: 10,
  abortAfterSeekCount: 2,
});
const abortCtrl = new AbortController();
harness2.bindAbortController(abortCtrl);

await assert.rejects(
  () =>
    extractVideoFramesWithCanvas(syntheticSampleBlob, {
      maxFrames: 5,
      intervalSec: 2,
      signal: abortCtrl.signal,
      document: harness2.mockDocument,
      urlApi: harness2.urlApi,
    }),
  (err) => err?.name === 'AbortError' || /已取消/.test(String(err?.message || '')),
  'aborting during seek must reject with AbortError / cancellation message',
);
assert.equal(harness2.revoked.length, 1, 'object URL must still be revoked when aborted');

console.log('[PASS] step3-browser-video-frames (in-process mock only; NOT browser acceptance or real video inspection)');
