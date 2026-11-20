import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3199';

function loadAccessKey() {
  const envKey = process.env.STUDIO_ACCESS_KEY || process.env.E2E_ACCESS_KEY;
  if (envKey) return envKey;

  const refPath = path.resolve(process.cwd(), 'tests/e2e-verify.mjs');
  if (fs.existsSync(refPath)) {
    const src = fs.readFileSync(refPath, 'utf8');
    const keyMatch =
      src.match(/action:\s*['"]login_key['"][\s\S]{0,160}?key:\s*['"]([^'"]+)['"]/) ||
      src.match(/(?:ACCESS_KEY|ADMIN_KEY|EXCLUSIVE_KEY|key)\s*[:=]\s*['"]([^'"]+)['"]/);
    if (keyMatch) return keyMatch[1];
  }
  return process.env.ADMIN_ACCESS_KEY || '';
}

async function login() {
  const key = loadAccessKey();
  assert.ok(key, '未配置 STUDIO_ACCESS_KEY / E2E_ACCESS_KEY 且未能从 tests/e2e-verify.mjs 读取 key');
  const res = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login_key', key }),
  });
  const data = await res.json();
  assert.ok(res.ok && data?.token, `登录失败: ${res.status} ${JSON.stringify(data)}`);
  return data.token;
}

function extractDocxXmlText(zipBuf) {
  let offset = 0;
  const chunks = [];
  while (offset + 30 <= zipBuf.length) {
    const sig = zipBuf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const compression = zipBuf.readUInt16LE(offset + 8);
    const compSize = zipBuf.readUInt32LE(offset + 18);
    const nameLen = zipBuf.readUInt16LE(offset + 26);
    const extraLen = zipBuf.readUInt16LE(offset + 28);
    const fileName = zipBuf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (fileName === 'word/document.xml' && dataEnd <= zipBuf.length) {
      const raw = zipBuf.subarray(dataStart, dataEnd);
      const xml =
        compression === 8 ? zlib.inflateRawSync(raw).toString('utf8') : raw.toString('utf8');
      chunks.push(xml.replace(/<[^>]+>/g, ''));
    }
    offset = dataEnd;
  }
  return chunks.join('\n');
}

async function run() {
  const token = await login();
  const headers = {
    'Content-Type': 'application/json',
    'x-studio-token': token,
  };

  // 1. 创建扒剧测试项目
  const createRes = await fetch(`${BASE_URL}/api/studio`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      operation: 'create',
      title: 'Step3诚实度验收测试项目',
      kind: 'transcribe',
      total: 10,
      brief: '自动化测试简报',
    }),
  });
  const created = await createRes.json();
  assert.equal(createRes.status, 201, `创建项目失败: ${JSON.stringify(created)}`);
  const projectId = created.project?.id || created.id;
  assert.ok(projectId, '未返回 project.id');

  // 2. 拒绝 .exe 上传 (400/415 且 code FILE_TYPE_REJECTED)
  const fdExe = new FormData();
  fdExe.append('id', projectId);
  fdExe.append(
    'file',
    new Blob(['MZ-fake-binary'], { type: 'application/x-msdownload' }),
    'payload.exe'
  );
  const exeRes = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { 'x-studio-token': token },
    body: fdExe,
  });
  const exeBody = await exeRes.json();
  assert.ok(
    [400, 415].includes(exeRes.status),
    `exe 应返回 400 或 415，实际为 ${exeRes.status}`
  );
  assert.equal(
    exeBody?.code || exeBody?.error?.code || exeBody?.error,
    'FILE_TYPE_REJECTED',
    `exe 错误码应为 FILE_TYPE_REJECTED，实际为 ${JSON.stringify(exeBody)}`
  );

  // 3. 危险路径名规范化为 basename 且不逃出 buckets
  const fdTraversal = new FormData();
  fdTraversal.append('id', projectId);
  fdTraversal.append('name', '../../etc/evil/ep01_script.srt');
  fdTraversal.append(
    'file',
    new Blob(['1\n00:00:01,000 --> 00:00:03,000\n测试字幕\n'], { type: 'text/plain' }),
    '../../etc/evil/ep01_script.srt'
  );
  const travRes = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { 'x-studio-token': token },
    body: fdTraversal,
  });
  const travBody = await travRes.json();
  assert.ok(travRes.ok, `合法 srt 上传应成功: ${travRes.status} ${JSON.stringify(travBody)}`);
  const savedAtt = travBody.attachments?.slice(-1)[0] || travBody.attachment || travBody.project?.attachments?.slice(-1)[0];
  assert.ok(savedAtt, '应返回保存后的附件对象');
  assert.equal(savedAtt.name, 'ep01_script.srt', `附件名应规范化为 basename: ${savedAtt.name}`);
  assert.ok(!savedAtt.name.includes('..') && !savedAtt.name.includes('/'), `附件名不应包含路径遍历字符: ${savedAtt.name}`);
  assert.ok(!String(savedAtt.name).includes('..') && !String(savedAtt.name).includes('/'));
  if (savedAtt.bucketKey || savedAtt.path) {
    const loc = String(savedAtt.bucketKey || savedAtt.path);
    assert.ok(!loc.includes('..'), `存储路径不得包含路径穿越: ${loc}`);
  }

  // 4. 未交付 docx 可下载且内容能看出未完成
  const docxRes = await fetch(`${BASE_URL}/api/upload?id=${encodeURIComponent(projectId)}&export=docx`, {
    headers: { 'x-studio-token': token },
  });
  assert.equal(docxRes.status, 200, `导出 docx 失败: ${docxRes.status}`);
  const docxBuf = Buffer.from(await docxRes.arrayBuffer());
  assert.ok(docxBuf.length > 100, 'docx 内容过短');
  const docText = extractDocxXmlText(docxBuf);
  assert.ok(
    docText.includes('未完成占位'),
    `未交付 docx 正文应包含「未完成占位」提示，实际提取片段: ${docText.slice(0, 300)}`
  );

  // 5. 未交付转入返回 201，brief 含「未完成占位转入」且附件不含 exe
  const transferRes = await fetch(`${BASE_URL}/api/studio`, {
    method: 'POST',
    headers,
    body: JSON.stringify((() => {
      const version = travBody?.version ?? created?.version;
      assert.strictEqual(
        typeof version,
        'number',
        `最近一次写库响应未返回数字 version: ${JSON.stringify({ travBody, created })}`
      );
      return {
        operation: 'transfer_iteration',
        id: projectId,
        version,
        target_kind: 'foreign',
      };
    })()),
  });
  const transferBody = await transferRes.json();
  assert.equal(transferRes.status, 201, `未交付转入应返回 201: ${JSON.stringify(transferBody)}`);
  const targetProj = transferBody.project || transferBody;
  assert.ok(
    String(targetProj.brief || '').includes('未完成占位转入'),
    `转入项目 brief 必须含「未完成占位转入」，实际为: ${targetProj.brief}`
  );
  assert.ok(
    !String(targetProj.brief || '').includes('已核对') &&
      !JSON.stringify(targetProj.requirements || []).includes('已核对'),
    '未交付转入不得出现「已核对」字样'
  );
  const targetAtts = Array.isArray(targetProj.attachments) ? targetProj.attachments : [];
  assert.ok(
    !targetAtts.some((a) => /\.exe$/i.test(String(a?.name || ''))),
    `转入附件不得包含 .exe: ${JSON.stringify(targetAtts)}`
  );
  assert.ok(
    targetAtts.some((a) => a?.name === 'ep01_script.srt'),
    '合法字幕附件应保留在转入项目中'
  );

  console.log('ALL PASS: step3-upload-honesty');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
