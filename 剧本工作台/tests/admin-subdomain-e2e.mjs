#!/usr/bin/env node
/**
 * Independent Opaque-Box 4-Tier E2E Suite for Isolated Admin Subdomain & Warm Paper Redesign
 *
 * Zero external dependencies — uses Node v24 built-ins + headless Chrome/Edge CDP only.
 * Derived strictly from ORIGINAL_REQUEST.md & PROJECT.md Interface Contracts.
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, '.data');
const STORE_FILE = path.join(DATA_DIR, 'studio-store.json');
const BUCKETS_DIR = path.join(DATA_DIR, 'buckets');
const NEXT_BIN = path.join(ROOT_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
const BUILD_ID_FILE = path.join(ROOT_DIR, '.next', 'BUILD_ID');

const ADMIN_HOST = 'admin.cryptoayin.cn';
const MAIN_HOST = 'cryptoayin.cn';
const WWW_HOST = 'www.cryptoayin.cn';

const ADMIN_KEY = 'AYIN-ADMIN-8888-KEY';
const WRITER1_KEY = 'AYIN-KEY-W01-9921';
const REVIEWER1_KEY = 'AYIN-KEY-R01-5510';
const ADMIN_PASSWORD = process.env.STUDIO_ADMIN_PASSWORD || 'E2eAdminPass!2026';
const NEXT_MODE = process.env.E2E_NEXT_MODE === 'dev' ? 'dev' : 'start';
const EXTERNAL_BASE_URL = (process.env.E2E_BASE_URL || '').trim().replace(/\/+$/, '');
const EXTERNAL_STRICT_URL = (process.env.E2E_STRICT_BASE_URL || '').trim().replace(/\/+$/, '');

const TEST_CATALOG = [
  // Tier 1 — Feature Coverage
  { id: 'T1-01', tier: 'Tier 1', desc: 'Host: admin.cryptoayin.cn GET / and GET /admin -> 200 HTML admin interface' },
  { id: 'T1-02', tier: 'Tier 1', desc: 'Host: cryptoayin.cn & www.cryptoayin.cn GET /admin & GET/POST /api/admin -> 404' },
  { id: 'T1-03', tier: 'Tier 1', desc: 'Main site /login & /studio -> 200 and Chrome DOM has zero /admin nav links' },
  { id: 'T1-04', tier: 'Tier 1', desc: 'Admin auth lifecycle: login_key, GET /api/admin, logout, login_password' },
  { id: 'T1-05', tier: 'Tier 1', desc: 'Module 1 (团队账号与邀请码/Key): API CRUD + Chrome UI navigation' },
  { id: 'T1-06', tier: 'Tier 1', desc: 'Module 2 (API 渠道池): save_provider/delete_provider API + Chrome UI navigation' },
  { id: 'T1-07', tier: 'Tier 1', desc: 'Module 3 (六大 AI 编剧工位路由): save_routes for all 6 stations + Chrome UI' },
  { id: 'T1-08', tier: 'Tier 1', desc: 'Module 4 (全站项目监控/安全策略/审计日志): save_system_config + clear_audit_logs + Chrome UI' },
  { id: 'T1-09', tier: 'Tier 1', desc: 'Module 5 (提示词插件 Skills): upload/toggle/default/replace/delete + Chrome UI' },
  { id: 'T1-10', tier: 'Tier 1', desc: 'Module 6 (创作档位配置): save_creation_tiers API + Chrome UI' },
  { id: 'T1-11', tier: 'Tier 1', desc: 'Module 7 (套餐与价格额度): save_plans (name/enabled/monthly|yearly|once) + Chrome UI' },
  { id: 'T1-12', tier: 'Tier 1', desc: 'Module 8 (订单审核入账): list_commerce + confirm_order + idempotency + Chrome UI' },

  // Tier 2 — Boundary & Corner Cases
  { id: 'T2-01', tier: 'Tier 2', desc: 'X-Forwarded-Host port stripping, comma-list, uppercase, and IPv6 [::1]' },
  { id: 'T2-02', tier: 'Tier 2', desc: 'STUDIO_STRICT_HOST_ISOLATION=1 unknown host 404 while admin host returns 200' },
  { id: 'T2-03', tier: 'Tier 2', desc: 'Subpaths & query strings on main hosts (/admin/anything, /api/admin?op=1) -> 404' },
  { id: 'T2-04', tier: 'Tier 2', desc: 'Creator routes & APIs blocked (404) on admin.cryptoayin.cn' },
  { id: 'T2-05', tier: 'Tier 2', desc: 'Admin RBAC: unauthenticated 401 AUTH_REQUIRED; creator & reviewer 401 FORBIDDEN_ADMIN_ONLY' },
  { id: 'T2-06', tier: 'Tier 2', desc: 'Masked secret safety: zero sk-/backendToken/scrypt$ in admin API, creator API, and DOM' },
  { id: 'T2-07', tier: 'Tier 2', desc: 'Partial secret preservation across save_provider & save_system_config + clearBackendToken' },
  { id: 'T2-08', tier: 'Tier 2', desc: 'Negative boundaries: invalid plan period/amount 422, binary/bad-ext/slot skill 400, paid order cancel 409' },

  // Tier 3 — Cross-Feature Combinations
  { id: 'T3-01', tier: 'Tier 3', desc: 'Host-only studio_session cookie isolation (no Domain=, isolated between admin & main hosts)' },
  { id: 'T3-02', tier: 'Tier 3', desc: 'End-to-end commerce loop (creator /purchase -> /orders -> admin confirm -> /usage & /subscriptions)' },
  { id: 'T3-03', tier: 'Tier 3', desc: 'Invite/account copy card & foreground links resolve main-site origin (cryptoayin.cn)' },
  { id: 'T3-04', tier: 'Tier 3', desc: 'Provider masked partial save + 6-station route binding + creation tier binding integration' },

  // Tier 4 — Real-World Visual & Responsive Scenarios (Chrome CDP)
  { id: 'T4-01', tier: 'Tier 4', desc: 'Desktop Light (1440x900): login gate + shell, warm paper palette, zero legacy colors/overflow/errors' },
  { id: 'T4-02', tier: 'Tier 4', desc: 'Desktop Light (1440x900): navigate all 8 modules, bounding boxes, zero overflow, zero sk-/scrypt$ in DOM' },
  { id: 'T4-03', tier: 'Tier 4', desc: 'Desktop Dark (1440x900): toggle [data-theme="dark"], warm-ink palette, zero legacy colors, toggle back' },
  { id: 'T4-04', tier: 'Tier 4', desc: 'Mobile Light (390x844): menu button visible, sidebar off-canvas, open drawer, navigate all 8 modules' },
  { id: 'T4-05', tier: 'Tier 4', desc: 'Mobile Dark (390x844): dark tokens, zero horizontal overflow, zero console/page/5xx errors' },
];

const MODULE_DEFS = [
  { key: 'accounts', label: 'Module 1: 团队账号与邀请码/Key', pattern: /团队.*账号|账号.*邀请码/ },
  { key: 'providers', label: 'Module 2: API 渠道池', pattern: /API\s*渠道池|渠道池/ },
  { key: 'routes', label: 'Module 3: 六大 AI 编剧工位路由', pattern: /六大.*工位|编剧工位/ },
  { key: 'monitor', label: 'Module 4: 全站项目监控/安全策略/审计日志', pattern: /项目监控|安全策略|审计日志/ },
  { key: 'skills', label: 'Module 5: 提示词插件 (Skills)', pattern: /提示词插件|Skills/ },
  { key: 'tiers', label: 'Module 6: 创作档位配置', pattern: /创作档位/ },
  { key: 'plans', label: 'Module 7: 套餐与价格额度', pattern: /套餐与价格|套餐.*额度/ },
  { key: 'orders', label: 'Module 8: 订单审核入账', pattern: /订单审核|审核入账/ },
];

const FORBIDDEN_LEGACY_RGBS = [
  [12, 14, 18],    // #0c0e12
  [20, 24, 33],    // #141821
  [27, 32, 44],    // #1b202c
  [14, 18, 26],    // #0e121a
  [16, 20, 29],    // #10141d
  [12, 14, 20],    // #0c0e14
  [17, 21, 30],    // #11151e
  [23, 28, 39],    // #171c27
  [38, 49, 71],    // #263147
  [10, 132, 255],  // #0a84ff
  [124, 192, 255], // #7cc0ff
  [147, 157, 176], // #939db0
  [243, 245, 248], // #f3f5f8
];

let assertionCount = 0;
function check(condition, message) {
  assertionCount += 1;
  assert.ok(condition, message);
}
function checkEqual(actual, expected, message) {
  assertionCount += 1;
  assert.equal(actual, expected, message);
}
function checkNotEqual(actual, expected, message) {
  assertionCount += 1;
  assert.notEqual(actual, expected, message);
}
function checkMatch(str, regex, message) {
  assertionCount += 1;
  assert.match(String(str), regex, message);
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
  return null;
}

function printTestList() {
  console.log('=== Admin Subdomain & Warm Paper E2E Test Catalog (29 cases) ===');
  for (const t of TEST_CATALOG) {
    console.log(`  [${t.tier}] ${t.id}: ${t.desc}`);
  }
}

function runDryRun() {
  printTestList();
  console.log('\n=== Dry-Run Environment & Safety Checks ===');

  const wsOk = typeof WebSocket === 'function';
  console.log(`  Node version: ${process.version} | global WebSocket: ${wsOk ? 'AVAILABLE' : 'MISSING'}`);
  if (!wsOk) {
    throw new Error('Node global WebSocket is required (Node v22/v24+).');
  }

  const browserPath = resolveBrowserExecutable();
  console.log(`  Browser binary: ${browserPath || 'NOT FOUND'}`);
  if (!browserPath) {
    throw new Error('No Chrome/Edge binary found; set CHROME_PATH or EDGE_PATH.');
  }

  const nextBinExists = fs.existsSync(NEXT_BIN);
  console.log(`  Next.js binary: ${nextBinExists ? NEXT_BIN : 'MISSING'}`);
  if (!EXTERNAL_BASE_URL && !nextBinExists) {
    throw new Error(`Next.js binary not found at ${NEXT_BIN}`);
  }

  const buildIdExists = fs.existsSync(BUILD_ID_FILE);
  console.log(`  .next/BUILD_ID: ${buildIdExists ? 'PRESENT' : 'MISSING (run npm run build before next start)'}`);

  const tmpRoot = os.tmpdir();
  fs.accessSync(tmpRoot, fs.constants.W_OK);
  console.log(`  os.tmpdir() writable: YES (${tmpRoot})`);

  const dataDirExists = fs.existsSync(DATA_DIR);
  const storeExists = fs.existsSync(STORE_FILE);
  const bucketsExists = fs.existsSync(BUCKETS_DIR);
  console.log(`  .data/ sanity (read-only): dir=${dataDirExists}, studio-store.json=${storeExists}, buckets=${bucketsExists}`);
  console.log('  Dry-run complete: no servers started, .data/ untouched.');
}

// ---------- SHA-256 & .data/ Backup / Restore ----------

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
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-subdomain-e2e-bak-'));
  const backupStoreFile = path.join(backupRoot, 'studio-store.json');
  const backupBucketsDir = path.join(backupRoot, 'buckets');

  const storeExists = fs.existsSync(STORE_FILE);
  const bucketsExists = fs.existsSync(BUCKETS_DIR);

  if (storeExists) {
    fs.copyFileSync(STORE_FILE, backupStoreFile);
  }
  if (bucketsExists) {
    fs.cpSync(BUCKETS_DIR, backupBucketsDir, { recursive: true });
  }

  const originalStoreHash = computeFileSha256(STORE_FILE);
  const originalBucketsHash = computeDirSnapshotHash(BUCKETS_DIR);

  console.log(`[backup] Created snapshot at ${backupRoot}`);
  console.log(`[backup] studio-store.json SHA-256: ${originalStoreHash}`);
  console.log(`[backup] buckets SHA-256: ${originalBucketsHash}`);

  return {
    backupRoot,
    storeExists,
    bucketsExists,
    backupStoreFile,
    backupBucketsDir,
    originalStoreHash,
    originalBucketsHash,
  };
}

function seedCleanDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(STORE_FILE)) {
    fs.rmSync(STORE_FILE, { force: true });
  }
  if (fs.existsSync(BUCKETS_DIR)) {
    fs.rmSync(BUCKETS_DIR, { recursive: true, force: true });
  }
}

function restoreDataDir(backupState) {
  if (!backupState) return true;
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (backupState.storeExists) {
    fs.copyFileSync(backupState.backupStoreFile, STORE_FILE);
  } else if (fs.existsSync(STORE_FILE)) {
    fs.rmSync(STORE_FILE, { force: true });
  }

  if (fs.existsSync(BUCKETS_DIR)) {
    fs.rmSync(BUCKETS_DIR, { recursive: true, force: true });
  }
  if (backupState.bucketsExists) {
    fs.cpSync(backupState.backupBucketsDir, BUCKETS_DIR, { recursive: true });
  }

  const restoredStoreHash = computeFileSha256(STORE_FILE);
  const restoredBucketsHash = computeDirSnapshotHash(BUCKETS_DIR);
  const matched =
    restoredStoreHash === backupState.originalStoreHash &&
    restoredBucketsHash === backupState.originalBucketsHash;

  console.log(`[restore] studio-store.json SHA-256: ${restoredStoreHash}`);
  console.log(`[restore] buckets SHA-256: ${restoredBucketsHash}`);
  console.log(`[restore] verification: ${matched ? 'MATCH' : 'MISMATCH'}`);

  if (matched) {
    fs.rmSync(backupState.backupRoot, { recursive: true, force: true });
  } else {
    console.error(`[restore] ERROR: SHA-256 mismatch! Preserved backup dir: ${backupState.backupRoot}`);
  }
  return matched;
}

// ---------- Networking & Next.js Process Lifecycle ----------

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopProcessTree(child, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const waitExit = new Promise((resolve) => {
    child.once('exit', () => resolve(true));
  });

  try {
    child.kill('SIGTERM');
  } catch {}

  const exitedGracefully = await Promise.race([waitExit, sleep(3000).then(() => false)]);
  if (!exitedGracefully && child.pid) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try {
        child.kill('SIGKILL');
      } catch {}
    }
    await Promise.race([waitExit, sleep(3000)]);
  }
  console.log(`[proc] Stopped ${label} (pid=${child.pid})`);
}

async function startNextServer({ port, strictHostIsolation = false }) {
  if (!fs.existsSync(NEXT_BIN)) {
    throw new Error(`Missing Next.js binary at ${NEXT_BIN}`);
  }
  if (NEXT_MODE === 'start' && !fs.existsSync(BUILD_ID_FILE)) {
    throw new Error('Missing .next/BUILD_ID — run "npm run build" in 剧本工作台/ before running E2E with next start.');
  }

  const env = { ...process.env };
  delete env.STUDIO_STRICT_HOST_ISOLATION;
  env.NODE_ENV = NEXT_MODE === 'start' ? 'production' : 'development';
  env.PORT = String(port);
  env.STUDIO_DISABLE_RATE_LIMIT = '1';
  env.STUDIO_ADMIN_PASSWORD = ADMIN_PASSWORD;
  if (strictHostIsolation) {
    env.STUDIO_STRICT_HOST_ISOLATION = '1';
  }

  const args = [NEXT_BIN, NEXT_MODE, '-H', '127.0.0.1', '-p', String(port)];
  const child = spawn(process.execPath, args, {
    cwd: ROOT_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const logs = [];
  const pushLog = (prefix, chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) {
        logs.push(`${prefix}${line}`);
        if (logs.length > 120) logs.shift();
      }
    }
  };
  child.stdout?.on('data', (d) => pushLog('[next:out] ', d));
  child.stderr?.on('data', (d) => pushLog('[next:err] ', d));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + (NEXT_MODE === 'dev' ? 45_000 : 25_000);
  let lastErr = '';

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Next.js (${NEXT_MODE}) exited prematurely with code ${child.exitCode}.\n${logs.join('\n')}`
      );
    }
    try {
      const res = await httpRequest({
        baseUrl,
        method: 'GET',
        path: '/api/auth',
        timeoutMs: 1500,
      });
      if (res.status === 200) {
        console.log(
          `[next] Ready on ${baseUrl} (mode=${NEXT_MODE}, strict=${strictHostIsolation ? '1' : '0'}, pid=${child.pid})`
        );
        return { child, port, baseUrl, logs };
      }
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err?.message || String(err);
    }
    await sleep(200);
  }

  await stopProcessTree(child, `next-${port}`);
  throw new Error(`Timed out waiting for Next.js on ${baseUrl} (${lastErr}).\n${logs.join('\n')}`);
}

/**
 * Raw node:http / node:https client.
 * NEVER uses fetch() because Node v24 Undici silently overwrites the Host header.
 */
function httpRequest({ baseUrl, method = 'GET', path: reqPath = '/', headers = {}, body, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(baseUrl);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;

    let payloadBuf = null;
    if (body !== undefined && body !== null) {
      if (Buffer.isBuffer(body)) {
        payloadBuf = body;
      } else if (typeof body === 'string') {
        payloadBuf = Buffer.from(body, 'utf8');
      } else {
        payloadBuf = Buffer.from(JSON.stringify(body), 'utf8');
      }
    }

    const reqHeaders = { ...headers };
    if (payloadBuf) {
      const hasCt = Object.keys(reqHeaders).some((k) => k.toLowerCase() === 'content-type');
      if (!hasCt && typeof body === 'object' && !Buffer.isBuffer(body)) {
        reqHeaders['Content-Type'] = 'application/json';
      }
      reqHeaders['Content-Length'] = String(payloadBuf.byteLength);
    }

    const options = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : isHttps ? 443 : 80,
      method,
      path: reqPath,
      headers: reqHeaders,
      timeout: timeoutMs,
    };

    const req = mod.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const bodyText = buf.toString('utf8');
        const setCookieRaw = res.headers['set-cookie'];
        const setCookies = Array.isArray(setCookieRaw)
          ? setCookieRaw
          : setCookieRaw
          ? [setCookieRaw]
          : [];
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          setCookies,
          bodyText,
          json() {
            try {
              return JSON.parse(bodyText);
            } catch {
              return null;
            }
          },
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`HTTP timeout after ${timeoutMs}ms for ${method} ${reqPath}`));
    });
    req.on('error', reject);
    if (payloadBuf) {
      req.write(payloadBuf);
    }
    req.end();
  });
}

function buildMultipartFormData(fields, fileSpec) {
  const boundary = '----E2eFormBoundary' + crypto.randomBytes(8).toString('hex');
  const parts = [];

  for (const [key, val] of Object.entries(fields || {})) {
    if (val === undefined || val === null) continue;
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${String(val)}\r\n`,
        'utf8'
      )
    );
  }

  if (fileSpec) {
    const fileBuf = Buffer.isBuffer(fileSpec.content)
      ? fileSpec.content
      : Buffer.from(String(fileSpec.content), 'utf8');
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileSpec.filename}"\r\nContent-Type: ${fileSpec.contentType || 'application/octet-stream'}\r\n\r\n`,
        'utf8'
      )
    );
    parts.push(fileBuf);
    parts.push(Buffer.from('\r\n', 'utf8'));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(parts),
  };
}

function extractCookiePair(setCookies, cookieName = 'studio_session') {
  for (const header of setCookies || []) {
    const firstPart = String(header).split(';')[0]?.trim() || '';
    if (firstPart.startsWith(`${cookieName}=`)) {
      return firstPart;
    }
  }
  return '';
}

// ---------- Zero-Dependency Node v24 Chrome CDP Client ----------

class CdpClient {
  constructor({ browserPath, hostPort, screenshotDir }) {
    this.browserPath = browserPath;
    this.hostPort = hostPort;
    this.screenshotDir = screenshotDir;
    this.chrome = null;
    this.userDataDir = '';
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.eventListeners = new Map();
    this.issues = {
      consoleErrors: [],
      pageExceptions: [],
      server5xx: [],
      loadingFailed: [],
    };
  }

  async launch() {
    this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-subdomain-cdp-'));
    const hostRules = `MAP ${ADMIN_HOST} 127.0.0.1, MAP ${MAIN_HOST} 127.0.0.1, MAP ${WWW_HOST} 127.0.0.1`;
    const shouldMapLocalHosts = (() => {
      if (!EXTERNAL_BASE_URL) return true;
      try {
        const h = new URL(EXTERNAL_BASE_URL).hostname.toLowerCase();
        return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1';
      } catch {
        return false;
      }
    })();

    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-extensions',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=0',
      `--user-data-dir=${this.userDataDir}`,
      ...(shouldMapLocalHosts ? [`--host-resolver-rules=${hostRules}`] : []),
      '--window-size=1440,900',
      'about:blank',
    ];

    this.chrome = spawn(this.browserPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const debugPort = await new Promise((resolve, reject) => {
      let resolved = false;
      let errOutput = '';
      const timer = setTimeout(() => {
        if (!resolved) {
          const activePortFile = path.join(this.userDataDir, 'DevToolsActivePort');
          if (fs.existsSync(activePortFile)) {
            const firstLine = fs.readFileSync(activePortFile, 'utf8').split(/\r?\n/)[0]?.trim();
            if (/^\d+$/.test(firstLine)) {
              resolved = true;
              resolve(Number(firstLine));
              return;
            }
          }
          reject(new Error(`Timed out waiting for Chrome DevTools port.\n${errOutput}`));
        }
      }, 15_000);

      this.chrome.stderr?.on('data', (chunk) => {
        const text = String(chunk);
        errOutput += text;
        const m = text.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
        if (m && !resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(Number(m[1]));
        }
      });

      this.chrome.once('exit', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          reject(new Error(`Chrome exited prematurely (${code}).\n${errOutput}`));
        }
      });
    });

    // Discover or create a page WebSocket target
    let pageWsUrl = '';
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !pageWsUrl) {
      try {
        const resp = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        if (resp.ok) {
          const list = await resp.json();
          const pageTarget = Array.isArray(list)
            ? list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
            : null;
          if (pageTarget) {
            pageWsUrl = pageTarget.webSocketDebuggerUrl;
            break;
          }
        }
      } catch {}
      await sleep(150);
    }

    if (!pageWsUrl) {
      const created = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).catch(() => null);
      if (created && created.ok) {
        const info = await created.json();
        pageWsUrl = info.webSocketDebuggerUrl || '';
      }
    }
    if (!pageWsUrl) {
      throw new Error('Could not find Chrome page WebSocket debugger URL.');
    }

    this.ws = new WebSocket(pageWsUrl);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('CDP WebSocket open timeout')), 10_000);
      this.ws.addEventListener('open', () => {
        clearTimeout(t);
        resolve(true);
      });
      this.ws.addEventListener('error', (err) => {
        clearTimeout(t);
        reject(new Error(`CDP WebSocket error: ${err?.message || 'unknown'}`));
      });
    });

    this.ws.addEventListener('message', (evt) => {
      const raw = typeof evt.data === 'string' ? evt.data : String(evt.data);
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (typeof msg.id === 'number') {
        const handler = this.pending.get(msg.id);
        if (handler) {
          this.pending.delete(msg.id);
          if (msg.error) {
            handler.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            handler.resolve(msg.result || {});
          }
        }
        return;
      }
      if (msg.method) {
        this._handleEvent(msg.method, msg.params || {});
      }
    });

    this.ws.addEventListener('close', () => {
      for (const [, h] of this.pending) {
        h.reject(new Error('CDP WebSocket closed'));
      }
      this.pending.clear();
    });

    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    await this.send('DOM.enable');
    await this.setViewport(1440, 900, false);
    console.log(`[cdp] Connected headless browser (${path.basename(this.browserPath)})`);
  }

  _handleEvent(method, params) {
    if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      const text = (params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      this.issues.consoleErrors.push(text || 'console.error');
    } else if (method === 'Runtime.exceptionThrown') {
      const desc =
        params.exceptionDetails?.exception?.description ||
        params.exceptionDetails?.text ||
        'Uncaught exception';
      this.issues.pageExceptions.push(desc);
    } else if (method === 'Network.responseReceived' && (params.response?.status || 0) >= 500) {
      this.issues.server5xx.push(`${params.response.status} ${params.response.url}`);
    } else if (method === 'Network.loadingFailed' && !params.canceled) {
      if (params.errorText !== 'net::ERR_ABORTED') {
        this.issues.loadingFailed.push(`${params.type || 'req'}: ${params.errorText || 'failed'}`);
      }
    }

    const listeners = this.eventListeners.get(method);
    if (listeners) {
      for (const fn of [...listeners]) {
        try {
          fn(params);
        } catch {}
      }
    }
  }

  on(method, fn) {
    if (!this.eventListeners.has(method)) {
      this.eventListeners.set(method, new Set());
    }
    this.eventListeners.get(method).add(fn);
    return () => this.eventListeners.get(method)?.delete(fn);
  }

  resetIssues() {
    this.issues.consoleErrors = [];
    this.issues.pageExceptions = [];
    this.issues.server5xx = [];
    this.issues.loadingFailed = [];
  }

  assertNoIssues(scope) {
    checkEqual(
      this.issues.consoleErrors.length,
      0,
      `${scope}: expected 0 console.error, got: ${this.issues.consoleErrors.join(' | ')}`
    );
    checkEqual(
      this.issues.pageExceptions.length,
      0,
      `${scope}: expected 0 pageerror, got: ${this.issues.pageExceptions.join(' | ')}`
    );
    checkEqual(
      this.issues.server5xx.length,
      0,
      `${scope}: expected 0 HTTP >= 500, got: ${this.issues.server5xx.join(' | ')}`
    );
    checkEqual(
      this.issues.loadingFailed.length,
      0,
      `${scope}: expected 0 loadingFailed, got: ${this.issues.loadingFailed.join(' | ')}`
    );
  }

  send(method, params = {}, timeoutMs = 15_000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP WebSocket is not open for ${method}`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout after ${timeoutMs}ms on ${method}`));
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      const errMsg =
        res.exceptionDetails.exception?.description ||
        res.exceptionDetails.text ||
        'Runtime.evaluate exception';
      throw new Error(`Browser eval failed: ${errMsg}`);
    }
    return res.result?.value;
  }

  async waitFor(predicateExpr, timeoutMs = 15_000, pollMs = 150) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const val = await this.eval(predicateExpr);
        if (val) return val;
      } catch {}
      await sleep(pollMs);
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${predicateExpr.slice(0, 140)}`);
  }

  async navigate(url, timeoutMs = 20_000) {
    let loaded = false;
    const off = this.on('Page.loadEventFired', () => {
      loaded = true;
    });
    try {
      await this.send('Page.navigate', { url }, timeoutMs);
      const deadline = Date.now() + timeoutMs;
      let readyOk = false;
      while (Date.now() < deadline) {
        if (loaded) {
          const ready = await this.eval('document.readyState').catch(() => '');
          if (ready === 'complete' || ready === 'interactive') {
            readyOk = true;
            break;
          }
        }
        await sleep(100);
      }
      if (!readyOk) {
        throw new Error(`Navigation timed out after ${timeoutMs}ms waiting for Page.loadEventFired on ${url}`);
      }
      await this.eval('new Promise((r) => requestAnimationFrame(() => r(true)))').catch(() => {});
    } finally {
      off();
    }
  }

  async setViewport(width, height, mobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: mobile ? 2 : 1,
      mobile,
    });
    await this.waitFor(`window.innerWidth === ${Number(width)}`, 2000, 50).catch(() => {});
  }

  async clearCookies() {
    await this.send('Network.clearBrowserCookies');
  }

  async getCookies(urls) {
    const res = await this.send('Network.getCookies', urls ? { urls } : {});
    return Array.isArray(res.cookies) ? res.cookies : [];
  }

  async fillInput(selector, value) {
    const ok = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, ${JSON.stringify(String(value))});
      else el.value = ${JSON.stringify(String(value))};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) {
      throw new Error(`fillInput: element not found for selector "${selector}"`);
    }
  }

  async clickSelector(selector) {
    const ok = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!ok) {
      throw new Error(`clickSelector: element not found for selector "${selector}"`);
    }
  }

  async screenshot(filename) {
    fs.mkdirSync(this.screenshotDir, { recursive: true });
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const outPath = path.join(this.screenshotDir, filename);
    fs.writeFileSync(outPath, Buffer.from(res.data, 'base64'));
    return outPath;
  }

  async close() {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
    } catch {}
    await stopProcessTree(this.chrome, 'chrome-cdp');
    if (this.userDataDir && fs.existsSync(this.userDataDir)) {
      for (let i = 0; i < 4; i++) {
        try {
          fs.rmSync(this.userDataDir, { recursive: true, force: true });
          break;
        } catch {
          await sleep(250);
        }
      }
    }
  }
}

// ---------- Browser Domain Helpers ----------

function originForHost(host, baseUrl) {
  const parsed = new URL(baseUrl);
  const portPart = parsed.port ? `:${parsed.port}` : '';
  return `${parsed.protocol}//${host}${portPart}`;
}

const ADMIN_SHELL_READY_PREDICATE = `(() => {
  const text = document.body?.innerText || '';
  if (/正在验证管理员权限|加载后台配置/.test(text)) return false;
  const hasLogoutOrMenu = /退出后台|退出登录/.test(text) ||
    Boolean(document.querySelector('[aria-label*="账号菜单"], [data-testid="admin-logout"], .admin-user-pill, .warm-user-pill'));
  if (hasLogoutOrMenu) return true;
  if (/管理员.*登录|管理后台登录|立即进入管理后台/.test(text)) return false;
  const hasExplicitShellOrModules = Boolean(
    document.querySelector('.admin-shell, [data-admin-module], [data-testid^="admin-nav-"], aside')
  ) || (/团队.*账号|账号.*邀请码/.test(text) && /渠道池|工位|订单/.test(text));
  if (hasExplicitShellOrModules) return true;
  const hasAuthForm = Boolean(
    document.querySelector('form button[type="submit"], form input[type="submit"]') &&
    document.querySelector('form input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="search"])')
  );
  return Boolean(document.querySelector('nav')) && !hasAuthForm;
})()`;

const MOBILE_MENU_FINDER_JS = `(() => {
  const prioritySelectors = [
    '[data-testid="mobile-menu-toggle"]',
    '.admin-mobile-menu',
    '.warm-mobile-menu',
    'button[aria-label*="菜单"]',
  ];
  for (const sel of prioritySelectors) {
    for (const el of document.querySelectorAll(sel)) {
      const st = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0 && r.left >= 0) {
        return el;
      }
    }
  }
  for (const el of document.querySelectorAll('button[aria-label*="导航"]')) {
    const ariaLabel = el.getAttribute('aria-label') || '';
    if (/收起|展开/.test(ariaLabel)) continue;
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0 && r.left >= 0) {
      return el;
    }
  }
  return null;
})`;

async function ensureMobileDrawerClosed(cdp) {
  const isOpen = await cdp.eval(`(() => {
    const sidebar = document.querySelector('aside, .warm-sidebar, .admin-sidebar, [data-testid="admin-sidebar"]');
    if (!sidebar) return false;
    const st = getComputedStyle(sidebar);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    const r = sidebar.getBoundingClientRect();
    return r.right > 2;
  })()`);
  if (!isOpen) return;

  await cdp.eval(`(() => {
    const isVisible = (el) => {
      if (!el) return false;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const closeSelectors = [
      '.admin-scrim',
      '.warm-scrim',
      'aside button[aria-label*="关闭"]',
      '.admin-sidebar button[aria-label*="关闭"]',
      '.warm-sidebar button[aria-label*="关闭"]',
      '[data-testid="admin-sidebar"] button[aria-label*="关闭"]',
      'button[aria-label*="关闭侧边"]',
      'button[aria-label*="关闭导航"]',
    ];
    let target = null;
    for (const sel of closeSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (isVisible(el)) {
          target = el;
          break;
        }
      }
      if (target) break;
    }
    if (!target) {
      target = (${MOBILE_MENU_FINDER_JS})();
    }
    if (target) target.click();
  })()`);
  await cdp.waitFor(`(() => {
    const sidebar = document.querySelector('aside, .warm-sidebar, .admin-sidebar, [data-testid="admin-sidebar"]');
    if (!sidebar) return true;
    const st = getComputedStyle(sidebar);
    if (st.display === 'none' || st.visibility === 'hidden') return true;
    return sidebar.getBoundingClientRect().right <= 2;
  })()`, 5_000);
}

async function browserAdminLogin(cdp, adminOrigin, key = ADMIN_KEY) {
  await cdp.navigate(`${adminOrigin}/`);
  await cdp.waitFor(`(() => {
    const text = document.body?.innerText || '';
    if (/正在验证管理员权限|加载后台配置/.test(text)) return false;
    if (/管理员.*登录|管理后台登录|立即进入管理后台/.test(text)) {
      return document.querySelector('form input') !== null;
    }
    return ${ADMIN_SHELL_READY_PREDICATE} || document.querySelector('form input') !== null;
  })()`, 15_000);

  const alreadyLoggedIn = await cdp.eval(ADMIN_SHELL_READY_PREDICATE);

  if (!alreadyLoggedIn) {
    // Ensure key mode is active if mode tabs exist
    const switchedTab = await cdp.eval(`(() => {
      const btns = [...document.querySelectorAll('button')];
      const keyBtn = btns.find((b) => /专属\\s*Key|Access\\s*Key|密钥登录/.test(b.innerText || ''));
      if (keyBtn) {
        keyBtn.click();
        return true;
      }
      return false;
    })()`);
    if (switchedTab) {
      await cdp.waitFor(`(() => {
        const inp = document.querySelector('form input');
        return Boolean(inp && (inp.type !== 'password' || /key|密钥/i.test((inp.id || '') + ' ' + (inp.placeholder || ''))));
      })()`, 5_000).catch(() => {});
    }
    await cdp.waitFor('Boolean(document.querySelector("form input"))', 5_000);
    await cdp.fillInput('form input', key);
    await cdp.clickSelector('form button[type="submit"]');
    await cdp.waitFor(ADMIN_SHELL_READY_PREDICATE, 15_000);
  }
}

async function ensureCreatorKeyTab(cdp) {
  await cdp.waitFor(
    'Boolean(document.querySelector("[role=\\"tablist\\"], #login-key-input, #login-username-input"))',
    15_000
  );
  const hasKeyInput = await cdp.eval('Boolean(document.querySelector("#login-key-input"))');
  if (!hasKeyInput) {
    const clickedTab = await cdp.eval(`(() => {
      const findKeyTab = (els) =>
        els.find((b) => /专属\\s*Key/.test(b.innerText || '')) ||
        els.find((b) => /邀请码/.test(b.innerText || '') && !/注册/.test(b.innerText || ''));
      const tabEls = [...document.querySelectorAll('[role="tablist"] button, button[role="tab"]')];
      const keyTab = findKeyTab(tabEls) || findKeyTab([...document.querySelectorAll('button')]);
      if (!keyTab) return false;
      keyTab.click();
      return true;
    })()`);
    if (!clickedTab) {
      throw new Error('Creator login key tab (专属 Key / 邀请码) not found');
    }
    await cdp.waitFor('Boolean(document.querySelector("#login-key-input"))', 15_000);
  }
}

async function browserCreatorLogin(cdp, mainOrigin, key = WRITER1_KEY) {
  await cdp.navigate(`${mainOrigin}/login`);
  await ensureCreatorKeyTab(cdp);
  await cdp.fillInput('#login-key-input', key);
  await cdp.eval(`(() => {
    const btns = [...document.querySelectorAll('button[type="submit"], button')];
    const submit = btns.find((b) => /登录进入工作台/.test(b.innerText || ''));
    if (!submit) throw new Error('Creator login submit button not found');
    submit.click();
  })()`);
  await cdp.waitFor(`(() => {
    if (location.pathname === '/login') return false;
    const pill = document.querySelector('.warm-quota-pill');
    return Boolean(pill && /\\$\\d+/.test(pill.innerText || ''));
  })()`, 15_000);
}

async function clickAdminModule(cdp, moduleDef, { isMobile = false } = {}) {
  if (isMobile) {
    // Open drawer if sidebar is closed/off-canvas
    const drawerAction = await cdp.eval(`(() => {
      const sidebar = document.querySelector('aside, .warm-sidebar, .admin-sidebar, [data-testid="admin-sidebar"]');
      if (sidebar) {
        const r = sidebar.getBoundingClientRect();
        if (r.right > 40 && r.left >= -2) return 'already-open';
      }
      const menuBtn = (${MOBILE_MENU_FINDER_JS})();
      if (menuBtn) {
        menuBtn.click();
        return 'clicked';
      }
      return '';
    })()`);
    check(Boolean(drawerAction), `Mobile menu toggle must be clickable before selecting ${moduleDef.key}`);
    await cdp.waitFor(`(() => {
      const sidebar = document.querySelector('aside, .warm-sidebar, .admin-sidebar, [data-testid="admin-sidebar"]');
      if (!sidebar) return false;
      const r = sidebar.getBoundingClientRect();
      return r.right > 40 && r.left >= -2;
    })()`, 5_000);
  }

  const clicked = await cdp.eval(`(() => {
    const re = new RegExp(${JSON.stringify(moduleDef.pattern.source)});
    const candidates = [...document.querySelectorAll('[data-admin-module], [data-testid^="admin-nav-"], aside button, nav button, [role="tab"], button')];
    const target = candidates.find((el) => {
      const modAttr = el.getAttribute('data-admin-module') || el.getAttribute('data-testid') || '';
      if (modAttr === ${JSON.stringify(moduleDef.key)} || modAttr === ${JSON.stringify(`admin-nav-${moduleDef.key}`)}) {
        return true;
      }
      const txt = (el.innerText || el.getAttribute('aria-label') || '').trim();
      if (!txt || txt.length > 80) return false;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      return re.test(txt);
    });
    if (!target) return null;
    target.click();
    return (target.innerText || target.getAttribute('aria-label') || '').trim();
  })()`);

  check(Boolean(clicked), `Admin sidebar/nav button for ${moduleDef.label} must be present and clickable`);
  await cdp.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  return clicked;
}

async function inspectAdminVisualState(cdp, mode /* 'light' | 'dark' */) {
  return cdp.eval(`(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    const getVar = (n) => rootStyle.getPropertyValue(n).trim().toLowerCase();
    const parseRgb = (str) => {
      const m = String(str || '').match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)(?:\\s*,\\s*([\\d.]+))?\\s*\\)/i);
      if (!m) return null;
      return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
    };

    const forbidden = ${JSON.stringify(FORBIDDEN_LEGACY_RGBS)};
    const isForbidden = (rgb) => {
      if (!rgb || rgb.a === 0) return false;
      return forbidden.some(([fr, fg, fb]) => rgb.r === fr && rgb.g === fg && rgb.b === fb);
    };

    const forbiddenHits = [];
    const els = document.querySelectorAll('body, main, aside, header, nav, section, article, button, a, input, select, textarea, table, th, td, div, span, p, h1, h2, h3, label');
    for (const el of els) {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      for (const prop of ['backgroundColor', 'color', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor']) {
        const parsed = parseRgb(st[prop]);
        if (isForbidden(parsed)) {
          forbiddenHits.push({ tag: el.tagName, prop, val: st[prop], cls: String(el.className || '').slice(0, 40) });
          if (forbiddenHits.length >= 10) break;
        }
      }
      if (forbiddenHits.length >= 10) break;
    }

    const bodyBg = parseRgb(getComputedStyle(document.body).backgroundColor);
    const shellEl = document.querySelector('.admin-shell, .warm-shell, main');
    const shellBg = shellEl ? parseRgb(getComputedStyle(shellEl).backgroundColor) : null;
    const htmlTheme = document.documentElement.getAttribute('data-theme');
    const hasDarkClass = document.documentElement.classList.contains('dark');
    const storedTheme = localStorage.getItem('studio_theme');

    const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;

    const mainEl = document.querySelector('main') || document.body;
    const panels = [...mainEl.querySelectorAll('section, article, [role="tabpanel"], .admin-panel, .warm-card, main > div')];
    let maxPanel = { width: 0, height: 0 };
    for (const p of panels) {
      const r = p.getBoundingClientRect();
      if (r.width * r.height > maxPanel.width * maxPanel.height) {
        maxPanel = { width: r.width, height: r.height };
      }
    }

    const html = document.body?.innerHTML || '';
    const text = document.body?.innerText || '';
    const inputVals = [...document.querySelectorAll('input, textarea')].map((el) => el.value || '').join('\\n');
    const combinedDom = html + '\\n' + text + '\\n' + inputVals;
    const hasRawSk = /\\bsk-[A-Za-z0-9_-]{8,}\\b/.test(combinedDom);
    const hasScrypt = combinedDom.includes('scrypt$');

    return {
      vars: {
        bgPaper: getVar('--bg-paper'),
        bgSidebar: getVar('--bg-sidebar'),
        bgSurface: getVar('--bg-surface'),
        accentCinnabar: getVar('--accent-cinnabar'),
        accentGold: getVar('--accent-gold'),
        textPrimary: getVar('--text-primary'),
      },
      bodyBg,
      shellBg,
      htmlTheme,
      hasDarkClass,
      storedTheme,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflow,
      forbiddenHits,
      maxPanel,
      hasRawSk,
      hasScrypt,
      modeExpected: ${JSON.stringify(mode)},
    };
  })()`);
}

// ---------- Test Runner & Helpers ----------

async function apiLogin({ baseUrl, host, key, username, password }) {
  const body = key
    ? { action: 'login_key', key }
    : { action: 'login_password', username, password };
  const res = await httpRequest({
    baseUrl,
    method: 'POST',
    path: '/api/auth',
    headers: { Host: host },
    body,
  });
  const json = res.json();
  const cookiePair = extractCookiePair(res.setCookies, 'studio_session');
  return { res, json, token: json?.token || '', cookiePair };
}

async function runSuite() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--list')) {
    printTestList();
    process.exit(0);
  }
  if (args.has('--dry-run')) {
    runDryRun();
    process.exit(0);
  }

  const browserPath = resolveBrowserExecutable();
  if (!browserPath) {
    throw new Error('No Chrome or Edge executable found; set CHROME_PATH or EDGE_PATH.');
  }
  if (typeof WebSocket !== 'function') {
    throw new Error('Node global WebSocket is unavailable; Node v22/v24+ is required.');
  }

  const screenshotDir =
    process.env.E2E_SCREENSHOT_DIR ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'admin-subdomain-e2e-shots-'));
  fs.mkdirSync(screenshotDir, { recursive: true });

  let backupState = null;
  let server1 = null;
  let server2 = null;
  let cdp = null;
  let cleanupPromise = null;

  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      if (cdp) {
        await cdp.close().catch(() => {});
        cdp = null;
      }
      if (server1?.child) {
        await stopProcessTree(server1.child, 'next-server-1').catch(() => {});
        server1 = null;
      }
      if (server2?.child) {
        await stopProcessTree(server2.child, 'next-server-2').catch(() => {});
        server2 = null;
      }
      if (backupState) {
        const ok = restoreDataDir(backupState);
        if (!ok) {
          process.exitCode = 1;
        }
        backupState = null;
      }
    })();
    return cleanupPromise;
  };

  const onSignal = (sig) => {
    console.error(`\n[signal] Caught ${sig}, cleaning up safely...`);
    cleanup().finally(() => process.exit(1));
  };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));

  const results = [];
  const runTest = async (id, fn) => {
    const meta = TEST_CATALOG.find((t) => t.id === id);
    const label = meta ? `${id}: ${meta.desc}` : id;
    const t0 = Date.now();
    try {
      await fn();
      const ms = Date.now() - t0;
      console.log(`  PASS  ${label} (${ms}ms)`);
      results.push({ id, status: 'PASS', ms });
    } catch (err) {
      const ms = Date.now() - t0;
      console.error(`  FAIL  ${label} (${ms}ms)\n        ${err?.stack || err}`);
      results.push({ id, status: 'FAIL', ms, error: err?.message || String(err) });
    }
  };

  try {
    let baseUrl = EXTERNAL_BASE_URL;
    let hostPort = 0;

    if (!baseUrl) {
      backupState = backupDataDir();
      seedCleanDataDir();
      const port1 = await getFreePort();
      server1 = await startNextServer({ port: port1, strictHostIsolation: false });
      baseUrl = server1.baseUrl;
      hostPort = port1;
    } else {
      const parsed = new URL(baseUrl);
      hostPort = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
    }

    const adminOrigin = originForHost(ADMIN_HOST, baseUrl);
    const mainOrigin = originForHost(MAIN_HOST, baseUrl);

    cdp = new CdpClient({ browserPath, hostPort, screenshotDir });
    await cdp.launch();

    // Shared test state across tiers
    let adminToken = '';
    let writerToken = '';
    let reviewerToken = '';
    let createdAccountId = '';
    let createdInviteId = '';
    let createdPlanId = '';
    let createdSkillId = '';
    let paidOrderId = '';
    let seededSecretProviderId = '';

    // =========================================================================
    // TIER 1 — Feature Coverage (T1-01 .. T1-12)
    // =========================================================================
    console.log('\n--- Tier 1: Feature Coverage ---');

    await runTest('T1-01', async () => {
      const rootRes = await httpRequest({
        baseUrl,
        method: 'GET',
        path: '/',
        headers: { Host: ADMIN_HOST },
      });
      checkEqual(rootRes.status, 200, 'Host: admin.cryptoayin.cn GET / must return 200');
      checkMatch(rootRes.bodyText, /<html|<!DOCTYPE html/i, 'GET / on admin host must return HTML');
      checkMatch(rootRes.bodyText, /管理后台|加载后台配置|admin/i, 'GET / on admin host must render admin page');

      const adminRes = await httpRequest({
        baseUrl,
        method: 'GET',
        path: '/admin',
        headers: { Host: ADMIN_HOST },
      });
      checkEqual(adminRes.status, 200, 'Host: admin.cryptoayin.cn GET /admin must return 200');
      checkMatch(adminRes.bodyText, /管理后台|加载后台配置|admin/i, 'GET /admin on admin host must render admin page');
    });

    await runTest('T1-02', async () => {
      for (const h of [MAIN_HOST, WWW_HOST]) {
        const pageRes = await httpRequest({
          baseUrl,
          method: 'GET',
          path: '/admin',
          headers: { Host: h },
        });
        checkEqual(pageRes.status, 404, `Host: ${h} GET /admin must return HTTP 404`);

        const apiGet = await httpRequest({
          baseUrl,
          method: 'GET',
          path: '/api/admin',
          headers: { Host: h },
        });
        checkEqual(apiGet.status, 404, `Host: ${h} GET /api/admin must return HTTP 404`);

        const apiPost = await httpRequest({
          baseUrl,
          method: 'POST',
          path: '/api/admin',
          headers: { Host: h },
          body: { operation: 'list_commerce' },
        });
        checkEqual(apiPost.status, 404, `Host: ${h} POST /api/admin must return HTTP 404`);
      }
    });

    await runTest('T1-03', async () => {
      for (const p of ['/login', '/studio']) {
        const res = await httpRequest({
          baseUrl,
          method: 'GET',
          path: p,
          headers: { Host: MAIN_HOST },
        });
        checkEqual(res.status, 200, `Host: ${MAIN_HOST} GET ${p} must return HTTP 200`);
      }

      await cdp.clearCookies();
      await cdp.navigate(`${mainOrigin}/login`);
      await ensureCreatorKeyTab(cdp);
      const loginLinks = await cdp.eval(`(() => {
        const links = [...document.querySelectorAll('a[href]')].map((a) => ({
          href: a.getAttribute('href') || '',
          text: (a.innerText || '').trim(),
        }));
        return links.filter((l) => /\\/admin\\b/i.test(l.href) || /管理后台/.test(l.text));
      })()`);
      checkEqual(loginLinks.length, 0, 'Main site /login DOM must have zero /admin nav links');

      await browserCreatorLogin(cdp, mainOrigin, WRITER1_KEY);
      await cdp.navigate(`${mainOrigin}/studio`);
      await cdp.waitFor(`(() => {
        const pill = document.querySelector('.warm-quota-pill');
        return Boolean(pill && /\\$\\d+/.test(pill.innerText || ''));
      })()`, 15_000);
      const studioAdminLinks = await cdp.eval(`(() => {
        const links = [...document.querySelectorAll('a[href], nav button')].map((el) => ({
          href: el.getAttribute('href') || '',
          text: (el.innerText || '').trim(),
        }));
        return links.filter((l) => /\\/admin\\b/i.test(l.href) || /管理后台/.test(l.text));
      })()`);
      checkEqual(studioAdminLinks.length, 0, 'Main site /studio DOM must have zero /admin nav links');
      await cdp.clearCookies();
    });

    await runTest('T1-04', async () => {
      const keyAuth = await apiLogin({ baseUrl, host: ADMIN_HOST, key: ADMIN_KEY });
      checkEqual(keyAuth.res.status, 200, 'login_key with AYIN-ADMIN-8888-KEY must return 200');
      checkEqual(keyAuth.json?.ok, true, 'login_key must return ok: true');
      checkEqual(keyAuth.json?.account?.role, 'admin', 'login_key account role must be admin');
      check(Boolean(keyAuth.cookiePair), 'login_key must set studio_session cookie');

      const adminSnap = await httpRequest({
        baseUrl,
        method: 'GET',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, Cookie: keyAuth.cookiePair },
      });
      checkEqual(adminSnap.status, 200, 'GET /api/admin with admin session cookie must return 200');
      checkEqual(adminSnap.json()?.authorized, true, 'GET /api/admin must return authorized: true');

      const logoutRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/auth',
        headers: { Host: ADMIN_HOST, Cookie: keyAuth.cookiePair },
        body: { action: 'logout' },
      });
      checkEqual(logoutRes.status, 200, 'logout must return 200');
      const clearedCookie = logoutRes.setCookies.join('; ');
      checkMatch(clearedCookie, /Max-Age=0/i, 'logout must expire studio_session cookie with Max-Age=0');

      const afterLogout = await httpRequest({
        baseUrl,
        method: 'GET',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, Cookie: keyAuth.cookiePair },
      });
      checkEqual(afterLogout.status, 401, 'GET /api/admin after logout must return 401');

      const pwdAuth = await apiLogin({
        baseUrl,
        host: ADMIN_HOST,
        username: 'ayin',
        password: ADMIN_PASSWORD,
      });
      checkEqual(pwdAuth.res.status, 200, 'login_password for ayin must return 200');
      checkEqual(pwdAuth.json?.account?.username, 'ayin');
      adminToken = pwdAuth.token;

      const afterPwd = await httpRequest({
        baseUrl,
        method: 'GET',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
      });
      checkEqual(afterPwd.status, 200, 'GET /api/admin after password login must return 200');
    });

    await runTest('T1-05', async () => {
      // Module 1 API CRUD
      const invRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'generate_invites',
          count: 1,
          role: 'creator',
          budgetCapUsd: 25,
          maxUses: 2,
          prefix: 'AYIN-E2E',
          note: 'E2E测试邀请码M1',
        },
      });
      checkEqual(invRes.status, 200, 'generate_invites must return 200');
      const invObj = (invRes.json()?.invites || []).find((i) => i.note === 'E2E测试邀请码M1');
      check(Boolean(invObj?.id), 'Created invite must persist in snapshot');
      createdInviteId = invObj.id;

      const revRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'revoke_invite', id: createdInviteId },
      });
      checkEqual(revRes.status, 200, 'revoke_invite must return 200');
      const revoked = (revRes.json()?.invites || []).find((i) => i.id === createdInviteId);
      checkEqual(revoked?.status, 'revoked', 'revoke_invite must toggle status to revoked');

      const accRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'create_account',
          username: 'e2e_member_01',
          displayName: 'E2E编剧成员',
          password: 'MemberPass!2026',
          role: 'creator',
          budgetCapUsd: 30,
          note: 'E2E模块1账号',
        },
      });
      checkEqual(accRes.status, 200, 'create_account must return 200');
      const createdAcc = (accRes.json()?.accounts || []).find((a) => a.username === 'e2e_member_01');
      check(Boolean(createdAcc?.id), 'Created account must appear in accounts snapshot');
      createdAccountId = createdAcc.id;
      const oldAccessKey = createdAcc.accessKey;

      const updRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'update_account',
          id: createdAccountId,
          displayName: 'E2E编剧成员-已更新',
          budgetCapUsd: 45,
        },
      });
      checkEqual(updRes.status, 200, 'update_account must return 200');
      const updatedAcc = (updRes.json()?.accounts || []).find((a) => a.id === createdAccountId);
      checkEqual(updatedAcc?.displayName, 'E2E编剧成员-已更新');
      checkEqual(updatedAcc?.budgetCapUsd, 45);

      const regenRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'regenerate_key', id: createdAccountId },
      });
      checkEqual(regenRes.status, 200, 'regenerate_key must return 200');
      const regenAcc = (regenRes.json()?.accounts || []).find((a) => a.id === createdAccountId);
      checkNotEqual(regenAcc?.accessKey, oldAccessKey, 'regenerate_key must rotate accessKey');

      // Chrome UI check for Module 1
      await cdp.clearCookies();
      await browserAdminLogin(cdp, adminOrigin, ADMIN_KEY);
      await clickAdminModule(cdp, MODULE_DEFS[0]);
      const uiText = await cdp.eval('document.body.innerText');
      check(uiText.includes('e2e_member_01'), 'Module 1 UI must display created account e2e_member_01');

      // Clean up temporary invite & account via API
      const delInv = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'delete_invite', id: createdInviteId },
      });
      checkEqual(delInv.status, 200, 'delete_invite must return 200');
      check(!(delInv.json()?.invites || []).some((i) => i.id === createdInviteId), 'Deleted invite must be removed');

      const delAcc = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'delete_account', id: createdAccountId },
      });
      checkEqual(delAcc.status, 200, 'delete_account must return 200');
      check(!(delAcc.json()?.accounts || []).some((a) => a.id === createdAccountId), 'Deleted account must be removed');
    });

    await runTest('T1-06', async () => {
      const saveRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'save_provider',
          provider: {
            id: 'prov-e2e-t1',
            name: 'E2E测试渠道T1',
            vendor: 'custom',
            baseUrl: 'https://relay.example.invalid/v1',
            models: ['gpt-4o', 'gemini-2.5-pro'],
            enabled: true,
            note: 'E2E Tier1 provider',
          },
        },
      });
      checkEqual(saveRes.status, 200, 'save_provider must return 200');
      const getSnap = await httpRequest({
        baseUrl,
        method: 'GET',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
      });
      const prov = (getSnap.json()?.systemConfig?.providers || []).find((p) => p.id === 'prov-e2e-t1');
      checkEqual(prov?.name, 'E2E测试渠道T1', 'Saved provider must persist in GET /api/admin');

      await cdp.navigate(`${adminOrigin}/`);
      await cdp.waitFor(ADMIN_SHELL_READY_PREDICATE, 15_000);
      await clickAdminModule(cdp, MODULE_DEFS[1]);
      const mod2Text = await cdp.eval('document.body.innerText');
      check(mod2Text.includes('E2E测试渠道T1'), 'Module 2 UI must display saved provider');

      const delRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'delete_provider', id: 'prov-e2e-t1' },
      });
      checkEqual(delRes.status, 200, 'delete_provider must return 200');
      check(
        !(delRes.json()?.systemConfig?.providers || []).some((p) => p.id === 'prov-e2e-t1'),
        'Deleted provider must not remain in snapshot'
      );
    });

    await runTest('T1-07', async () => {
      const stations = ['director', 'analyst', 'vision', 'planner', 'writer', 'polisher'];
      const routesPayload = {};
      for (const st of stations) {
        routesPayload[st] = {
          temperature: 0.45,
          maxTokens: 4096,
          systemPrompt: `E2E工位提示词_${st}`,
        };
      }
      const saveRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'save_routes', routes: routesPayload },
      });
      checkEqual(saveRes.status, 200, 'save_routes for all 6 stations must return 200');

      const snap = (
        await httpRequest({
          baseUrl,
          method: 'GET',
          path: '/api/admin',
          headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        })
      ).json();
      for (const st of stations) {
        checkEqual(snap?.systemConfig?.routes?.[st]?.temperature, 0.45, `Station ${st} temperature persisted`);
        checkEqual(snap?.systemConfig?.routes?.[st]?.maxTokens, 4096, `Station ${st} maxTokens persisted`);
      }

      await clickAdminModule(cdp, MODULE_DEFS[2]);
      const mod3Text = await cdp.eval('document.body.innerText');
      checkMatch(mod3Text, /总编剧|分集编剧|精修/, 'Module 3 UI must render 6 AI writer station panels');
    });

    await runTest('T1-08', async () => {
      const cfgRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'save_system_config',
          allowInviteRegistration: false,
          globalBudgetCapUsd: 666,
        },
      });
      checkEqual(cfgRes.status, 200, 'save_system_config must return 200');
      checkEqual(cfgRes.json()?.systemConfig?.allowInviteRegistration, false);
      checkEqual(cfgRes.json()?.systemConfig?.globalBudgetCapUsd, 666);

      // Restore allowInviteRegistration = true
      await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'save_system_config', allowInviteRegistration: true },
      });

      const snap = (
        await httpRequest({
          baseUrl,
          method: 'GET',
          path: '/api/admin',
          headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        })
      ).json();
      check(Array.isArray(snap?.projectsSummary), 'GET /api/admin must return projectsSummary array');
      check(Array.isArray(snap?.auditLogs), 'GET /api/admin must return auditLogs array');

      const clearRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'clear_audit_logs' },
      });
      checkEqual(clearRes.status, 200, 'clear_audit_logs must return 200');
      checkEqual(clearRes.json()?.auditLogs?.length, 0, 'clear_audit_logs must empty auditLogs');

      await clickAdminModule(cdp, MODULE_DEFS[3]);
      const mod4Text = await cdp.eval('document.body.innerText');
      checkMatch(mod4Text, /全站|审计日志|安全/, 'Module 4 UI must render monitor, security & audit log panels');
    });

    await runTest('T1-09', async () => {
      const upRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'upload_skill_plugin',
          kind: 'foreign',
          slot: 'primary',
          name: 'E2E出海短剧插件',
          description: 'Tier1技能插件测试',
          fileName: 'e2e-foreign.md',
          content: '# E2E Skill\nKeep pacing tight in episode 1.',
          enabled: true,
          isDefault: false,
        },
      });
      checkEqual(upRes.status, 200, 'upload_skill_plugin must return 200');
      const skill = (upRes.json()?.systemConfig?.skillPlugins || []).find((p) => p.name === 'E2E出海短剧插件');
      check(Boolean(skill?.id), 'Uploaded skill plugin must persist in snapshot');
      createdSkillId = skill.id;

      const defRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'set_default_skill_plugin', id: createdSkillId, isDefault: true },
      });
      checkEqual(defRes.status, 200, 'set_default_skill_plugin must return 200');
      checkEqual(
        (defRes.json()?.systemConfig?.skillPlugins || []).find((p) => p.id === createdSkillId)?.isDefault,
        true
      );

      const repRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'replace_skill_plugin',
          id: createdSkillId,
          name: 'E2E出海短剧插件-v2',
          content: '# Updated Skill\nEpisode 1 hook under 3 seconds.',
        },
      });
      checkEqual(repRes.status, 200, 'replace_skill_plugin must return 200');
      checkEqual(
        (repRes.json()?.systemConfig?.skillPlugins || []).find((p) => p.id === createdSkillId)?.name,
        'E2E出海短剧插件-v2'
      );

      const togRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'toggle_skill_plugin', id: createdSkillId, enabled: false },
      });
      checkEqual(togRes.status, 200, 'toggle_skill_plugin must return 200');
      checkEqual(
        (togRes.json()?.systemConfig?.skillPlugins || []).find((p) => p.id === createdSkillId)?.enabled,
        false
      );

      await cdp.navigate(`${adminOrigin}/`);
      await cdp.waitFor(ADMIN_SHELL_READY_PREDICATE, 15_000);
      await clickAdminModule(cdp, MODULE_DEFS[4]);
      const mod5Text = await cdp.eval('document.body.innerText');
      check(mod5Text.includes('E2E出海短剧插件-v2'), 'Module 5 UI must display uploaded skill plugin');

      const delRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'delete_skill_plugin', id: createdSkillId },
      });
      checkEqual(delRes.status, 200, 'delete_skill_plugin must return 200');
    });

    await runTest('T1-10', async () => {
      const initialSnap = (
        await httpRequest({
          baseUrl,
          method: 'GET',
          path: '/api/admin',
          headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        })
      ).json();
      const tiers = JSON.parse(JSON.stringify(initialSnap?.systemConfig?.creationTiers || []));
      check(tiers.length > 0, 'Default creationTiers must be non-empty');
      tiers[0].costHint = 'E2E-1.2x标准';

      const saveRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'save_creation_tiers', creationTiers: tiers },
      });
      checkEqual(saveRes.status, 200, 'save_creation_tiers must return 200');
      checkEqual(
        saveRes.json()?.systemConfig?.creationTiers?.[0]?.costHint,
        'E2E-1.2x标准',
        'Creation tier update must persist'
      );

      await cdp.navigate(`${adminOrigin}/`);
      await cdp.waitFor(ADMIN_SHELL_READY_PREDICATE, 15_000);
      await clickAdminModule(cdp, MODULE_DEFS[5]);
      const mod6Text = await cdp.eval('document.body.innerText');
      check(mod6Text.includes('E2E-1.2x标准'), 'Module 6 UI must render updated creation tier costHint');
    });

    await runTest('T1-11', async () => {
      const savePlanRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'save_plans',
          plan: {
            name: 'E2E专享创作包',
            description: 'Tier1测试套餐',
            kind: 'topup',
            period: 'once',
            priceUsd: 19,
            creditUsd: 24,
            enabled: true,
            order: 9,
          },
        },
      });
      checkEqual(savePlanRes.status, 200, 'save_plans valid payload must return 200');
      const savedPlan = savePlanRes.json()?.savedPlan;
      check(Boolean(savedPlan?.id), 'savedPlan must return created plan id');
      checkEqual(savedPlan?.name, 'E2E专享创作包');
      checkEqual(savedPlan?.enabled, true);
      checkEqual(savedPlan?.period, 'once');
      createdPlanId = savedPlan.id;

      // Update plan
      const updatePlanRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'save_plans',
          plan: {
            id: createdPlanId,
            name: 'E2E专享创作包-已调价',
            kind: 'topup',
            period: 'once',
            priceUsd: 20,
            creditUsd: 25,
            enabled: true,
          },
        },
      });
      checkEqual(updatePlanRes.status, 200, 'save_plans update must return 200');
      checkEqual(updatePlanRes.json()?.savedPlan?.creditUsd, 25);

      await cdp.navigate(`${adminOrigin}/`);
      await cdp.waitFor(ADMIN_SHELL_READY_PREDICATE, 15_000);
      await clickAdminModule(cdp, MODULE_DEFS[6]);
      const mod7Check = await cdp.eval(`(() => {
        const text = document.body.innerText || '';
        const optionVals = [...document.querySelectorAll('select option')].map((o) => o.value);
        return {
          hasPlanName: text.includes('E2E专享创作包-已调价'),
          optionVals,
        };
      })()`);
      check(mod7Check.hasPlanName, 'Module 7 UI must display saved plan name (using CommercePlan.name, not planName)');
      check(!mod7Check.optionVals.includes('one_time'), 'Module 7 UI must not contain legacy invalid period one_time');
      check(!mod7Check.optionVals.includes('quarterly'), 'Module 7 UI must not contain legacy invalid period quarterly');
    });

    await runTest('T1-12', async () => {
      const wLogin = await apiLogin({ baseUrl, host: MAIN_HOST, key: WRITER1_KEY });
      checkEqual(wLogin.res.status, 200, 'writer01 login must succeed');
      writerToken = wLogin.token;
      const beforeCap = Number(wLogin.json?.account?.budgetCapUsd || 0);

      const ordRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/purchase',
        headers: { Host: MAIN_HOST, 'x-studio-token': writerToken },
        body: { planId: createdPlanId, paymentChannel: 'manual_admin' },
      });
      checkEqual(ordRes.status, 200, 'POST /api/purchase must return 200');
      paidOrderId = ordRes.json()?.order?.id;
      check(Boolean(paidOrderId), 'Created pending order must return order id');

      const listRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'list_commerce' },
      });
      checkEqual(listRes.status, 200, 'list_commerce must return 200');
      check((listRes.json()?.orders || []).some((o) => o.id === paidOrderId && o.status === 'pending'));

      const conf1 = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'confirm_order', orderId: paidOrderId },
      });
      checkEqual(conf1.status, 200, 'confirm_order must return 200');
      checkEqual(conf1.json()?.alreadyPaid, false, 'First confirm_order must have alreadyPaid: false');
      checkEqual(conf1.json()?.confirmedOrder?.status, 'paid');
      checkEqual(conf1.json()?.accountBudgetCapUsd, beforeCap + 25, 'confirm_order must credit exact creditUsd');

      // Idempotency check
      const conf2 = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'confirm_order', orderId: paidOrderId },
      });
      checkEqual(conf2.status, 200, 'Second confirm_order must return 200');
      checkEqual(conf2.json()?.alreadyPaid, true, 'Second confirm_order must be idempotent (alreadyPaid: true)');
      checkEqual(conf2.json()?.accountBudgetCapUsd, beforeCap + 25, 'Second confirm_order must not double-credit');

      await cdp.navigate(`${adminOrigin}/`);
      await cdp.waitFor(ADMIN_SHELL_READY_PREDICATE, 15_000);
      await clickAdminModule(cdp, MODULE_DEFS[7]);
      const mod8Text = await cdp.eval('document.body.innerText');
      check(mod8Text.includes(paidOrderId), 'Module 8 UI must display confirmed order ID');
    });

    // =========================================================================
    // TIER 2 — Boundary & Corner Cases (T2-01, T2-03 .. T2-08; T2-02 on Server #2)
    // =========================================================================
    console.log('\n--- Tier 2: Boundary & Corner Cases ---');

    await runTest('T2-01', async () => {
      const fwdAdminPort = await httpRequest({
        baseUrl,
        method: 'GET',
        path: '/',
        headers: { Host: '127.0.0.1', 'X-Forwarded-Host': `${ADMIN_HOST}:443` },
      });
      checkEqual(fwdAdminPort.status, 200, 'X-Forwarded-Host admin.cryptoayin.cn:443 / must return 200');

      const fwdMainPort = await httpRequest({
        baseUrl,
        method: 'GET',
        path: '/admin',
        headers: { Host: '127.0.0.1', 'X-Forwarded-Host': `${MAIN_HOST}:3199` },
      });
      checkEqual(fwdMainPort.status, 404, 'X-Forwarded-Host cryptoayin.cn:3199 /admin must return 404');

      const fwdComma = await httpRequest({
        baseUrl,
        method: 'GET',
        path: '/',
        headers: { Host: '127.0.0.1', 'X-Forwarded-Host': `${ADMIN_HOST}:443, 10.0.0.1` },
      });
      checkEqual(fwdComma.status, 200, 'Comma-separated X-Forwarded-Host must use first entry and return 200');

      const upperAdmin = await httpRequest({
        baseUrl,
        method: 'GET',
        path: '/',
        headers: { Host: ADMIN_HOST.toUpperCase() },
      });
      checkEqual(upperAdmin.status, 200, 'Uppercase ADMIN.CRYPTOAYIN.CN / must return 200');

      const upperMain = await httpRequest({
        baseUrl,
        method: 'GET',
        path: '/admin',
        headers: { Host: MAIN_HOST.toUpperCase() },
      });
      checkEqual(upperMain.status, 404, 'Uppercase CRYPTOAYIN.CN /admin must return 404');

      const ipv6Res = await httpRequest({
        baseUrl,
        method: 'GET',
        path: '/api/auth',
        headers: { Host: `[::1]:${hostPort}` },
      });
      checkEqual(ipv6Res.status, 200, 'IPv6 Host [::1]:<port> /api/auth must return 200');
    });

    await runTest('T2-03', async () => {
      const mainPaths = ['/admin/anything', '/admin/orders?x=1', '/api/admin/anything', '/api/admin?op=1'];
      for (const h of [MAIN_HOST, WWW_HOST]) {
        for (const p of mainPaths) {
          const res = await httpRequest({
            baseUrl,
            method: 'GET',
            path: p,
            headers: { Host: h },
          });
          checkEqual(res.status, 404, `Host: ${h} GET ${p} must return 404`);
        }
        const postSub = await httpRequest({
          baseUrl,
          method: 'POST',
          path: '/api/admin/confirm',
          headers: { Host: h },
          body: {},
        });
        checkEqual(postSub.status, 404, `Host: ${h} POST /api/admin/confirm must return 404`);
      }
    });

    await runTest('T2-04', async () => {
      const blockedPages = [
        '/login',
        '/studio',
        '/breakdown',
        '/usage',
        '/subscriptions',
        '/purchase',
        '/orders',
        '/redeem',
        '/profile',
      ];
      for (const p of blockedPages) {
        const res = await httpRequest({
          baseUrl,
          method: 'GET',
          path: p,
          headers: { Host: ADMIN_HOST },
        });
        checkEqual(res.status, 404, `Creator page ${p} on ${ADMIN_HOST} must return 404`);
      }

      for (const apiPath of ['/api/orders', '/api/purchase', '/api/usage']) {
        const res = await httpRequest({
          baseUrl,
          method: 'GET',
          path: apiPath,
          headers: { Host: ADMIN_HOST, 'x-studio-token': writerToken },
        });
        checkEqual(res.status, 404, `Creator API GET ${apiPath} on ${ADMIN_HOST} must return 404`);
      }

      const studioPost = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/studio',
        headers: { Host: ADMIN_HOST, 'x-studio-token': writerToken },
        body: { action: 'list' },
      });
      checkEqual(studioPost.status, 404, `Creator API POST /api/studio on ${ADMIN_HOST} must return 404`);
    });

    await runTest('T2-05', async () => {
      const unauthGet = await httpRequest({
        baseUrl,
        method: 'GET',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST },
      });
      checkEqual(unauthGet.status, 401, 'Unauthenticated GET /api/admin must return 401');
      checkEqual(unauthGet.json()?.error, 'AUTH_REQUIRED');

      const unauthPost = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST },
        body: { operation: 'list_commerce' },
      });
      checkEqual(unauthPost.status, 401, 'Unauthenticated POST /api/admin must return 401');
      checkEqual(unauthPost.json()?.error, 'AUTH_REQUIRED');

      const revLogin = await apiLogin({ baseUrl, host: MAIN_HOST, key: REVIEWER1_KEY });
      checkEqual(revLogin.res.status, 200, 'reviewer01 login must succeed');
      reviewerToken = revLogin.token;

      for (const [roleLabel, tok] of [
        ['creator', writerToken],
        ['reviewer', reviewerToken],
      ]) {
        const g = await httpRequest({
          baseUrl,
          method: 'GET',
          path: '/api/admin',
          headers: { Host: ADMIN_HOST, 'x-studio-token': tok },
        });
        checkEqual(g.status, 401, `${roleLabel} GET /api/admin must return 401`);
        checkEqual(g.json()?.error, 'FORBIDDEN_ADMIN_ONLY', `${roleLabel} GET error must be FORBIDDEN_ADMIN_ONLY`);

        const p = await httpRequest({
          baseUrl,
          method: 'POST',
          path: '/api/admin',
          headers: { Host: ADMIN_HOST, 'x-studio-token': tok },
          body: { operation: 'list_commerce' },
        });
        checkEqual(p.status, 401, `${roleLabel} POST /api/admin must return 401`);
        checkEqual(p.json()?.error, 'FORBIDDEN_ADMIN_ONLY', `${roleLabel} POST error must be FORBIDDEN_ADMIN_ONLY`);
      }
    });

    await runTest('T2-06', async () => {
      seededSecretProviderId = 'prov-e2e-secret';
      const secretKey = 'sk-e2etest-secret-998877665544';
      const secretBackendToken = 'e2e-backend-secret-778899';

      const provRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'save_provider',
          provider: {
            id: seededSecretProviderId,
            name: 'E2E脱敏安全测试渠道',
            vendor: 'custom',
            baseUrl: 'https://secret-relay.example.invalid/v1',
            apiKeys: [secretKey],
            models: ['gpt-4o'],
            enabled: true,
          },
        },
      });
      checkEqual(provRes.status, 200, 'Seeding provider with sk- key must return 200');
      check(!provRes.bodyText.includes(secretKey), 'POST /api/admin save_provider must not echo raw sk- key');
      check(!provRes.bodyText.includes('sk-e2etest-secret'), 'POST /api/admin must not leak sk- prefix secret');

      const cfgRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'save_system_config',
          backendToken: secretBackendToken,
        },
      });
      checkEqual(cfgRes.status, 200, 'Seeding backendToken must return 200');
      check(!cfgRes.bodyText.includes(secretBackendToken), 'POST /api/admin must not echo raw backendToken');

      const getSnapRes = await httpRequest({
        baseUrl,
        method: 'GET',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
      });
      checkEqual(getSnapRes.status, 200);
      const rawJsonText = getSnapRes.bodyText;
      check(!rawJsonText.includes(secretKey), 'GET /api/admin must contain ZERO raw sk- secret');
      check(!rawJsonText.includes(secretBackendToken), 'GET /api/admin must contain ZERO raw backendToken');
      check(!rawJsonText.includes('scrypt$'), 'GET /api/admin must contain ZERO scrypt$ hashes');
      check(!rawJsonText.includes(ADMIN_PASSWORD), 'GET /api/admin must contain ZERO raw admin password');

      const snap = getSnapRes.json();
      const prov = (snap?.systemConfig?.providers || []).find((p) => p.id === seededSecretProviderId);
      check(Boolean(prov), 'Seeded provider must exist in snapshot');
      checkEqual(prov.apiKeyCount, 1, 'Provider apiKeyCount must be 1');
      checkEqual(prov.hasApiKeys, true, 'Provider hasApiKeys must be true');
      check(Array.isArray(prov.apiKeysMasked) && prov.apiKeysMasked.length === 1, 'Provider must expose apiKeysMasked');
      check(prov.apiKeysMasked[0].includes('****'), 'apiKeysMasked entry must be masked with ****');
      checkEqual(prov.apiKeys, undefined, 'Provider must omit raw apiKeys array in GET /api/admin');

      checkEqual(snap?.systemConfig?.hasBackendToken, true, 'systemConfig.hasBackendToken must be true');
      check(Boolean(snap?.systemConfig?.backendTokenMasked), 'systemConfig.backendTokenMasked must be non-empty');
      checkEqual(snap?.systemConfig?.backendToken, undefined, 'systemConfig.backendToken must be omitted');

      for (const acc of snap?.accounts || []) {
        checkEqual(acc.password, '••••••••', `Account ${acc.username} password must be masked`);
      }

      // Creator endpoints must never leak secrets
      for (const creatorEndpoint of ['/api/usage?days=7', '/api/profile', '/api/purchase', '/api/orders', '/api/subscriptions']) {
        const cRes = await httpRequest({
          baseUrl,
          method: 'GET',
          path: creatorEndpoint,
          headers: { Host: MAIN_HOST, 'x-studio-token': writerToken },
        });
        checkEqual(cRes.status, 200, `Creator ${creatorEndpoint} must return 200`);
        check(!cRes.bodyText.includes('sk-e2etest-secret'), `${creatorEndpoint} must not leak sk- secret`);
        check(!cRes.bodyText.includes(secretBackendToken), `${creatorEndpoint} must not leak backendToken`);
        check(!cRes.bodyText.includes('scrypt$'), `${creatorEndpoint} must not leak scrypt$`);
      }

      // Rendered Chrome DOM check across Providers & Monitor modules
      await cdp.navigate(`${adminOrigin}/`);
      await cdp.waitFor(ADMIN_SHELL_READY_PREDICATE, 15_000);
      await clickAdminModule(cdp, MODULE_DEFS[1]);
      const provDom = await cdp.eval(`(() => {
        const vals = [...document.querySelectorAll('input, textarea')].map((el) => el.value || '').join('\\n');
        return document.body.innerHTML + '\\n' + document.body.innerText + '\\n' + vals;
      })()`);
      check(!provDom.includes('sk-e2etest-secret'), 'Admin Providers DOM must contain ZERO raw sk- secret');
      check(!provDom.includes('scrypt$'), 'Admin Providers DOM must contain ZERO scrypt$');

      await clickAdminModule(cdp, MODULE_DEFS[3]);
      const monDom = await cdp.eval(`(() => {
        const vals = [...document.querySelectorAll('input, textarea')].map((el) => el.value || '').join('\\n');
        return document.body.innerHTML + '\\n' + document.body.innerText + '\\n' + vals;
      })()`);
      check(!monDom.includes(secretBackendToken), 'Admin Monitor DOM must contain ZERO raw backendToken');
      check(!monDom.includes('scrypt$'), 'Admin Monitor DOM must contain ZERO scrypt$');
    });

    await runTest('T2-07', async () => {
      const beforeSnap = (
        await httpRequest({
          baseUrl,
          method: 'GET',
          path: '/api/admin',
          headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        })
      ).json();
      const beforeProv = beforeSnap.systemConfig.providers.find((p) => p.id === seededSecretProviderId);
      const maskedKeys = beforeProv.apiKeysMasked;
      const maskedBackend = beforeSnap.systemConfig.backendTokenMasked;

      // 1. save_provider omitting apiKeys
      const pOmit = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'save_provider',
          provider: {
            id: seededSecretProviderId,
            name: beforeProv.name,
            baseUrl: beforeProv.baseUrl,
            models: beforeProv.models,
            note: 'Updated note omitting apiKeys',
          },
        },
      });
      checkEqual(pOmit.status, 200);
      const afterOmit = pOmit.json().systemConfig.providers.find((p) => p.id === seededSecretProviderId);
      checkEqual(afterOmit.apiKeyCount, 1, 'Omitting apiKeys must preserve apiKeyCount');
      checkEqual(afterOmit.hasApiKeys, true, 'Omitting apiKeys must preserve hasApiKeys');
      checkEqual(afterOmit.apiKeysMasked?.[0], maskedKeys[0], 'Omitting apiKeys must preserve apiKeysMasked');

      // 2. save_provider passing masked apiKeysMasked back
      const pMasked = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'save_provider',
          provider: {
            id: seededSecretProviderId,
            name: beforeProv.name,
            baseUrl: beforeProv.baseUrl,
            apiKeys: maskedKeys,
            models: beforeProv.models,
          },
        },
      });
      checkEqual(pMasked.status, 200);
      const afterMasked = pMasked.json().systemConfig.providers.find((p) => p.id === seededSecretProviderId);
      checkEqual(afterMasked.apiKeyCount, 1, 'Passing masked apiKeys must preserve apiKeyCount');
      checkEqual(afterMasked.apiKeysMasked?.[0], maskedKeys[0], 'Passing masked apiKeys must preserve apiKeysMasked');

      // 3. save_system_config omitting backendToken
      const cfgOmit = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'save_system_config', globalBudgetCapUsd: 777 },
      });
      checkEqual(cfgOmit.status, 200);
      checkEqual(cfgOmit.json()?.systemConfig?.hasBackendToken, true, 'Omitting backendToken must preserve hasBackendToken');
      checkEqual(cfgOmit.json()?.systemConfig?.backendTokenMasked, maskedBackend);

      // 4. save_system_config passing masked backendToken
      const cfgMasked = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'save_system_config', backendToken: maskedBackend },
      });
      checkEqual(cfgMasked.status, 200);
      checkEqual(cfgMasked.json()?.systemConfig?.hasBackendToken, true, 'Passing masked backendToken must preserve it');
      checkEqual(cfgMasked.json()?.systemConfig?.backendTokenMasked, maskedBackend);

      // 5. clearBackendToken: true clears it
      const cfgClear = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'save_system_config', clearBackendToken: true },
      });
      checkEqual(cfgClear.status, 200);
      checkEqual(cfgClear.json()?.systemConfig?.hasBackendToken, false, 'clearBackendToken: true must clear backendToken');
      checkEqual(cfgClear.json()?.systemConfig?.backendTokenMasked, '');
    });

    await runTest('T2-08', async () => {
      // Invalid plan period -> 422
      const badPeriod = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'save_plans',
          plan: { name: 'BadPeriod', kind: 'subscription', period: 'quarterly', priceUsd: 10, creditUsd: 10 },
        },
      });
      checkEqual(badPeriod.status, 422, 'save_plans with invalid period must return 422');

      // Invalid plan amount -> 422
      const badPrice = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'save_plans',
          plan: { name: 'BadPrice', kind: 'topup', period: 'once', priceUsd: -5, creditUsd: 10 },
        },
      });
      checkEqual(badPrice.status, 422, 'save_plans with priceUsd <= 0 must return 422');

      // Binary skill plugin -> 400 BINARY_CONTENT_REJECTED
      const binForm = buildMultipartFormData(
        { operation: 'upload_skill_plugin', kind: 'foreign', slot: 'primary', name: 'BinaryTest' },
        {
          filename: 'fake.md',
          contentType: 'application/octet-stream',
          content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        }
      );
      const binRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: {
          Host: ADMIN_HOST,
          'x-studio-token': adminToken,
          'Content-Type': binForm.contentType,
        },
        body: binForm.body,
      });
      checkEqual(binRes.status, 400, 'Binary skill upload must return 400');
      checkEqual(binRes.json()?.error, 'BINARY_CONTENT_REJECTED');

      // Invalid extension -> 400 INVALID_PLUGIN_FILE_TYPE
      const extRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'upload_skill_plugin',
          kind: 'foreign',
          slot: 'primary',
          name: 'BadExt',
          fileName: 'evil.exe',
          content: 'plain text',
        },
      });
      checkEqual(extRes.status, 400, 'Bad skill extension must return 400');
      checkEqual(extRes.json()?.error, 'INVALID_PLUGIN_FILE_TYPE');

      // Transcribe secondary slot -> 400 SLOT_NOT_ALLOWED
      const slotRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'upload_skill_plugin',
          kind: 'transcribe',
          slot: 'secondary',
          name: 'BadSlot',
          fileName: 'badslot.md',
          content: '# Invalid slot',
        },
      });
      checkEqual(slotRes.status, 400, 'transcribe secondary slot must return 400');
      checkEqual(slotRes.json()?.error, 'SLOT_NOT_ALLOWED');

      // Cancel paid order -> 409 PAID_ORDER_CANNOT_CANCEL
      const cancelPaid = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/orders',
        headers: { Host: MAIN_HOST, 'x-studio-token': writerToken },
        body: { action: 'cancel', orderId: paidOrderId },
      });
      checkEqual(cancelPaid.status, 409, 'Cancelling a paid order must return 409');
      checkEqual(cancelPaid.json()?.error, 'PAID_ORDER_CANNOT_CANCEL');
    });

    // =========================================================================
    // TIER 3 — Cross-Feature Combinations (T3-01 .. T3-04)
    // =========================================================================
    console.log('\n--- Tier 3: Cross-Feature Combinations ---');

    await runTest('T3-01', async () => {
      const loginRes = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/auth',
        headers: { Host: ADMIN_HOST },
        body: { action: 'login_key', key: ADMIN_KEY },
      });
      checkEqual(loginRes.status, 200);
      const setCookie = loginRes.setCookies.find((c) => c.startsWith('studio_session=')) || '';
      check(Boolean(setCookie), 'Set-Cookie studio_session must be emitted');
      checkMatch(setCookie, /HttpOnly/i, 'studio_session must include HttpOnly');
      checkMatch(setCookie, /Path=\//i, 'studio_session must include Path=/');
      checkMatch(setCookie, /SameSite=Lax/i, 'studio_session must include SameSite=Lax');
      check(!/\bDomain=/i.test(setCookie), 'studio_session MUST NOT include Domain= so cookie stays host-only');

      // Browser cookie isolation check across admin.cryptoayin.cn vs cryptoayin.cn
      await cdp.clearCookies();
      await browserAdminLogin(cdp, adminOrigin, ADMIN_KEY);

      const adminCookies = await cdp.getCookies([adminOrigin]);
      const mainCookies = await cdp.getCookies([mainOrigin]);
      const adminSessCookie = adminCookies.find((c) => c.name === 'studio_session');
      check(Boolean(adminSessCookie), 'admin.cryptoayin.cn must have studio_session cookie');
      checkEqual(adminSessCookie.domain, ADMIN_HOST, 'Admin cookie domain must be exact host (host-only)');
      checkEqual(adminSessCookie.httpOnly, true);
      checkEqual(
        mainCookies.some((c) => c.name === 'studio_session'),
        false,
        'cryptoayin.cn must NOT receive admin.cryptoayin.cn studio_session cookie'
      );

      // Verify cryptoayin.cn /api/auth reports authenticated: false
      await cdp.navigate(`${mainOrigin}/login`);
      const mainAuthState = await cdp.eval(`(async () => {
        const r = await fetch('/api/auth');
        return r.json();
      })()`);
      checkEqual(mainAuthState?.authenticated, false, 'Main site must NOT be authenticated with admin cookie');

      // Now login as writer01 on main site, then ensure admin cookie deletion leaves admin unauthenticated
      await browserCreatorLogin(cdp, mainOrigin, WRITER1_KEY);
      const mainCookiesAfter = await cdp.getCookies([mainOrigin]);
      const mainSessCookie = mainCookiesAfter.find((c) => c.name === 'studio_session');
      checkEqual(mainSessCookie?.domain, MAIN_HOST, 'Creator cookie domain must be exact host cryptoayin.cn');

      await cdp.send('Network.deleteCookies', { name: 'studio_session', url: adminOrigin });
      await cdp.navigate(`${adminOrigin}/`);
      await cdp.waitFor('Boolean(document.querySelector("form input"))', 15_000);
      const adminNeedsLogin = await cdp.eval('Boolean(document.querySelector("form button[type=submit]"))');
      check(adminNeedsLogin, 'Admin site must require login when admin cookie is removed even if creator is logged in');
    });

    await runTest('T3-02', async () => {
      await cdp.clearCookies();
      await browserCreatorLogin(cdp, mainOrigin, WRITER1_KEY);

      const beforeUsage = (
        await httpRequest({
          baseUrl,
          method: 'GET',
          path: '/api/usage?days=7',
          headers: { Host: MAIN_HOST, 'x-studio-token': writerToken },
        })
      ).json();
      const initialCap = Number(beforeUsage?.kpis?.budgetCapUsd || 0);
      const purchaseCatalog = (
        await httpRequest({
          baseUrl,
          method: 'GET',
          path: '/api/purchase',
          headers: { Host: MAIN_HOST, 'x-studio-token': writerToken },
        })
      ).json();
      const monthlyPlan = (purchaseCatalog?.plans || []).find((p) => p.name === '月度创作会员');
      check(Boolean(monthlyPlan?.creditUsd > 0), '月度创作会员 plan must be active in /api/purchase');

      // Navigate /purchase and submit Monthly plan order
      await cdp.navigate(`${mainOrigin}/purchase`);
      await cdp.waitFor(`(() => (document.body?.innerText || '').includes('月度创作会员'))()`, 15_000);

      await cdp.eval(`(() => {
        const cards = [...document.querySelectorAll('form div')].filter((d) => {
          const t = d.innerText || '';
          return t.includes('月度创作会员') && t.includes('可选购') && !t.includes('已下架') && t.length < 300;
        });
        const target = cards.pop();
        if (!target) throw new Error('Monthly plan card not found');
        target.click();
      })()`);
      await cdp.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');

      await cdp.eval(`(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('提交订单（待管理员确认入账）'));
        if (!btn) throw new Error('Submit purchase order button not found');
        btn.click();
      })()`);

      await cdp.waitFor(`(() => /ord_[a-z0-9]+/i.test(document.body?.innerText || ''))()`, 15_000);
      const purchaseResultText = await cdp.eval('document.body.innerText');
      check(purchaseResultText.includes('待管理员确认入账'), '/purchase must show 待管理员确认入账');
      const orderIdMatch = purchaseResultText.match(/\b(ord_[a-z0-9]+)\b/i);
      check(Boolean(orderIdMatch), 'Purchase page must show created ord_... id');
      const loopOrderId = orderIdMatch[1];

      // Verify on /orders
      await cdp.navigate(`${mainOrigin}/orders`);
      await cdp.waitFor(`(() => (document.body?.innerText || '').includes(${JSON.stringify(loopOrderId)}))()`, 15_000);
      const ordersText = await cdp.eval('document.body.innerText');
      check(ordersText.includes('待管理员确认入账'), '/orders must show pending status 待管理员确认入账');

      // Admin logs in on admin subdomain, goes to Module 8, clicks 确认入账
      await browserAdminLogin(cdp, adminOrigin, ADMIN_KEY);
      await clickAdminModule(cdp, MODULE_DEFS[7]);
      await cdp.waitFor(`(() => (document.body?.innerText || '').includes(${JSON.stringify(loopOrderId)}))()`, 15_000);

      await cdp.eval(`(() => {
        const rows = [...document.querySelectorAll('tr')];
        const targetRow = rows.find((r) => (r.innerText || '').includes(${JSON.stringify(loopOrderId)}));
        if (!targetRow) throw new Error('Pending order row not found in Module 8');
        const btn = [...targetRow.querySelectorAll('button')].find((b) => (b.innerText || '').includes('确认入账'));
        if (!btn) throw new Error('确认入账 button not found in target row');
        btn.click();
      })()`);
      await cdp.waitFor(`(() => {
        if (document.querySelector('[role="dialog"]')) return true;
        const rows = [...document.querySelectorAll('tr')];
        const targetRow = rows.find((r) => (r.innerText || '').includes(${JSON.stringify(loopOrderId)}));
        return Boolean(targetRow && /已(?:确认)?入账|paid/i.test(targetRow.innerText || ''));
      })()`, 5_000).catch(() => {});

      // Handle optional confirmation modal dialog if M2 adds one
      await cdp.eval(`(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (dlg) {
          const confirmBtn = [...dlg.querySelectorAll('button')].find((b) => /确认|确定/.test(b.innerText || ''));
          if (confirmBtn) confirmBtn.click();
        }
      })()`);

      await cdp.waitFor(`(() => {
        const rows = [...document.querySelectorAll('tr')];
        const targetRow = rows.find((r) => (r.innerText || '').includes(${JSON.stringify(loopOrderId)}));
        return Boolean(targetRow && /已(?:确认)?入账|paid/i.test(targetRow.innerText || ''));
      })()`, 15_000);

      // Creator refreshes /usage and /subscriptions on cryptoayin.cn
      await cdp.navigate(`${mainOrigin}/usage`);
      await cdp.waitFor(`(() => {
        const pill = document.querySelector('.warm-quota-pill')?.innerText || '';
        const text = document.body?.innerText || '';
        return /\\$\\d+(?:\\.\\d+)?/.test(pill) && text.includes('总额度 $') && !text.includes('总额度 $0.00');
      })()`, 15_000);
      const afterUsageText = await cdp.eval('document.body.innerText');
      const pillText = await cdp.eval('document.querySelector(".warm-quota-pill")?.innerText || ""');
      checkMatch(pillText, /\$\d+(?:\.\d+)?/, 'WarmShell .warm-quota-pill must show updated USD quota');

      const afterUsageApi = (
        await httpRequest({
          baseUrl,
          method: 'GET',
          path: '/api/usage?days=7',
          headers: { Host: MAIN_HOST, 'x-studio-token': writerToken },
        })
      ).json();
      const expectedCap = Math.round((initialCap + Number(monthlyPlan.creditUsd)) * 10000) / 10000;
      checkEqual(
        afterUsageApi?.kpis?.budgetCapUsd,
        expectedCap,
        `budgetCapUsd must increase by exact creditUsd (+${monthlyPlan.creditUsd})`
      );
      check(afterUsageText.includes(`$${expectedCap.toFixed(2)}`), '/usage UI must reflect updated total budgetCapUsd');

      await cdp.navigate(`${mainOrigin}/subscriptions`);
      await cdp.waitFor(`(() => (document.body?.innerText || '').includes('月度创作会员'))()`, 15_000);
      const subsText = await cdp.eval('document.body.innerText');
      check(subsText.includes('生效中'), '/subscriptions UI must show 生效中 for activated monthly subscription');
    });

    await runTest('T3-03', async () => {
      await cdp.clearCookies();
      await cdp.navigate(`${adminOrigin}/`);
      await cdp.waitFor('Boolean(document.querySelector("form input"))', 15_000);

      // Check pre-auth foreground link
      const preAuthLinks = await cdp.eval(`(() => {
        return [...document.querySelectorAll('a[href]')].map((a) => ({
          text: (a.innerText || '').trim(),
          href: a.href,
        })).filter((l) => /创作者前台|返回前台|前台/.test(l.text));
      })()`);
      check(preAuthLinks.length > 0, 'Pre-auth admin gate must have a link to creator foreground');
      for (const l of preAuthLinks) {
        check(
          l.href.startsWith(mainOrigin) && !l.href.includes(ADMIN_HOST),
          `Pre-auth foreground link must point to ${mainOrigin}, got ${l.href}`
        );
      }

      await browserAdminLogin(cdp, adminOrigin, ADMIN_KEY);
      const authLinks = await cdp.eval(`(() => {
        return [...document.querySelectorAll('a[href]')].map((a) => ({
          text: (a.innerText || '').trim(),
          href: a.href,
        })).filter((l) => /创作者前台|前往前台|返回前台/.test(l.text));
      })()`);
      check(authLinks.length > 0, 'Authenticated admin shell must have a foreground link');
      for (const l of authLinks) {
        check(
          l.href.startsWith(mainOrigin) && !l.href.includes(ADMIN_HOST),
          `Authenticated foreground link must point to ${mainOrigin}, got ${l.href}`
        );
      }

      // Spy on navigator.clipboard.writeText for invite & account copy cards in Module 1
      await clickAdminModule(cdp, MODULE_DEFS[0]);
      await cdp.eval(`(() => {
        window.__e2eCopied = [];
        const stub = async (txt) => { window.__e2eCopied.push(String(txt)); };
        if (!navigator.clipboard) {
          Object.defineProperty(navigator, 'clipboard', { value: { writeText: stub }, configurable: true });
        } else {
          navigator.clipboard.writeText = stub;
        }
      })()`);

      await cdp.eval(`(() => {
        const invBtn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('复制邀请函'));
        if (!invBtn) throw new Error('Copy invite button not found');
        invBtn.click();
        const accBtn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('复制完整登录卡'));
        if (!accBtn) throw new Error('Copy account card button not found');
        accBtn.click();
      })()`);
      await cdp.waitFor('Array.isArray(window.__e2eCopied) && window.__e2eCopied.length >= 2', 5_000);

      const copiedItems = await cdp.eval('window.__e2eCopied || []');
      checkEqual(copiedItems.length, 2, 'Clicking invite & account copy buttons must write 2 cards to clipboard');
      for (const txt of copiedItems) {
        check(txt.includes(mainOrigin), `Copied card must contain main-site origin ${mainOrigin}; got: ${txt}`);
        check(!txt.includes(ADMIN_HOST), `Copied card MUST NOT leak admin origin ${ADMIN_HOST}`);
      }
    });

    await runTest('T3-04', async () => {
      const comboProvId = 'prov-e2e-combo';
      const pCreate = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'save_provider',
          provider: {
            id: comboProvId,
            name: 'E2E联动渠道',
            vendor: 'custom',
            baseUrl: 'https://combo-relay.example.invalid/v1',
            apiKeys: ['sk-e2etest-combo-112233445566'],
            models: ['gpt-4o', 'gemini-2.5-pro'],
            enabled: true,
          },
        },
      });
      checkEqual(pCreate.status, 200);
      const createdMasked = pCreate.json().systemConfig.providers.find((p) => p.id === comboProvId)?.apiKeysMasked;
      check(Array.isArray(createdMasked) && createdMasked.length === 1);

      // Bind director & writer routes to combo provider
      const rSave = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'save_routes',
          routes: {
            director: { primaryProviderId: comboProvId, primaryModel: 'gpt-4o' },
            writer: { primaryProviderId: comboProvId, primaryModel: 'gemini-2.5-pro' },
          },
        },
      });
      checkEqual(rSave.status, 200);

      // Bind creation tier to combo provider
      const tiers = JSON.parse(JSON.stringify(rSave.json().systemConfig.creationTiers || []));
      tiers[0].providerId = comboProvId;
      tiers[0].model = 'gemini-2.5-pro';
      const tSave = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: { operation: 'save_creation_tiers', creationTiers: tiers },
      });
      checkEqual(tSave.status, 200);

      // Partial save_provider updating note/models without raw keys
      const pPartial = await httpRequest({
        baseUrl,
        method: 'POST',
        path: '/api/admin',
        headers: { Host: ADMIN_HOST, 'x-studio-token': adminToken },
        body: {
          operation: 'save_provider',
          provider: {
            id: comboProvId,
            name: 'E2E联动渠道-更新',
            baseUrl: 'https://combo-relay.example.invalid/v1',
            models: ['gpt-4o', 'gemini-2.5-pro', 'gemini-2.5-flash'],
            note: 'Combo partial update',
          },
        },
      });
      checkEqual(pPartial.status, 200);
      const snap = pPartial.json();
      const comboProv = snap.systemConfig.providers.find((p) => p.id === comboProvId);
      checkEqual(comboProv?.apiKeyCount, 1, 'Partial save must preserve apiKeyCount');
      checkEqual(comboProv?.apiKeysMasked?.[0], createdMasked[0], 'Partial save must preserve apiKeysMasked');
      checkEqual(snap.systemConfig.routes?.director?.primaryProviderId, comboProvId);
      checkEqual(snap.systemConfig.routes?.writer?.primaryProviderId, comboProvId);
      checkEqual(snap.systemConfig.creationTiers?.[0]?.providerId, comboProvId);
      checkEqual(snap.systemConfig.creationTiers?.[0]?.model, 'gemini-2.5-pro');
    });

    // =========================================================================
    // TIER 4 — Real-World Visual & Responsive Scenarios via Chrome CDP (T4-01 .. T4-05)
    // =========================================================================
    console.log('\n--- Tier 4: Visual & Responsive Scenarios (Chrome CDP) ---');

    await runTest('T4-01', async () => {
      await cdp.clearCookies();
      await cdp.setViewport(1440, 900, false);
      cdp.resetIssues();

      await cdp.navigate(`${adminOrigin}/`);
      await cdp.waitFor('Boolean(document.querySelector("form input"))', 15_000);
      const wasDark = await cdp.eval(`(() => {
        const darkBefore =
          document.documentElement.getAttribute('data-theme') === 'dark' ||
          localStorage.getItem('studio_theme') === 'dark';
        localStorage.setItem('studio_theme', 'light');
        return darkBefore;
      })()`);
      if (wasDark) {
        await cdp.navigate(`${adminOrigin}/`);
        await cdp.waitFor('Boolean(document.querySelector("form input"))', 15_000);
      }
      await cdp.screenshot('admin-login-desktop-light.png');

      const loginCheck = await inspectAdminVisualState(cdp, 'light');
      checkEqual(loginCheck.overflow, false, `Login desktop light horizontal overflow: ${loginCheck.scrollWidth}>${loginCheck.clientWidth}`);
      checkEqual(loginCheck.forbiddenHits.length, 0, `Login gate forbidden legacy colors: ${JSON.stringify(loginCheck.forbiddenHits)}`);
      check(['#f9f6f0', '#f6f2ea'].includes(loginCheck.vars.bgPaper), `Light --bg-paper mismatch: ${loginCheck.vars.bgPaper}`);
      checkEqual(loginCheck.vars.accentCinnabar, '#8c3b2b', `Light --accent-cinnabar mismatch: ${loginCheck.vars.accentCinnabar}`);
      checkEqual(loginCheck.vars.accentGold, '#d49b54', `Light --accent-gold mismatch: ${loginCheck.vars.accentGold}`);
      check(Boolean(loginCheck.bodyBg), `Login bodyBg must be parseable RGB, got ${JSON.stringify(loginCheck.bodyBg)}`);
      check(
        loginCheck.bodyBg.r >= 235 && loginCheck.bodyBg.g >= 230 && loginCheck.bodyBg.b >= 220 &&
          loginCheck.bodyBg.r >= loginCheck.bodyBg.g && loginCheck.bodyBg.g >= loginCheck.bodyBg.b,
        `Login bodyBg must be warm paper RGB (R>=G>=B), got ${JSON.stringify(loginCheck.bodyBg)}`
      );

      // Authenticate and check shell
      await browserAdminLogin(cdp, adminOrigin, ADMIN_KEY);
      await cdp.screenshot('admin-desktop-light.png');
      const shellCheck = await inspectAdminVisualState(cdp, 'light');
      checkEqual(shellCheck.overflow, false, `Admin desktop light horizontal overflow: ${shellCheck.scrollWidth}>${shellCheck.clientWidth}`);
      checkEqual(shellCheck.forbiddenHits.length, 0, `Admin shell forbidden legacy colors: ${JSON.stringify(shellCheck.forbiddenHits)}`);
      check(Boolean(shellCheck.bodyBg), `Admin shell bodyBg must be parseable RGB, got ${JSON.stringify(shellCheck.bodyBg)}`);
      check(
        shellCheck.bodyBg.r >= 235 && shellCheck.bodyBg.g >= 230 && shellCheck.bodyBg.b >= 220 &&
          shellCheck.bodyBg.r >= shellCheck.bodyBg.g && shellCheck.bodyBg.g >= shellCheck.bodyBg.b,
        `Admin shell bodyBg must be warm paper RGB, got ${JSON.stringify(shellCheck.bodyBg)}`
      );
      cdp.assertNoIssues('T4-01 Desktop Light');
    });

    await runTest('T4-02', async () => {
      await cdp.setViewport(1440, 900, false);
      cdp.resetIssues();

      const keyScreenshots = new Set(['routes', 'skills', 'plans', 'orders']);
      for (const mod of MODULE_DEFS) {
        await clickAdminModule(cdp, mod);
        const st = await inspectAdminVisualState(cdp, 'light');
        checkEqual(st.overflow, false, `Desktop Light ${mod.key} overflow (${st.scrollWidth}>${st.clientWidth})`);
        check(
          st.maxPanel.width > 200 && st.maxPanel.height > 100,
          `Desktop Light ${mod.key} panel bounding box too small: ${JSON.stringify(st.maxPanel)}`
        );
        checkEqual(st.forbiddenHits.length, 0, `Desktop Light ${mod.key} legacy colors: ${JSON.stringify(st.forbiddenHits)}`);
        checkEqual(st.hasRawSk, false, `Desktop Light ${mod.key} must have ZERO raw sk- secrets in DOM`);
        checkEqual(st.hasScrypt, false, `Desktop Light ${mod.key} must have ZERO scrypt$ in DOM`);

        if (keyScreenshots.has(mod.key)) {
          await cdp.screenshot(`admin-module-${mod.key}-desktop-light.png`);
        }
      }
      cdp.assertNoIssues('T4-02 Desktop 8 Modules');
    });

    await runTest('T4-03', async () => {
      await cdp.setViewport(1440, 900, false);
      cdp.resetIssues();

      const toggled = await cdp.eval(`(() => {
        const btn = document.querySelector('button[aria-label*="主题"], button[aria-label*="暗色"], button[aria-label*="浅色"], button[title*="主题"], [data-testid="theme-toggle"]') ||
          [...document.querySelectorAll('button')].find((b) => /深墨|暗色|夜间|切换.*主题/.test((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')));
        if (!btn) return false;
        btn.click();
        return true;
      })()`);
      check(toggled, 'Theme toggle button must exist on admin shell');
      await cdp.waitFor('document.documentElement.getAttribute("data-theme") === "dark"', 5_000);

      const darkState = await inspectAdminVisualState(cdp, 'dark');
      checkEqual(darkState.htmlTheme, 'dark', 'documentElement[data-theme] must become dark');
      checkEqual(darkState.storedTheme, 'dark', 'localStorage.studio_theme must become dark');
      checkEqual(darkState.vars.bgPaper, '#161412', `Dark --bg-paper must be #161412, got ${darkState.vars.bgPaper}`);
      checkEqual(darkState.vars.bgSidebar, '#1b1815', `Dark --bg-sidebar must be #1b1815, got ${darkState.vars.bgSidebar}`);
      checkEqual(darkState.vars.bgSurface, '#1f1c19', `Dark --bg-surface must be #1f1c19, got ${darkState.vars.bgSurface}`);
      checkEqual(darkState.vars.accentCinnabar, '#b25440', `Dark --accent-cinnabar must be #b25440, got ${darkState.vars.accentCinnabar}`);
      checkEqual(darkState.vars.textPrimary, '#efe9e0', `Dark --text-primary must be #efe9e0, got ${darkState.vars.textPrimary}`);
      check(Boolean(darkState.bodyBg), `Dark bodyBg must be parseable RGB, got ${JSON.stringify(darkState.bodyBg)}`);
      check(
        darkState.bodyBg.r <= 40 && darkState.bodyBg.g <= 36 && darkState.bodyBg.b <= 32 &&
          darkState.bodyBg.r >= darkState.bodyBg.g && darkState.bodyBg.g >= darkState.bodyBg.b,
        `Dark bodyBg must be warm-ink RGB (R>=G>=B), got ${JSON.stringify(darkState.bodyBg)}`
      );
      checkEqual(darkState.overflow, false, 'Desktop Dark must have zero horizontal overflow');
      checkEqual(darkState.forbiddenHits.length, 0, `Desktop Dark legacy colors: ${JSON.stringify(darkState.forbiddenHits)}`);

      await cdp.screenshot('admin-desktop-dark.png');

      // Toggle back to light
      await cdp.eval(`(() => {
        const btn = document.querySelector('button[aria-label*="主题"], button[aria-label*="暗色"], button[aria-label*="浅色"], button[title*="主题"], [data-testid="theme-toggle"]') ||
          [...document.querySelectorAll('button')].find((b) => /暖纸|浅色|日间|切换.*主题/.test((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')));
        if (btn) btn.click();
      })()`);
      await cdp.waitFor('document.documentElement.getAttribute("data-theme") === "light"', 5_000);
      const backLight = await inspectAdminVisualState(cdp, 'light');
      checkEqual(backLight.htmlTheme, 'light', 'Toggling theme again must return data-theme to light');
      cdp.assertNoIssues('T4-03 Desktop Dark');
    });

    await runTest('T4-04', async () => {
      await cdp.setViewport(390, 844, true);
      cdp.resetIssues();
      await cdp.waitFor('document.documentElement.clientWidth <= 390', 5_000);
      await cdp.waitFor(`(() => {
        const sidebar = document.querySelector('aside, .warm-sidebar, .admin-sidebar, [data-testid="admin-sidebar"]');
        if (!sidebar) return true;
        const st = getComputedStyle(sidebar);
        if (st.display === 'none' || st.visibility === 'hidden') return true;
        return sidebar.getBoundingClientRect().right <= 2;
      })()`, 2_000).catch(() => {});

      const initMobile = await cdp.eval(`(() => {
        const menuBtn = (${MOBILE_MENU_FINDER_JS})();
        const btnRect = menuBtn ? menuBtn.getBoundingClientRect() : null;
        const btnStyle = menuBtn ? getComputedStyle(menuBtn) : null;
        const sidebar = document.querySelector('aside, .warm-sidebar, .admin-sidebar, [data-testid="admin-sidebar"]');
        const sideRect = sidebar ? sidebar.getBoundingClientRect() : null;
        const sideStyle = sidebar ? getComputedStyle(sidebar) : null;
        return {
          menuVisible: Boolean(btnRect && btnStyle && btnStyle.display !== 'none' && btnRect.width > 0 && btnRect.height > 0 && btnRect.left >= 0),
          sidebarHidden: Boolean(!sidebar || sideStyle.display === 'none' || sideRect.right <= 2),
          clientWidth: document.documentElement.clientWidth,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      })()`);
      check(initMobile.menuVisible, 'Mobile menu toggle button must be visible at 390x844');
      check(initMobile.sidebarHidden, 'Sidebar must initially be off-canvas/hidden at 390x844');
      check(initMobile.clientWidth <= 390, `Mobile Light clientWidth must be <= 390, got ${initMobile.clientWidth}`);
      checkEqual(initMobile.overflow, false, 'Mobile Light initial view must have zero horizontal overflow');
      await cdp.screenshot('admin-mobile-light.png');

      // Open mobile drawer
      const clickedDrawerBtn = await cdp.eval(`(() => {
        const menuBtn = (${MOBILE_MENU_FINDER_JS})();
        if (!menuBtn) return false;
        menuBtn.click();
        return true;
      })()`);
      check(clickedDrawerBtn, 'Mobile menu toggle button must be clickable to open drawer');
      await cdp.waitFor(`(() => {
        const sidebar = document.querySelector('aside, .warm-sidebar, .admin-sidebar, [data-testid="admin-sidebar"]');
        if (!sidebar) return false;
        const r = sidebar.getBoundingClientRect();
        return r.left >= -2 && r.right > 150;
      })()`, 5_000);
      const drawerState = await cdp.eval(`(() => {
        const sidebar = document.querySelector('aside, .warm-sidebar, .admin-sidebar, [data-testid="admin-sidebar"]');
        const r = sidebar ? sidebar.getBoundingClientRect() : null;
        return r ? { left: r.left, right: r.right, width: r.width } : null;
      })()`);
      check(Boolean(drawerState && drawerState.left >= -2 && drawerState.right > 150), `Mobile drawer must open on-screen, got ${JSON.stringify(drawerState)}`);
      await cdp.screenshot('admin-mobile-drawer-light.png');

      // Navigate all 8 modules via mobile drawer
      for (const mod of MODULE_DEFS) {
        await clickAdminModule(cdp, mod, { isMobile: true });
        const modMobile = await cdp.eval(`(() => {
          const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
          const mainEl = document.querySelector('main') || document.body;
          const panels = [...mainEl.querySelectorAll('section, article, [role="tabpanel"], .admin-panel, .warm-card, main > div')];
          let maxPanel = { width: 0, height: 0, right: 0 };
          for (const p of panels) {
            const r = p.getBoundingClientRect();
            if (r.width * r.height > maxPanel.width * maxPanel.height) {
              maxPanel = { width: r.width, height: r.height, right: r.right };
            }
          }
          return { overflow, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, maxPanel };
        })()`);
        checkEqual(modMobile.overflow, false, `Mobile Light ${mod.key} overflow (${modMobile.scrollWidth}>${modMobile.clientWidth})`);
        check(
          modMobile.maxPanel.width > 180 && modMobile.maxPanel.right <= 390.5,
          `Mobile Light ${mod.key} panel must fit <= 390.5px, got ${JSON.stringify(modMobile.maxPanel)}`
        );
      }
      cdp.assertNoIssues('T4-04 Mobile Light');
    });

    await runTest('T4-05', async () => {
      await cdp.setViewport(390, 844, true);
      cdp.resetIssues();
      await cdp.waitFor('document.documentElement.clientWidth <= 390', 5_000);
      await ensureMobileDrawerClosed(cdp);

      await cdp.eval(`(() => {
        const btn = document.querySelector('button[aria-label*="主题"], button[aria-label*="暗色"], button[aria-label*="浅色"], button[title*="主题"], [data-testid="theme-toggle"]') ||
          [...document.querySelectorAll('button')].find((b) => /深墨|暗色|夜间|切换.*主题/.test((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')));
        if (!btn) throw new Error('Theme toggle button not found in mobile header');
        btn.click();
      })()`);
      await cdp.waitFor('document.documentElement.getAttribute("data-theme") === "dark"', 5_000);
      await ensureMobileDrawerClosed(cdp);

      const mobDark = await inspectAdminVisualState(cdp, 'dark');
      checkEqual(mobDark.htmlTheme, 'dark', 'Mobile Dark data-theme must be dark');
      checkEqual(mobDark.vars.bgPaper, '#161412');
      check(mobDark.clientWidth <= 390, `Mobile Dark clientWidth must be <= 390, got ${mobDark.clientWidth}`);
      checkEqual(mobDark.overflow, false, `Mobile Dark overflow (${mobDark.scrollWidth}>${mobDark.clientWidth})`);
      checkEqual(mobDark.forbiddenHits.length, 0, `Mobile Dark legacy colors: ${JSON.stringify(mobDark.forbiddenHits)}`);
      await cdp.screenshot('admin-mobile-dark.png');
      cdp.assertNoIssues('T4-05 Mobile Dark');
    });

    // Close Chrome cleanly before Server #1 -> Server #2 transition
    await cdp.close();
    cdp = null;

    // =========================================================================
    // TIER 2 (Strict Mode) — T2-02 on Server #2 with STUDIO_STRICT_HOST_ISOLATION=1
    // =========================================================================
    if (server1) {
      await stopProcessTree(server1.child, 'next-server-1');
      server1 = null;
    }

    let strictBaseUrl = EXTERNAL_STRICT_URL;
    if (!EXTERNAL_BASE_URL) {
      const port2 = await getFreePort();
      server2 = await startNextServer({ port: port2, strictHostIsolation: true });
      strictBaseUrl = server2.baseUrl;
    }

    await runTest('T2-02', async () => {
      if (EXTERNAL_BASE_URL && !EXTERNAL_STRICT_URL) {
        console.log('        [info] E2E_BASE_URL set without E2E_STRICT_BASE_URL; verifying against E2E_BASE_URL strict host check');
        strictBaseUrl = EXTERNAL_BASE_URL;
      }

      const unkPage = await httpRequest({
        baseUrl: strictBaseUrl,
        method: 'GET',
        path: '/admin',
        headers: { Host: 'unknown.example.com' },
      });
      checkEqual(unkPage.status, 404, 'Strict mode unknown host GET /admin must return 404');

      const unkApi = await httpRequest({
        baseUrl: strictBaseUrl,
        method: 'GET',
        path: '/api/admin',
        headers: { Host: 'unknown.example.com' },
      });
      checkEqual(unkApi.status, 404, 'Strict mode unknown host GET /api/admin must return 404');

      const strictPort = new URL(strictBaseUrl).port;
      const localHostHeader = strictPort ? `localhost:${strictPort}` : 'localhost';
      const localPage = await httpRequest({
        baseUrl: strictBaseUrl,
        method: 'GET',
        path: '/admin',
        headers: { Host: localHostHeader },
      });
      checkEqual(localPage.status, 404, `Strict mode Host: ${localHostHeader} GET /admin must return 404`);

      const localApi = await httpRequest({
        baseUrl: strictBaseUrl,
        method: 'GET',
        path: '/api/admin',
        headers: { Host: localHostHeader },
      });
      checkEqual(localApi.status, 404, `Strict mode Host: ${localHostHeader} GET /api/admin must return 404`);

      const admRoot = await httpRequest({
        baseUrl: strictBaseUrl,
        method: 'GET',
        path: '/',
        headers: { Host: ADMIN_HOST },
      });
      checkEqual(admRoot.status, 200, 'Strict mode Host: admin.cryptoayin.cn GET / must return 200');

      const admPage = await httpRequest({
        baseUrl: strictBaseUrl,
        method: 'GET',
        path: '/admin',
        headers: { Host: ADMIN_HOST },
      });
      checkEqual(admPage.status, 200, 'Strict mode Host: admin.cryptoayin.cn GET /admin must return 200');

      const mainLogin = await httpRequest({
        baseUrl: strictBaseUrl,
        method: 'GET',
        path: '/login',
        headers: { Host: MAIN_HOST },
      });
      checkEqual(mainLogin.status, 200, 'Strict mode Host: cryptoayin.cn GET /login must return 200');
    });

    if (server2) {
      await stopProcessTree(server2.child, 'next-server-2');
      server2 = null;
    }
  } finally {
    await cleanup();
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL');

  console.log('\n=== E2E Summary ===');
  console.log(`  Tests: ${passed}/${results.length} passed, ${failed.length} failed`);
  console.log(`  Assertions executed: ${assertionCount}`);
  console.log(`  Screenshots directory: ${screenshotDir}`);

  if (failed.length > 0) {
    console.error('\nFailed test IDs:', failed.map((f) => f.id).join(', '));
    process.exitCode = 1;
  }
}

runSuite().catch((err) => {
  console.error('FATAL E2E ERROR:', err?.stack || err);
  process.exitCode = 1;
});
