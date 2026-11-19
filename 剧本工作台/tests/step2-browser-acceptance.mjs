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

const EPISODE_1_SCRIPT = [
  '第一集 · 暴雨夜的未接来电《暗潮初起》',
  '场景：江城老码头·三号仓库（夜 / 暴雨倾盆）',
  '人物：林澈、沈昭、老周',
  '',
  '△ 霓虹倒映在积水里碎成一片。林澈攥紧牛皮纸袋，指节泛白，身后铁门发出刺耳的摩擦声——「哐当！」',
  '林澈（压低声音，警惕回头）："谁在那里？别装神弄鬼……把账本交出来，今晚的事还能压下去。▲"',
  '沈昭从阴影里缓步走出，伞沿滴下的雨水砸在铁皮桶上，声声急促！？',
  '沈昭（冷笑）："压下去？三年前《渡口协议》签字那一刻，你就已经没有回头路了——不信，你听听录音里的第47秒……"',
].join('\n');

const EPISODE_2_SCRIPT = [
  '第二集 · 晨雾与证词《证物链条》',
  '场景：市局刑侦支队·七楼审讯室（日 / 阴转多云）',
  '人物：沈昭、林澈、法医陈默',
  '',
  '△ 白炽灯嗡嗡作响。陈默把密封袋推过桌面，里面的黄铜钥匙在冷光下泛着暗沉的锈迹——「编号：09-B」。',
  '陈默（推了推眼镜，语气笃定）："检材边缘提取到微量海盐结晶，和三号仓库东侧防潮闸的样本完全吻合……这可不是巧合！▲"',
  '林澈盯着照片背面的铅笔批注，呼吸骤停——那串数字竟与母亲失踪前寄出的明信片一模一样！？',
  '林澈（声音发哑）："如果钥匙一直锁在物证室，那昨晚在码头替我挡下那一刀的人……究竟是谁？"',
].join('\n');

function sha256Utf8(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

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
    await briefInput.fill('全剧 10 集');
  }

  const submitBtn = page.getByRole('button', { name: /创建并进入工作台/ }).first();
  await submitBtn.click();

  await page.getByRole('button', { name: /生成大纲/ }).first().waitFor({ state: 'visible', timeout: 20000 });
}

async function isTocDropdownOpen(page) {
  return await page.evaluate(() => {
    const portals = Array.from(
      document.querySelectorAll('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-state="open"]')
    );
    for (const el of portals) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const text = el.innerText || '';
      if (text.includes('作品目录') && (text.includes('大纲') || text.includes('角色') || text.includes('背景设定'))) {
        return true;
      }
    }
    const expandedTriggers = Array.from(document.querySelectorAll('button[aria-expanded="true"]'));
    return expandedTriggers.some((btn) => /作品目录|大纲|角色|背景设定/.test(btn.innerText || ''));
  });
}

async function closeTocDropdownIfOpen(page) {
  if (!(await isTocDropdownOpen(page))) {
    return;
  }

  const tocMenuItem = page
    .locator('[role="menuitem"], [role="option"], [role="menu"] button, [role="listbox"] button')
    .filter({ hasText: /^作品目录$/ })
    .first();
  if ((await tocMenuItem.count()) > 0 && (await tocMenuItem.isVisible().catch(() => false))) {
    await tocMenuItem.click();
    await page.waitForTimeout(100);
  }

  if (await isTocDropdownOpen(page)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
  }

  if (await isTocDropdownOpen(page)) {
    const portalTrigger = page
      .locator('button[aria-expanded="true"]')
      .filter({ hasText: /作品目录|大纲|角色|背景设定/ })
      .first();
    if ((await portalTrigger.count()) > 0 && (await portalTrigger.isVisible().catch(() => false))) {
      await portalTrigger.click();
      await page.waitForTimeout(100);
    }
  }

  await page.waitForFunction(
    () => {
      const portals = Array.from(
        document.querySelectorAll('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')
      );
      for (const el of portals) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          continue;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const text = el.innerText || '';
        if (text.includes('作品目录') && (text.includes('大纲') || text.includes('角色') || text.includes('背景设定'))) {
          return false;
        }
      }
      return true;
    },
    null,
    { timeout: 5000 }
  ).catch(() => {});
}

async function openTocPanel(page) {
  const newEpVisible = await page
    .getByRole('button', { name: /\+\s*新集|新建分集/ })
    .first()
    .isVisible()
    .catch(() => false);
  const epRowVisible = await page
    .locator('button[data-locked]')
    .first()
    .isVisible()
    .catch(() => false);

  if (newEpVisible || epRowVisible) {
    await closeTocDropdownIfOpen(page);
    return;
  }

  const leftModeBtn = page.getByRole('button', { name: /作品目录|大纲|角色|背景设定/ }).first();
  await leftModeBtn.waitFor({ state: 'visible', timeout: 10000 });
  const triggerText = ((await leftModeBtn.innerText()) || '').trim();

  if (!triggerText.includes('作品目录') || !(await isTocDropdownOpen(page))) {
    await leftModeBtn.click();
    await page.waitForTimeout(120);
  }

  const tocOption = page
    .locator('[role="menuitem"], [role="option"], [role="menu"] button, [role="listbox"] button, button')
    .filter({ hasText: /^作品目录$/ })
    .last();
  if ((await tocOption.count()) > 0 && (await tocOption.isVisible().catch(() => false))) {
    await tocOption.click();
    await page.waitForTimeout(120);
  } else {
    const tocText = page.getByText('作品目录', { exact: true }).last();
    if ((await tocText.count()) > 0 && (await tocText.isVisible().catch(() => false))) {
      await tocText.click();
      await page.waitForTimeout(120);
    }
  }

  await closeTocDropdownIfOpen(page);
}

async function findVisibleEpisodeButton(page, epNum, { requireLocked = false } = {}) {
  const selectorBase = requireLocked ? 'button[data-locked="true"]' : 'button[data-locked]';
  const epRegex = new RegExp(`第\\s*${epNum}\\s*集`);

  const byAriaOrText = page.locator(selectorBase).filter({ hasText: epRegex });
  const count1 = await byAriaOrText.count();
  for (let i = 0; i < count1; i++) {
    const candidate = byAriaOrText.nth(i);
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  const byAriaAttr = page.locator(`${selectorBase}[aria-label*="第${epNum}集"], ${selectorBase}[aria-label*="第 ${epNum} 集"]`);
  const count2 = await byAriaAttr.count();
  for (let i = 0; i < count2; i++) {
    const candidate = byAriaAttr.nth(i);
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  if (!requireLocked) {
    const fallbackBtns = page.getByRole('button', { name: epRegex });
    const count3 = await fallbackBtns.count();
    for (let i = 0; i < count3; i++) {
      const candidate = fallbackBtns.nth(i);
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }
  }

  return null;
}

async function selectEpisodeInToc(page, epNum, { requireLocked = false } = {}) {
  await openTocPanel(page);
  await closeTocDropdownIfOpen(page);

  const targetBtn = await findVisibleEpisodeButton(page, epNum, { requireLocked });
  assert.ok(
    targetBtn,
    `在作品目录中未找到可见的${requireLocked ? '已锁定 ' : ''}第 ${epNum} 集按钮`
  );
  await targetBtn.scrollIntoViewIfNeeded().catch(() => {});
  await targetBtn.click();
}

async function createEpisodeAndImportTxt(page, epNum, scriptText, tmpDir) {
  assert.ok(scriptText.trim().length > 80, `第 ${epNum} 集测试原稿 trim 后长度必须 > 80`);

  await openTocPanel(page);
  await closeTocDropdownIfOpen(page);

  const newEpBtn = page.getByRole('button', { name: /\+\s*新集|新建分集/ }).first();
  await newEpBtn.waitFor({ state: 'visible', timeout: 10000 });
  await newEpBtn.click();

  await closeTocDropdownIfOpen(page);
  const targetEpBtn = await findVisibleEpisodeButton(page, epNum);
  if (targetEpBtn) {
    await targetEpBtn.click();
  }

  const tmpTxtPath = path.join(tmpDir, `episode-${epNum}.txt`);
  fs.writeFileSync(tmpTxtPath, scriptText, 'utf8');

  const fileInput = page.locator('input[type="file"][accept*=".txt"]').first();
  if ((await fileInput.count()) === 0) {
    const importTrigger = page.getByRole('button', { name: /本地导入/ }).first();
    if ((await importTrigger.count()) > 0 && (await importTrigger.isVisible().catch(() => false))) {
      await importTrigger.click();
    }
  }
  await fileInput.waitFor({ state: 'attached', timeout: 10000 });
  await fileInput.setInputFiles(tmpTxtPath);

  const editor = page.locator('textarea[placeholder="开始撰写本集剧本正文…"]').first();
  await editor.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction(
    ({ selector, expected }) => {
      const el = document.querySelector(selector);
      return Boolean(el && el.value === expected);
    },
    { selector: 'textarea[placeholder="开始撰写本集剧本正文…"]', expected: scriptText },
    { timeout: 10000 }
  );

  const saveBtn = page.getByRole('button', { name: /保存本章/ }).first();
  await saveBtn.waitFor({ state: 'visible', timeout: 10000 });
  await saveBtn.click();

  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);

  const savedValue = await editor.inputValue();
  assert.equal(savedValue, scriptText, `第 ${epNum} 集保存后编辑器内容必须与导入原稿逐字一致`);
}

async function seedAndLockFirstTwoEpisodes(page, uniqueTitle) {
  assert.ok(EPISODE_1_SCRIPT.trim().length > 80, 'EPISODE_1_SCRIPT trim 后长度必须 > 80');
  assert.ok(EPISODE_2_SCRIPT.trim().length > 80, 'EPISODE_2_SCRIPT trim 后长度必须 > 80');
  assert.notEqual(EPISODE_1_SCRIPT, EPISODE_2_SCRIPT, '两集测试原稿必须明显不同');

  const tmpScriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-step2-scripts-'));
  try {
    await createEpisodeAndImportTxt(page, 1, EPISODE_1_SCRIPT, tmpScriptDir);
    await createEpisodeAndImportTxt(page, 2, EPISODE_2_SCRIPT, tmpScriptDir);
  } finally {
    fs.rmSync(tmpScriptDir, { recursive: true, force: true });
  }

  const listRes = await page.request.get(`${BASE_URL}/api/studio`);
  assert.ok(listRes.ok(), `GET /api/studio 失败: HTTP ${listRes.status()}`);
  const listJson = await listRes.json();
  assert.ok(Array.isArray(listJson?.projects), 'GET /api/studio 返回体必须包含 projects 数组');

  const project = listJson.projects.find((p) => p && p.title === uniqueTitle);
  assert.ok(project, `GET /api/studio 的 projects 中未找到标题为 "${uniqueTitle}" 的作品`);
  assert.ok(project.id, '作品记录缺少 id');
  assert.ok(typeof project.version === 'number', '作品记录缺少 numeric version');

  const lockRes = await page.request.post(`${BASE_URL}/api/studio`, {
    data: {
      operation: 'set_locked',
      id: project.id,
      version: project.version,
      locked: 2,
    },
  });
  assert.ok(lockRes.ok(), `POST /api/studio set_locked 失败: HTTP ${lockRes.status()}`);

  await page.reload({ waitUntil: 'networkidle' });
  const shelfProjectHeading = page.getByRole('heading', { name: uniqueTitle, exact: true }).first();
  await shelfProjectHeading.waitFor({ state: 'visible', timeout: 15000 });
  await shelfProjectHeading.click();
  await page.getByText(/\+ 新集|保存本章|生成大纲/).first().waitFor({ state: 'visible', timeout: 15000 });
  await openTocPanel(page);

  const lockedIndicator = page.locator('[data-locked="true"], :text("锁定（一字不改）")').first();
  await lockedIndicator.waitFor({ state: 'visible', timeout: 15000 });

  await selectEpisodeInToc(page, 1, { requireLocked: true });
  const editor = page.locator('textarea[placeholder="开始撰写本集剧本正文…"]').first();
  await editor.waitFor({ state: 'visible', timeout: 10000 });
  const ep1Raw = await editor.inputValue();
  assert.ok(ep1Raw.trim().length > 0, '锁定后第 1 集正文不得为空');
  assert.equal(ep1Raw, EPISODE_1_SCRIPT, '锁定后第 1 集正文必须与原始导入内容逐字一致');

  await selectEpisodeInToc(page, 2, { requireLocked: true });
  await editor.waitFor({ state: 'visible', timeout: 10000 });
  const ep2Raw = await editor.inputValue();
  assert.ok(ep2Raw.trim().length > 0, '锁定后第 2 集正文不得为空');
  assert.equal(ep2Raw, EPISODE_2_SCRIPT, '锁定后第 2 集正文必须与原始导入内容逐字一致');

  const ep1Sha256 = sha256Utf8(ep1Raw);
  const ep2Sha256 = sha256Utf8(ep2Raw);
  assert.notEqual(ep1Sha256, ep2Sha256, '第 1 集与第 2 集锁定原稿的 SHA-256 必须不同');

  console.log(`[locked-seed] project=${project.id} locked=2`);
  console.log(`[locked-seed] ep1 len=${ep1Raw.length} sha256=${ep1Sha256}`);
  console.log(`[locked-seed] ep2 len=${ep2Raw.length} sha256=${ep2Sha256}`);

  return {
    ep1Raw,
    ep1Sha256,
    ep2Raw,
    ep2Sha256,
  };
}

async function ensureUnlockedEpisode3Selected(page) {
  await openTocPanel(page);
  await closeTocDropdownIfOpen(page);

  const existingEp3Btn = await findVisibleEpisodeButton(page, 3);
  if (existingEp3Btn) {
    await existingEp3Btn.click();
    return;
  }

  const newEpBtn = page.getByRole('button', { name: /\+\s*新集|新建分集/ }).first();
  await newEpBtn.waitFor({ state: 'visible', timeout: 10000 });
  await newEpBtn.click();

  await closeTocDropdownIfOpen(page);
  const createdEp3Btn = await findVisibleEpisodeButton(page, 3);
  if (createdEp3Btn) {
    await createdEp3Btn.click();
  }
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

async function verifyLockedEpisodesMandatory(page, lockedSnapshot) {
  const openLockedEpEntry = async (epNum) => {
    await selectEpisodeInToc(page, epNum, { requireLocked: true });
  };

  const verifySingleEpisodeReadOnly = async (epNum, expectedRaw, expectedSha) => {
    await openLockedEpEntry(epNum);

    const lockBannerVisible = await page
      .getByText(/锁定（一字不改）|锁定稿（只读保护）/)
      .first()
      .isVisible()
      .catch(() => false);
    assert.equal(
      lockBannerVisible,
      true,
      `锁定第 ${epNum} 集后必须可见「锁定（一字不改）」或「锁定稿（只读保护）」`
    );

    const editor = page.locator('textarea[placeholder="开始撰写本集剧本正文…"]').first();
    await editor.waitFor({ state: 'visible', timeout: 10000 });

    const isReadOnlyProp = await editor.evaluate(
      (el) => Boolean(el.readOnly) || el.getAttribute('aria-readonly') === 'true'
    );
    assert.equal(isReadOnlyProp, true, `锁定第 ${epNum} 集主编辑器必须为 readOnly 或 aria-readonly`);

    const enabledUnlockBtns = await page
      .getByRole('button', { name: /解锁|解除锁定|取消锁定/ })
      .evaluateAll((els) => els.filter((el) => !el.disabled && el.offsetParent !== null).length);
    assert.equal(enabledUnlockBtns, 0, `锁定第 ${epNum} 集不得出现启用的解锁按钮`);

    const currentRaw = await editor.inputValue();
    assert.ok(currentRaw.trim().length > 0, `锁定第 ${epNum} 集正文不得为空串`);
    assert.equal(currentRaw, expectedRaw, `锁定第 ${epNum} 集 inputValue 必须逐字等于第 ${epNum} 集原文`);
    assert.equal(
      sha256Utf8(currentRaw),
      expectedSha,
      `锁定第 ${epNum} 集 SHA-256 必须与锁定前一致`
    );

    await editor.fill(`${expectedRaw}\n[篡改测试]`, { timeout: 1500 }).catch(() => {});
    await editor.type('篡改', { delay: 10, timeout: 1500 }).catch(() => {});
    assert.equal(
      await editor.inputValue(),
      expectedRaw,
      `锁定第 ${epNum} 集只读编辑器禁止被普通 fill/type 篡改`
    );
  };

  await verifySingleEpisodeReadOnly(1, lockedSnapshot.ep1Raw, lockedSnapshot.ep1Sha256);
  await verifySingleEpisodeReadOnly(2, lockedSnapshot.ep2Raw, lockedSnapshot.ep2Sha256);

  await openLockedEpEntry(1);

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

  await page.waitForFunction(() => {
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const bodyText = document.body?.innerText || '';
    const hasLockedFeedback = /目标集已锁定|无法写入|锁定稿（只读保护）|一字不改|EPISODE_LOCKED/.test(bodyText);
    const hasStopButton = Array.from(document.querySelectorAll('button[aria-label="停止生成"], button')).some(
      (btn) => isVisible(btn) && (btn.getAttribute('aria-label') === '停止生成' || (btn.textContent || '').trim() === '停止生成')
    );
    const hasBusyControl = Array.from(document.querySelectorAll('[aria-busy="true"]')).some((el) => isVisible(el));
    const isBusy = hasStopButton || hasBusyControl;
    return hasLockedFeedback && !isBusy;
  }, { timeout: 30000 });

  const editor = page.locator('textarea[placeholder="开始撰写本集剧本正文…"]').first();

  await openLockedEpEntry(2);
  await editor.waitFor({ state: 'visible', timeout: 10000 });
  const afterEp2Raw = await editor.inputValue();
  assert.ok(afterEp2Raw.trim().length > 0, '执行「写整集正文」后第 2 集正文不得为空');
  assert.equal(afterEp2Raw, lockedSnapshot.ep2Raw, '执行「写整集正文」后第 2 集锁定正文必须逐字保持不变');
  assert.equal(
    sha256Utf8(afterEp2Raw),
    lockedSnapshot.ep2Sha256,
    '执行「写整集正文」后第 2 集 SHA-256 必须与锁定前一致'
  );

  await openLockedEpEntry(1);
  await editor.waitFor({ state: 'visible', timeout: 10000 });
  const afterEp1Raw = await editor.inputValue();
  assert.ok(afterEp1Raw.trim().length > 0, '执行「写整集正文」后第 1 集正文不得为空');
  assert.equal(afterEp1Raw, lockedSnapshot.ep1Raw, '执行「写整集正文」后第 1 集锁定正文必须逐字保持不变');
  assert.equal(
    sha256Utf8(afterEp1Raw),
    lockedSnapshot.ep1Sha256,
    '执行「写整集正文」后第 1 集 SHA-256 必须与锁定前一致'
  );

  await inspectPageSafety(page, 'locked-ep1');
  await saveScreenshot(page, '07-locked-readonly.png');
}

async function run() {
  const backupManifest = createBackup();
  let browser = null;
  let exitCode = 0;

  try {
    console.log('[env] STUDIO_LLM_FIXTURE=1（模拟 LLM，非真实中转）');
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

    // 2b. Import real non-empty scripts into ep1 & ep2 via UI, then lock first 2 episodes via official API
    const lockedSnapshot = await seedAndLockFirstTwoEpisodes(page, uniqueTitle);

    // Select/create unlocked episode 3 before running auto-mode generation buttons
    await ensureUnlockedEpisode3Selected(page);

    // 3. Auto mode: click 5 generation buttons and verify status + non-empty content
    const autoSteps = [
      { label: '生成大纲', shot: '01-auto-outline.png' },
      { label: '生成角色卡', shot: '02-auto-characters.png' },
      { label: '生成背景设定', shot: '03-auto-world.png' },
      { label: '挂卡续写', shot: '04-auto-continue.png' },
      { label: '写整集正文', shot: '05-auto-episode.png' },
    ];

    for (const step of autoSteps) {
      if (step.label === '挂卡续写' || step.label === '写整集正文') {
        await ensureUnlockedEpisode3Selected(page);
      }

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

    // 5. Locked episode read-only check (mandatory; missing entry or empty content fails)
    await verifyLockedEpisodesMandatory(page, lockedSnapshot);

    console.log('[acceptance] All step2 browser acceptance checks passed (STUDIO_LLM_FIXTURE=1，模拟 LLM，非真实中转).');
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
