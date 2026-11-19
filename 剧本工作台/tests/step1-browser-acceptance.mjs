import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const PROJECT_ROOT = path.resolve(process.env.STEP1_PROJECT_ROOT || process.cwd());
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3199').replace(/\/+$/, '');
const PLAYWRIGHT_MODULE_DIR = process.env.PLAYWRIGHT_MODULE_DIR || '';
const SCREENSHOT_DIR =
  process.env.SCREENSHOT_DIR ||
  fs.mkdtempSync(path.join(os.tmpdir(), 'step1-browser-shots-'));

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function loadPlaywright() {
  if (!PLAYWRIGHT_MODULE_DIR) {
    throw new Error('缺少环境变量 PLAYWRIGHT_MODULE_DIR，无法加载独立安装的 playwright 模块。');
  }
  const resolvedBase = path.resolve(PLAYWRIGHT_MODULE_DIR);
  const candidateEntries = [
    path.join(resolvedBase, 'node_modules', 'playwright', 'index.js'),
    path.join(resolvedBase, 'node_modules', 'playwright'),
    resolvedBase,
  ];
  for (const entry of candidateEntries) {
    if (fs.existsSync(entry)) {
      const req = createRequire(
        fs.statSync(entry).isDirectory() ? path.join(entry, 'package.json') : entry
      );
      try {
        return req(entry);
      } catch {
        // try next
      }
    }
  }
  const reqFromDir = createRequire(path.join(resolvedBase, 'package.json'));
  return reqFromDir('playwright');
}

function resolveBrowserExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  throw new Error('未找到本机 Chrome 或 Edge 可执行文件，请设置 CHROME_PATH 或 EDGE_PATH。');
}

function computeFileSha256(filePath) {
  if (!fs.existsSync(filePath)) return 'MISSING';
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function computeDirSnapshotHash(dirPath) {
  if (!fs.existsSync(dirPath)) return 'MISSING';
  const hash = crypto.createHash('sha256');
  const walk = (currentDir) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const rel = path.relative(dirPath, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        hash.update(`D:${rel}\n`);
        walk(fullPath);
      } else if (entry.isFile()) {
        hash.update(`F:${rel}:`);
        hash.update(fs.readFileSync(fullPath));
        hash.update('\n');
      }
    }
  };
  walk(dirPath);
  return hash.digest('hex');
}

function backupDataDir() {
  const dataDir = path.join(PROJECT_ROOT, '.data');
  const storeFile = path.join(dataDir, 'studio-store.json');
  const bucketsDir = path.join(dataDir, 'buckets');

  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'step1-data-backup-'));
  const backupStoreFile = path.join(backupRoot, 'studio-store.json');
  const backupBucketsDir = path.join(backupRoot, 'buckets');

  const storeExists = fs.existsSync(storeFile);
  const bucketsExists = fs.existsSync(bucketsDir);

  if (storeExists) {
    fs.copyFileSync(storeFile, backupStoreFile);
  }
  if (bucketsExists) {
    fs.cpSync(bucketsDir, backupBucketsDir, { recursive: true });
  }

  const originalStoreHash = computeFileSha256(storeFile);
  const originalBucketsHash = computeDirSnapshotHash(bucketsDir);

  console.log(`[备份] 已创建数据备份目录: ${backupRoot}`);
  console.log(`[备份] studio-store.json SHA-256: ${originalStoreHash}`);
  console.log(`[备份] buckets 目录 SHA-256: ${originalBucketsHash}`);

  return {
    backupRoot,
    storeFile,
    bucketsDir,
    backupStoreFile,
    backupBucketsDir,
    storeExists,
    bucketsExists,
    originalStoreHash,
    originalBucketsHash,
  };
}

function restoreDataDir(backupState) {
  const {
    storeFile,
    bucketsDir,
    backupStoreFile,
    backupBucketsDir,
    storeExists,
    bucketsExists,
    originalStoreHash,
    originalBucketsHash,
  } = backupState;

  fs.mkdirSync(path.dirname(storeFile), { recursive: true });

  if (storeExists) {
    fs.copyFileSync(backupStoreFile, storeFile);
  } else if (fs.existsSync(storeFile)) {
    fs.rmSync(storeFile, { force: true });
  }

  if (fs.existsSync(bucketsDir)) {
    fs.rmSync(bucketsDir, { recursive: true, force: true });
  }
  if (bucketsExists) {
    fs.cpSync(backupBucketsDir, bucketsDir, { recursive: true });
  }

  const restoredStoreHash = computeFileSha256(storeFile);
  const restoredBucketsHash = computeDirSnapshotHash(bucketsDir);
  const matched =
    restoredStoreHash === originalStoreHash && restoredBucketsHash === originalBucketsHash;

  console.log(`[恢复] studio-store.json SHA-256: ${restoredStoreHash}`);
  console.log(`[恢复] buckets 目录 SHA-256: ${restoredBucketsHash}`);
  console.log(`[恢复] 哈希核对结果: ${matched ? 'MATCH' : 'MISMATCH'}`);

  return matched;
}

function extractSeedLoginKeys() {
  const seedFile = path.join(PROJECT_ROOT, 'tests', 'v3-e2e.mjs');
  if (!fs.existsSync(seedFile)) {
    throw new Error('未找到 tests/v3-e2e.mjs，无法定位测试 login_key 种子。');
  }
  const content = fs.readFileSync(seedFile, 'utf8');
  const matches = [...content.matchAll(/loginKey\(\s*['"]([^'"]+)['"]\s*\)/g)];
  const uniqueKeys = [];
  for (const m of matches) {
    const k = m[1]?.trim();
    if (k && !uniqueKeys.includes(k)) {
      uniqueKeys.push(k);
    }
  }
  if (uniqueKeys.length < 2) {
    throw new Error(
      `在 tests/v3-e2e.mjs 中未找到足够的 loginKey('...') 种子（仅找到 ${uniqueKeys.length} 个，需要创作者与管理员共 2 个）。`
    );
  }

  let creatorKey = null;
  let adminKey = null;

  for (const m of matches) {
    const idx = m.index ?? 0;
    const contextSlice = content.slice(Math.max(0, idx - 140), idx + m[0].length + 140).toLowerCase();
    const val = m[1].trim();
    if (!adminKey && (contextSlice.includes('admin') || contextSlice.includes('管理员'))) {
      adminKey = val;
    } else if (
      !creatorKey &&
      (contextSlice.includes('creator') || contextSlice.includes('user') || contextSlice.includes('创作者'))
    ) {
      creatorKey = val;
    }
  }

  if (!creatorKey) {
    creatorKey = uniqueKeys.find((k) => k !== adminKey) || uniqueKeys[0];
  }
  if (!adminKey) {
    adminKey = uniqueKeys.find((k) => k !== creatorKey) || uniqueKeys[1];
  }
  if (!creatorKey || !adminKey || creatorKey === adminKey) {
    throw new Error('无法从 tests/v3-e2e.mjs 区分有效的创作者与管理员 loginKey 种子。');
  }

  return { creatorKey, adminKey };
}

function sanitizeError(err, secrets = []) {
  let msg = err instanceof Error ? err.message : String(err ?? '未知错误');
  for (const s of secrets) {
    if (s) {
      msg = msg.split(s).join('[REDACTED_KEY]');
    }
  }
  msg = msg
    .replace(/Bearer\s+[A-Za-z0-9._\-+=]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_\-]+\b/g, '[REDACTED_TOKEN]')
    .replace(/studio_session=[^;\s]+/gi, 'studio_session=[REDACTED]');
  return msg;
}

function parseUsdAmount(text) {
  if (!text) return NaN;
  const cleaned = String(text).replace(/,/g, '');
  const match = cleaned.match(/\$?\s*(-?\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : NaN;
}

async function assertAuthenticatedSession(page, roleLabel) {
  const currentUrl = new URL(page.url());
  if (currentUrl.pathname === '/login' || currentUrl.pathname.endsWith('/login')) {
    const errorEl = page
      .locator('[role="alert"], .text-red-500, .text-red-600, .text-rose-600, [class*="error"]')
      .first();
    const errText = (await errorEl.innerText().catch(() => '')).trim();
    throw new Error(`${roleLabel}登录后仍停留在 /login${errText ? `，页面提示：${errText}` : ''}。`);
  }

  const cookies = await page.context().cookies(BASE_URL);
  const sessionCookie = cookies.find((c) => c.name === 'studio_session' && c.value);
  if (!sessionCookie) {
    throw new Error(`${roleLabel}登录后未检测到 studio_session Cookie，会话未建立。`);
  }

  try {
    await page.waitForFunction(
      () => {
        const bodyText = document.body?.innerText || '';
        if (bodyText.includes('未登录') || bodyText.includes('去登录')) {
          return false;
        }
        const quotaEl = document.querySelector(
          '.warm-quota-pill, [data-testid="quota-pill"], [class*="quota-pill"]'
        );
        const hasVisibleQuota = Boolean(
          quotaEl &&
            (quotaEl.offsetWidth > 0 ||
              quotaEl.offsetHeight > 0 ||
              quotaEl.getClientRects().length > 0)
        );
        const hasLoggedInSignal =
          hasVisibleQuota ||
          /退出登录|注销|剩余额度|可用额度|预算上限|我的订阅|管理员|控制台/.test(bodyText);
        return hasLoggedInSignal;
      },
      { timeout: 15000 }
    );
  } catch {
    const finalUrl = new URL(page.url());
    if (finalUrl.pathname === '/login' || finalUrl.pathname.endsWith('/login')) {
      const errorEl = page
        .locator('[role="alert"], .text-red-500, .text-red-600, .text-rose-600, [class*="error"]')
        .first();
      const errText = (await errorEl.innerText().catch(() => '')).trim();
      throw new Error(
        `${roleLabel}等待已登录状态超时且已跳回 /login${errText ? `，页面提示：${errText}` : ''}。`
      );
    }

    const bodyText = await page.locator('body').innerText().catch(() => '');
    const visibleAlert = (
      await page
        .locator('[role="alert"], .text-red-500, .text-red-600, .text-rose-600, [class*="error"]')
        .first()
        .innerText()
        .catch(() => '')
    ).trim();
    const detailSuffix = visibleAlert ? `（页面错误提示：${visibleAlert}）` : '';

    if (bodyText.includes('未登录') || bodyText.includes('去登录')) {
      throw new Error(
        `${roleLabel}登录后在 ${finalUrl.pathname} 等待 15 秒页面仍显示「未登录」或「去登录」，未完成已认证态切换${detailSuffix}。`
      );
    }
    throw new Error(
      `${roleLabel}登录后在 ${finalUrl.pathname} 等待 15 秒仍未检测到「退出登录」、额度胶囊或「我的订阅」导航${detailSuffix}。`
    );
  }
}

async function loginWithKey(page, loginKeyVal, roleLabel = '用户') {
  await page.context().clearCookies();
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // ignore
    }
  });
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });

  const keyTab = page.getByRole('tab', { name: '专属 Key / 邀请码', exact: true });
  await keyTab.waitFor({ state: 'visible', timeout: 15000 });
  await keyTab.click();

  const input = page.locator('#login-key-input');
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.fill(loginKeyVal);

  const submitBtn = page
    .locator('form button[type="submit"]')
    .filter({ hasText: '登录进入工作台' })
    .first();
  await submitBtn.waitFor({ state: 'visible', timeout: 15000 });

  const authResponsePromise = page
    .waitForResponse(
      (res) => res.url().includes('/api/auth') && res.request().method() === 'POST',
      { timeout: 15000 }
    )
    .catch(() => null);

  await submitBtn.click();

  const authResponse = await authResponsePromise;
  if (authResponse && !authResponse.ok()) {
    const errPayload = await authResponse.json().catch(() => ({}));
    const serverMsg =
      typeof errPayload?.error === 'string'
        ? errPayload.error
        : typeof errPayload?.message === 'string'
        ? errPayload.message
        : `HTTP ${authResponse.status()}`;
    throw new Error(`${roleLabel}登录接口 /api/auth 返回失败：${serverMsg}`);
  }

  try {
    await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15000 });
  } catch {
    const errorText = (
      await page
        .locator('[role="alert"], .text-red-500, .text-red-600, .text-rose-600, [class*="error"]')
        .first()
        .innerText()
        .catch(() => '')
    ).trim();
    throw new Error(
      `${roleLabel}提交登录表单后未能离开 /login${errorText ? `，错误提示：${errorText}` : ''}。`
    );
  }

  const cookies = await page.context().cookies(BASE_URL);
  const sessionCookie = cookies.find((c) => c.name === 'studio_session' && c.value);
  if (!sessionCookie) {
    throw new Error(`${roleLabel}离开 /login 后未检测到 studio_session Cookie，会话未建立。`);
  }

  await page.goto(`${BASE_URL}/subscriptions`, { waitUntil: 'networkidle' });
  await assertAuthenticatedSession(page, roleLabel);
}

async function ensureActiveTestPlans(page) {
  const uniquePrefix = `step1-browser-${Date.now()}`;
  const monthlyPlanName = `${uniquePrefix}-monthly`;
  const oncePlanName = `${uniquePrefix}-once`;

  const result = await page.evaluate(
    async ({ monthlyName, onceName }) => {
      async function saveSinglePlan(stepLabel, planPayload) {
        const res = await fetch('/api/admin', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'save_plans',
            plan: planPayload,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return {
            ok: false,
            step: stepLabel,
            status: res.status,
            error:
              typeof data?.error === 'string'
                ? data.error
                : typeof data?.message === 'string'
                ? data.message
                : '',
          };
        }
        const savedPlan = data?.savedPlan || data?.plan || null;
        if (!savedPlan || typeof savedPlan !== 'object' || !savedPlan.name) {
          return {
            ok: false,
            step: stepLabel,
            status: res.status,
            error: '响应缺少有效的 savedPlan 对象',
          };
        }
        return {
          ok: true,
          savedPlan,
        };
      }

      const monthlyResult = await saveSinglePlan('POST /api/admin save_plans (monthly)', {
        name: monthlyName,
        description: 'Step1 browser acceptance isolated monthly subscription fixture',
        kind: 'subscription',
        period: 'monthly',
        priceUsd: 9.9,
        creditUsd: 10,
        enabled: true,
        order: 9998,
      });
      if (!monthlyResult.ok) {
        return monthlyResult;
      }

      const onceResult = await saveSinglePlan('POST /api/admin save_plans (once)', {
        name: onceName,
        description: 'Step1 browser acceptance isolated once topup fixture',
        kind: 'topup',
        period: 'once',
        priceUsd: 4.9,
        creditUsd: 5,
        enabled: true,
        order: 9999,
      });
      if (!onceResult.ok) {
        return onceResult;
      }

      return {
        ok: true,
        monthlyPlan: monthlyResult.savedPlan,
        oncePlan: onceResult.savedPlan,
      };
    },
    { monthlyName: monthlyPlanName, onceName: oncePlanName }
  );

  if (!result.ok) {
    throw new Error(
      `创建隔离测试套餐失败（${result.step}，status=${result.status}${
        result.error ? `，error=${result.error}` : ''
      }）。`
    );
  }

  return {
    monthlyPlan: result.monthlyPlan,
    oncePlan: result.oncePlan,
  };
}

async function readCreatorQuotaUsd(page) {
  await page.goto(`${BASE_URL}/usage`, { waitUntil: 'networkidle' });
  await assertAuthenticatedSession(page, '创作者');

  let pillQuota = NaN;
  const pill = page
    .locator('.warm-quota-pill, [data-testid="quota-pill"], [class*="quota-pill"]')
    .first();
  if (await pill.isVisible().catch(() => false)) {
    const pillText = (await pill.innerText().catch(() => '')) || '';
    pillQuota = parseUsdAmount(pillText);
  }

  let pageCap = NaN;
  const bodyText = await page.locator('body').innerText();
  const capMatch = bodyText.match(
    /(?:预算上限|总额度|可用额度|剩余额度|额度上限|budgetCapUsd)[^\d$]*\$?\s*(\d+(?:\.\d+)?)/i
  );
  if (capMatch) {
    pageCap = Number(capMatch[1]);
  }

  const resolved = Number.isFinite(pageCap) ? pageCap : pillQuota;
  if (!Number.isFinite(resolved)) {
    throw new Error('在 /usage 页面和顶部额度胶囊中均未能读取到有效的美元额度数值。');
  }
  return { resolved, pillQuota, pageCap };
}

async function selectActivePlanAndSubmitOrder(page, targetPlanName, expectedCreditUsd) {
  await page.goto(`${BASE_URL}/purchase`, { waitUntil: 'networkidle' });
  await assertAuthenticatedSession(page, '创作者');

  const targetCard = page
    .locator('button, [role="button"], article, section, div')
    .filter({ hasText: targetPlanName })
    .filter({ hasNotText: '已下架' })
    .last();

  if (!(await targetCard.isVisible().catch(() => false))) {
    throw new Error(`在 /purchase 页面未找到可用（非「已下架」）的测试套餐「${targetPlanName}」。`);
  }

  await targetCard.click();
  await page.waitForTimeout(200);

  const submitOrderBtn = page
    .locator('button')
    .filter({ hasText: '提交订单（待管理员确认入账）' })
    .first();
  if (!(await submitOrderBtn.isVisible().catch(() => false))) {
    throw new Error('在 /purchase 页面未找到主按钮「提交订单（待管理员确认入账）」。');
  }
  if (await submitOrderBtn.isDisabled().catch(() => false)) {
    throw new Error('主按钮「提交订单（待管理员确认入账）」处于禁用状态，未能选中有效套餐。');
  }

  await submitOrderBtn.click();

  await page.waitForFunction(
    (planName) => {
      const text = document.body?.innerText || '';
      return (
        text.includes('已生成') ||
        (text.includes(planName) && text.includes('待管理员确认入账'))
      );
    },
    targetPlanName,
    { timeout: 15000 }
  );

  const pageTextAfterSubmit = await page.locator('body').innerText();
  const orderIdMatch = pageTextAfterSubmit.match(/\b(ord_[A-Za-z0-9_-]+|ORD-[A-Za-z0-9_-]+)\b/);
  return {
    orderId: orderIdMatch ? orderIdMatch[1] : null,
    expectedCreditUsd,
  };
}

async function verifyOrderInOrdersPage(page, targetPlanName, expectedStatusText) {
  await page.goto(`${BASE_URL}/orders`, { waitUntil: 'networkidle' });
  await assertAuthenticatedSession(page, '创作者');

  const bodyText = await page.locator('body').innerText();
  if (bodyText.includes('等待管理员确认入账') && !bodyText.includes(targetPlanName)) {
    throw new Error(`/orders 页面仍处于空态（「等待管理员确认入账」），未找到套餐「${targetPlanName}」的订单。`);
  }

  const countMatch = bodyText.match(/订单记录[^\d]*(\d+)/);
  if (countMatch && Number(countMatch[1]) <= 0) {
    throw new Error(`/orders 页面「订单记录」数量为 0，未创建有效订单。`);
  }

  const orderRow = page
    .locator('tr, li, article, section, div')
    .filter({ hasText: targetPlanName })
    .filter({ hasText: expectedStatusText })
    .first();

  if (!(await orderRow.isVisible().catch(() => false))) {
    throw new Error(
      `在 /orders 页面未找到同时包含套餐「${targetPlanName}」与状态「${expectedStatusText}」的订单记录行。`
    );
  }
}

async function adminApproveOrderForPlan(page, targetPlanName) {
  await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
  await assertAuthenticatedSession(page, '管理员');

  const ordersTab = page
    .locator('[role="tab"], button, a')
    .filter({ hasText: /订单|充值审核|入账管理|订单管理/ })
    .first();
  if (await ordersTab.isVisible().catch(() => false)) {
    await ordersTab.click();
    await page.waitForTimeout(400);
  }

  const targetOrderContainer = page
    .locator('tr, li, article, section, div')
    .filter({ hasText: targetPlanName })
    .filter({ hasText: '待管理员确认入账' })
    .filter({ has: page.locator('button', { hasText: '确认入账' }) })
    .last();

  let approveBtn;
  if (await targetOrderContainer.isVisible().catch(() => false)) {
    approveBtn = targetOrderContainer
      .locator('button')
      .filter({ hasText: '确认入账' })
      .first();
  } else {
    approveBtn = page.locator('button').filter({ hasText: '确认入账' }).first();
  }

  if (!(await approveBtn.isVisible().catch(() => false))) {
    throw new Error(`在 /admin 页面未找到套餐「${targetPlanName}」对应的「确认入账」按钮。`);
  }

  await approveBtn.click();

  const dialogConfirmBtn = page
    .locator('[role="dialog"] button')
    .filter({ hasText: /^确认入账$|^确定$/ })
    .first();
  if (await dialogConfirmBtn.isVisible().catch(() => false)) {
    await dialogConfirmBtn.click();
  }

  await page.waitForTimeout(800);
  await page.waitForLoadState('networkidle');
}

async function runAcceptance() {
  const { creatorKey, adminKey } = extractSeedLoginKeys();
  const secrets = [creatorKey, adminKey];
  const pw = loadPlaywright();
  const executablePath = resolveBrowserExecutable();

  let browser;
  try {
    browser = await pw.chromium.launch({
      executablePath,
      headless: true,
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    // 1) 管理员登录并在隔离数据基础上创建 enabled=true 的测试套餐（含月度订阅与单次充值）
    await loginWithKey(page, adminKey, '管理员');
    const { monthlyPlan, oncePlan } = await ensureActiveTestPlans(page);

    // 2) 创作者登录并验证导航与页面加载
    await loginWithKey(page, creatorKey, '创作者');

    for (const route of ['/subscriptions', '/purchase', '/orders']) {
      const resp = await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle' });
      if (!resp || resp.status() >= 400) {
        throw new Error(`访问 ${route} 失败，HTTP 状态异常（${resp ? resp.status() : '无响应'}）。`);
      }
      await assertAuthenticatedSession(page, '创作者');

      const navText = await page.locator('nav, aside, [role="navigation"]').allInnerTexts();
      const joinedNav = navText.join('\n');
      for (const requiredItem of ['我的订阅', '充值 / 会员', '我的订单']) {
        if (!joinedNav.includes(requiredItem)) {
          throw new Error(`在 ${route} 的左侧导航中未找到「${requiredItem}」。`);
        }
      }
      const fullText = await page.locator('body').innerText();
      if (fullText.includes('墨笔行') || fullText.includes('游戏收益')) {
        throw new Error(`页面 ${route} 出现了不应存在的「墨笔行」或「游戏收益」文案。`);
      }
    }

    await page.goto(`${BASE_URL}/subscriptions`, { waitUntil: 'networkidle' });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-creator-navigation-subscriptions.png'),
      fullPage: true,
    });

    // 记录入账前创作者额度
    const quotaBefore = await readCreatorQuotaUsd(page);

    // 3) 在 /purchase 选中可用的月度订阅测试套餐并提交订单，验证 /orders 出现「待管理员确认入账」订单
    await selectActivePlanAndSubmitOrder(page, monthlyPlan.name, monthlyPlan.creditUsd);
    await verifyOrderInOrdersPage(page, monthlyPlan.name, '待管理员确认入账');

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-creator-pending-order.png'),
      fullPage: true,
    });

    // 4) 管理员登录后台，精确点击「确认入账」
    await loginWithKey(page, adminKey, '管理员');
    await adminApproveOrderForPlan(page, monthlyPlan.name);

    // 5) 切回创作者账号验证 /usage 与顶部额度胶囊刷新增加
    await loginWithKey(page, creatorKey, '创作者');
    const quotaAfterApprove = await readCreatorQuotaUsd(page);

    const delta = quotaAfterApprove.resolved - quotaBefore.resolved;
    if (!(delta > 0)) {
      throw new Error(
        `管理员确认入账后，创作者可用额度未增加（入账前: ${quotaBefore.resolved}，入账后: ${quotaAfterApprove.resolved}）。`
      );
    }
    if (Math.abs(delta - monthlyPlan.creditUsd) > 1e-6) {
      throw new Error(
        `入账后额度增量（${delta}）与测试套餐 creditUsd（${monthlyPlan.creditUsd}）不一致，超出 1e-6 误差范围。`
      );
    }
    if (
      Number.isFinite(quotaBefore.pillQuota) &&
      Number.isFinite(quotaAfterApprove.pillQuota) &&
      !(quotaAfterApprove.pillQuota > quotaBefore.pillQuota)
    ) {
      throw new Error(
        `顶部额度胶囊未随入账增加（入账前: ${quotaBefore.pillQuota}，入账后: ${quotaAfterApprove.pillQuota}）。`
      );
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '03-creator-usage-after-approval.png'),
      fullPage: true,
    });

    // 6) 再下一单（使用单次充值测试套餐）后在 /orders 点击「取消订单」，状态变为「已取消」
    await selectActivePlanAndSubmitOrder(page, oncePlan.name, oncePlan.creditUsd);
    await verifyOrderInOrdersPage(page, oncePlan.name, '待管理员确认入账');

    const pendingOnceRow = page
      .locator('tr, li, article, section, div')
      .filter({ hasText: oncePlan.name })
      .filter({ hasText: '待管理员确认入账' })
      .filter({ has: page.locator('button', { hasText: '取消订单' }) })
      .last();

    let cancelOrderBtn;
    if (await pendingOnceRow.isVisible().catch(() => false)) {
      cancelOrderBtn = pendingOnceRow.locator('button').filter({ hasText: '取消订单' }).first();
    } else {
      cancelOrderBtn = page.locator('button').filter({ hasText: '取消订单' }).first();
    }

    if (!(await cancelOrderBtn.isVisible().catch(() => false))) {
      throw new Error('在 /orders 页面未找到待付订单的「取消订单」按钮。');
    }
    await cancelOrderBtn.click();

    const cancelConfirmDialogBtn = page
      .locator('[role="dialog"] button')
      .filter({ hasText: /^取消订单$|^确认取消$|^确定$/ })
      .first();
    if (await cancelConfirmDialogBtn.isVisible().catch(() => false)) {
      await cancelConfirmDialogBtn.click();
    }

    await page.waitForTimeout(800);
    await verifyOrderInOrdersPage(page, oncePlan.name, '已取消');

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '04-creator-order-cancelled.png'),
      fullPage: true,
    });

    // 7) 取消订阅停止续订：在 /subscriptions 点「取消自动续期」，验证状态提示且额度上限不回扣
    await page.goto(`${BASE_URL}/subscriptions`, { waitUntil: 'networkidle' });
    await assertAuthenticatedSession(page, '创作者');

    const cancelAutoRenewBtn = page
      .locator('button')
      .filter({ hasText: '取消自动续期' })
      .first();
    if (!(await cancelAutoRenewBtn.isVisible().catch(() => false))) {
      throw new Error('在 /subscriptions 页面未找到「取消自动续期」按钮。');
    }
    await cancelAutoRenewBtn.click();

    const confirmAutoRenewDialog = page
      .locator('[role="dialog"] button')
      .filter({ hasText: /^取消自动续期$|^确定$/ })
      .first();
    if (await confirmAutoRenewDialog.isVisible().catch(() => false)) {
      await confirmAutoRenewDialog.click();
    }

    await page.waitForFunction(
      () => {
        const text = document.body?.innerText || '';
        return text.includes('已关闭自动续期') || text.includes('已取消到期自动续期设置');
      },
      { timeout: 15000 }
    );

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '05-creator-subscription-auto-renew-disabled.png'),
      fullPage: true,
    });

    const quotaAfterSubCancel = await readCreatorQuotaUsd(page);
    if (quotaAfterSubCancel.resolved + 1e-6 < quotaAfterApprove.resolved) {
      throw new Error(
        `取消自动续期后已入账额度发生回扣（取消前: ${quotaAfterApprove.resolved}，取消后: ${quotaAfterSubCancel.resolved}）。`
      );
    }
  } catch (err) {
    throw new Error(sanitizeError(err, secrets));
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function main() {
  const backupState = backupDataDir();
  let testPassed = false;
  let failureMessage = '';

  try {
    await runAcceptance();
    testPassed = true;
  } catch (err) {
    failureMessage = err instanceof Error ? err.message : String(err);
  } finally {
    const hashMatched = restoreDataDir(backupState);
    if (!hashMatched) {
      console.error('断言失败：数据目录恢复后 SHA-256 哈希与备份前不一致！');
      process.exitCode = 1;
      return;
    }

    if (testPassed) {
      console.log('STEP1_BROWSER_ACCEPTANCE_PASSED');
      console.log(`截图目录路径: ${SCREENSHOT_DIR}`);
      console.log(`恢复哈希是否匹配: ${hashMatched}`);
    } else {
      console.error(`验收失败：${failureMessage}`);
      console.error(`截图目录路径: ${SCREENSHOT_DIR}`);
      console.error(`恢复哈希是否匹配: ${hashMatched}`);
      process.exitCode = 1;
    }
  }
}

main();