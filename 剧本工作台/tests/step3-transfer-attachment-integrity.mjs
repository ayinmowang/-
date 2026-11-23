import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const loaderCode = `
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\\.[a-z0-9]+$/i.test(specifier) && context.parentURL?.startsWith('file:')) {
    const parentPath = fileURLToPath(context.parentURL);
    const tsUrl = new URL(specifier + '.ts', pathToFileURL(parentPath));
    if (fs.existsSync(fileURLToPath(tsUrl))) {
      return { url: tsUrl.href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript;base64,${Buffer.from(loaderCode).toString('base64')}`);

const root = new URL('../', import.meta.url);
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'step3-transfer-att-'));
process.chdir(tmp);
delete process.env.STUDIO_LLM_FIXTURE;

globalThis.fetch = () => {
  throw new Error('network forbidden in offline transfer attachment integrity test');
};

const imp = (p) => import(new URL(p, root).href);
const { getStore, saveProject, resolveSafeBucketPath } = await imp('lib/server.ts');
const upload = await imp('app/api/upload/route.ts');
const studio = await imp('app/api/studio/route.ts');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const store = await getStore();
const acct = (id, key) => ({
  id,
  username: id,
  accessKey: key,
  status: 'active',
  role: 'creator',
  budgetUsedUsd: 0,
  budgetCapUsd: 0,
  allowedFlows: ['transcribe', 'foreign', 'domestic', 'original'],
});
store.accounts = [acct('owner', 'test-owner-key'), acct('other', 'test-other-key')];
store.systemConfig ||= {};
Object.assign(store.systemConfig, {
  requireAuthOnFrontend: true,
  providers: [],
  backendUrl: '',
  backendToken: '',
  mode: 'direct_llm',
});
store.projects = {};

const hdr = (k) => (k ? { 'x-studio-token': k } : {});
const studioPost = (body, k = 'test-owner-key') =>
  studio.POST(
    new Request('http://localhost/api/studio', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...hdr(k) },
      body: JSON.stringify(body),
    }),
  );
const uploadPost = (query, body, contentType, k = 'test-owner-key') =>
  upload.POST(
    new Request(`http://localhost/api/upload?${query}`, {
      method: 'POST',
      headers: { 'content-type': contentType, ...hdr(k) },
      body,
    }),
  );
const uploadGet = (query, k) =>
  upload.GET(new Request(`http://localhost/api/upload?${query}`, { headers: hdr(k) }));

const makeDeliveredBody = (n) =>
  [
    `1-${n} 客厅 日 内`,
    '人物：林深、苏晴',
    '△ 林深推开窗，冷风吹动桌上的旧照片。',
    '林深：这卷录像带必须原样转入国外迭代工作台。',
    '△ 苏晴将校验摘要抄在笔记本上。',
    '苏晴：一字节都不能少，下载必须和源文件哈希完全一致。',
  ].join('\n');

// ---------------------------------------------------------------------------
// 1. Real binary video upload -> delivered -> transfer_iteration (foreign & domestic)
// ---------------------------------------------------------------------------
const createRes = await studioPost({
  operation: 'create',
  title: '视频附件转入完整性回归',
  kind: 'transcribe',
  brief: '全剧 1 集',
});
assert.equal(createRes.status, 201);
let srcProj = await createRes.json();

// Build a deterministic 256 KB binary MP4-like payload
const videoBytes = Buffer.alloc(256 * 1024);
videoBytes.write('\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom', 0, 'latin1');
for (let i = 32; i < videoBytes.length; i++) {
  videoBytes[i] = (i * 31 + 17) & 0xff;
}
const videoSha = sha256(videoBytes);

const upRes = await uploadPost(
  `id=${srcProj.id}&name=${encodeURIComponent('第01集.mp4')}`,
  videoBytes,
  'video/mp4',
);
assert.equal(upRes.status, 200);
srcProj = await upRes.json();
assert.equal(srcProj.attachments.length, 1);
const srcAtt = srcProj.attachments[0];
assert.equal(srcAtt.size, videoBytes.length);

// Mark source project delivered so transfer_iteration passes delivery gate
const now = new Date().toISOString();
const ep1 = { id: 'ep-1', episodeNumber: 1, title: '第1集', body: makeDeliveredBody(1), locked: false };
srcProj.confirmed = true;
srcProj.total = 1;
srcProj.episodes = [ep1];
srcProj.volumes = [{ id: 'vol-1', title: '第一卷', episodes: [ep1] }];
srcProj.remote = {
  id: 'r-src',
  version: 1,
  mode: 'test_channel',
  status: 'delivered',
  stage: { key: 'delivery', title: '已交付' },
  cursor: 2,
  progress: { completed_steps: 2, total_steps: 2 },
  card: null,
  outputs: { script: { title: '剧本', content: ep1.body, updatedAt: now, version: 1 } },
  messages: [],
};
srcProj = await saveProject(srcProj, 'owner');
const srcRowBefore = JSON.stringify(store.projects[srcProj.id]);
const srcDiskPath = resolveSafeBucketPath(`owner/${srcProj.id}/${srcAtt.id}`);

// Transfer to foreign
const trForeignRes = await studioPost({
  operation: 'transfer_iteration',
  id: srcProj.id,
  version: srcProj.version,
  target_kind: 'foreign',
});
assert.equal(trForeignRes.status, 201);
const foreignProj = await trForeignRes.json();
assert.equal(foreignProj.kind, 'foreign');
assert.equal(foreignProj.sourceProjectId, srcProj.id);
assert.equal(foreignProj.attachments.length, 1);
assert.equal(foreignProj.attachments[0].size, videoBytes.length);

// Source row & source binary must remain untouched
assert.equal(JSON.stringify(store.projects[srcProj.id]), srcRowBefore, 'source project mutated by transfer');
assert.equal(sha256(await fs.readFile(srcDiskPath)), videoSha, 'source binary mutated');

// Target bucket file must exist independently with exact bytes & hash
const foreignDiskPath = resolveSafeBucketPath(`owner/${foreignProj.id}/${srcAtt.id}`);
const foreignDiskBytes = await fs.readFile(foreignDiskPath);
assert.equal(foreignDiskBytes.length, videoBytes.length, 'target disk file byte count mismatch');
assert.equal(sha256(foreignDiskBytes), videoSha, 'target disk file SHA256 mismatch');

// Target HTTP download must return HTTP 200 with exact Content-Length, bytes, SHA256
const dlForeign = await uploadGet(`id=${foreignProj.id}&file=${srcAtt.id}`, 'test-owner-key');
assert.equal(dlForeign.status, 200);
assert.equal(dlForeign.headers.get('content-length'), String(videoBytes.length));
const dlForeignBuf = Buffer.from(await dlForeign.arrayBuffer());
assert.equal(dlForeignBuf.length, videoBytes.length);
assert.equal(sha256(dlForeignBuf), videoSha);

// Auth & isolation on target download
assert.equal((await uploadGet(`id=${foreignProj.id}&file=${srcAtt.id}`)).status, 401);
assert.equal((await uploadGet(`id=${foreignProj.id}&file=${srcAtt.id}`, 'test-other-key')).status, 404);

// Also transfer to domestic
const trDomesticRes = await studioPost({
  operation: 'transfer_iteration',
  id: srcProj.id,
  version: srcProj.version,
  target_kind: 'domestic',
});
assert.equal(trDomesticRes.status, 201);
const domesticProj = await trDomesticRes.json();
const dlDomestic = await uploadGet(`id=${domesticProj.id}&file=${srcAtt.id}`, 'test-owner-key');
assert.equal(dlDomestic.status, 200);
const dlDomesticBuf = Buffer.from(await dlDomestic.arrayBuffer());
assert.equal(dlDomesticBuf.length, videoBytes.length);
assert.equal(sha256(dlDomesticBuf), videoSha);

// ---------------------------------------------------------------------------
// 2. Historical pre-fix transferred project (no target bucket file, valid sourceProjectId)
// ---------------------------------------------------------------------------
const legacyTargetId = 'legacy-target-no-copy';
const legacyTarget = {
  ...structuredClone(foreignProj),
  id: legacyTargetId,
  sourceProjectId: srcProj.id,
  title: '历史已转入目标（无目标桶文件）',
};
store.projects[legacyTargetId] = {
  owner: 'owner',
  data: JSON.stringify(legacyTarget),
  version: 1,
  updated_at: now,
};
// Confirm target file does NOT exist on disk
await assert.rejects(fs.stat(resolveSafeBucketPath(`owner/${legacyTargetId}/${srcAtt.id}`)), { code: 'ENOENT' });

// Same-owner download must transparently fall back to verified source project binary
const dlLegacy = await uploadGet(`id=${legacyTargetId}&file=${srcAtt.id}`, 'test-owner-key');
assert.equal(dlLegacy.status, 200);
assert.equal(dlLegacy.headers.get('content-length'), String(videoBytes.length));
const dlLegacyBuf = Buffer.from(await dlLegacy.arrayBuffer());
assert.equal(dlLegacyBuf.length, videoBytes.length);
assert.equal(sha256(dlLegacyBuf), videoSha);

// Cross-owner & anonymous still blocked on legacy target
assert.equal((await uploadGet(`id=${legacyTargetId}&file=${srcAtt.id}`)).status, 401);
assert.equal((await uploadGet(`id=${legacyTargetId}&file=${srcAtt.id}`, 'test-other-key')).status, 404);

// Spoofed cross-owner sourceProjectId must NOT leak owner's binary to 'other'
const spoofCrossOwnerId = 'spoof-cross-owner';
store.projects[spoofCrossOwnerId] = {
  owner: 'other',
  data: JSON.stringify({
    ...structuredClone(legacyTarget),
    id: spoofCrossOwnerId,
    owner: 'other',
    sourceProjectId: srcProj.id,
  }),
  version: 1,
  updated_at: now,
};
const dlSpoofCross = await uploadGet(`id=${spoofCrossOwnerId}&file=${srcAtt.id}`, 'test-other-key');
assert.equal(dlSpoofCross.status, 404);
const dlSpoofCrossJson = await dlSpoofCross.json();
assert.equal(dlSpoofCrossJson.code, 'ATTACHMENT_DATA_MISSING');

// Spoofed attachment id not belonging to source project must return 404 (not 200 / 0 bytes)
const spoofAttTargetId = 'spoof-att-id';
store.projects[spoofAttTargetId] = {
  owner: 'owner',
  data: JSON.stringify({
    ...structuredClone(legacyTarget),
    id: spoofAttTargetId,
    attachments: [{ ...srcAtt, id: 'not-in-source' }],
  }),
  version: 1,
  updated_at: now,
};
const dlSpoofAtt = await uploadGet(`id=${spoofAttTargetId}&file=not-in-source`, 'test-owner-key');
assert.equal(dlSpoofAtt.status, 404);
assert.equal((await dlSpoofAtt.json()).code, 'ATTACHMENT_DATA_MISSING');

// ---------------------------------------------------------------------------
// 3. True independence of copied target after source binary is removed
//    AND missing binary returns honest 404 (NEVER HTTP 200 / 0 bytes)
// ---------------------------------------------------------------------------
await fs.unlink(srcDiskPath);

// Newly transferred foreign target STILL serves full 256 KB because it has its own copied file
const dlForeignAfterSrcDelete = await uploadGet(`id=${foreignProj.id}&file=${srcAtt.id}`, 'test-owner-key');
assert.equal(dlForeignAfterSrcDelete.status, 200);
const dlForeignAfterBuf = Buffer.from(await dlForeignAfterSrcDelete.arrayBuffer());
assert.equal(dlForeignAfterBuf.length, videoBytes.length);
assert.equal(sha256(dlForeignAfterBuf), videoSha);

// Missing source file must now return 404 ATTACHMENT_DATA_MISSING (NEVER HTTP 200 / 0 bytes!)
const dlMissingSrc = await uploadGet(`id=${srcProj.id}&file=${srcAtt.id}`, 'test-owner-key');
assert.equal(dlMissingSrc.status, 404);
assert.equal((await dlMissingSrc.json()).code, 'ATTACHMENT_DATA_MISSING');

// Legacy target whose source binary was also deleted must return 404 (NEVER HTTP 200 / 0 bytes!)
const dlMissingLegacy = await uploadGet(`id=${legacyTargetId}&file=${srcAtt.id}`, 'test-owner-key');
assert.equal(dlMissingLegacy.status, 404);
assert.equal((await dlMissingLegacy.json()).code, 'ATTACHMENT_DATA_MISSING');

// ---------------------------------------------------------------------------
// 4. Legitimate 0-byte uploaded file still downloads as HTTP 200 with 0 bytes
// ---------------------------------------------------------------------------
const emptyUpRes = await uploadPost(
  `id=${srcProj.id}&name=${encodeURIComponent('empty.txt')}`,
  new Uint8Array(0),
  'text/plain',
);
assert.equal(emptyUpRes.status, 200);
const projWithEmpty = await emptyUpRes.json();
const emptyAtt = projWithEmpty.attachments.find((a) => a.name === 'empty.txt');
assert.ok(emptyAtt);
assert.equal(emptyAtt.size, 0);
const dlEmpty = await uploadGet(`id=${srcProj.id}&file=${emptyAtt.id}`, 'test-owner-key');
assert.equal(dlEmpty.status, 200);
assert.equal(dlEmpty.headers.get('content-length'), '0');
assert.equal((await dlEmpty.arrayBuffer()).byteLength, 0);

// ---------------------------------------------------------------------------
// 5. Custom BUCKET binding path (transfer copies inside custom bucket, missing returns 404)
// ---------------------------------------------------------------------------
const memBucket = new Map();
const origBindings = globalThis.__STUDIO_BINDINGS__;
const baseBindings = (await imp('lib/server.ts')).bindings();
globalThis.__STUDIO_BINDINGS__ = {
  ...baseBindings,
  BUCKET: {
    async get(key) {
      const val = memBucket.get(key);
      if (!val) return null;
      return {
        async arrayBuffer() {
          return val.buffer.slice(val.byteOffset, val.byteOffset + val.byteLength);
        },
      };
    },
    async put(key, value) {
      const bytes = Buffer.isBuffer(value) || value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(new Uint8Array(value));
      memBucket.set(key, bytes);
    },
    async delete(key) {
      memBucket.delete(key);
    },
  },
};

try {
  const customVideo = Buffer.from('CUSTOM_BUCKET_MP4_PAYLOAD_' + 'Z'.repeat(8192));
  const customSha = sha256(customVideo);
  const cCreate = await studioPost({ operation: 'create', title: '自定义桶转入测试', kind: 'transcribe', brief: '1集' });
  assert.equal(cCreate.status, 201);
  let cProj = await cCreate.json();
  const cUp = await uploadPost(`id=${cProj.id}&name=${encodeURIComponent('第01集.mp4')}`, customVideo, 'video/mp4');
  assert.equal(cUp.status, 200);
  cProj = await cUp.json();
  const cAtt = cProj.attachments[0];
  assert.ok(memBucket.has(`owner/${cProj.id}/${cAtt.id}`));

  cProj.confirmed = true;
  cProj.total = 1;
  cProj.episodes = [ep1];
  cProj.volumes = [{ id: 'vol-1', title: '第一卷', episodes: [ep1] }];
  cProj.remote = {
    id: 'r-custom',
    version: 1,
    mode: 'test_channel',
    status: 'delivered',
    stage: { key: 'delivery', title: '已交付' },
    cursor: 2,
    progress: { completed_steps: 2, total_steps: 2 },
    card: null,
    outputs: { script: { title: '剧本', content: ep1.body, updatedAt: now, version: 1 } },
    messages: [],
  };
  cProj = await saveProject(cProj, 'owner');

  const cTr = await studioPost({
    operation: 'transfer_iteration',
    id: cProj.id,
    version: cProj.version,
    target_kind: 'foreign',
  });
  assert.equal(cTr.status, 201);
  const cTarget = await cTr.json();
  assert.ok(memBucket.has(`owner/${cTarget.id}/${cAtt.id}`), 'custom bucket copy missing');

  const cDl = await uploadGet(`id=${cTarget.id}&file=${cAtt.id}`, 'test-owner-key');
  assert.equal(cDl.status, 200);
  assert.equal(cDl.headers.get('content-length'), String(customVideo.length));
  const cDlBuf = Buffer.from(await cDl.arrayBuffer());
  assert.equal(sha256(cDlBuf), customSha);
} finally {
  if (origBindings === undefined) {
    delete globalThis.__STUDIO_BINDINGS__;
  } else {
    globalThis.__STUDIO_BINDINGS__ = origBindings;
  }
}

console.log('PASS: step3-transfer-attachment-integrity (copy, SHA256, legacy fallback, isolation, 404-not-0-bytes, custom bucket)');
