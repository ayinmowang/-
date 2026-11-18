import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';

// Register a lightweight hook so extensionless TypeScript imports (e.g. '../lib/server') resolve in Node v24
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

async function runFullE2ECheck() {
  const authRoute = await import('../app/api/auth/route.ts');
  const adminRoute = await import('../app/api/admin/route.ts');
  const studioRoute = await import('../app/api/studio/route.ts');
  const uploadRoute = await import('../app/api/upload/route.ts');

  console.log('1. Imported all TypeScript API routes successfully.');

  // Test 1: Unauthenticated /admin check should return 401
  const unauthRes = await adminRoute.GET(new Request('http://localhost/api/admin'));
  assert.equal(unauthRes.status, 401);
  console.log('2. Verified /api/admin rejects unauthenticated requests (401).');

  // Test 2: Admin login with Exclusive Key (AYIN-ADMIN-8888-KEY)
  const adminLoginRes = await authRoute.POST(
    new Request('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login_key', key: 'AYIN-ADMIN-8888-KEY' }),
    })
  );
  assert.equal(adminLoginRes.status, 200);
  const adminLoginData = await adminLoginRes.json();
  assert.equal(adminLoginData.ok, true);
  assert.equal(adminLoginData.account.username, 'ayin');
  assert.equal(adminLoginData.account.role, 'admin');
  const adminToken = adminLoginData.token;
  console.log('3. Verified Admin Exclusive Key login works and issues session token.');

  // Test 3: Admin generates an Exclusive Invite Code for a team member
  const genInviteRes = await adminRoute.POST(
    new Request('http://localhost/api/admin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-studio-token': adminToken,
      },
      body: JSON.stringify({
        operation: 'generate_invites',
        count: 1,
        role: 'creator',
        budgetCapUsd: 20,
        maxUses: 2,
        prefix: 'AYIN-TEST',
        note: '自动化测试编剧邀请码',
      }),
    })
  );
  assert.equal(genInviteRes.status, 200);
  const snapAfterInvite = await genInviteRes.json();
  const createdInvite = snapAfterInvite.invites.find((i) => i.code.startsWith('AYIN-TEST-'));
  assert.ok(createdInvite, 'Invite code should be created');
  console.log('4. Verified Admin Invite Code generation:', createdInvite.code);

  // Test 4: Team member uses the Invite Code to register their own Username + Password
  const testUsername = 'writer_test_' + Date.now().toString().slice(-4);
  const regRes = await authRoute.POST(
    new Request('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'register_with_invite',
        inviteCode: createdInvite.code,
        username: testUsername,
        displayName: '测试编剧小张',
        password: 'pass1234',
      }),
    })
  );
  assert.equal(regRes.status, 200);
  const regData = await regRes.json();
  assert.equal(regData.ok, true);
  assert.equal(regData.account.username, testUsername);
  assert.ok(regData.exclusiveKey.startsWith('AYIN-KEY-'));
  const memberToken = regData.token;
  console.log('5. Verified Team Member registration with Invite Code + Password & Exclusive Key:', regData.exclusiveKey);

  // Test 5: Team member logs in with Username + Password
  const pwdLoginRes = await authRoute.POST(
    new Request('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'login_password',
        username: testUsername,
        password: 'pass1234',
      }),
    })
  );
  assert.equal(pwdLoginRes.status, 200);
  const pwdLoginData = await pwdLoginRes.json();
  assert.equal(pwdLoginData.account.username, testUsername);
  console.log('6. Verified Team Member Username + Password login.');

  // Test 6: Team member creates a project and uploads an attachment -> verify multi-account isolation
  const createProjRes = await studioRoute.POST(
    new Request('http://localhost/api/studio', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-studio-token': memberToken,
      },
      body: JSON.stringify({
        operation: 'create',
        title: '北美狼人契约闪婚测试剧',
        kind: 'foreign',
        brief: '全剧 60 集，前 10 集已锁定，帮我续写后面',
      }),
    })
  );
  assert.equal(createProjRes.status, 201);
  const createdProj = await createProjRes.json();
  assert.equal(createdProj.total, 60);
  assert.equal(createdProj.lockedEpisodes, 10);
  assert.equal(createdProj.startEpisode, 11);

  // Verify Upload & Export
  const exportRes = await uploadRoute.GET(
    new Request(`http://localhost/api/upload?id=${createdProj.id}&export=1`, {
      headers: { 'x-studio-token': memberToken },
    })
  );
  assert.equal(exportRes.status, 200);
  const exportedText = await exportRes.text();
  assert.ok(exportedText.includes('前 10 集已锁定（一字不动）'));
  console.log('7. Verified Project creation, locked episode detection, and Script Export.');

  // Verify account isolation: writer01 should NOT see testUsername's project, but Admin (/api/admin) SHOULD see all projects!
  const writer01Login = await (
    await authRoute.POST(
      new Request('http://localhost/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login_key', key: 'AYIN-KEY-W01-9921' }),
      })
    )
  ).json();
  const writer01List = await (
    await studioRoute.GET(
      new Request('http://localhost/api/studio', {
        headers: { 'x-studio-token': writer01Login.token },
      })
    )
  ).json();
  assert.equal(
    writer01List.projects.some((p) => p.id === createdProj.id),
    false,
    'Other creator accounts must not see another creator project'
  );

  const adminSnap = await (
    await adminRoute.GET(
      new Request('http://localhost/api/admin', {
        headers: { 'x-studio-token': adminToken },
      })
    )
  ).json();
  assert.equal(
    adminSnap.projectsSummary.some((p) => p.id === createdProj.id && p.owner === testUsername),
    true,
    'Admin must see all projects across all team accounts'
  );
  console.log('8. Verified strict Multi-Account project isolation & Admin cross-account visibility.');

  // Test 7: Test Gemini Provider & 6-Station Multi-Step Workflow Execution (with mocked fetch when no live key is set)
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const urlStr = String(url);
    if (urlStr.includes('generativelanguage.googleapis.com') || urlStr.includes('/chat/completions')) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '【Gemini 创作引擎回复】已完成本阶段短剧复述、情绪曲线对位与分集剧本生成（由 gemini-2.5-flash 生成，prompt_tokens: 320）。',
              },
            },
          ],
          usage: { total_tokens: 480 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return originalFetch(url, init);
  };

  // Configure Gemini API key in /api/admin
  const saveGeminiRes = await adminRoute.POST(
    new Request('http://localhost/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-studio-token': adminToken },
      body: JSON.stringify({
        operation: 'save_provider',
        provider: {
          id: 'prov-gemini',
          name: 'Google Gemini 官方通道',
          vendor: 'gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKeys: ['AIzaSyTestGeminiKeyForVerification01', 'AIzaSyTestGeminiKeyForVerification02'],
          models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
          enabled: true,
          priority: 1,
        },
      }),
    })
  );
  assert.equal(saveGeminiRes.status, 200);

  // Test Provider connectivity via /api/admin
  const testProvRes = await (
    await adminRoute.POST(
      new Request('http://localhost/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-studio-token': adminToken },
        body: JSON.stringify({ operation: 'test_provider', id: 'prov-gemini', model: 'gemini-2.5-flash' }),
      })
    )
  ).json();
  assert.equal(testProvRes.testResult.ok, true);
  console.log('9. Verified /api/admin Gemini Provider multi-key save & connectivity test.');

  // Confirm project & connect to AI Station workflow
  await studioRoute.POST(
    new Request('http://localhost/api/studio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-studio-token': memberToken },
      body: JSON.stringify({ operation: 'confirm', id: createdProj.id, version: createdProj.version }),
    })
  );
  const afterConnect = await (
    await studioRoute.POST(
      new Request('http://localhost/api/studio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-studio-token': memberToken },
        body: JSON.stringify({ operation: 'connect', id: createdProj.id, version: createdProj.version + 1 }),
      })
    )
  ).json();
  assert.ok(afterConnect.remoteId, 'Project should be connected to station workflow');
  // Verify model name "gemini-2.5-flash" and "prompt_tokens" were sanitized out of client response!
  const serializedClientProj = JSON.stringify(afterConnect);
  assert.equal(serializedClientProj.includes('gemini-2.5-flash'), false, 'Model name must be sanitized from client');
  assert.equal(serializedClientProj.includes('prompt_tokens'), false, 'Token counts must be sanitized from client');
  console.log('10. Verified Station LLM execution & strict client-side redline sanitization.');

  globalThis.fetch = originalFetch;

  // Restore clean Gemini provider keys after test
  await adminRoute.POST(
    new Request('http://localhost/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-studio-token': adminToken },
      body: JSON.stringify({
        operation: 'save_provider',
        provider: {
          id: 'prov-gemini',
          name: 'Google Gemini 官方通道 (支持免费/付费额度)',
          vendor: 'gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKeys: [],
          models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
          enabled: true,
          priority: 1,
          note: '支持直接填入 Google AI Studio (AIzaSy...) 密钥，全工位通用且支持视觉扒剧',
        },
      }),
    })
  );

  // Clean up test account & test project from persistent store
  await adminRoute.POST(
    new Request('http://localhost/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-studio-token': adminToken },
      body: JSON.stringify({ operation: 'delete_invite', id: createdInvite.id }),
    })
  );
  const testAcc = adminSnap.accounts.find((a) => a.username === testUsername);
  if (testAcc) {
    await adminRoute.POST(
      new Request('http://localhost/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-studio-token': adminToken },
        body: JSON.stringify({ operation: 'delete_account', id: testAcc.id }),
      })
    );
  }

  console.log('ALL_E2E_ROUTES_AND_MULTI_ACCOUNT_TESTS_PASSED');
}

runFullE2ECheck().catch((err) => {
  console.error('E2E_TEST_FAILED:', err);
  process.exit(1);
});
