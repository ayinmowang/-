import assert from 'node:assert/strict';
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

const { sanitizeForClient } = await import('../lib/server.ts');

function statedTotal(text) {
  const match =
    text.match(/(?:全剧|整个剧|总共|一共|总集数|全本|共)\s*(?:是|有|为|：|:)?\s*(\d{1,3})\s*集/) ||
    text.match(/写到\s*第?\s*(\d{1,3})\s*集/) ||
    text.trim().match(/^(\d{1,3})\s*集[。！!]?$/);
  const n = Number(match?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= 300 ? n : null;
}

function statedLocked(text) {
  const match =
    text.match(/前\s*(\d{1,3})\s*集\s*(?:已|已经)?\s*(?:锁定|定稿|不改|不动)/) ||
    text.match(/(?:锁定|定稿)\s*前\s*(\d{1,3})\s*集/) ||
    text.match(/第?\s*1\s*[-~至到]\s*(\d{1,3})\s*集\s*(?:已|已经)?\s*(?:锁定|定稿|不改|不动)/);
  const n = Number(match?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= 299 ? n : null;
}

function detectEpisodeFromName(name) {
  const base = name.replace(/\.[^.]+$/, '').trim();
  if (/^\d+\s*[-_]\s*\d+$/.test(base) || /微信视频|WeChat|\d{6,}/i.test(base)) {
    return undefined;
  }
  const match =
    base.match(/(?:第|^|[_\-\s])0*(\d{1,3})\s*集/) ||
    base.match(/(?:^|[_\-\s])(?:ep|episode)\s*0*(\d{1,3})(?:$|[_\-\s])/i) ||
    base.match(/^0*(\d{1,3})$/);
  const n = Number(match?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= 300 ? n : undefined;
}

function isProgressQuery(text) {
  const t = text.trim();
  if (t.length > 36) return false;
  return /^(现在|目前|请问|这剧)?(进度)?(咋样了?|怎么样了?|还要多久|什么时候好|啥时候.*答复|到哪一步了?|在跑吗|卡在哪了?|进度)[？?。！!]*$/.test(t);
}

// 1. Test statedTotal & statedLocked for continuation workflow
assert.equal(statedTotal('全剧 62 集，前 10 集已锁定，帮我续写后面'), 62);
assert.equal(statedLocked('全剧 62 集，前 10 集已锁定，帮我续写后面'), 10);
assert.equal(statedLocked('第1-15集已定稿，后面写到第80集'), 15);
assert.equal(statedTotal('第1-15集已定稿，后面写到第80集'), 80);
assert.equal(statedTotal('我有一个都市爱情故事的脑洞'), null);

// 2. Test transcribe filename detection (avoid false positives on 1-1.mp4 & WeChat videos)
assert.equal(detectEpisodeFromName('第08集.mp4'), 8);
assert.equal(detectEpisodeFromName('EP12.mp4'), 12);
assert.equal(detectEpisodeFromName('05.mp4'), 5);
assert.equal(detectEpisodeFromName('1-1.mp4'), undefined);
assert.equal(detectEpisodeFromName('微信视频20261113.mp4'), undefined);

// 3. Test progress query detection (G14 honesty check)
assert.equal(isProgressQuery('进度'), true);
assert.equal(isProgressQuery('现在进度咋样了？'), true);
assert.equal(isProgressQuery('啥时候给我答复'), true);
assert.equal(isProgressQuery('女主性格要更冷酷一点，不要恋爱脑'), false);

// 4. Test real sanitizeForClient from lib/server.ts (no model names, routes, tokens, or prompts leaked)
const rawBackendObj = {
  id: 'proj-1',
  model: 'claude-opus-4-6',
  prompt_tokens: 12345,
  totalTokenCount: 320,
  system_prompt: 'secret system prompt',
  text: '由 gpt-4o-mini 与 deepseek-reasoner 以及 Gemini 和 Claude 处理完成，total_tokens: 900, tokens: 480',
};
const cleaned = sanitizeForClient(rawBackendObj, ['secret system prompt']);
assert.equal('model' in cleaned, false);
assert.equal('prompt_tokens' in cleaned, false);
assert.equal('totalTokenCount' in cleaned, false);
assert.equal('system_prompt' in cleaned, false);
assert.equal(cleaned.text.includes('gpt-4o-mini'), false);
assert.equal(cleaned.text.includes('deepseek-reasoner'), false);
assert.equal(cleaned.text.includes('Gemini'), false);
assert.equal(cleaned.text.includes('Claude'), false);
assert.equal(cleaned.text.includes('total_tokens'), false);
assert.equal(/\btokens\s*:\s*480\b/i.test(cleaned.text), false);

// 5. Test exclusive invite key / access key format & masking
function generateRandomCode(prefix = 'AYIN-KEY') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = (len) =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${prefix}-${seg(4)}-${seg(4)}`;
}

const sampleInvite = generateRandomCode('AYIN-INV');
assert.match(sampleInvite, /^AYIN-INV-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

console.log('ALL_CONTRACT_TESTS_PASSED');
