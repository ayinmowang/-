#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ordersPage = fs.readFileSync(path.join(ROOT, 'app/orders/page.tsx'), 'utf8');
const purchasePage = fs.readFileSync(path.join(ROOT, 'app/purchase/page.tsx'), 'utf8');
const studioWorkspace = fs.readFileSync(path.join(ROOT, 'components/StudioWorkspace.tsx'), 'utf8');
const studioRoute = fs.readFileSync(path.join(ROOT, 'app/api/studio/route.ts'), 'utf8');
const commerceLib = fs.readFileSync(path.join(ROOT, 'lib/commerce.ts'), 'utf8');

// 1. /orders status filter values must match lib/commerce.ts OrderStatus enum
assert.match(commerceLib, /'paid'/, 'lib/commerce.ts should define paid status');
assert.match(commerceLib, /'cancelled'/, 'lib/commerce.ts should define cancelled status');
assert.match(ordersPage, /key:\s*'paid'/, 'app/orders/page.tsx must filter paid');
assert.match(ordersPage, /key:\s*'cancelled'/, 'app/orders/page.tsx must filter cancelled');
assert.doesNotMatch(ordersPage, /key:\s*'confirmed'/, 'app/orders/page.tsx must not use stale confirmed filter');
assert.doesNotMatch(ordersPage, /key:\s*'canceled'/, 'app/orders/page.tsx must not use single-l canceled filter');
assert.match(ordersPage, /period === 'once'/, 'app/orders/page.tsx should map once period to Chinese label');

// 2. /purchase Chinese labels
assert.match(purchasePage, /人工核验入账/, 'app/purchase/page.tsx should show Chinese label for manual_admin');
assert.match(purchasePage, /沙盒测试通道/, 'app/purchase/page.tsx should show Chinese label for sandbox');
assert.match(purchasePage, /单次额度充值/, 'app/purchase/page.tsx should map once period to Chinese label');

// 3. /studio create modal accessibility + formatting bar single-line
assert.match(studioWorkspace, /role="dialog"/, 'StudioWorkspace create modal must have role="dialog"');
assert.match(studioWorkspace, /aria-modal="true"/, 'StudioWorkspace create modal must have aria-modal="true"');
assert.match(studioWorkspace, /e\.key === 'Escape'/, 'StudioWorkspace create modal must close on Escape');
assert.match(studioWorkspace, /whiteSpace:\s*'nowrap'[\s\S]{0,200}页宽正文/, '页宽正文 button should not wrap');

// 4. Multi-video transcribe per-episode attachment scoping & retry
assert.match(
  studioRoute,
  /const shouldRunPerVideo = videoAtts\.length > 3 \|\| \(!isLlmFixture\(\) && videoAtts\.length > 1\)/,
  'Multi-video real transcribe must split per video whenever videoAtts.length > 1'
);
assert.match(
  studioRoute,
  /project:\s*\{\s*\.\.\.p,\s*attachments:\s*epScopedAtts\s*\}/,
  'Per-video transcribe loop must scope project.attachments to epScopedAtts'
);
assert.match(
  studioRoute,
  /sourceEpisodes:\s*uniqueValidSourceEpisodes\(params\.project\.attachments\)/,
  'Raw evidence sourceEpisodes must preserve params.project.attachments contract'
);

console.log('PASS: step4-ui-and-multivideo-regressions (all assertions passed)');
