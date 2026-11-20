import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3199').replace(/\/+$/, '');

function resolveAccessKey() {
  const fromEnv = (process.env.STUDIO_ACCESS_KEY || process.env.E2E_ACCESS_KEY || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const e2ePath = path.join(process.cwd(), 'tests', 'e2e-verify.mjs');
    const src = fs.readFileSync(e2ePath, 'utf8');
    const match = src.match(/action\s*:\s*['"]login_key['"][\s\S]{0,160}?key\s*:\s*['"]([^'"]+)['"]/);
    if (match && match[1]) return match[1].trim();
  } catch {
    // ignore
  }
  throw new Error('Missing STUDIO_ACCESS_KEY / E2E_ACCESS_KEY and unable to read login_key from tests/e2e-verify.mjs');
}

function extractZipEntryText(zipBuf, targetEntryName) {
  let offset = 0;
  while (offset + 30 <= zipBuf.length) {
    const sig = zipBuf.readUInt32LE(offset);
    if (sig !== 0x04034b50) {
      break;
    }
    const flags = zipBuf.readUInt16LE(offset + 6);
    const compression = zipBuf.readUInt16LE(offset + 8);
    let compressedSize = zipBuf.readUInt32LE(offset + 18);
    const fileNameLen = zipBuf.readUInt16LE(offset + 26);
    const extraLen = zipBuf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLen;
    if (nameEnd > zipBuf.length) break;

    const entryName = zipBuf.subarray(nameStart, nameEnd).toString('utf8');
    const dataStart = nameEnd + extraLen;

    // Bit 3 indicates data descriptor follows compressed payload when size is 0 in local header
    if ((flags & 0x08) !== 0 && compressedSize === 0) {
      let scan = dataStart;
      let found = false;
      while (scan + 16 <= zipBuf.length) {
        if (zipBuf.readUInt32LE(scan) === 0x08074b50) {
          compressedSize = zipBuf.readUInt32LE(scan + 8);
          found = true;
          break;
        }
        scan += 1;
      }
      if (!found) break;
    }

    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zipBuf.length) break;

    if (entryName === targetEntryName) {
      const payload = zipBuf.subarray(dataStart, dataEnd);
      if (compression === 0) {
        return payload.toString('utf8');
      }
      if (compression === 8) {
        return zlib.inflateRawSync(payload).toString('utf8');
      }
      throw new Error(`Unsupported ZIP compression method ${compression} for ${targetEntryName}`);
    }

    offset = dataEnd;
    if ((flags & 0x08) !== 0 && offset + 16 <= zipBuf.length && zipBuf.readUInt32LE(offset) === 0x08074b50) {
      offset += 16;
    }
  }
  return '';
}

function xmlToPlainText(xml) {
  return String(xml || '')
    .replace(/<w:p\b[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function collectActionProjectText(actionJson) {
  const root = actionJson?.project && typeof actionJson.project === 'object' ? actionJson.project : actionJson || {};
  const parts = [];

  const pushVal = (val) => {
    if (!val) return;
    if (typeof val === 'string') {
      parts.push(val);
    } else if (Array.isArray(val)) {
      for (const item of val) pushVal(item);
    } else if (typeof val === 'object') {
      for (const key of ['title', 'summary', 'synopsis', 'outline', 'content', 'text', 'body', 'script', 'output', 'markdown']) {
        if (typeof val[key] === 'string') parts.push(val[key]);
      }
    }
  };

  pushVal(root.episodes);
  pushVal(root.outputs);
  pushVal(root.messages);
  pushVal(root.content);
  pushVal(root.script);
  pushVal(root.output);
  pushVal(root.document);

  if (parts.length === 0) {
    parts.push(JSON.stringify(root));
  }
  return parts.join('\n');
}

async function reqJson(pathname, { method = 'POST', token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-studio-token'] = token;
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, text };
}

async function login(key) {
  const res = await reqJson('/api/auth', {
    method: 'POST',
    body: { action: 'login_key', key },
  });
  assert.equal(res.status, 200, `login failed (${res.status}): ${res.text}`);
  const token = res.json?.data?.token || res.json?.token;
  assert.ok(token, `login response missing token: ${res.text}`);
  return token;
}

async function createTranscribeProject(token, title) {
  const res = await reqJson('/api/studio', {
    method: 'POST',
    token,
    body: {
      operation: 'create',
      kind: 'transcribe',
      title,
    },
  });
  assert.equal(res.status, 201, `create failed (${res.status}): ${res.text}`);
  assert.ok(res.json?.id, `create response missing id: ${res.text}`);
  assert.equal(typeof res.json?.version, 'number', `create response missing version: ${res.text}`);
  return { id: res.json.id, version: res.json.version };
}

async function uploadSampleSrt(token, id, filename) {
  const srtContent = [
    '1',
    '00:00:01,000 --> 00:00:04,000',
    '夜雨倾盆，林默推开老旧工作室的铁门。',
    '',
    '2',
    '00:00:04,500 --> 00:00:08,000',
    '苏晴把录音笔推到桌边：只有十分钟。',
    '',
  ].join('\n');

  const form = new FormData();
  form.append('id', id);
  form.append('file', new Blob([srtContent], { type: 'application/x-subrip' }), filename);

  const res = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { 'x-studio-token': token },
    body: form,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  assert.equal(res.status, 200, `upload failed (${res.status}): ${text}`);
  assert.ok(Array.isArray(json?.attachments) && json.attachments.length >= 1, `upload missing attachments: ${text}`);
  assert.equal(typeof json?.version, 'number', `upload missing version: ${text}`);
  return { version: json.version, attachments: json.attachments };
}

async function runFixtureFlow(token, mode) {
  const created = await createTranscribeProject(token, `[STUDIO_LLM_FIXTURE] 联调验收-${mode}`);
  let version = created.version;
  const id = created.id;

  // 文件名必须包含可被 detectEpisodeFromName 解析的集号（如 ep01_），避免 connect 报 EPISODE_MAPPING_REQUIRED
  const uploaded = await uploadSampleSrt(token, id, `ep01_fixture-${mode}.srt`);
  version = uploaded.version;

  // confirm 阶段进入 remote / 待连接
  const confirmStage = await reqJson('/api/studio', {
    method: 'POST',
    token,
    body: {
      operation: 'confirm',
      id,
      version,
    },
  });
  assert.equal(confirmStage.status, 200, `confirm (${mode}) failed (${confirmStage.status}): ${confirmStage.text}`);
  assert.equal(typeof confirmStage.json?.version, 'number', `confirm missing version: ${confirmStage.text}`);
  version = confirmStage.json.version;

  // STUDIO_LLM_FIXTURE=1（非真实 API）模式下不配真实 API Key、不调用 save_provider，connect 不得返回 503
  const connected = await reqJson('/api/studio', {
    method: 'POST',
    token,
    body: {
      operation: 'connect',
      id,
      version,
    },
  });
  assert.notEqual(
    connected.status,
    503,
    `connect (${mode}) must not 503 under STUDIO_LLM_FIXTURE=1 (non-real API): ${connected.text}`
  );
  assert.equal(connected.status, 200, `connect (${mode}) failed (${connected.status}): ${connected.text}`);
  assert.equal(typeof connected.json?.version, 'number', `connect missing version: ${connected.text}`);
  version = connected.json.version;

  // action 载荷契约：action 为对象 { action: 'confirm', answers: { mode } }
  const acted = await reqJson('/api/studio', {
    method: 'POST',
    token,
    body: {
      operation: 'action',
      id,
      version,
      action: {
        action: 'confirm',
        answers: {
          mode,
        },
      },
    },
  });
  assert.equal(acted.status, 200, `action confirm (${mode}) failed (${acted.status}): ${acted.text}`);
  assert.equal(typeof acted.json?.version, 'number', `action missing version: ${acted.text}`);
  version = acted.json.version;

  const deliveredStatus = acted.json?.remote?.status || acted.json?.project?.remote?.status;
  assert.equal(
    deliveredStatus,
    'delivered',
    `expected remote.status === 'delivered' for mode=${mode}, got ${deliveredStatus}: ${acted.text}`
  );

  // 检查 action 响应中的项目字段（episodes / outputs / messages / 正文）
  const actionProjectText = collectActionProjectText(acted.json);
  assert.ok(actionProjectText.trim().length > 0, `action response (${mode}) missing project output text`);
  assert.ok(!/未完成占位/.test(actionProjectText), `action output (${mode}) must not be placeholder only`);
  assert.ok(
    /(夹具|FIXTURE)/i.test(actionProjectText),
    `action output (${mode}) must explicitly mark STUDIO_LLM_FIXTURE / 夹具`
  );
  assert.ok(
    /(梗概|人物|分场|▲)/.test(actionProjectText),
    `action output (${mode}) must include structured screenplay markers (梗概/人物/分场/▲)`
  );

  // 导出 docx（zip）并解压读取 word/document.xml 文本
  const expRes = await fetch(`${BASE_URL}/api/upload?id=${encodeURIComponent(id)}&export=docx`, {
    method: 'GET',
    headers: { 'x-studio-token': token },
  });
  assert.equal(expRes.status, 200, `export docx (${mode}) failed (${expRes.status})`);
  const buf = Buffer.from(await expRes.arrayBuffer());
  assert.ok(buf.length > 200, `exported docx too small (${buf.length} bytes)`);
  assert.equal(buf.readUInt32LE(0), 0x04034b50, `exported docx (${mode}) is not a valid zip archive`);

  const documentXml = extractZipEntryText(buf, 'word/document.xml');
  assert.ok(documentXml.length > 0, `exported docx (${mode}) missing word/document.xml`);
  const docxPlainText = xmlToPlainText(documentXml);

  assert.ok(!/未完成占位/.test(docxPlainText), `exported docx (${mode}) must not contain placeholder text`);
  assert.ok(
    /(夹具|FIXTURE)/i.test(docxPlainText),
    `exported docx (${mode}) must explicitly mark STUDIO_LLM_FIXTURE / 夹具`
  );
  assert.ok(
    /(梗概|人物|分场|▲)/.test(docxPlainText),
    `exported docx (${mode}) must include structured screenplay markers (梗概/人物/分场/▲)`
  );

  return { id, version, mode };
}

async function main() {
  console.log(`[step3-fixture-connect] Running under STUDIO_LLM_FIXTURE=1 (non-real API) against ${BASE_URL}`);
  const key = resolveAccessKey();
  const token = await login(key);

  const fastRes = await runFixtureFlow(token, 'fast');
  console.log(`[step3-fixture-connect] PASS mode=fast id=${fastRes.id} v=${fastRes.version} (STUDIO_LLM_FIXTURE=1, non-real API)`);

  const detailedRes = await runFixtureFlow(token, 'detailed');
  console.log(`[step3-fixture-connect] PASS mode=detailed id=${detailedRes.id} v=${detailedRes.version} (STUDIO_LLM_FIXTURE=1, non-real API)`);

  console.log('[step3-fixture-connect] ALL PASS (verified STUDIO_LLM_FIXTURE=1 fixture flow, NOT real relay API)');
}

main().catch((err) => {
  console.error('[step3-fixture-connect] FAIL:', err);
  process.exit(1);
});
