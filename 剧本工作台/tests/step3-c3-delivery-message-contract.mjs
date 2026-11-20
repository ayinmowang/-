import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { register } from 'node:module';

const hookCode = `
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !path.extname(specifier)) {
    const parentDir = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
    for (const ext of ['.ts', '.tsx', '.js', '.mjs']) {
      const candidate = path.resolve(parentDir, specifier + ext);
      if (fs.existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
`;

register('data:text/javascript,' + encodeURIComponent(hookCode));

const src = await import('../lib/source-materials.ts');
const parseMod = await import('../lib/transcribe-parse.ts');

function runUnitAssertions() {
  // 1) describeSourceMaterials
  assert.equal(
    src.describeSourceMaterials([{ name: '第01集_原稿.docx', role: 'source', episode: 1 }]),
    '1 份文稿源素材'
  );
  assert.ok(
    !src
      .describeSourceMaterials([{ name: '第01集_原稿.docx', role: 'source', episode: 1 }])
      .includes('视频/字幕源素材')
  );

  assert.equal(
    src.describeSourceMaterials([
      { name: '01.mp4', role: 'source', episode: 1 },
      { name: '02.mp4', role: 'source', episode: 2 },
      { name: '03.mp4', role: 'source', episode: 3 },
      { name: '04.mp4', role: 'source', episode: 4 },
      { name: '05.mp4', role: 'source', episode: 5 },
    ]),
    '5 份视频源素材'
  );

  const mixedDesc = src.describeSourceMaterials([
    { name: '01.mp4', role: 'source', episode: 1 },
    { name: '02.mp4', role: 'source', episode: 2 },
    { name: '03.docx', role: 'source', episode: 3 },
  ]);
  assert.ok(mixedDesc.includes('2 份视频与 1 份文稿'), `unexpected mixedDesc: ${mixedDesc}`);
  assert.ok(!mixedDesc.includes('3 份视频'), `docx must not be counted as video: ${mixedDesc}`);

  // 2) buildTranscribeDeliveryCopy without real synopsis (placeholder & empty)
  for (const syn of ['', '   ', parseMod.SYNOPSIS_PLACEHOLDER]) {
    const fixtureCopy = src.buildTranscribeDeliveryCopy({
      episodeCount: 1,
      modeLabel: '详细模式',
      synopsisContent: syn,
      isFixture: true,
    });
    assert.ok(!fixtureCopy.directorText.includes('梗概已经归档'));
    assert.ok(!fixtureCopy.directorText.includes('梗概和分集剧本已经归档'));
    assert.ok(fixtureCopy.directorText.includes('本次未单独写出故事梗概'));
    assert.ok(fixtureCopy.fileDescription.includes('本次未单独写出故事梗概'));
    assert.ok(!fixtureCopy.fileDescription.includes('剧情梗概'));
    assert.ok(fixtureCopy.directorText.includes('模拟测试稿'));
    assert.ok(fixtureCopy.directorText.includes('不是对上传原文或成片的忠实分析'));
    assert.ok(!fixtureCopy.directorText.includes('已观看'));

    const realCopy = src.buildTranscribeDeliveryCopy({
      episodeCount: 2,
      modeLabel: '快速模式',
      synopsisContent: syn,
      isFixture: false,
    });
    assert.ok(!realCopy.directorText.includes('梗概已经归档'));
    assert.ok(!realCopy.directorText.includes('梗概和分集剧本已经归档'));
    assert.ok(realCopy.directorText.includes('本次未单独写出故事梗概'));
  }

  // 3) buildTranscribeDeliveryCopy with real synopsis
  const withSynopsis = src.buildTranscribeDeliveryCopy({
    episodeCount: 3,
    modeLabel: '详细模式',
    synopsisContent: '林澈在暴雨夜重返老宅，发现十年前失踪案的真正幕后推手。',
    isFixture: false,
  });
  assert.ok(withSynopsis.directorText.includes('人物表、梗概和分集剧本已经归档到左侧目录'));
  assert.ok(withSynopsis.fileDescription.includes('剧情梗概'));

  // 4) describeTranscribePromptSource
  const docxPrompt = src.describeTranscribePromptSource([
    { name: '第01集_原稿.docx', role: 'source', episode: 1 },
  ]);
  assert.ok(!docxPrompt.lead.includes('请直接观看'));
  assert.ok(!docxPrompt.lead.includes('观看并拆解'));
  assert.ok(!docxPrompt.noun.includes('视频'));
  assert.ok(docxPrompt.noun.includes('文稿'));

  const srtPrompt = src.describeTranscribePromptSource([
    { name: '第01集_正片源.srt', role: 'source', episode: 1 },
  ]);
  assert.ok(!srtPrompt.lead.includes('请直接观看'));
  assert.ok(!srtPrompt.lead.includes('观看并拆解'));
  assert.ok(srtPrompt.noun.includes('字幕'));

  const videoPrompt = src.describeTranscribePromptSource([
    { name: '第01集_正片源.mp4', role: 'source', episode: 1 },
  ]);
  assert.ok(videoPrompt.lead.includes('观看'));

  const mixedPrompt = src.describeTranscribePromptSource([
    { name: '第01集_正片源.mp4', role: 'source', episode: 1 },
    { name: '第01集_原稿.docx', role: 'source', episode: 1 },
  ]);
  assert.ok(mixedPrompt.lead.includes('观看'));
  assert.ok(mixedPrompt.lead.includes('不要把文稿或字幕说成已观看视频'));

  console.log('[PASS] unit assertions for C3 delivery/source copy');
}

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

function makeMinimalZip(files) {
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[i] = c >>> 0;
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const rawBuf = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
    const compBuf = zlib.deflateRawSync(rawBuf);
    const crc = crc32(rawBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compBuf.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compBuf.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compBuf.length;
  }

  const centralSize = centralParts.reduce((sum, b) => sum + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function buildMinimalDocx(paragraphText) {
  const escaped = String(paragraphText)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${escaped}</w:t></w:r></w:p>
  </w:body>
</w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  return makeMinimalZip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rels },
    { name: 'word/document.xml', content: docXml },
  ]);
}

function extractXmlText(xml) {
  return String(xml || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function inflateZipEntry(zipBuf, targetName) {
  let pos = 0;
  while (pos + 30 <= zipBuf.length) {
    const sig = zipBuf.readUInt32LE(pos);
    if (sig !== 0x04034b50) break;
    const method = zipBuf.readUInt16LE(pos + 8);
    const compSize = zipBuf.readUInt32LE(pos + 18);
    const nameLen = zipBuf.readUInt16LE(pos + 26);
    const extraLen = zipBuf.readUInt16LE(pos + 28);
    const name = zipBuf.subarray(pos + 30, pos + 30 + nameLen).toString('utf8');
    const dataStart = pos + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (name === targetName) {
      const slice = zipBuf.subarray(dataStart, dataEnd);
      return method === 8 ? zlib.inflateRawSync(slice).toString('utf8') : slice.toString('utf8');
    }
    pos = dataEnd;
  }
  return '';
}

function extractProject(payload) {
  return payload?.project || payload?.data?.project || payload;
}

async function requestJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, text, json };
}

async function uploadRaw(baseUrl, token, { id, name, role, buffer, contentType }) {
  const qs = new URLSearchParams({ id, name, role });
  const res = await fetch(`${baseUrl}/api/upload?${qs.toString()}`, {
    method: 'POST',
    headers: {
      'x-studio-token': token,
      'Content-Type': contentType || 'application/octet-stream',
    },
    body: buffer,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

function collectAssistantTexts(project) {
  const msgs = Array.isArray(project?.messages) ? project.messages : [];
  return msgs
    .filter((m) => m && m.role !== 'user')
    .map((m) => [m.text || '', m.file?.description || ''].join(' '))
    .join('\n');
}

async function runHttpScenario({ baseUrl, token, title, files, mode }) {
  const createRes = await requestJson(`${baseUrl}/api/studio`, {
    method: 'POST',
    headers: {
      'x-studio-token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'create',
      kind: 'transcribe',
      title,
    }),
  });
  assert.equal(createRes.status, 201, `create failed (${createRes.status}): ${createRes.text}`);
  let project = extractProject(createRes.json);
  assert.ok(project?.id, 'missing project.id after create');

  for (const file of files) {
    const upRes = await uploadRaw(baseUrl, token, {
      id: project.id,
      name: file.name,
      role: 'source',
      buffer: file.buffer,
      contentType: file.contentType,
    });
    assert.equal(
      upRes.status,
      200,
      `upload ${file.name} failed (${upRes.status}): ${upRes.text}`
    );
    const maybeProj = extractProject(upRes.json);
    const nextVersion =
      typeof maybeProj?.version === 'number'
        ? maybeProj.version
        : typeof upRes.json?.version === 'number'
        ? upRes.json.version
        : project.version;
    const nextAttachments = Array.isArray(maybeProj?.attachments)
      ? maybeProj.attachments
      : Array.isArray(upRes.json?.attachments)
      ? upRes.json.attachments
      : project.attachments;
    project = {
      ...project,
      ...(maybeProj && typeof maybeProj === 'object' ? maybeProj : {}),
      id: project.id,
      version: nextVersion,
      ...(nextAttachments !== undefined ? { attachments: nextAttachments } : {}),
    };
  }

  const confirmRes = await requestJson(`${baseUrl}/api/studio`, {
    method: 'POST',
    headers: {
      'x-studio-token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'confirm',
      id: project.id,
      version: project.version,
    }),
  });
  assert.equal(confirmRes.status, 200, `confirm failed (${confirmRes.status}): ${confirmRes.text}`);
  project = extractProject(confirmRes.json);

  const connectRes = await requestJson(`${baseUrl}/api/studio`, {
    method: 'POST',
    headers: {
      'x-studio-token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'connect',
      id: project.id,
      version: project.version,
    }),
  });
  assert.equal(connectRes.status, 200, `connect failed (${connectRes.status}): ${connectRes.text}`);
  const afterConnect = extractProject(connectRes.json);

  const actionRes = await requestJson(`${baseUrl}/api/studio`, {
    method: 'POST',
    headers: {
      'x-studio-token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'action',
      id: afterConnect.id,
      version: afterConnect.version,
      action: {
        action: 'confirm',
        answers: { mode },
      },
    }),
  });
  assert.equal(actionRes.status, 200, `action failed (${actionRes.status}): ${actionRes.text}`);
  const afterAction = extractProject(actionRes.json);

  return { afterConnect, afterAction };
}

async function runHttpAssertions() {
  loadEnvLocal();
  const baseUrl = (
    process.env.BASE_URL ||
    process.env.STUDIO_BASE_URL ||
    'http://127.0.0.1:3199'
  ).replace(/\/$/, '');
  let accessKey =
    process.env.STUDIO_ACCESS_KEY ||
    process.env.E2E_ACCESS_KEY ||
    process.env.ACCESS_KEY ||
    process.env.ADMIN_ACCESS_KEY ||
    '';
  if (!accessKey) {
    try {
      const e2eSrc = fs.readFileSync(new URL('./e2e-verify.mjs', import.meta.url), 'utf8');
      const m = e2eSrc.match(/action:\s*['"]login_key['"]\s*,\s*key:\s*['"]([^'"]+)['"]/);
      if (m) accessKey = m[1];
    } catch {}
  }
  if (!accessKey) {
    console.log('[SKIP] No access key found; unit assertions already passed.');
    return;
  }

  let token = '';
  try {
    const loginRes = await requestJson(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'login_key', key: accessKey }),
    });
    const resolvedToken =
      loginRes.json?.token ||
      loginRes.json?.data?.token ||
      loginRes.headers?.get?.('x-studio-token') ||
      '';
    if (loginRes.status !== 200 || !resolvedToken) {
      console.log(
        `[SKIP] HTTP auth unavailable (${loginRes.status}) at ${baseUrl}; unit assertions already passed.`
      );
      return;
    }
    token = resolvedToken;
  } catch (err) {
    console.log(
      `[SKIP] HTTP server unreachable at ${baseUrl} (${err?.message || err}); unit assertions already passed.`
    );
    return;
  }

  // Scenario 1: single DOCX manuscript
  {
    const docxBuf = buildMinimalDocx('第一集 暴雨之夜\n主角推开老宅木门，灯影摇晃。');
    const { afterConnect, afterAction } = await runHttpScenario({
      baseUrl,
      token,
      title: 'C3-DOCX诚实文案验收',
      mode: 'detailed',
      files: [
        {
          name: '第01集_原稿.docx',
          buffer: docxBuf,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      ],
    });

    const connectBlob = [
      collectAssistantTexts(afterConnect),
      afterConnect?.remote?.outputs?.recap?.content || '',
    ].join('\n');
    assert.ok(connectBlob.includes('文稿源素材'), `connect should mention 文稿源素材:\n${connectBlob}`);
    assert.ok(
      !connectBlob.includes('视频/字幕源素材'),
      `connect must not say 视频/字幕源素材:\n${connectBlob}`
    );

    const deliveryBlob = collectAssistantTexts(afterAction);
    assert.ok(!deliveryBlob.includes('梗概已经归档'));
    assert.ok(!deliveryBlob.includes('梗概和分集剧本已经归档'));
    assert.ok(!deliveryBlob.includes('已观看'));
    assert.ok(deliveryBlob.includes('本次未单独写出故事梗概'));
    assert.ok(deliveryBlob.includes('模拟测试稿'));

    const exportRes = await fetch(
      `${baseUrl}/api/upload?id=${encodeURIComponent(afterAction.id)}&export=docx`,
      {
        headers: { 'x-studio-token': token },
      }
    );
    assert.equal(exportRes.status, 200, `export docx failed: ${exportRes.status}`);
    const exportedBuf = Buffer.from(await exportRes.arrayBuffer());
    const docXml = inflateZipEntry(exportedBuf, 'word/document.xml');
    const docText = extractXmlText(docXml);
    assert.ok(docText.includes(parseMod.SYNOPSIS_PLACEHOLDER), 'exported docx missing synopsis placeholder');
    assert.ok(docText.includes('详细动作拆解'), 'exported docx missing detailed breakdown section');
    assert.ok(docText.includes('模拟测试稿'), 'exported docx missing fixture disclaimer');
  }

  // Scenario 2: single SRT subtitle
  {
    const srtBuf = Buffer.from(
      '1\n00:00:01,000 --> 00:00:03,000\n今晚雨太大了，先回屋再说。\n',
      'utf8'
    );
    const { afterConnect, afterAction } = await runHttpScenario({
      baseUrl,
      token,
      title: 'C3-SRT诚实文案验收',
      mode: 'fast',
      files: [
        {
          name: '第01集_正片源.srt',
          buffer: srtBuf,
          contentType: 'application/x-subrip',
        },
      ],
    });

    const connectBlob = [
      collectAssistantTexts(afterConnect),
      afterConnect?.remote?.outputs?.recap?.content || '',
    ].join('\n');
    assert.ok(connectBlob.includes('字幕源素材'), `connect should mention 字幕源素材:\n${connectBlob}`);
    assert.ok(!connectBlob.includes('文稿源素材'));
    assert.ok(!connectBlob.includes('视频/字幕源素材'));

    const deliveryBlob = collectAssistantTexts(afterAction);
    assert.ok(!deliveryBlob.includes('梗概已经归档'));
    assert.ok(!deliveryBlob.includes('梗概和分集剧本已经归档'));
    assert.ok(!deliveryBlob.includes('已观看'));
    assert.ok(deliveryBlob.includes('本次未单独写出故事梗概'));
  }

  // Scenario 3: mixed MP4 + DOCX
  {
    const docxBuf = buildMinimalDocx('第一集 补充对白稿');
    const mp4Buf = Buffer.from('000000186674797069736f6d0000020069736f6d', 'hex');
    const { afterConnect, afterAction } = await runHttpScenario({
      baseUrl,
      token,
      title: 'C3-混合诚实文案验收',
      mode: 'fast',
      files: [
        {
          name: '第01集_正片源.mp4',
          buffer: mp4Buf,
          contentType: 'video/mp4',
        },
        {
          name: '第02集_原稿.docx',
          buffer: docxBuf,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      ],
    });

    const connectBlob = [
      collectAssistantTexts(afterConnect),
      afterConnect?.remote?.outputs?.recap?.content || '',
    ].join('\n');
    assert.ok(
      connectBlob.includes('1 份视频与 1 份文稿源素材'),
      `mixed connect should state both kinds:\n${connectBlob}`
    );
    assert.ok(!connectBlob.includes('视频/字幕源素材'));

    const deliveryBlob = collectAssistantTexts(afterAction);
    assert.ok(deliveryBlob.includes('模拟测试稿'));
    assert.ok(deliveryBlob.includes('不是对上传原文或成片的忠实分析'));
    assert.ok(!deliveryBlob.includes('已观看'));
  }

  console.log('[PASS] HTTP scenarios for C3 delivery/source copy');
}

runUnitAssertions();
await runHttpAssertions();
