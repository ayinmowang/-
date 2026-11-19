import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const DATA_DIR = path.join(ROOT_DIR, '.data');
const STORE_PATH = path.join(DATA_DIR, 'studio-store.json');
const BUCKETS_DIR = path.join(DATA_DIR, 'buckets');
const V3_E2E_PATH = path.join(ROOT_DIR, 'tests', 'v3-e2e.mjs');

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3199').replace(/\/+$/, '');
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR
  ? path.resolve(process.env.SCREENSHOT_DIR)
  : path.join(os.tmpdir(), 'studio-step2-shots');

const DEFAULT_CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function listFilesRecursive(dirPath, baseDir = dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(full, baseDir));
    } else if (entry.isFile()) {
      results.push(path.relative(baseDir, full));
    }
  }
  results.sort();
  return results;
}

function copyDirRecursive(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(src, dst);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dst);
    }
  }
}

function createBackup() {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-step2-browser-bak-'));
  const backupStorePath = path.join(backupDir, 'studio-store.json');
  const backupBucketsDir = path.join(backupDir, 'buckets');

  const manifest = {
    backupDir,
    storeExists: fs.existsSync(STORE_PATH),
    storeSha256: null,
    bucketsExists: fs.existsSync(BUCKETS_DIR),
    bucketHashes: new Map(),
  };

  if (manifest.storeExists) {
    fs.copyFileSync(STORE_PATH, backupStorePath);
    manifest.storeSha256 = sha256File(backupStorePath);
    console.log(`[backup] studio-store.json -> ${backupStorePath} (sha256: ${manifest.storeSha256})`);
  } else {
    console.log(`[backup] studio-store.json not present at ${STORE_PATH}; recorded absent state in ${backupDir}`);
  }

  if (manifest.bucketsExists) {
    copyDirRecursive(BUCKETS_DIR, backupBucketsDir);
    const relFiles = listFilesRecursive(backupBucketsDir);
    for (const rel of relFiles) {
      const full = path.join(backupBucketsDir, rel);
      const digest = sha256File(full);
      manifest.bucketHashes.set(rel, digest);
      console.log(`[backup] buckets/${rel} -> ${full} (sha256: ${digest})`);
    }
    if (relFiles.length === 0) {
      console.log(`[backup] buckets directory empty -> ${backupBucketsDir}`);
    }
  } else {
    console.log(`[backup] buckets directory not present at ${BUCKETS_DIR}; recorded absent state in ${backupDir}`);
  }

  return manifest;
}

function restoreAndVerifyBackup(manifest) {
  const backupStorePath = path.join(manifest.backupDir, 'studio-store.json');
  const backupBucketsDir = path.join(manifest.backupDir, 'buckets');

  if (manifest.storeExists) {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.copyFileSync(backupStorePath, STORE_PATH);
    const restoredHash = sha256File(STORE_PATH);
    assert.equal(
      restoredHash,
      manifest.storeSha256,
      `studio-store.json hash mismatch after restore: expected ${manifest.storeSha256}, got ${restoredHash}`
    );
    console.log(`[restore] verified studio-store.json (sha256: ${restoredHash}) from ${backupStorePath}`);
  } else if (fs.existsSync(STORE_PATH)) {
    fs.rmSync(STORE_PATH, { force: true });
    console.log(`[restore] removed newly created studio-store.json to match initial absent state`);
  }

  if (fs.existsSync(BUCKETS_DIR)) {
    fs.rmSync(BUCKETS_DIR, { recursive: true, force: true });
  }

  if (manifest.bucketsExists) {
    copyDirRecursive(backupBucketsDir, BUCKETS_DIR);
    const restoredFiles = listFilesRecursive(BUCKETS_DIR);
    const expectedFiles = Array.from(manifest.bucketHashes.keys()).sort();
    assert.deepEqual(
      restoredFiles,
      expectedFiles,
      `buckets file list mismatch after restore: expected [${expectedFiles.join(', ')}], got [${restoredFiles.join(', ')}]`
    );
    for (const rel of expectedFiles) {
      const full = path.join(BUCKETS_DIR, rel);
      const digest = sha256File(full);
      const expected = manifest.bucketHashes.get(rel);
      assert.equal(
        digest,
        expected,
        `buckets/${rel} hash mismatch after restore: expected ${expected}, got ${digest}`
      );
      console.log(`[restore] verified buckets/${rel} (sha256: ${digest})`);
    }
  } else {
    console.log(`[restore] verified buckets directory remains absent`);
  }

  console.log(`[backup] preserved backup directory at ${manifest.backupDir}`);
}

function extractCreatorLoginSeed() {
  if (!fs.existsSync(V3_E2E_PATH)) {
    throw new Error(`Required seed source file not found: ${V3_E2E_PATH}`);
  }
  const source = fs.readFileSync(V3_E2E_PATH, 'utf8');
  const regex = /loginKey\(\s*(['"`])([^'"`]+)\1\s*\)/g;
  const keys = [];
  let match;
  while ((match = regex.exec(source)) !== null) {
    keys.push(match[2]);
  }
  if (keys.length === 0) {
    throw new Error(`No loginKey('...') calls found in ${V3_E2E_PATH}`);
  }
  const creatorKeys = keys.filter((k) => !/admin/i.test(k));
  if (creatorKeys.length === 0) {
    throw new Error(`No non-admin creator loginKey('...') found in ${V3_E2E_PATH}`);
  }
  return creatorKeys[0];
}

async function loadPlaywright() {
  const moduleDir = process.env.PLAYWRIGHT_MODULE_DIR;
  if (!moduleDir || !moduleDir.trim()) {
    throw new Error(
      'PLAYWRIGHT_MODULE_DIR is required but not set. Set PLAYWRIGHT_MODULE_DIR to the directory containing playwright or playwright-core.'
    );
  }
  const resolvedDir = path.resolve(moduleDir.trim());
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`PLAYWRIGHT_MODULE_DIR does not exist: ${resolvedDir}`);
  }

  const candidateEntries = [
    path.join(resolvedDir, 'index.mjs'),
    path.join(resolvedDir, 'index.js'),
    path.join(resolvedDir, 'playwright', 'index.mjs'),
    path.join(resolvedDir, 'playwright', 'index.js'),
    path.join(resolvedDir, 'playwright-core', 'index.mjs'),
    path.join(resolvedDir, 'playwright-core', 'index.js'),
  ];

  const req = createRequire(path.join(resolvedDir, 'package.json'));
  const packageCandidates = ['playwright', 'playwright-core'];

  for (const pkg of packageCandidates) {
    try {
      const resolvedPkg = req.resolve(pkg);
      const mod = await import(pathToFileURL(resolvedPkg).href);
      const pw = mod.default ?? mod;
      if (pw && pw.chromium) {
        return pw;
      }
    } catch {
      // try direct file paths next
    }
  }

  for (const entry of candidateEntries) {
    if (fs.existsSync(entry)) {
      const mod = await import(pathToFileURL(entry).href);
      const pw = mod.default ?? mod;
      if (pw && pw.chromium) {
        return pw;
      }
    }
  }

  throw new Error(
    `Failed to load Playwright (with chromium) from PLAYWRIGHT_MODULE_DIR=${resolvedDir}`
  );
}

function resolveBrowserExecutable() {
  const envPath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    process.env.CHROME_EXECUTABLE_PATH ||
    process.env.CHROME_PATH;
  const candidate = envPath && envPath.trim() ? envPath.trim() : DEFAULT_CHROME_PATH;
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `Browser executable not found at "${candidate}". Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH or install Chrome at "${DEFAULT_CHROME_PATH}".`
    );
  }
  return candidate;
}

async function checkServerReachable(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(baseUrl, { method: 'GET', signal: controller.signal });
    if (res.status >= 500) {
      throw new Error(`Server at ${baseUrl} responded with HTTP ${res.status}`);
    }
  } catch (err) {
    throw new Error(
      `Target server at ${baseUrl} is not reachable. Ensure the server is running with STUDIO_LLM_FIXTURE=1 before executing this test. (${err.message})`
    );
  } finally {
    clearTimeout(timer);
  }
}

function assertNoSensitiveLeak(text, contextLabel) {
  assert.ok(
    !/sk-[a-zA-Z0-9_-]{8,}/.test(text),
    `[${contextLabel}] Page text leaked an API key token pattern (sk-...)`
  );
  assert.ok(
    !/api[\s_-]*key/i.test(text),
    `[${contextLabel}] Page text leaked "api key" label`
  );
  assert.ok(
    !/http\s*中转|中转\s*http|https?:\/\/[^\s"'<>]+/i.test(text),
    `[${contextLabel}] Page text leaked HTTP relay / raw endpoint URL`
  );
  assert.ok(
    !/\b(gpt-4[a-z0-9.-]*|gpt-3\.5[a-z0-9.-]*|o1-[a-z0-9.-]*|o3-[a-z0-9.-]*|claude-[23][a-z0-9.-]*|claude-sonnet[a-z0-9.-]*|claude-opus[a-z0-9.-]*|gemini-[12]\.[05][a-z0-9.-]*|deepseek-[a-z0-9.-]+|qwen-[a-z0-9.-]+)\b/i.test(
      text
    ),
    `[${contextLabel}] Page text leaked an upstream LLM model name`
  );
}

async function inspectPageSafety(page, contextLabel) {
  const bodyText = await page.evaluate(() => document.body?.innerText || '');
  assertNoSensitiveLeak(bodyText, contextLabel);
  return bodyText;
}

async function saveScreenshot(page, fileName) {
  const resolvedOutDir = path.resolve(SCREENSHOT_DIR);
  const relToRoot = path.relative(ROOT_DIR, resolvedOutDir);
  if (!relToRoot.startsWith('..') && !path.isAbsolute(relToRoot)) {
    throw new Error(
      `SCREENSHOT_DIR (${resolvedOutDir}) must not be inside project repository (${ROOT_DIR})`
    );
  }
  fs.mkdirSync(resolvedOutDir, { recursive: true });
  const filePath = path.join(resolvedOutDir, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`[screenshot] saved ${filePath}`);
}

async function clearInputIfPresent(page, selector) {
  const loc = page.locator(selector).first();
  if ((await loc.count()) > 0) {
    await loc.fill('');
  }
}

async function ensureWorkCreatedOrOpened(page, uniqueTitle) {
  await page.waitForLoadState('networkidle').catch(() => {});

  const createBtn = page.getByRole('button', { name: /新建作品/ }).first();
  await createBtn.waitFor({ state: 'visible', timeout: 15000 });
  await createBtn.click();

  const titleInput = page.getByPlaceholder('如：豪门闪婚第11-62集续写');
  await titleInput.waitFor({ state: 'visible', timeout: 10000 });
  await titleInput.fill(uniqueTitle);

  const briefInput = page.getByPlaceholder(/例如：全剧/);
  if ((await briefInput.count()) > 0 && (await briefInput.isVisible().catch(() => false))) {
    await briefInput.fill('全剧 10 集，前 2 集已锁定');
  }

  const submitBtn = page.getByRole('button', { name: /创建并进入工作台/ }).first();
  await submitBtn.click();

  await page.getByRole('button', { name: /生成大纲/ }).first().waitFor({ state: 'visible', timeout: 20000 });
}

async function readCenterAndLeftContent(page) {
  return await page.evaluate(() => {
    const textareas = Array.from(document.querySelectorAll('textarea'))
      .map((el) => el.value?.trim() || '')
      .filter(Boolean);
    const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'))
      .map((el) => el.innerText?.trim() || '')
      .filter(Boolean);
    const leftPanels = Array.from(
      document.querySelectorAll('aside, [data-panel="left"], [class*="sidebar"], [class*="asset"]')
    )
      .map((el) => el.innerText?.trim() || '')
      .filter(Boolean);
    const mainPanels = Array.from(
      document.querySelectorAll('main, [data-panel="center"], [class*="editor"], [class*="canvas"]')
    )
      .map((el) => el.innerText?.trim() || '')
      .filter(Boolean);

    return {
      textareas,
      editables,
      leftText: leftPanels.join('\n'),
      mainText: mainPanels.join('\n'),
      fullText: document.body?.innerText || '',
    };
  });
}

async function waitForRightPaneStatus(page, actionLabel, timeoutMs = 25000) {
  const statusRegex = /思考中|起稿中|正在写入|已写入完成|已给出规划（未写入）/;
  const terminalRegex = /已写入完成|已给出规划（未写入）/;

  await page.waitForFunction(
    (patternSource) => {
      const re = new RegExp(patternSource);
      return re.test(document.body?.innerText || '');
    },
    statusRegex.source,
    { timeout: timeoutMs }
  );

  // Wait until generation settles into terminal state if still streaming
  await page.waitForFunction(
    (patternSource) => {
      const re = new RegExp(patternSource);
      return re.test(document.body?.innerText || '');
    },
    terminalRegex.source,
    { timeout: timeoutMs }
  );

  const bodyText = await inspectPageSafety(page, actionLabel);
  assert.match(
    bodyText,
    statusRegex,
    `[${actionLabel}] Expected right pane status (思考中/起稿中/正在写入/已写入完成/已给出规划（未写入）)`
  );
}

async function findActionButton(page, buttonLabel) {
  const exactBtn = page.getByRole('button', { name: buttonLabel, exact: false }).first();
  if ((await exactBtn.count()) > 0 && (await exactBtn.isVisible().catch(() => false))) {
    return exactBtn;
  }
  const fallbackBtn = page
    .locator('button, [role="button"]')
    .filter({ hasText: buttonLabel })
    .first();
  if ((await fallbackBtn.count()) > 0) {
    return fallbackBtn;
  }
  throw new Error(`Action button not found on page: "${buttonLabel}"`);
}

async function verifyLockedEpisodeIfVisible(page) {
  const openLockedEp1Entry = async () => {
    const leftModeBtn = page.getByRole('button', { name: /作品目录|大纲|角色|背景设定/ }).first();
    await leftModeBtn.waitFor({ state: 'visible', timeout: 10000 });
    await leftModeBtn.click();

    const tocOption = page.getByRole('button', { name: /^作品目录$/ }).first();
    if (await tocOption.isVisible().catch(() => false)) {
      await tocOption.click();
    } else {
      await page.getByText('作品目录', { exact: true }).first().click();
    }

    const lockedEp1Btn = page
      .locator('button[data-locked="true"]')
      .filter({ hasText: /第\s*1\s*集|锁定（一字不改）/ })
      .first();
    await lockedEp1Btn.waitFor({ state: 'visible', timeout: 10000 });
    await lockedEp1Btn.click();
  };

  await openLockedEp1Entry();

  const lockBannerVisible = await page
    .getByText(/锁定（一字不改）|锁定稿（只读保护）/)
    .first()
    .isVisible()
    .catch(() => false);
  assert.equal(lockBannerVisible, true, '锁定第 1 集后必须可见「锁定（一字不改）」或「锁定稿（只读保护）」');

  const editor = page.locator('textarea[placeholder="开始撰写本集剧本正文…"]').first();
  await editor.waitFor({ state: 'visible', timeout: 10000 });

  const isReadOnlyProp = await editor.evaluate((el) => Boolean(el.readOnly) || el.getAttribute('aria-readonly') === 'true');
  assert.equal(isReadOnlyProp, true, '锁定分集主编辑器必须为 readOnly 或 aria-readonly');

  const enabledUnlockBtns = await page
    .getByRole('button', { name: /解锁|解除锁定|取消锁定/ })
    .evaluateAll((els) => els.filter((el) => !el.disabled && el.offsetParent !== null).length);
  assert.equal(enabledUnlockBtns, 0, '锁定分集不得出现启用的解锁按钮');

  const originalRaw = await editor.inputValue();

  await editor.fill(`${originalRaw}\n[篡改测试]`, { force: true }).catch(() => {});
  await editor.type('篡改', { delay: 10 }).catch(() => {});
  assert.equal(await editor.inputValue(), originalRaw, '只读锁定编辑器禁止被 fill/type 篡改');

  const modeBtn = page.getByRole('button', { name: /自动模式|计划模式/ }).first();
  await modeBtn.waitFor({ state: 'visible', timeout: 10000 });
  const modeText = (await modeBtn.innerText()).trim();
  if (modeText.includes('计划模式')) {
    await modeBtn.click();
    await page.getByRole('button', { name: /自动模式/ }).first().waitFor({ state: 'visible', timeout: 10000 });
  }

  const writeFullEpBtn = page.getByRole('button', { name: /写整集正文/ }).first();
  await writeFullEpBtn.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction(
    (btn) => btn && !btn.disabled,
    await writeFullEpBtn.elementHandle(),
    { timeout: 30000 }
  );
  await writeFullEpBtn.click();

  await waitForRightPaneStatus(page, 'locked-ep1:写整集正文');

  await openLockedEp1Entry();
  const afterRaw = await editor.inputValue();
  assert.equal(afterRaw, originalRaw, '执行「写整集正文」后第 1 集锁定正文必须逐字保持不变');

  await inspectPageSafety(page, 'locked-ep1');
  await saveScreenshot(page, '07-locked-readonly.png');
}

async function run() {
  const backupManifest = createBackup();
  let browser = null;
  let exitCode = 0;

  try {
    await checkServerReachable(BASE_URL);
    const creatorSeed = extractCreatorLoginSeed();
    const playwright = await loadPlaywright();
    const executablePath = resolveBrowserExecutable();

    browser = await playwright.chromium.launch({
      executablePath,
      headless: true,
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    // 1. Login flow aligned with step1
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    const keyInput = page.locator('#login-key-input');
    await keyInput.waitFor({ state: 'visible', timeout: 15000 });
    await keyInput.fill(creatorSeed);

    const submitBtn = page
      .locator('button[type="submit"], button, [role="button"]')
      .filter({ hasText: /登录进入工作台|登录/ })
      .first();

    if ((await submitBtn.count()) > 0 && (await submitBtn.isVisible().catch(() => false))) {
      await submitBtn.click();
    } else {
      await keyInput.press('Enter');
    }

    await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15000 });

    const sessionRes = await page.request.get(`${BASE_URL}/api/auth/session`).catch(() => null);
    if (sessionRes && sessionRes.ok()) {
      const sessionJson = await sessionRes.json().catch(() => ({}));
      assert.ok(sessionJson, 'Session endpoint returned empty payload');
    }

    if (!new URL(page.url()).pathname.startsWith('/studio')) {
      await page.goto(`${BASE_URL}/studio`, { waitUntil: 'networkidle' });
    }
    await page.waitForURL((url) => url.pathname.startsWith('/studio'), { timeout: 15000 });

    // Ensure any key input is cleared before taking any screenshot
    await clearInputIfPresent(page, '#login-key-input');
    await inspectPageSafety(page, 'studio-entry');

    // 2. Create or open unique work
    const uniqueTitle = `验收测试作品-${Date.now()}`;
    await ensureWorkCreatedOrOpened(page, uniqueTitle);

    // 3. Auto mode: click 5 generation buttons and verify status + non-empty content
    const autoSteps = [
      { label: '生成大纲', shot: '01-auto-outline.png' },
      { label: '生成角色卡', shot: '02-auto-characters.png' },
      { label: '生成背景设定', shot: '03-auto-world.png' },
      { label: '挂卡续写', shot: '04-auto-continue.png' },
      { label: '写整集正文', shot: '05-auto-episode.png' },
    ];

    for (const step of autoSteps) {
      const before = await readCenterAndLeftContent(page);
      const btn = await findActionButton(page, step.label);
      await btn.click();

      await waitForRightPaneStatus(page, `auto:${step.label}`);

      const after = await readCenterAndLeftContent(page);
      const hasNonEmptyAssetOrEditor =
        after.textareas.some((v) => v.length > 0) ||
        after.editables.some((v) => v.length > 0) ||
        after.leftText.length > before.leftText.length ||
        after.mainText.length > 0;

      assert.ok(
        hasNonEmptyAssetOrEditor,
        `[${step.label}] Expected non-empty content in left asset panel or center editor after generation`
      );

      await clearInputIfPresent(page, '#login-key-input');
      await inspectPageSafety(page, `auto:${step.label}`);
      await saveScreenshot(page, step.shot);
    }

    // 4. Plan mode: switch to 计划模式, snapshot content, trigger generation, verify unchanged
    const modeToggle = page.getByRole('button', { name: /自动模式|计划模式/ }).first();
    assert.ok((await modeToggle.count()) > 0, 'Could not find execution mode toggle (自动模式/计划模式)');
    const modeLabel = ((await modeToggle.innerText()) || '').trim();
    if (!/计划模式/.test(modeLabel)) {
      await modeToggle.click();
      await page.getByRole('button', { name: /计划模式/ }).first().waitFor({ state: 'visible', timeout: 10000 });
    }
    await page.waitForTimeout(400);

    const beforePlan = await readCenterAndLeftContent(page);
    const planTriggerBtn = await findActionButton(page, '生成大纲');
    await planTriggerBtn.click();

    await waitForRightPaneStatus(page, 'plan-mode:生成大纲');

    const afterPlan = await readCenterAndLeftContent(page);
    assert.deepEqual(
      afterPlan.textareas,
      beforePlan.textareas,
      'Plan mode must not overwrite textarea editor contents'
    );
    assert.deepEqual(
      afterPlan.editables,
      beforePlan.editables,
      'Plan mode must not overwrite contenteditable editor contents'
    );

    await clearInputIfPresent(page, '#login-key-input');
    await inspectPageSafety(page, 'plan-readonly');
    await saveScreenshot(page, '06-plan-readonly.png');

    // 5. Locked episode read-only check (mandatory; missing entry fails)
    await verifyLockedEpisodeIfVisible(page);

    console.log('[acceptance] All step2 browser acceptance checks passed.');
  } catch (err) {
    exitCode = 1;
    console.error('[acceptance] FAILED:', err);
  } finally {
    if (browser) {
      await browser.close().catch((closeErr) => {
        console.error('[browser] Error closing browser:', closeErr);
      });
    }
    try {
      restoreAndVerifyBackup(backupManifest);
    } catch (restoreErr) {
      exitCode = 1;
      console.error('[restore] CRITICAL FAILURE:', restoreErr);
    }
    if (exitCode !== 0) {
      process.exitCode = 1;
    }
  }
}

await run();
