#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const LOADER = `
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\\.[a-z0-9]+$/i.test(specifier) && context.parentURL?.startsWith('file:')) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    for (const ext of ['.ts', '.tsx', '.js', '.mjs']) {
      const candidate = path.resolve(parentDir, specifier + ext);
      if (fs.existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript;base64,${Buffer.from(LOADER).toString('base64')}`);

const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const origCwd = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'step7-commerce-admin-'));

try {
  process.chdir(tmp);
  delete globalThis.__STUDIO_PERSISTENT_STORE__;

  const server = await imp('lib/server.ts');
  const adminRoute = await imp('app/api/admin/route.ts');
  const purchaseRoute = await imp('app/api/purchase/route.ts');
  const ordersRoute = await imp('app/api/orders/route.ts');
  const subsRoute = await imp('app/api/subscriptions/route.ts');
  const redeemRoute = await imp('app/api/redeem/route.ts');
  const usageRoute = await imp('app/api/usage/route.ts');
  const profileRoute = await imp('app/api/profile/route.ts');

  const store = server.getStore();
  const adminAcc = store.accounts.find((a) => a.username === 'ayin');
  const writerAcc = store.accounts.find((a) => a.username === 'writer01');
  const adminToken = server.createSessionForAccount(adminAcc);
  const writerToken = server.createSessionForAccount(writerAcc);
  const writerKey = writerAcc.accessKey;
  const origBudgetCap = writerAcc.budgetCapUsd;

  const HAdmin = { 'content-type': 'application/json', 'x-studio-token': adminToken };
  const HWriter = { 'content-type': 'application/json', 'x-studio-token': writerToken };

  // 1. RBAC enforcement on /api/admin
  const rbacGet = await adminRoute.GET(new Request('http://localhost/api/admin', { headers: HWriter }));
  assert.equal(rbacGet.status, 401, 'non-admin GET /api/admin must reject with 401 FORBIDDEN_ADMIN_ONLY');
  assert.equal((await rbacGet.json()).error, 'FORBIDDEN_ADMIN_ONLY');
  const rbacPost = await adminRoute.POST(
    new Request('http://localhost/api/admin', {
      method: 'POST',
      headers: HWriter,
      body: JSON.stringify({ operation: 'create_invite', role: 'creator', budgetCapUsd: 10 }),
    })
  );
  assert.ok([401, 403].includes(rbacPost.status), 'non-admin POST /api/admin must reject with 401/403');
  assert.equal((await rbacPost.json()).error, 'FORBIDDEN_ADMIN_ONLY');

  // Seed secret key and verify non-admin endpoints never leak it
  store.systemConfig.providers[0].apiKeys = ['sk-SECRET-TEST-KEY-999999'];
  const adminGetRes = await adminRoute.GET(new Request('http://localhost/api/admin', { headers: HAdmin }));
  assert.equal(adminGetRes.status, 200);
  const adminGetJson = await adminGetRes.json();
  assert.equal(adminGetJson.authorized, true);

  // 2. Invite code + allowInviteRegistration enforcement on /api/redeem
  const invRes = await adminRoute.POST(
    new Request('http://localhost/api/admin', {
      method: 'POST',
      headers: HAdmin,
      body: JSON.stringify({
        operation: 'generate_invites',
        count: 1,
        role: 'creator',
        budgetCapUsd: 12,
        maxUses: 1,
        note: '闭环测试邀请码',
      }),
    })
  );
  assert.equal(invRes.status, 200);
  const invJson = await invRes.json();
  const createdInvite = (invJson.invites || []).find((i) => i.note === '闭环测试邀请码');
  assert.ok(createdInvite?.code, 'admin create_invite must return new invite code');

  // Disable allowInviteRegistration -> invite redeem must return 403, key switch must still return 200
  store.systemConfig.allowInviteRegistration = false;
  const blockedRedeem = await redeemRoute.POST(
    new Request('http://localhost/api/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: createdInvite.code }),
    })
  );
  assert.equal(blockedRedeem.status, 403, 'disabled allowInviteRegistration must block invite redemption');

  const keySwitch = await redeemRoute.POST(
    new Request('http://localhost/api/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: writerKey }),
    })
  );
  assert.equal(keySwitch.status, 200, 'existing accessKey switch must still work when invite registration is off');

  // Re-enable allowInviteRegistration -> invite activates cleanly
  store.systemConfig.allowInviteRegistration = true;
  const okRedeem = await redeemRoute.POST(
    new Request('http://localhost/api/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: createdInvite.code }),
    })
  );
  assert.equal(okRedeem.status, 200);
  const okRedeemJson = await okRedeem.json();
  assert.equal(okRedeemJson.mode, 'activated');
  assert.equal(okRedeemJson.account.budgetCapUsd, 12);

  // 3. Purchase -> Orders -> Admin confirm -> Subscriptions -> Renew -> Cancel
  const purGet = await purchaseRoute.GET(new Request('http://localhost/api/purchase', { headers: HWriter }));
  assert.equal(purGet.status, 200);
  const purData = await purGet.json();
  const monthlyPlan = (purData.plans || []).find((pl) => pl.period === 'monthly');
  assert.ok(monthlyPlan, 'monthly plan must exist');

  const idemKey = 'idem-step7-monthly-001';
  const ordCreate1 = await purchaseRoute.POST(
    new Request('http://localhost/api/purchase', {
      method: 'POST',
      headers: HWriter,
      body: JSON.stringify({ planId: monthlyPlan.id, paymentChannel: 'manual_admin', idempotencyKey: idemKey }),
    })
  );
  assert.ok([200, 201].includes(ordCreate1.status), 'purchase order creation must succeed');
  const ord1 = (await ordCreate1.json()).order;
  assert.equal(ord1.status, 'pending');

  // Idempotent replay
  const ordCreate2 = await purchaseRoute.POST(
    new Request('http://localhost/api/purchase', {
      method: 'POST',
      headers: HWriter,
      body: JSON.stringify({ planId: monthlyPlan.id, paymentChannel: 'manual_admin', idempotencyKey: idemKey }),
    })
  );
  const ord2Json = await ordCreate2.json();
  assert.equal(ord2Json.order.id, ord1.id, 'idempotencyKey must replay exact same order');

  // Orders filter check
  const pendingList = await (await ordersRoute.GET(new Request('http://localhost/api/orders?status=pending', { headers: HWriter }))).json();
  assert.ok(pendingList.orders.some((o) => o.id === ord1.id));
  const paidBefore = await (await ordersRoute.GET(new Request('http://localhost/api/orders?status=paid', { headers: HWriter }))).json();
  assert.ok(!paidBefore.orders.some((o) => o.id === ord1.id));

  // Admin confirms order
  const confirmRes = await adminRoute.POST(
    new Request('http://localhost/api/admin', {
      method: 'POST',
      headers: HAdmin,
      body: JSON.stringify({ operation: 'confirm_order', orderId: ord1.id }),
    })
  );
  assert.equal(confirmRes.status, 200);
  assert.equal(writerAcc.budgetCapUsd, origBudgetCap + monthlyPlan.creditUsd, 'confirm_order must credit budgetCapUsd');

  const paidAfter = await (await ordersRoute.GET(new Request('http://localhost/api/orders?status=paid', { headers: HWriter }))).json();
  assert.ok(paidAfter.orders.some((o) => o.id === ord1.id));

  // Subscriptions GET must expose current, subscriptions, history, AND plans
  const subGet = await (await subsRoute.GET(new Request('http://localhost/api/subscriptions', { headers: HWriter }))).json();
  assert.equal(subGet.current?.status, 'active');
  assert.ok(Array.isArray(subGet.subscriptions) && subGet.subscriptions.length >= 1);
  assert.ok(Array.isArray(subGet.history) && subGet.history.length >= 1, 'GET /api/subscriptions must expose history');
  assert.ok(Array.isArray(subGet.plans) && subGet.plans.length >= 1, 'GET /api/subscriptions must expose plans');

  // Renew creates pending order; cancel cancels active subscription
  const renewRes = await subsRoute.POST(
    new Request('http://localhost/api/subscriptions', {
      method: 'POST',
      headers: HWriter,
      body: JSON.stringify({ action: 'renew', subscriptionId: subGet.current.id }),
    })
  );
  assert.equal(renewRes.status, 200);
  assert.equal((await renewRes.json()).order?.status, 'pending');

  const cancelSubRes = await subsRoute.POST(
    new Request('http://localhost/api/subscriptions', {
      method: 'POST',
      headers: HWriter,
      body: JSON.stringify({ action: 'cancel', subscriptionId: subGet.current.id }),
    })
  );
  assert.equal(cancelSubRes.status, 200);
  assert.equal((await cancelSubRes.json()).subscription?.status, 'cancelled');

  // 4. Usage KPIs + CSV export + creator redline check
  store.auditLogs.unshift({
    id: 'audit-step7-1',
    time: new Date().toISOString(),
    accountId: writerAcc.id,
    username: writerAcc.username,
    projectId: 'proj-step7',
    station: 'writer',
    stationTitle: '05 · 分集编剧',
    providerId: 'prov-openai',
    providerName: 'Primary Relay',
    model: 'gemini-4-hydrogen',
    latencyMs: 1200,
    tokens: 500,
    estimatedCostUsd: 0.01,
    status: 'success',
  });
  const usageJsonRes = await usageRoute.GET(new Request('http://localhost/api/usage?days=7', { headers: HWriter }));
  assert.equal(usageJsonRes.status, 200);
  const usageText = await usageJsonRes.text();
  assert.ok(!usageText.includes('gemini-4-hydrogen'), 'creator /api/usage must redact model name');
  assert.ok(!usageText.includes('sk-SECRET-TEST-KEY'), 'creator /api/usage must never leak secrets');

  const usageCsvRes = await usageRoute.GET(new Request('http://localhost/api/usage?days=7&format=csv', { headers: HWriter }));
  assert.equal(usageCsvRes.status, 200);
  const csvText = await usageCsvRes.text();
  assert.ok(csvText.includes(',') && !csvText.includes('gemini-4-hydrogen'), 'CSV export must work and redact model names');

  // 5. Profile update & password check
  const profUp = await profileRoute.POST(
    new Request('http://localhost/api/profile', {
      method: 'POST',
      headers: HWriter,
      body: JSON.stringify({ displayName: '金牌编剧01', themePreference: 'dark', globalRules: '前3秒必出强冲突' }),
    })
  );
  assert.equal(profUp.status, 200);
  const profJson = await profUp.json();
  assert.equal(profJson.account.displayName, '金牌编剧01');
  assert.equal(profJson.themePreference, 'dark');
  assert.equal(profJson.globalRules, '前3秒必出强冲突');

  const badPwd = await profileRoute.POST(
    new Request('http://localhost/api/profile', {
      method: 'POST',
      headers: HWriter,
      body: JSON.stringify({ currentPassword: 'WRONG_PASSWORD', newPassword: 'newpassword123' }),
    })
  );
  assert.equal(badPwd.status, 400);

  console.log('PASS: step7-commerce-admin-e2e (RBAC, secret masking, invite toggle, purchase->confirm->subscription->renew->cancel, usage CSV redline, profile)');
} finally {
  delete globalThis.__STUDIO_PERSISTENT_STORE__;
  process.chdir(origCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
}
