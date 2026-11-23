// HELPER tests execute lib/transcribe-private-evidence.ts for real (scratch cwd, no network).
// STATIC tests parse the real lib/server.ts and app/api/studio/route.ts source (AST) to check wiring.
// STATIC checks do not execute the route or server and are not HTTP end-to-end tests.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = ts.transpileModule(
  fs.readFileSync(path.join(repo, 'lib/transcribe-private-evidence.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
const { saveTranscribeRawEvidence: save } = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
);

const ROOT = '.private-transcribe-evidence';
const MSG = '原文留存失败，本次未交付，请检查存储后重试';
const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
const fresh = () => {
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'tpe-')));
  return process.cwd();
};
const rootDir = () => path.join(process.cwd(), ROOT);
const dirOf = (o, p) => path.join(rootDir(), h(o), h(p));
const mode = (p) => fs.statSync(p).mode & 0o777;
const posix = process.platform !== 'win32';
const base = (o = {}) => ({
  owner: 'alice',
  projectId: 'p1',
  sourceEpisodes: [1, 10],
  auditId: 'audit-1',
  inputSource: 'video',
  text: 'x',
  ...o,
});
const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
  );
async function t(name, fn) {
  await fn();
  console.log('ok -', name);
}

await t('HELPER exact bytes, 0700/0600, minimal metadata and phase', () => {
  fresh();
  const text = '\n  前导 空白\r\n\t正文 😀  \n\n';
  save(base({ text }));
  const dir = dirOf('alice', 'p1');
  const names = fs.readdirSync(dir);
  assert.equal(names.length, 2);
  const raw = names.find((n) => n.endsWith('.raw.txt'));
  const meta = names.find((n) => n.endsWith('.meta.json'));
  assert.match(raw, /^[0-9a-f-]{36}\.raw\.txt$/);
  assert.equal(raw.replace('.raw.txt', ''), meta.replace('.meta.json', ''));
  assert.deepEqual(fs.readFileSync(path.join(dir, raw)), Buffer.from(text, 'utf8'));
  const metaTxt = fs.readFileSync(path.join(dir, meta), 'utf8');
  assert.deepEqual(JSON.parse(metaTxt), {
    auditId: 'audit-1',
    inputSource: 'video',
    reason: 'awaiting_delivery_validation',
    sourceEpisodes: [1, 10],
    stage: 'captured_before_sanitize_parse',
    textLength: text.length,
  });
  assert.ok(!/prompt|api[_-]?key|authorization|bearer|base64|secret/i.test(metaTxt));
  assert.ok(!metaTxt.includes('正文'));
  if (posix) {
    for (const d of [rootDir(), path.join(rootDir(), h('alice')), dir]) assert.equal(mode(d), 0o700);
    for (const n of names) assert.equal(mode(path.join(dir, n)), 0o600);
  }
});

await t('HELPER hashed owner/project separation, no traversal', () => {
  fresh();
  save(base());
  save(base({ projectId: 'p2' }));
  save(base({ owner: 'bob' }));
  save(base({ owner: '../../escape', projectId: '../x' }));
  assert.equal(fs.readdirSync(dirOf('alice', 'p1')).length, 2);
  assert.equal(fs.readdirSync(dirOf('alice', 'p2')).length, 2);
  assert.equal(fs.readdirSync(dirOf('bob', 'p1')).length, 2);
  assert.equal(fs.readdirSync(dirOf('../../escape', '../x')).length, 2);
  for (const f of walk(rootDir())) {
    const rel = path.relative(rootDir(), f);
    assert.ok(!rel.startsWith('..'));
    const [a, b] = rel.split(path.sep);
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.match(b, /^[0-9a-f]{64}$/);
    assert.ok(!/alice|bob|escape/.test(rel));
  }
  assert.ok(!fs.existsSync(path.join(process.cwd(), '..', 'escape')));
});

await t('HELPER repeated and concurrent saves are distinct, never overwrite', async () => {
  fresh();
  await Promise.all(Array.from({ length: 20 }, () => Promise.resolve().then(() => save(base({ text: 'same' })))));
  const raws = fs.readdirSync(dirOf('alice', 'p1')).filter((n) => n.endsWith('.raw.txt'));
  assert.equal(new Set(raws).size, 20);
  for (const r of raws) {
    assert.equal(fs.readFileSync(path.join(dirOf('alice', 'p1'), r), 'utf8'), 'same');
    if (posix) assert.equal(mode(path.join(dirOf('alice', 'p1'), r)), 0o600);
  }
});

await t('HELPER root location is not public or .data', () => {
  fresh();
  save(base());
  assert.equal(path.relative(process.cwd(), rootDir()), ROOT);
  assert.ok(!path.relative(process.cwd(), rootDir()).split(path.sep).some((s) => s === 'public' || s === '.data'));
});

await t('HELPER refuses symlinked private root / owner dir / project dir', { skip: !posix } && (() => {
  if (!posix) return;
  const outside = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tpe-out-'));
  let o = outside();
  fresh();
  fs.symlinkSync(o, ROOT);
  assert.throws(() => save(base()));
  assert.deepEqual(fs.readdirSync(o), []);

  o = outside();
  fresh();
  fs.mkdirSync(rootDir(), { mode: 0o700 });
  fs.symlinkSync(o, path.join(rootDir(), h('alice')));
  assert.throws(() => save(base()));
  assert.deepEqual(fs.readdirSync(o), []);

  o = outside();
  fresh();
  fs.mkdirSync(path.join(rootDir(), h('alice')), { recursive: true, mode: 0o700 });
  fs.symlinkSync(o, path.join(rootDir(), h('alice'), h('p1')));
  assert.throws(() => save(base()));
  assert.deepEqual(fs.readdirSync(o), []);
}));

await t('HELPER fails on unusable root, unsafe perms (no chmod), invalid input', () => {
  fresh();
  fs.writeFileSync(ROOT, 'not a dir');
  assert.throws(() => save(base()));
  if (posix) {
    fresh();
    fs.mkdirSync(ROOT, { mode: 0o755 });
    fs.chmodSync(ROOT, 0o755);
    assert.throws(() => save(base()));
    assert.equal(mode(rootDir()), 0o755);
    assert.deepEqual(fs.readdirSync(rootDir()), []);
  }
  fresh();
  assert.throws(() => save(base({ auditId: '' })));
  assert.throws(() => save(base({ sourceEpisodes: [0] })));
  assert.throws(() => save(base({ inputSource: 'audio' })));
  assert.throws(() => save(base({ text: null })));
});

// ---------- STATIC (AST/source wiring, nothing executed) ----------
const read = (f) => {
  const text = fs.readFileSync(path.join(repo, f), 'utf8');
  return { text, sf: ts.createSourceFile(f, text, ts.ScriptTarget.ES2022, true) };
};
const find = (n, pred, out = []) => {
  if (pred(n)) out.push(n);
  ts.forEachChild(n, (c) => {
    find(c, pred, out);
  });
  return out;
};
const isCallTo = (n, name) => ts.isCallExpression(n) && n.expression.getText() === name;

await t('STATIC server: capture before sanitize, local failure, no fallback', () => {
  const { sf } = read('lib/server.ts');
  const fn = find(sf, (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'callStationLLM')[0];
  assert.ok(fn);
  const member = fn.parameters[0].type.members.find((m) => m.name?.getText() === 'onRawText');
  assert.ok(member?.questionToken);
  assert.match(member.type.getText(), /\(text: string, auditId: string\) => void/);
  assert.equal(find(fn, (n) => isCallTo(n, 'params.onRawText')).length, 2);
  for (const [arg, sink] of [
    ['strictRes.rawText ?? strictRes.text', 'sanitizeForClient(strictRes.text)'],
    ['reply', 'sanitizeForClient(reply.trim()'],
  ]) {
    const rets = find(fn, (n) => ts.isReturnStatement(n) && n.getText().includes('ok: true') && n.getText().includes(sink));
    assert.equal(rets.length, 1, sink);
    const ret = rets[0];
    assert.ok(ts.isBlock(ret.parent));
    const prev = ret.parent.statements[ret.parent.statements.indexOf(ret) - 1];
    const calls = find(prev, (n) => isCallTo(n, 'params.onRawText'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].arguments[0].getText(), arg);
    assert.match(calls[0].arguments[1].getText(), /\.id$/);
    const tr = find(prev, ts.isTryStatement)[0];
    assert.ok(tr?.catchClause);
    assert.ok(calls[0].getStart() >= tr.tryBlock.getStart() && calls[0].end <= tr.tryBlock.end);
    const c = tr.catchClause.block.getText();
    assert.ok(c.includes('ok: false') && c.includes('text: null') && c.includes(MSG));
    assert.equal(find(tr.catchClause.block, ts.isThrowStatement).length, 0);
    assert.ok(!/console\./.test(prev.getText()));
  }
});

await t('STATIC route: private capture supplied only for transcribe+vision; both strict parser sites', () => {
  const { text, sf } = read('app/api/studio/route.ts');
  const named = (name) =>
    find(
      sf,
      (n) =>
        (ts.isFunctionDeclaration(n) && n.name?.text === name) ||
        (ts.isVariableDeclaration(n) && n.name.getText() === name),
    )[0];

  const station = named('callProjectStation');
  assert.ok(station);
  const llmCalls = find(station, (n) => isCallTo(n, 'callStationLLM') && n.getText().includes('onRawText'));
  assert.equal(llmCalls.length, 1);
  const cb = llmCalls[0].getText();
  for (const s of [
    "params.project.kind === 'transcribe'",
    "params.station === 'vision'",
    'saveTranscribeRawEvidence(',
    'owner: params.account.username',
    'projectId: params.project.id',
    'sourceEpisodes: uniqueValidSourceEpisodes(params.project.attachments)',
    "'video/'",
    "'image/'",
  ]) assert.ok(cb.includes(s), s);
  assert.equal(text.split('onRawText').length - 1, 1);

  const helper = named('parseStrictTranscribeDeliveryMap');
  const ht = helper.getText();
  assert.ok(ht.includes('parseTranscribeDeliveryBodies(src.text, [src.episode])'));
  assert.ok(ht.includes('allowed.has(src.episode)') && ht.includes('throw new Error'));
  assert.ok(!ht.includes('mergePerSourceEpisodeBodies') && !ht.includes('parseEpisodeBodiesFromSingleSource'));

  const legacy = /mergePerSourceEpisodeBodies\(|parseEpisodeBodiesFromSingleSource\(/;
  const strict = find(sf, (n) => isCallTo(n, 'parseStrictTranscribeDeliveryMap'));
  assert.equal(strict.length, 2);

  const hyd = named('populateTranscribeWorkspace');
  assert.ok(hyd);
  const hydCalls = find(hyd, (n) => isCallTo(n, 'parseStrictTranscribeDeliveryMap'));
  assert.equal(hydCalls.length, 1);
  assert.equal(hydCalls[0].arguments[2].getText(), 'validSourceEpisodes');
  assert.ok(hyd.getText().includes('validSourceEpisodes = uniqueValidSourceEpisodes(p.attachments)'));
  assert.ok(!legacy.test(hyd.getText()));

  const gStart = text.indexOf('BEGIN_TRANSCRIBE_DELIVERY_GUARD');
  const inspectPos = text.indexOf('inspectTranscribeBodiesDelivery(expectedEpisodes', gStart);
  assert.ok(gStart > 0 && inspectPos > gStart);
  const gCall = strict.find((n) => n.getStart() > gStart);
  assert.ok(gCall && gCall.getStart() < inspectPos);
  assert.equal(gCall.arguments[2].getText(), 'expectedEpisodes');
  assert.ok(!legacy.test(text.slice(gStart, inspectPos)));
});

console.log('transcribe-private-evidence: all checks passed');
