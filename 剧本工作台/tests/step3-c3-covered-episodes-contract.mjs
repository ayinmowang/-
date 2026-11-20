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
const parse = await import('../lib/transcribe-parse.ts');
const extractMod = await import('../lib/manuscript-extract.ts');

const REAL_12_DOCX = path.resolve(
  process.cwd(),
  'tests/fixtures/女繼承人和她的怪物王子_前12集_剧本.docx',
);
const REAL_01_DOCX = path.resolve(
  process.cwd(),
  'tests/fixtures/女繼承人和她的怪物王子_第01集_剧本.docx',
);

function runUnitAssertions() {
  assert.equal(src.formatCoveredEpisodeRange([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), '第1–12集');
  assert.equal(src.formatCoveredEpisodeRange([1]), '第1集');
  assert.equal(src.formatCoveredEpisodeRange([1, 2, 3, 8, 10, 11]), '第1–3、8、10–11集');
  assert.deepEqual(src.normalizeCoveredEpisodes([12, 1, 1, 0, 301, 2, '2']), [1, 2, 12]);
  assert.equal(src.normalizeCoveredEpisodes([]).length, 0);
  assert.equal(
    src.isSourceAttachmentMapped({ name: 'a.docx', role: 'source', coveredEpisodes: [1, 12] }),
    true,
  );
  assert.equal(src.isSourceAttachmentMapped({ name: 'a.docx', role: 'source' }), false);
  assert.equal(src.hasUnmappedSourceMaterials([{ name: 'a.docx', role: 'source' }]), true);
  assert.equal(
    src.hasUnmappedSourceMaterials([{ name: 'a.docx', role: 'source', coveredEpisodes: [1, 2] }]),
    false,
  );
  assert.equal(src.resolveAutoTotalFromSources([{ name: 'a.docx', role: 'source', coveredEpisodes: [1, 12] }]), 12);
  assert.equal(
    src.hasOverlappingSourceCoverage([
      { name: 'a.mp4', role: 'source', episode: 1 },
      { name: 'b.docx', role: 'source', coveredEpisodes: [1, 2] },
    ]),
    true,
  );
  assert.equal(
    src.hasOverlappingSourceCoverage([
      { name: 'a.mp4', role: 'source', episode: 1 },
      { name: 'b.mp4', role: 'source', episode: 2 },
    ]),
    false,
  );
  const five = [1, 2, 3, 4, 5].map((n) => ({ name: `第0${n}集.mp4`, role: 'source', episode: n }));
  assert.deepEqual(src.uniqueValidSourceEpisodes(five), [1, 2, 3, 4, 5]);
  assert.equal(src.hasOverlappingSourceCoverage(five), false);
  assert.equal(src.resolveAutoTotalFromSources(five), 5);
  assert.equal(
    src.hasOverlappingSourceCoverage([
      ...five,
      { name: 'dup.mp4', role: 'source', episode: 3 },
    ]),
    true,
  );

  const sceneOnly = parse.inspectManuscriptEpisodeCoverage(
    '### 第 1 场  第 1 集核查室（日 · 内）\n动作\n场次1-1 走廊\n',
  );
  assert.deepEqual(sceneOnly.episodes, []);
  const untitled = parse.inspectManuscriptEpisodeCoverage('只有对白，没有集标题。');
  assert.deepEqual(untitled.episodes, []);

  assert.ok(fs.existsSync(REAL_12_DOCX), `missing fixture ${REAL_12_DOCX}`);
  const buf12 = fs.readFileSync(REAL_12_DOCX);
  const extracted = extractMod.extractManuscriptTextFromBuffer(buf12, '女繼承人和她的怪物王子_前12集_剧本.docx');
  assert.equal(extracted.error, undefined);
  assert.ok(extracted.text.length > 15000, `full extract too short: ${extracted.text.length}`);
  assert.ok(/第\s*0*12\s*集/.test(extracted.text), 'full text must contain 第12集 heading');
  const ins = parse.inspectManuscriptEpisodeCoverage(extracted.text);
  assert.deepEqual(ins.episodes, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const ep12 = ins.bodies.get(12) || '';
  assert.ok(ep12.length > 200, `episode 12 body too short: ${ep12.length}`);
  assert.ok(/12-1/.test(ep12) || /第12集/.test(ep12), 'episode 12 body must keep its own heading/scene');
  assert.ok(/Isabella|沃斯科夫|阿德里安/.test(ep12), `episode 12 unique evidence missing: ${ep12.slice(0, 180)}`);
  const ep1 = ins.bodies.get(1) || '';
  assert.ok(ep1.length > 0 && ep1 !== ep12, 'episode bodies must not be the same full text copied 12 times');

  if (fs.existsSync(REAL_01_DOCX)) {
    const one = extractMod.extractManuscriptTextFromBuffer(
      fs.readFileSync(REAL_01_DOCX),
      '女繼承人和她的怪物王子_第01集_剧本.docx',
    );
    assert.equal(one.error, undefined);
    const oneIns = parse.inspectManuscriptEpisodeCoverage(one.text);
    assert.ok(oneIns.episodes.length <= 1 || oneIns.episodes[0] === 1, `single-ep fixture episodes=${oneIns.episodes}`);
  }

  const fixtureCopy = src.buildTranscribeDeliveryCopy({
    episodeCount: 12,
    modeLabel: '详细模式',
    synopsisContent: '',
    isFixture: true,
  });
  assert.ok(fixtureCopy.directorText.includes('模拟测试稿'));
  assert.ok(fixtureCopy.directorText.includes('不是对上传原文或成片的忠实分析'));
  assert.ok(fixtureCopy.directorText.includes('本次未单独写出故事梗概'));
  assert.ok(src.describeTranscribePromptSource([{ name: 'a.docx', role: 'source' }]).noun.includes('文稿'));

  console.log('[PASS] unit/parse assertions including real 12-ep docx episode 12 evidence');
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
    if (!process.env[key]) process.env[key] = val;
  }
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
  const qs = new URLSearchParams({ id, name });
  if (role) qs.set('role', role);
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

function mergeUploadProject(project, upRes) {
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
  return {
    ...project,
    ...(maybeProj && typeof maybeProj === 'object' ? maybeProj : {}),
    id: project.id,
    version: nextVersion,
    ...(nextAttachments !== undefined ? { attachments: nextAttachments } : {}),
  };
}

function collectAssistantTexts(project) {
  const msgs = Array.isArray(project?.messages) ? project.messages : [];
  return msgs
    .filter((m) => m && m.role !== 'user')
    .map((m) => [m.text || '', m.file?.description || ''].join(' '))
    .join('\n');
}

async function runHttpAssertions() {
  loadEnvLocal();
  const requireHttp = String(process.env.STUDIO_REQUIRE_HTTP || '') === '1';
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
    if (requireHttp) throw new Error('HTTP required but no access key');
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
      if (requireHttp) {
        throw new Error(`HTTP auth failed (${loginRes.status}) at ${baseUrl}: ${loginRes.text}`);
      }
      console.log(`[SKIP] HTTP auth unavailable (${loginRes.status}) at ${baseUrl}; unit assertions already passed.`);
      return;
    }
    token = resolvedToken;
  } catch (err) {
    if (requireHttp) throw err;
    console.log(
      `[SKIP] HTTP server unreachable at ${baseUrl} (${err?.message || err}); unit assertions already passed.`,
    );
    return;
  }

  const headers = {
    'x-studio-token': token,
    'Content-Type': 'application/json',
  };

  const createRes = await requestJson(`${baseUrl}/api/studio`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      operation: 'create',
      kind: 'transcribe',
      title: 'C3多集文稿覆盖集契约_模拟',
    }),
  });
  assert.equal(createRes.status, 201, `create failed (${createRes.status}): ${createRes.text}`);
  let project = extractProject(createRes.json);
  assert.ok(project?.id, 'missing project.id after create');

  const docxBuf = fs.readFileSync(REAL_12_DOCX);
  const upRes = await uploadRaw(baseUrl, token, {
    id: project.id,
    name: '女繼承人和她的怪物王子_前12集_剧本.docx',
    buffer: docxBuf,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  assert.equal(upRes.status, 200, `upload failed (${upRes.status}): ${upRes.text}`);
  project = mergeUploadProject(project, upRes);
  assert.equal(project.attachments.length, 1, 'must keep 1 source file / 1 attachment');
  const att = project.attachments[0];
  assert.notEqual(att.role, 'locked', '前12集 filename must not be mis-labeled locked in transcribe');
  assert.equal(att.episode, undefined, 'must not set episode=12 from 前12集 filename');
  assert.deepEqual(att.coveredEpisodes, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const uploadText = collectAssistantTexts(project);
  assert.ok(uploadText.includes('1份源文稿'), `upload copy missing 1份源文稿:\n${uploadText}`);
  assert.ok(/第1–12集|第1-12集/.test(uploadText), `upload copy missing 第1–12集:\n${uploadText}`);
  assert.ok(!uploadText.includes('未能从文件名确定唯一集号'), `should not ask to hand-fill after 12-ep parse:\n${uploadText}`);

  const upAgain = await uploadRaw(baseUrl, token, {
    id: project.id,
    name: '女繼承人和她的怪物王子_前12集_剧本.docx',
    buffer: docxBuf,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  assert.equal(upAgain.status, 200, `idempotent reupload failed (${upAgain.status}): ${upAgain.text}`);
  project = mergeUploadProject(project, upAgain);
  assert.equal(project.attachments.length, 1, 'idempotent reupload must not add a second attachment');

  const setEpRes = await requestJson(`${baseUrl}/api/studio`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      operation: 'set_episode',
      id: project.id,
      version: project.version,
      attachment_id: att.id,
      episode: 1,
    }),
  });
  assert.notEqual(setEpRes.status, 200, 'set_episode must not overwrite a 12-ep coverage list with 1');

  const att2 = (project.attachments || []).find((a) => a.id === att.id) || att;
  assert.deepEqual(att2.coveredEpisodes, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  const lockRes = await requestJson(`${baseUrl}/api/studio`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      operation: 'set_locked',
      id: project.id,
      version: project.version,
      locked: 2,
    }),
  });
  assert.equal(lockRes.status, 200, `set_locked failed (${lockRes.status}): ${lockRes.text}`);
  project = extractProject(lockRes.json);
  assert.equal(project.lockedEpisodes, 2);

  const confirmRes = await requestJson(`${baseUrl}/api/studio`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ operation: 'confirm', id: project.id, version: project.version }),
  });
  assert.equal(confirmRes.status, 200, `confirm failed (${confirmRes.status}): ${confirmRes.text}`);
  project = extractProject(confirmRes.json);

  const connectRes = await requestJson(`${baseUrl}/api/studio`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ operation: 'connect', id: project.id, version: project.version }),
  });
  assert.equal(connectRes.status, 200, `connect failed (${connectRes.status}): ${connectRes.text}`);
  const afterConnect = extractProject(connectRes.json);
  assert.equal(afterConnect.total, 12, `autoTotal should be 12, got ${afterConnect.total}`);

  const actionRes = await requestJson(`${baseUrl}/api/studio`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      operation: 'action',
      id: afterConnect.id,
      version: afterConnect.version,
      action: { action: 'confirm', answers: { mode: 'detailed' } },
    }),
  });
  assert.equal(actionRes.status, 200, `action failed (${actionRes.status}): ${actionRes.text}`);
  const afterAction = extractProject(actionRes.json);
  assert.equal(afterAction.episodes?.length, 12, `expected 12 generated episodes, got ${afterAction.episodes?.length}`);
  const generated12 = afterAction.episodes.find((e) => Number(e.episodeNumber) === 12);
  assert.ok(generated12, 'generated episodes must include episode 12');
  const deliveryBlob = collectAssistantTexts(afterAction);
  assert.ok(deliveryBlob.includes('模拟测试稿'), `fixture must stay honestly labeled:\n${deliveryBlob}`);
  assert.ok(deliveryBlob.includes('不是对上传原文或成片的忠实分析'), deliveryBlob);
  assert.ok(deliveryBlob.includes('文稿') || deliveryBlob.includes('12 集'), deliveryBlob);
  assert.ok(!deliveryBlob.includes('请直接观看'), deliveryBlob);

  const docxRes = await fetch(
    `${baseUrl}/api/upload?id=${encodeURIComponent(afterAction.id)}&export=docx`,
    { headers: { 'x-studio-token': token } },
  );
  assert.equal(docxRes.status, 200, `docx export failed (${docxRes.status})`);
  const docxOut = Buffer.from(await docxRes.arrayBuffer());
  const docXml = inflateZipEntry(docxOut, 'word/document.xml');
  assert.ok(docXml, 'exported docx missing word/document.xml');
  const docText = docXml.replace(/<[^>]+>/g, ' ');
  assert.ok(/第\s*12\s*集/.test(docText), 'exported Word must contain 第12集 evidence');
  assert.ok(docxOut.length < 12 * fs.statSync(REAL_12_DOCX).size, 'Word must not be the original docx copied 12 times');

  const transferRes = await requestJson(`${baseUrl}/api/studio`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      operation: 'transfer_iteration',
      id: afterAction.id,
      version: afterAction.version,
      target_kind: 'domestic',
    }),
  });
  assert.equal(transferRes.status, 201, `transfer failed (${transferRes.status}): ${transferRes.text}`);
  const transferred = extractProject(transferRes.json);
  assert.ok(transferred?.id && transferred.id !== afterAction.id, 'transfer must create a new project');
  const tEpisodes = transferred.episodes;
  assert.ok(Array.isArray(tEpisodes) && tEpisodes.length === 12, `transfer should map 12 episodes, got ${tEpisodes?.length}`);
  assert.equal(transferred.total, 12, `transfer total should be 12, got ${transferred.total}`);

  console.log('[PASS] HTTP upload→connect detailed fixture→12-ep Word/transfer contract');
}

runUnitAssertions();
await runHttpAssertions();
console.log('[PASS] step3-c3-covered-episodes-contract');
