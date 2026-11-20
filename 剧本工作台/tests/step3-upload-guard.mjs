/**
 * Step 3 Task C1 verification:
 * - Pure unit assertions on lib/upload-guard.ts (effective upload limit, disk reserve, concurrency slot queue, ffmpeg flag)
 * - HTTP contract check against running server (oversized Content-Length rejected with 413 / FILE_TOO_LARGE)
 * - Does NOT call real external LLM relays or require ffmpeg/real mp4 videos.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// Register lightweight TypeScript loader hook via a real file URL so Node 22 resolves `typescript` from repo node_modules
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

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

const guard = await import(new URL('../lib/upload-guard.ts', import.meta.url).href);

// 1. Unit tests: getEffectiveUploadLimit
{
  const prevMaxMb = process.env.STUDIO_MAX_UPLOAD_MB;
  try {
    delete process.env.STUDIO_MAX_UPLOAD_MB;

    const transcribeLimit = guard.getEffectiveUploadLimit('transcribe');
    const emptyKindLimit = guard.getEffectiveUploadLimit(undefined);
    const foreignLimit = guard.getEffectiveUploadLimit('foreign');
    const domesticLimit = guard.getEffectiveUploadLimit('domestic');
    const originalLimit = guard.getEffectiveUploadLimit('original');

    const MB200 = 200 * 1024 * 1024;
    assert.ok(
      transcribeLimit > MB200,
      `Expected transcribe default limit > 200MiB, got ${transcribeLimit}`,
    );
    assert.ok(
      emptyKindLimit > MB200,
      `Expected empty kind default limit > 200MiB, got ${emptyKindLimit}`,
    );
    assert.equal(foreignLimit, MB200, 'Expected foreign default limit === 200MiB');
    assert.equal(domesticLimit, MB200, 'Expected domestic default limit === 200MiB');
    assert.equal(originalLimit, MB200, 'Expected original default limit === 200MiB');

    process.env.STUDIO_MAX_UPLOAD_MB = '1';
    const overrideLimit = guard.getEffectiveUploadLimit('transcribe');
    assert.equal(overrideLimit, 1024 * 1024, 'Expected STUDIO_MAX_UPLOAD_MB=1 to cap at 1MiB');
  } finally {
    if (prevMaxMb === undefined) {
      delete process.env.STUDIO_MAX_UPLOAD_MB;
    } else {
      process.env.STUDIO_MAX_UPLOAD_MB = prevMaxMb;
    }
  }
}

// 2. Unit tests: isFfmpegDisabled
{
  const prevFfmpeg = process.env.STUDIO_FFMPEG_DISABLED;
  try {
    process.env.STUDIO_FFMPEG_DISABLED = 'true';
    assert.equal(guard.isFfmpegDisabled(), true);
    process.env.STUDIO_FFMPEG_DISABLED = '1';
    assert.equal(guard.isFfmpegDisabled(), true);
    process.env.STUDIO_FFMPEG_DISABLED = 'YES';
    assert.equal(guard.isFfmpegDisabled(), true);
  } finally {
    if (prevFfmpeg === undefined) {
      delete process.env.STUDIO_FFMPEG_DISABLED;
    } else {
      process.env.STUDIO_FFMPEG_DISABLED = prevFfmpeg;
    }
  }
}

// 3. Unit tests: acquireUploadSlot concurrency cap
{
  const prevConc = process.env.STUDIO_MAX_CONCURRENT_UPLOADS;
  try {
    delete process.env.STUDIO_MAX_CONCURRENT_UPLOADS; // default 2

    const events = [];
    const rel1 = await guard.acquireUploadSlot();
    events.push('acquired-1');
    const rel2 = await guard.acquireUploadSlot();
    events.push('acquired-2');

    let thirdAcquired = false;
    const thirdPromise = guard.acquireUploadSlot().then((rel3) => {
      thirdAcquired = true;
      events.push('acquired-3');
      return rel3;
    });

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(thirdAcquired, false, '3rd upload slot must wait while 2 slots are active');

    rel1();
    events.push('released-1');

    const rel3 = await thirdPromise;
    assert.equal(thirdAcquired, true, '3rd upload slot should acquire after 1st releases');

    rel2();
    rel3();
  } finally {
    if (prevConc === undefined) {
      delete process.env.STUDIO_MAX_CONCURRENT_UPLOADS;
    } else {
      process.env.STUDIO_MAX_CONCURRENT_UPLOADS = prevConc;
    }
  }
}

// 4. Unit tests: assertSafeBucketKey
{
  assert.equal(guard.assertSafeBucketKey('proj-1/video.mp4'), 'proj-1/video.mp4');
  assert.throws(() => guard.assertSafeBucketKey('../secret.txt'));
  assert.throws(() => guard.assertSafeBucketKey('/etc/passwd'));
}

console.log('[step3-upload-guard] Pure unit checks passed.');

// 5. Optional live HTTP contract check (only if server is reachable; no real LLM calls)
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3199').replace(/\/$/, '');

function resolveAccessKey() {
  if (process.env.STUDIO_ACCESS_KEY) return process.env.STUDIO_ACCESS_KEY;
  if (process.env.E2E_ACCESS_KEY) return process.env.E2E_ACCESS_KEY;
  try {
    const e2ePath = path.join(repoRoot, 'tests', 'e2e-verify.mjs');
    const src = fs.readFileSync(e2ePath, 'utf8');
    const m = src.match(/login_key['"\s,:]+key\s*:\s*['"]([^'"]+)['"]/);
    if (m) return m[1];
  } catch {
    // ignore
  }
  return '';
}

async function runHttpCheck() {
  let healthOk = false;
  try {
    const res = await fetch(`${BASE_URL}/api/auth`, { method: 'GET' });
    healthOk = res.status < 500;
  } catch {
    healthOk = false;
  }

  if (!healthOk) {
    console.log(`[step3-upload-guard] Server not reachable at ${BASE_URL}; skipping HTTP check.`);
    return;
  }

  const key = resolveAccessKey();
  if (!key) {
    console.log('[step3-upload-guard] No access key available in env/e2e-verify.mjs; skipping HTTP check.');
    return;
  }

  const authRes = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'login_key', key }),
  });
  assert.equal(authRes.status, 200, `Expected /api/auth login_key 200, got ${authRes.status}`);
  const authData = await authRes.json();
  const token = authData.token;
  assert.ok(token, 'Expected x-studio-token from /api/auth');

  const headers = {
    'content-type': 'application/json',
    'x-studio-token': token,
  };

  const createRes = await fetch(`${BASE_URL}/api/studio`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      operation: 'create',
      kind: 'transcribe',
      title: 'Step3 C1 Upload Guard Check',
    }),
  });
  assert.equal(createRes.status, 201, `Expected /api/studio create 201, got ${createRes.status}`);
  const created = await createRes.json();
  const projectId = created.id;
  assert.ok(projectId, 'Expected created project id');

  const detailRes = await fetch(`${BASE_URL}/api/studio?id=${encodeURIComponent(projectId)}`, {
    method: 'GET',
    headers: { 'x-studio-token': token },
  });
  assert.equal(detailRes.status, 200, `Expected /api/studio detail 200, got ${detailRes.status}`);
  const detail = await detailRes.json();
  assert.equal(typeof detail.ffmpegAvailable, 'boolean', 'Expected boolean ffmpegAvailable on project detail');

  const listRes = await fetch(`${BASE_URL}/api/studio`, {
    method: 'GET',
    headers: { 'x-studio-token': token },
  });
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.equal(typeof listData.ffmpegAvailable, 'boolean', 'Expected boolean ffmpegAvailable on studio list');

  // Send oversized Content-Length header without transmitting a huge payload (bypass undici length check via node:http)
  const hugeContentLength = String(20 * 1024 * 1024 * 1024); // 20 GiB
  const http = await import('node:http');
  const uploadUrl = new URL(`${BASE_URL}/api/upload?id=${encodeURIComponent(projectId)}&filename=oversized.mp4`);
  const uploadRes = await new Promise((resolve, reject) => {
    const req = http.request(
      uploadUrl,
      {
        method: 'POST',
        headers: {
          'x-studio-token': token,
          'content-type': 'video/mp4',
          'content-length': hugeContentLength,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body = {};
          try {
            body = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode ?? 0, body });
        });
        res.on('error', reject);
      },
    );
    req.on('error', (err) => {
      // Server may reject early with 413 and close socket before full body is sent
      if (err && err.code === 'ECONNRESET') return;
      reject(err);
    });
    req.write(Buffer.from([0x00]));
    req.end();
  });
  const uploadBody = uploadRes.body;
  assert.ok(
    uploadRes.status === 413 || uploadBody.error === 'FILE_TOO_LARGE',
    `Expected 413 or FILE_TOO_LARGE for oversized Content-Length, got ${uploadRes.status} ${JSON.stringify(uploadBody)}`,
  );

  console.log('[step3-upload-guard] HTTP checks passed.');
}

await runHttpCheck();
