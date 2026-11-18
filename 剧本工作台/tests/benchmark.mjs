import { performance } from 'node:perf_hooks';
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

async function runBenchmarks() {
  const tImport0 = performance.now();
  const authRoute = await import('../app/api/auth/route.ts');
  const adminRoute = await import('../app/api/admin/route.ts');
  const studioRoute = await import('../app/api/studio/route.ts');
  const uploadRoute = await import('../app/api/upload/route.ts');
  const importMs = (performance.now() - tImport0).toFixed(2);

  // 1. Auth login latency
  const tAuth0 = performance.now();
  const loginRes = await authRoute.POST(
    new Request('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login_key', key: 'AYIN-ADMIN-8888-KEY' }),
    })
  );
  const { token } = await loginRes.json();
  const authMs = (performance.now() - tAuth0).toFixed(2);

  // 2. Skill Plugin Upload & Catalog Resolution latency
  const tSkill0 = performance.now();
  const upSkillRes = await adminRoute.POST(
    new Request('http://localhost/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-studio-token': token },
      body: JSON.stringify({
        operation: 'upload_skill_plugin',
        kind: 'domestic',
        slot: 'primary',
        name: '基准测试北美豪门主提示词',
        description: '用于测速的主提示词插件',
        fileName: 'bench-primary.md',
        content: '# 基准测试规则\n'.repeat(200),
        isDefault: true,
      }),
    })
  );
  const snap = await upSkillRes.json();
  const uploadedPlugin = snap.systemConfig.skillPlugins.find((p) => p.name === '基准测试北美豪门主提示词');
  const skillUploadMs = (performance.now() - tSkill0).toFixed(2);

  // 3. Studio GET (Project List + Prompt Catalog assembly + Redline Sanitization)
  const iterations = 20;
  const tList0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    await studioRoute.GET(new Request('http://localhost/api/studio', { headers: { 'x-studio-token': token } }));
  }
  const avgStudioListMs = ((performance.now() - tList0) / iterations).toFixed(2);

  // 4. Create Project + Slot Prompt Binding latency
  const tCreate0 = performance.now();
  const createRes = await studioRoute.POST(
    new Request('http://localhost/api/studio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-studio-token': token },
      body: JSON.stringify({
        operation: 'create',
        title: '速率基准测试项目',
        kind: 'domestic',
        brief: '全剧 60 集，前 10 集已锁定',
        promptSelections: { primary: uploadedPlugin.id },
      }),
    })
  );
  const proj = await createRes.json();
  const createProjMs = (performance.now() - tCreate0).toFixed(2);

  // 5. Multi-type Upload & 25 MB Large Video File Upload / Download Throughput
  const size25MB = 25 * 1024 * 1024;
  const largeBuf = new Uint8Array(size25MB);
  largeBuf.fill(65);
  const tUp25 = performance.now();
  const upRes = await uploadRoute.POST(
    new Request(`http://localhost/api/upload?id=${proj.id}&name=${encodeURIComponent('第01集_高清原片25MB.mp4')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'video/mp4', 'x-studio-token': token },
      body: largeBuf,
    })
  );
  const updatedProj = await upRes.json();
  const up25Ms = (performance.now() - tUp25).toFixed(2);
  const upThroughputMBps = (25 / ((performance.now() - tUp25) / 1000)).toFixed(1);

  const fileId = updatedProj.attachments[0].id;
  const tDown25 = performance.now();
  const downRes = await uploadRoute.GET(
    new Request(`http://localhost/api/upload?id=${proj.id}&file=${fileId}`, {
      headers: { 'x-studio-token': token },
    })
  );
  await downRes.arrayBuffer();
  const down25Ms = (performance.now() - tDown25).toFixed(2);

  // 6. Export Markdown Script with Sanitization latency
  const tExp0 = performance.now();
  const expRes = await uploadRoute.GET(
    new Request(`http://localhost/api/upload?id=${proj.id}&export=1`, {
      headers: { 'x-studio-token': token },
    })
  );
  await expRes.text();
  const expMs = (performance.now() - tExp0).toFixed(2);

  // Clean up benchmark plugin & project
  await adminRoute.POST(
    new Request('http://localhost/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-studio-token': token },
      body: JSON.stringify({ operation: 'delete_skill_plugin', id: uploadedPlugin.id }),
    })
  );
  const { getStore, flushPersistentStore } = await import('../lib/server.ts');
  const store = getStore();
  delete store.projects[proj.id];
  flushPersistentStore();

  console.log(
    JSON.stringify(
      {
        importMs: Number(importMs),
        authMs: Number(authMs),
        skillUploadMs: Number(skillUploadMs),
        avgStudioListMs: Number(avgStudioListMs),
        createProjMs: Number(createProjMs),
        upload25MBMs: Number(up25Ms),
        uploadThroughputMBps: Number(upThroughputMBps),
        download25MBMs: Number(down25Ms),
        exportScriptMs: Number(expMs),
      },
      null,
      2
    )
  );
}

runBenchmarks().catch((e) => {
  console.error(e);
  process.exit(1);
});
