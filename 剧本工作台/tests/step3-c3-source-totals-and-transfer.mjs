#!/usr/bin/env node
/**
 * Step 3 Task C3 integration test (STUDIO_LLM_FIXTURE=1 mode, not real LLM API):
 * Verifies source-only episode totals (excluding keyframe setting images),
 * EPISODE_MAPPING_REQUIRED rejection when sources lack valid episode numbers,
 * per-episode fixture script generation and DOCX export, and foreign/domestic
 * transfer_iteration behavior.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3199';

function resolveAccessKey() {
  const envKey = process.env.STUDIO_ACCESS_KEY || process.env.E2E_ACCESS_KEY;
  if (envKey && envKey.trim()) return envKey.trim();

  const e2ePath = path.resolve(process.cwd(), 'tests/e2e-verify.mjs');
  if (fs.existsSync(e2ePath)) {
    const src = fs.readFileSync(e2ePath, 'utf8');
    const m = src.match(/action:\s*['"]login_key['"]\s*,\s*key:\s*['"]([^'"]+)['"]/);
    if (m && m[1]) return m[1];
  }
  return null;
}

function extractZipEntryText(zipBuffer, entryName) {
  let offset = 0;
  while (offset + 30 <= zipBuffer.length) {
    const sig = zipBuffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const compression = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const fileNameLen = zipBuffer.readUInt16LE(offset + 26);
    const extraLen = zipBuffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLen + extraLen;
    const name = zipBuffer.slice(nameStart, nameStart + fileNameLen).toString('utf8');
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zipBuffer.length) break;

    if (name === entryName) {
      const slice = zipBuffer.slice(dataStart, dataEnd);
      if (compression === 0) return slice.toString('utf8');
      if (compression === 8) return zlib.inflateRawSync(slice).toString('utf8');
      throw new Error(`Unsupported zip compression method: ${compression}`);
    }
    offset = dataEnd;
  }
  return null;
}

function xmlToPlainText(xml) {
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function makeTinyJpeg() {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
    0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
    0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00,
    0x3f, 0x00, 0x7f, 0x00, 0xff, 0xd9,
  ]);
}

function makeTinySrt(ep) {
  return Buffer.from(
    `1\n00:00:01,000 --> 00:00:03,000\n第${String(ep).padStart(2, '0')}集测试台词\n`,
    'utf8'
  );
}

async function requestJson(urlPath, { method = 'GET', token, headers = {}, body } = {}) {
  const reqHeaders = { ...headers };
  if (token) reqHeaders['x-studio-token'] = token;
  if (body !== undefined && !Buffer.isBuffer(body) && typeof body === 'object') {
    reqHeaders['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: reqHeaders,
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, text, json };
}

async function uploadRaw(token, { id, name, role, buffer, contentType }) {
  const qs = new URLSearchParams({ id, name, role }).toString();
  const res = await requestJson(`/api/upload?${qs}`, {
    method: 'POST',
    token,
    headers: { 'content-type': contentType },
    body: buffer,
  });
  assert.equal(res.status, 200, `Upload ${name} failed (${res.status}): ${res.text}`);
  assert.ok(res.json && typeof res.json.version === 'number', `Upload ${name} missing version`);
  return res.json;
}

function extractProject(payload) {
  return payload?.project || payload?.data?.project || payload;
}

async function main() {
  const accessKey = resolveAccessKey();
  if (!accessKey) {
    console.log('SKIP: No STUDIO_ACCESS_KEY / E2E_ACCESS_KEY found and unable to extract key from tests/e2e-verify.mjs.');
    process.exit(0);
  }

  let authRes;
  try {
    authRes = await requestJson('/api/auth', {
      method: 'POST',
      body: { action: 'login_key', key: accessKey },
    });
  } catch (err) {
    console.log(`SKIP: Server unreachable at ${BASE_URL} (${err?.message || err}).`);
    process.exit(0);
  }

  if (authRes.status !== 200) {
    console.log(`SKIP: Auth endpoint returned ${authRes.status} at ${BASE_URL}: ${authRes.text}`);
    process.exit(0);
  }

  const token =
    authRes.json?.token ||
    authRes.json?.data?.token ||
    authRes.headers.get('x-studio-token');
  assert.ok(token, 'Expected x-studio-token from /api/auth');

  // -------------------------------------------------------------------------
  // Scenario 1: 5 source files + 36 keyframe setting images -> total === 5
  // -------------------------------------------------------------------------
  const create1 = await requestJson('/api/studio', {
    method: 'POST',
    token,
    body: {
      operation: 'create',
      kind: 'transcribe',
      title: `C3五集源与关键帧测试_${Date.now()}`,
    },
  });
  assert.equal(create1.status, 201, `Create project 1 failed: ${create1.text}`);
  let proj1 = extractProject(create1.json);
  const id1 = proj1.id;
  let version1 = proj1.version;
  assert.ok(id1, 'Project 1 id missing');
  assert.equal(typeof version1, 'number', 'Project 1 version missing');

  for (let ep = 1; ep <= 5; ep++) {
    const epStr = String(ep).padStart(2, '0');
    const up = await uploadRaw(token, {
      id: id1,
      name: `第${epStr}集_正片源.srt`,
      role: 'source',
      buffer: makeTinySrt(ep),
      contentType: 'application/x-subrip',
    });
    version1 = up.version;
  }

  const tinyJpeg = makeTinyJpeg();
  const kfCounts = [8, 7, 7, 7, 7]; // total 36 keyframes across episodes 1..5
  for (let ep = 1; ep <= 5; ep++) {
    const epStr = String(ep).padStart(2, '0');
    const count = kfCounts[ep - 1];
    for (let k = 1; k <= count; k++) {
      const kfStr = String(k).padStart(2, '0');
      const up = await uploadRaw(token, {
        id: id1,
        name: `第${epStr}集-kf-${kfStr}-${k}ds.jpg`,
        role: 'setting',
        buffer: tinyJpeg,
        contentType: 'image/jpeg',
      });
      version1 = up.version;
    }
  }

  const confirm1 = await requestJson('/api/studio', {
    method: 'POST',
    token,
    body: { operation: 'confirm', id: id1, version: version1 },
  });
  assert.equal(confirm1.status, 200, `Confirm project 1 failed: ${confirm1.text}`);
  proj1 = extractProject(confirm1.json);
  version1 = proj1.version;

  const connect1 = await requestJson('/api/studio', {
    method: 'POST',
    token,
    body: { operation: 'connect', id: id1, version: version1 },
  });
  assert.equal(connect1.status, 200, `Connect project 1 failed: ${connect1.text}`);
  proj1 = extractProject(connect1.json);
  version1 = proj1.version;

  assert.equal(proj1.total, 5, `Expected proj1.total === 5 (not 41), got ${proj1.total}`);

  const connectTexts = [
    ...(proj1.messages || []).map((m) => m.text || ''),
    proj1.recap || '',
    proj1.brief || '',
  ].join('\n');
  assert.ok(!connectTexts.includes('41 份'), 'Director/recap must not claim 41 份');
  assert.ok(!connectTexts.includes('共 41 集'), 'Director/recap must not claim 共 41 集');
  assert.ok(
    connectTexts.includes('5') && (connectTexts.includes('集') || connectTexts.includes('份')),
    'Director/recap should reflect 5 sources / 5 episodes'
  );

  // -------------------------------------------------------------------------
  // Scenario 2: Source without valid episode number -> EPISODE_MAPPING_REQUIRED
  // -------------------------------------------------------------------------
  const create2 = await requestJson('/api/studio', {
    method: 'POST',
    token,
    body: {
      operation: 'create',
      kind: 'transcribe',
      title: `C3无集号拦截测试_${Date.now()}`,
    },
  });
  assert.equal(create2.status, 201, `Create project 2 failed: ${create2.text}`);
  let proj2 = extractProject(create2.json);
  const id2 = proj2.id;
  let version2 = proj2.version;

  const upUnmapped = await uploadRaw(token, {
    id: id2,
    name: '压力样本_非真实剧集_大于30MB.mp4',
    role: 'source',
    buffer: Buffer.from('FAKE_MP4_HEADER_NO_EPISODE'),
    contentType: 'video/mp4',
  });
  version2 = upUnmapped.version;

  const confirm2 = await requestJson('/api/studio', {
    method: 'POST',
    token,
    body: { operation: 'confirm', id: id2, version: version2 },
  });
  assert.equal(confirm2.status, 200, `Confirm project 2 failed: ${confirm2.text}`);
  proj2 = extractProject(confirm2.json);
  version2 = proj2.version;

  const connect2 = await requestJson('/api/studio', {
    method: 'POST',
    token,
    body: { operation: 'connect', id: id2, version: version2 },
  });
  assert.notEqual(connect2.status, 200, 'Connect without valid episode mapping must fail');
  assert.ok(
    connect2.text.includes('EPISODE_MAPPING_REQUIRED') ||
      connect2.json?.error === 'EPISODE_MAPPING_REQUIRED',
    `Expected EPISODE_MAPPING_REQUIRED, got (${connect2.status}): ${connect2.text}`
  );
  assert.notEqual(connect2.json?.total, 1, 'Failed connect must not set total=1');
  assert.notEqual(connect2.json?.total, 5, 'Failed connect must not set total=5');

  // -------------------------------------------------------------------------
  // Scenario 3: Fixture action fast -> delivered, distinct episode bodies, DOCX export
  // -------------------------------------------------------------------------
  const action1 = await requestJson('/api/studio', {
    method: 'POST',
    token,
    body: {
      operation: 'action',
      id: id1,
      version: version1,
      action: { action: 'confirm', answers: { mode: 'fast' } },
    },
  });
  assert.equal(action1.status, 200, `Fixture action failed: ${action1.text}`);
  proj1 = extractProject(action1.json);
  version1 = proj1.version;

  assert.equal(proj1.remote?.status, 'delivered', `Expected remote.status === 'delivered', got ${proj1.remote?.status}`);
  const episodes1 = proj1.episodes || [];
  assert.equal(episodes1.length, 5, `Expected 5 episodes, got ${episodes1.length}`);

  const fullScriptContent = proj1.remote?.outputs?.script?.content || '';
  const bodies1 = episodes1.map((ep) => ep.body || '');
  const uniqueBodies1 = new Set(bodies1);
  assert.ok(uniqueBodies1.size === 5, 'All 5 episode bodies must be distinct');
  const fullDocRepeat = (fullScriptContent.match(/快速拉片与结构脚本/g) || []).length;
  assert.ok(fullDocRepeat <= 1, `outputs.script must not concatenate the full fixture 5 times, got ${fullDocRepeat}`);

  for (let i = 0; i < episodes1.length; i++) {
    const epNum = Number(episodes1[i].episodeNumber);
    const body = episodes1[i].body || '';
    assert.ok(body.length > 0, `Episode ${i + 1} body must not be empty`);
    if (fullScriptContent) {
      assert.notEqual(body, fullScriptContent, `Episode ${i + 1} body must not equal full script content`);
    }
    const selfHeaders = body.match(new RegExp(`^###\\s*第\\s*0*${epNum}\\s*集\\s*$`, 'mg')) || [];
    assert.equal(selfHeaders.length, 1, `Episode ${epNum} body must contain exactly one ### 第 ${epNum} 集 header, got ${selfHeaders.length}`);
    assert.ok(body.includes('模拟测试稿'), `Episode ${i + 1} body missing 模拟测试稿`);
    assert.ok(body.includes('不是实际视频还原'), `Episode ${i + 1} body missing 不是实际视频还原`);
    assert.ok(!body.includes('STUDIO_LLM_FIXTURE'), `Episode ${i + 1} body leaked STUDIO_LLM_FIXTURE`);
    assert.ok(!body.includes('观看了视频'), `Episode ${i + 1} body must not claim watching the video`);
  }

  const docxRes = await fetch(`${BASE_URL}/api/upload?id=${encodeURIComponent(id1)}&export=docx`, {
    method: 'GET',
    headers: { 'x-studio-token': token },
  });
  assert.equal(docxRes.status, 200, `DOCX export failed (${docxRes.status})`);
  const docxBuf = Buffer.from(await docxRes.arrayBuffer());
  const docXml = extractZipEntryText(docxBuf, 'word/document.xml');
  assert.ok(docXml, 'word/document.xml not found in exported DOCX');
  const docPlain = xmlToPlainText(docXml);

  assert.ok(!docPlain.includes('全剧集数：41'), 'DOCX must not state 全剧集数：41');
  assert.ok(!docPlain.includes('STUDIO_LLM_FIXTURE'), 'DOCX must not leak STUDIO_LLM_FIXTURE');
  assert.ok(!docPlain.includes('观看了视频'), 'DOCX must not claim watching the video');
  assert.ok(
    docPlain.includes('全剧集数：5') || docPlain.includes('共 5 集') || docPlain.includes('5 集'),
    'DOCX should reflect 5 episodes'
  );
  const distinctBodiesInDocx = [...uniqueBodies1].filter((b) => {
    const sample = b.split('\n').map((l) => l.trim()).find((l) => l.length >= 6);
    return sample ? docPlain.includes(sample) : false;
  });
  assert.ok(distinctBodiesInDocx.length >= 2, 'DOCX must contain distinct content from at least two episodes');

  // -------------------------------------------------------------------------
  // Scenario 4: transfer_iteration to foreign & domestic
  // -------------------------------------------------------------------------
  const transferForeign = await requestJson('/api/studio', {
    method: 'POST',
    token,
    body: {
      operation: 'transfer_iteration',
      id: id1,
      version: version1,
      target_kind: 'foreign',
    },
  });
  assert.equal(transferForeign.status, 201, `transfer_iteration foreign failed: ${transferForeign.text}`);
  const foreignProj = extractProject(transferForeign.json);
  assert.equal(foreignProj.kind, 'foreign', `Expected kind === 'foreign', got ${foreignProj.kind}`);
  assert.ok(
    (foreignProj.title || '').includes('（国外迭代）'),
    `Foreign title missing （国外迭代）: ${foreignProj.title}`
  );
  assert.ok(!(foreignProj.title || '').includes('国外迭代国外'), 'Foreign title has duplicate label');
  assert.ok(!(foreignProj.title || '').includes('国内迭代国外'), 'Foreign title has mixed label');
  assert.equal(foreignProj.total, 5, `Expected foreignProj.total === 5, got ${foreignProj.total}`);

  const transferDomestic = await requestJson('/api/studio', {
    method: 'POST',
    token,
    body: {
      operation: 'transfer_iteration',
      id: id1,
      version: version1,
      target_kind: 'domestic',
    },
  });
  assert.equal(transferDomestic.status, 201, `transfer_iteration domestic failed: ${transferDomestic.text}`);
  const domesticProj = extractProject(transferDomestic.json);
  assert.equal(domesticProj.kind, 'domestic', `Expected kind === 'domestic', got ${domesticProj.kind}`);
  assert.ok(
    (domesticProj.title || '').includes('（国内迭代）'),
    `Domestic title missing （国内迭代）: ${domesticProj.title}`
  );
  assert.ok(!(domesticProj.title || '').includes('国外迭代国外'), 'Domestic title has duplicate label');
  assert.ok(!(domesticProj.title || '').includes('国内迭代国外'), 'Domestic title has mixed label');
  assert.equal(domesticProj.total, 5, `Expected domesticProj.total === 5, got ${domesticProj.total}`);

  const foreignMsgText = (foreignProj.messages || []).map((m) => m.text || '').join('\n');
  const domesticMsgText = (domesticProj.messages || []).map((m) => m.text || '').join('\n');
  const domesticCombined = `${domesticMsgText}\n${domesticProj.brief || ''}`;

  for (const banned of ['出海', 'Prenup', '欧美', 'Caught in 4K', '桥段出海四级诊断']) {
    assert.ok(
      !domesticCombined.includes(banned),
      `Domestic messages/brief must not contain "${banned}"`
    );
  }

  assert.ok(
    foreignMsgText.includes('情绪曲线') ||
      foreignMsgText.includes('反派升级') ||
      foreignMsgText.includes('主线看得懂关'),
    'Foreign director message must mention 情绪曲线, 反派升级, or 主线看得懂关'
  );

  assert.notEqual(foreignMsgText, domesticMsgText, 'Foreign and domestic director advice must differ');
  assert.ok(
    domesticCombined.includes('国内') || domesticCombined.includes('本土'),
    'Domestic advice must mention 国内 or 本土'
  );

  const foreignBodies = new Set((foreignProj.episodes || []).map((e) => e.body || ''));
  const domesticBodies = new Set((domesticProj.episodes || []).map((e) => e.body || ''));
  assert.ok(foreignBodies.size > 1, 'Foreign target 5 episode bodies must not all be identical');
  assert.ok(domesticBodies.size > 1, 'Domestic target 5 episode bodies must not all be identical');

  // Scenario 5: mapped source episodes 1 and 10 -> total is max episode 10, not source count 2; numbers not rewritten
  const create5 = await requestJson('/api/studio', {
    method: 'POST',
    token,
    body: {
      operation: 'create',
      kind: 'transcribe',
      title: `C3非连续集号1与10_${Date.now()}`,
    },
  });
  assert.equal(create5.status, 201, `Create noncontiguous project failed: ${create5.text}`);
  let proj5 = extractProject(create5.json);
  const id5 = proj5.id;
  let version5 = proj5.version;
  for (const ep of [1, 10]) {
    const epStr = String(ep).padStart(2, '0');
    const up = await uploadRaw(token, {
      id: id5,
      name: `第${epStr}集_正片源.srt`,
      role: 'source',
      buffer: makeTinySrt(ep),
      contentType: 'application/x-subrip',
    });
    version5 = up.version;
  }
  const confirm5 = await requestJson('/api/studio', {
    method: 'POST',
    token,
    body: { operation: 'confirm', id: id5, version: version5 },
  });
  assert.equal(confirm5.status, 200, `Confirm noncontiguous project failed: ${confirm5.text}`);
  proj5 = extractProject(confirm5.json);
  version5 = proj5.version;
  const connect5 = await requestJson('/api/studio', {
    method: 'POST',
    token,
    body: { operation: 'connect', id: id5, version: version5 },
  });
  assert.equal(connect5.status, 200, `Connect episodes 1 and 10 must succeed, got ${connect5.status}: ${connect5.text}`);
  proj5 = extractProject(connect5.json);
  assert.equal(proj5.total, 10, `Expected total === 10 (max real episode), not 2, got ${proj5.total}`);
  const srcEps = (proj5.attachments || [])
    .filter((a) => a.role === 'source')
    .map((a) => a.episode)
    .sort((a, b) => a - b);
  assert.deepEqual(srcEps, [1, 10], `Source episode numbers must stay [1, 10], got ${JSON.stringify(srcEps)}`);
  const connectText5 = [
    ...(proj5.messages || []).map((m) => m.text || ''),
    proj5.brief || '',
  ].join('\n');
  assert.ok(!/EPISODE_MAPPING_REQUIRED/.test(connect5.text), 'Must not raise EPISODE_MAPPING_REQUIRED for mapped 1 and 10');
  if (/份/.test(connectText5) && /2/.test(connectText5) && /集/.test(connectText5)) {
    assert.notEqual(proj5.total, 2, 'Source count 2 must not be stored as total');
  }

  console.log('PASS: step3-c3-source-totals-and-transfer all 5 scenarios verified.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
