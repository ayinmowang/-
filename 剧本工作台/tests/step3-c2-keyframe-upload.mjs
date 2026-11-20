import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire, register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const tsUrl = pathToFileURL(require.resolve('typescript')).href;

const hookFile = path.join(os.tmpdir(), `ts-loader-hook-${process.pid}-${Date.now()}.mjs`);
fs.writeFileSync(
  hookFile,
  `import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from ${JSON.stringify(tsUrl)};

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('.') || specifier.startsWith('/')) && !specifier.endsWith('.ts') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
    try {
      return await nextResolve(specifier + '.ts', context);
    } catch {}
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const source = fs.readFileSync(fileURLToPath(url), 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: fileURLToPath(url),
    });
    return {
      format: 'module',
      shortCircuit: true,
      source: transpiled.outputText,
    };
  }
  return nextLoad(url, context);
}
`,
  'utf8',
);

register(pathToFileURL(hookFile).href);

const { formatCreatorUploadError } = await import(
  pathToFileURL(path.join(repoRoot, 'lib/upload-error-text.ts')).href
);

console.log('[step3-c2-keyframe-upload] 进程内/HTTP 契约回归开始（非浏览器验收）');

// 1. 创作者错误文案映射断言（无依赖，任何环境必须跑通）
{
  const rejectedMsg = formatCreatorUploadError('FILE_TYPE_REJECTED');
  assert.ok(!rejectedMsg.includes('FILE_TYPE_REJECTED'), '不得向创作者暴露 FILE_TYPE_REJECTED 英文码');
  assert.ok(rejectedMsg.includes('不被接受') || rejectedMsg.includes('不支持'), '应明确说明文件类型不被接受');
  assert.ok(rejectedMsg.includes('mp4'), '可上传类型清单应包含 mp4');
  assert.ok(rejectedMsg.includes('jpg') || rejectedMsg.includes('jpeg'), '可上传类型清单应包含 jpg/jpeg');
  assert.ok(rejectedMsg.includes('png') && rejectedMsg.includes('webp'), '可上传类型清单应包含 png 与 webp');
  assert.ok(rejectedMsg.includes('docx') || rejectedMsg.includes('srt'), '可上传类型清单应包含字幕或文稿扩展');
  assert.ok(rejectedMsg.includes('重新选择') || rejectedMsg.includes('重试'), '应提示重新选择文件后重试');

  const trimmedRejected = formatCreatorUploadError('  FILE_TYPE_REJECTED \n');
  assert.equal(trimmedRejected, rejectedMsg, '首尾空白包裹的 FILE_TYPE_REJECTED 也应映射为中文提示');

  const cancelText = '已取消当前上传/抽帧任务';
  assert.equal(
    formatCreatorUploadError(cancelText),
    cancelText,
    '已有中文取消提示必须原样透传，不得改写为类型错误',
  );

  const otherErr = 'FILE_TOO_LARGE';
  assert.equal(
    formatCreatorUploadError(otherErr),
    otherErr,
    '未要求映射的其它错误码不应擅自改写为类型错误',
  );

  assert.equal(formatCreatorUploadError(''), '上传失败', '空错误文案应返回简短中文兜底');
  console.log('[step3-c2-keyframe-upload] PASS: 创作者错误文案映射断言通过');
}

// 2. 真实 File/Blob + canvas 风格帧 HTTP 上传契约
function resolveAccessKey() {
  if (process.env.STUDIO_ACCESS_KEY) return process.env.STUDIO_ACCESS_KEY.trim();
  if (process.env.E2E_ACCESS_KEY) return process.env.E2E_ACCESS_KEY.trim();
  try {
    const e2ePath = path.join(repoRoot, 'tests/e2e-verify.mjs');
    const content = fs.readFileSync(e2ePath, 'utf8');
    const m = content.match(/key\s*:\s*['"]([^'"]+)['"]/);
    if (m?.[1]) return m[1];
  } catch {}
  return '';
}

function extractErrorCode(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.error === 'string') return payload.error;
  if (payload.error && typeof payload.error === 'object' && typeof payload.error.code === 'string') {
    return payload.error.code;
  }
  if (typeof payload.code === 'string') return payload.code;
  return '';
}

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3199').replace(/\/$/, '');
const accessKey = resolveAccessKey();

if (!accessKey) {
  console.log('[step3-c2-keyframe-upload] SKIP HTTP: 未找到访问键（STUDIO_ACCESS_KEY / E2E_ACCESS_KEY / e2e-verify.mjs）');
  try { fs.unlinkSync(hookFile); } catch {}
  process.exit(0);
}

let token = '';
try {
  const authRes = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login_key', key: accessKey }),
  });
  if (!authRes.ok) {
    console.log(`[step3-c2-keyframe-upload] SKIP HTTP: /api/auth 返回 HTTP ${authRes.status}`);
    try { fs.unlinkSync(hookFile); } catch {}
    process.exit(0);
  }
  const authData = await authRes.json();
  token = authData.token || '';
  assert.ok(token, '登录响应顶层 token 不得为空');
} catch (err) {
  console.log(`[step3-c2-keyframe-upload] SKIP HTTP: 服务 ${BASE_URL} 不可达 (${err?.message || err})`);
  try { fs.unlinkSync(hookFile); } catch {}
  process.exit(0);
}

let projectId = '';
try {
  // 创建 transcribe 项目
  const createRes = await fetch(`${BASE_URL}/api/studio`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-studio-token': token,
    },
    body: JSON.stringify({
      operation: 'create',
      kind: 'transcribe',
      title: `C2-Keyframe-Contract-${Date.now()}`,
    }),
  });
  assert.equal(createRes.status, 201, `创建 transcribe 项目期望 201，实际 ${createRes.status}`);
  const created = await createRes.json();
  projectId = created.project?.id || created.id || '';
  assert.ok(projectId, '创建项目响应必须返回 project.id 或 id');

  // 最小合法 JPEG 字节（SOI + APP0 + SOF0 + DHT + SOS + EOI 最小可用头）
  const minimalJpegBytes = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x03, 0x02, 0x02, 0x03, 0x02, 0x02, 0x03, 0x03, 0x03, 0x03, 0x04,
    0x03, 0x03, 0x04, 0x05, 0x08, 0x05, 0x05, 0x04, 0x04, 0x05, 0x0a, 0x07,
    0x07, 0x06, 0x08, 0x0c, 0x0a, 0x0c, 0x0c, 0x0b, 0x0a, 0x0b, 0x0b, 0x0d,
    0x0e, 0x12, 0x10, 0x0d, 0x0e, 0x11, 0x0e, 0x0b, 0x0b, 0x10, 0x16, 0x10,
    0x11, 0x13, 0x14, 0x15, 0x15, 0x15, 0x0c, 0x0f, 0x17, 0x18, 0x16, 0x14,
    0x18, 0x12, 0x14, 0x15, 0x14, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00,
    0x3f, 0x00, 0x37, 0xff, 0xd9,
  ]);
  const frameName = 'ep01-kf-01-0ds.jpg';
  const frameBlob = new Blob([minimalJpegBytes], { type: 'image/jpeg' });

  // 2a. 真实 raw body 上传 canvas 关键帧
  const kfRes = await fetch(
    `${BASE_URL}/api/upload?id=${encodeURIComponent(projectId)}&name=${encodeURIComponent(frameName)}&role=setting`,
    {
      method: 'POST',
      headers: {
        'x-studio-token': token,
        'Content-Type': 'image/jpeg',
      },
      body: frameBlob,
    },
  );
  assert.ok(kfRes.ok, `canvas 关键帧 raw body 上传期望 2xx，实际 ${kfRes.status}`);
  const kfData = await kfRes.json();

  // 2b. 紧接着上传原视频 File/Blob（模拟先帧后视频顺序）
  const minimalMp4Bytes = new Uint8Array([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
  ]);
  const videoName = 'ep01.mp4';
  const videoFile = new File([minimalMp4Bytes], videoName, { type: 'video/mp4' });

  const vidRes = await fetch(
    `${BASE_URL}/api/upload?id=${encodeURIComponent(projectId)}&name=${encodeURIComponent(videoName)}`,
    {
      method: 'POST',
      headers: {
        'x-studio-token': token,
        'Content-Type': 'video/mp4',
      },
      body: videoFile,
    },
  );
  assert.ok(vidRes.ok, `原视频 File raw body 上传期望 2xx，实际 ${vidRes.status}`);
  const vidData = await vidRes.json();

  // 查询项目确认附件列表
  let attachments =
    vidData.project?.attachments ||
    vidData.attachments ||
    kfData.project?.attachments ||
    [];
  const detailRes = await fetch(`${BASE_URL}/api/studio?id=${encodeURIComponent(projectId)}`, {
    headers: { 'x-studio-token': token },
  });
  if (detailRes.ok) {
    const detailData = await detailRes.json();
    const fetchedAttachments = detailData.project?.attachments || detailData.attachments;
    if (Array.isArray(fetchedAttachments)) {
      attachments = fetchedAttachments;
    }
  }

  assert.ok(Array.isArray(attachments) && attachments.length >= 2, '项目附件列表应至少包含关键帧与原视频两项');
  const savedFrame = attachments.find((a) => (a.name || a.filename) === frameName);
  assert.ok(savedFrame, `附件列表中应包含关键帧 ${frameName}`);
  if (savedFrame.role !== undefined) {
    assert.equal(savedFrame.role, 'setting', '关键帧附件 role 应为 setting');
  }
  const savedVideo = attachments.find((a) => (a.name || a.filename) === videoName);
  assert.ok(savedVideo, `附件列表中应包含原视频 ${videoName}`);
  console.log('[step3-c2-keyframe-upload] PASS: canvas 关键帧与原视频 raw body 顺序归档通过');

  // 2c. 仍必须拒绝危险扩展 (.exe) 与未放开扩展 (.zip)
  for (const [badName, badMime] of [
    ['malware.exe', 'application/x-msdownload'],
    ['payload.zip', 'application/zip'],
  ]) {
    const badRes = await fetch(
      `${BASE_URL}/api/upload?id=${encodeURIComponent(projectId)}&name=${encodeURIComponent(badName)}`,
      {
        method: 'POST',
        headers: {
          'x-studio-token': token,
          'Content-Type': badMime,
        },
        body: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]),
      },
    );
    assert.ok(
      badRes.status === 400 || badRes.status === 415,
      `拒绝 ${badName} 期望 HTTP 400 或 415，实际 ${badRes.status}`,
    );
    const badData = await badRes.json();
    const code = extractErrorCode(badData);
    assert.equal(code, 'FILE_TYPE_REJECTED', `拒绝 ${badName} 响应错误码应仍为 FILE_TYPE_REJECTED`);
  }
  console.log('[step3-c2-keyframe-upload] PASS: 危险扩展与非白名单扩展拒绝契约通过');
} finally {
  if (projectId) {
    try {
      await fetch(`${BASE_URL}/api/studio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-studio-token': token,
        },
        body: JSON.stringify({ operation: 'delete', id: projectId }),
      });
    } catch {}
  }
  try {
    fs.unlinkSync(hookFile);
  } catch {}
}

console.log('[step3-c2-keyframe-upload] ALL PASSED（进程内/HTTP 契约回归完成，非浏览器验收）');
