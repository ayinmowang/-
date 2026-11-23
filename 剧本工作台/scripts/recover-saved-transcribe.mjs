#!/usr/bin/env node
// One-off operator recovery: stored response -> real parser/hydration/guards -> saveProject. Offline only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { register } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '/opt/studio-workbench-3/releases/';
const PIN = {
  owner: 'ayin',
  project: '112087e5-3b44-4e55-872a-2ceb45046c00',
  action: '74c267ba-2489-4de4-a480-1a0cd2e776bb',
  audit: 'audit_1795339658194_h9gy8d',
  version: 6,
  rawRel:
    '.private-transcribe-evidence/74c21a8ea15d21d1958f3509a55cabed6e34135e33f4b3a0e6084182e399e7de/ef583f917fabb3c196e39f5c3b15c9038107a9a4b44526b4b1aa16fefff6becb/aa1fa852-a6d2-4f9d-b039-1341faa47f6a.raw.txt',
  rawSha: '835f3ebf7a5058f2f191ee6eb882a1ceabdf26e6fc91aee361513ab4414c5117',
  rawBytes: 9815,
  rawChars: 3743,
};
const ROUTE_SHA = 'bf7bb675a30305b75b7fc057bf81ce95c7d4cbd8727f77d4e7462bfa3fa09594';
const LOADER = `
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\\.[a-z0-9]+$/i.test(specifier) && context.parentURL?.startsWith('file:')) {
    const parentPath = fileURLToPath(context.parentURL);
    const tsUrl = new URL(specifier + '.ts', pathToFileURL(parentPath));
    if (fs.existsSync(fileURLToPath(tsUrl))) return { url: tsUrl.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`;
const NOTICE = '已从已保存的模型响应离线恢复交付，本次没有发起新的模型请求。简体正文已写入分集剧本，繁體版附在 Word 末尾，内容准确性待人工核对。';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const need = (c) => {
  if (!c) throw new Error('refused');
};
const dirOk = (p, mode) => {
  const s = fs.lstatSync(p);
  need(s.isDirectory() && s.uid === process.getuid() && (mode === undefined || (s.mode & 0o777) === mode));
};
const readPriv = (p) => {
  const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const s = fs.fstatSync(fd);
    need(s.isFile() && s.uid === process.getuid() && (s.mode & 0o777) === 0o600 && s.nlink === 1);
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
};
const readDisk = (file) => {
  need(fs.lstatSync(file).isFile());
  const buf = fs.readFileSync(file);
  return { buf, sha: sha(buf), store: JSON.parse(buf.toString('utf8')) };
};
const pinned = (store) => {
  const row = store.projects?.[PIN.project];
  need(row && row.owner === PIN.owner && row.version === PIN.version && typeof row.data === 'string');
  const p = JSON.parse(row.data);
  need(p.id === PIN.project && p.version === PIN.version && p.kind === 'transcribe');
  need((p.transcribeMode ?? p.remote?.transcribeMode ?? p.remote?.mode) === 'fast');
  need(p.remote?.status === 'failed' && p.remote?.stage?.key === 'transcribe_incomplete');
  const pa = p.processedActionIds ?? p.remote?.processedActionIds;
  need(Array.isArray(pa) && pa.includes(PIN.action));
  const au = (store.auditLogs || []).filter((a) => a && a.id === PIN.audit);
  need(au.length === 1 && au[0].projectId === PIN.project);
  return { row, project: p };
};
const readRaw = (cwd) => {
  const parts = PIN.rawRel.split('/');
  let dir = cwd;
  for (const part of parts.slice(0, -1)) {
    dir = path.join(dir, part);
    dirOk(dir, 0o700);
  }
  const rawPath = path.join(dir, parts[parts.length - 1]);
  const buf = readPriv(rawPath);
  need(buf.length === PIN.rawBytes && sha(buf) === PIN.rawSha);
  const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
  need(raw.length === PIN.rawChars || [...raw].length === PIN.rawChars);
  const meta = JSON.parse(readPriv(rawPath.replace(/\.raw\.txt$/, '.meta.json')).toString('utf8'));
  need(
    isDeepStrictEqual(meta, {
      auditId: PIN.audit,
      sourceEpisodes: [1],
      inputSource: 'video',
      textLength: 3743,
      stage: 'captured_before_sanitize_parse',
      reason: 'awaiting_delivery_validation',
    }),
  );
  return raw;
};

let libs;
const loadLibs = () =>
  (libs ??= (async () => {
    const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
    const [srv, srcm, parse, guard, ready, tsm] = await Promise.all([
      imp('lib/server.ts'),
      imp('lib/source-materials.ts'),
      imp('lib/transcribe-parse.ts'),
      imp('lib/transcribe-delivery-guard.ts'),
      imp('lib/transcribe-delivery-ready.ts'),
      import('typescript'),
    ]);
    const ts = tsm.default ?? tsm;
    const buf = fs.readFileSync(path.join(ROOT, 'app/api/studio/route.ts'));
    need(sha(buf) === ROUTE_SHA);
    const text = buf.toString('utf8');
    const sf = ts.createSourceFile('route.ts', text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const pick = (name) => {
      const m = sf.statements.filter((s) => ts.isFunctionDeclaration(s) && s.name?.text === name && s.body && !s.modifiers);
      need(m.length === 1);
      return text.slice(m[0].getStart(sf), m[0].end);
    };
    const js = ts.transpileModule(pick('parseStrictTranscribeDeliveryMap') + '\n' + pick('populateTranscribeWorkspace'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
    }).outputText;
    const fns = new Function(
      'sanitizeForClient',
      'uniqueValidSourceEpisodes',
      'extractSynopsisOrPlaceholder',
      'assembleScriptFromEpisodeBodies',
      'parseTranscribeDeliveryBodies',
      `${js}\nreturn { populateTranscribeWorkspace, parseStrictTranscribeDeliveryMap };`,
    )(
      srv.sanitizeForClient,
      srcm.uniqueValidSourceEpisodes,
      parse.extractSynopsisOrPlaceholder,
      parse.assembleScriptFromEpisodeBodies,
      parse.parseTranscribeDeliveryBodies,
    );
    need(typeof fns.populateTranscribeWorkspace === 'function' && typeof fns.parseStrictTranscribeDeliveryMap === 'function');
    return {
      srv,
      uniq: srcm.uniqueValidSourceEpisodes,
      variants: parse.parseTranscribeDeliveryVariants,
      inspect: guard.inspectTranscribeBodiesDelivery,
      ready: ready.inspectTranscribeProjectDeliveryReady,
      populate: fns.populateTranscribeWorkspace,
      strict: fns.parseStrictTranscribeDeliveryMap,
    };
  })());

const strip = (b) => String(b).replace(/^\s*#{1,6}\s*第\s*\d+\s*集[^\n]*\n?/, '').trim();
const withHead = (n, b) => (/^\s*#{1,6}\s*第\s*\d+\s*集/.test(b) ? b.trim() : `### 第 ${n} 集\n${b.trim()}`);

export async function prepareSavedTranscribeRecovery(project, raw) {
  need(project && typeof project === 'object' && project.kind === 'transcribe');
  need(typeof raw === 'string' && raw.trim() && project.remote && typeof project.remote === 'object');
  const L = await loadLibs();
  const eps = L.uniq(project.attachments);
  need(Array.isArray(eps) && eps.length > 0);
  const v = L.variants(raw, eps);
  const simp = v?.simplified;
  const trad = v?.traditional;
  const full = (m) => m instanceof Map && m.size === eps.length && eps.every((n) => typeof m.get(n) === 'string' && m.get(n).trim());
  need(full(simp) && full(trad));
  need(L.inspect(eps, simp).ok === true && L.inspect(eps, trad).ok === true);
  need(eps.every((n) => simp.get(n) !== trad.get(n)));

  const clone = structuredClone(project);
  const r = clone.remote;
  if (!r.outputs || typeof r.outputs !== 'object') r.outputs = {};
  L.populate(clone, raw);
  need(Array.isArray(clone.episodes) && clone.episodes.length === eps.length);
  need(eps.every((n) => clone.episodes.find((e) => e.episodeNumber === n)?.body === simp.get(n)));

  const alt = eps.map((n) => withHead(n, trad.get(n))).join('\n\n');
  const back = L.strict(alt, undefined, eps);
  need(full(back) && L.inspect(eps, back).ok === true && eps.every((n) => strip(back.get(n)) === strip(trad.get(n))));
  const now = new Date().toISOString();
  Object.assign(r, {
    status: 'delivered',
    stage: { key: 'delivery', title: '已存响应离线恢复交付' },
    card: null,
    progress: { completed_steps: 2, total_steps: 2 },
    cursor: 2,
  });
  r.outputs.scriptTraditional = { title: '繁體版分集劇本', content: alt, updatedAt: now, version: 1 };
  if (!Array.isArray(clone.messages)) clone.messages = [];
  const n0 = clone.messages.length;
  const m = L.srv.message(clone, 'assistant', NOTICE);
  if (clone.messages.length === n0) clone.messages.push(m);

  const prepared = L.srv.sanitizeForClient(clone);
  need(L.ready(prepared).ready === true);
  need(eps.every((n) => prepared.episodes.find((e) => e.episodeNumber === n)?.body === simp.get(n)));
  need(prepared.remote.outputs.scriptTraditional?.content === alt && !/transcribedraft/i.test(JSON.stringify(prepared)));
  return prepared;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  need(args.every((a) => a === '--apply' || a === '--dry-run') && new Set(args).size === args.length);
  need(!(apply && args.includes('--dry-run')));
  need((process.env.STUDIO_LLM_FIXTURE ?? '0') === '0');
  need(!Object.keys(process.env).some((k) => /API_?KEY/i.test(k) && process.env[k]));
  const cwd = process.cwd();
  need(fs.realpathSync(cwd) === cwd && cwd.startsWith(BASE) && cwd.length > BASE.length && cwd === ROOT);
  const ops = path.join(cwd, '.ops');
  dirOk(ops);
  dirOk(path.join(cwd, '.data'));
  const sp = path.join(ops, 'service.json');
  need(fs.lstatSync(sp).isFile());
  const svc = JSON.parse(fs.readFileSync(sp, 'utf8'));
  need((svc.cwd ?? svc.dir ?? svc.release) === cwd && Number.isInteger(svc.pid) && svc.pid > 0);
  let dead = false;
  try {
    process.kill(svc.pid, 0);
  } catch (e) {
    dead = e?.code === 'ESRCH';
  }
  need(dead);
  register(`data:text/javascript;base64,${Buffer.from(LOADER).toString('base64')}`);

  const storeFile = path.join(cwd, '.data', 'studio-store.json');
  if (apply) {
    const fd = fs.openSync(path.join(ops, 'recover-saved-transcribe.lock'), 'wx', 0o600);
    fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
    fs.closeSync(fd);
  }
  const d0 = readDisk(storeFile);
  const { project } = pinned(d0.store);
  const raw = readRaw(cwd);
  const L = await loadLibs();
  need(isDeepStrictEqual(L.uniq(project.attachments), [1]));
  const prepared = await prepareSavedTranscribeRecovery(project, raw);
  const others = (s) => JSON.stringify([Object.entries(s.projects).filter(([k]) => k !== PIN.project), s.auditLogs]);
  if (!apply) {
    need(readDisk(storeFile).sha === d0.sha);
    process.stdout.write('recover-saved-transcribe: dry-run ok\n');
    return;
  }

  const mem = await L.srv.getStore();
  const mr = mem.projects[PIN.project];
  need(mr && mr.owner === PIN.owner && mr.version === PIN.version && mr.data === d0.store.projects[PIN.project].data);
  need(JSON.stringify(mem.auditLogs) === JSON.stringify(d0.store.auditLogs));
  const rnd = () => crypto.randomBytes(8).toString('hex');
  const backup = path.join(ops, `studio-store.backup-${rnd()}.json`);
  fs.writeFileSync(backup, d0.buf, { flag: 'wx', mode: 0o600 });
  const d1 = readDisk(storeFile);
  need(d1.sha === d0.sha);
  pinned(d1.store);
  readRaw(cwd);
  const snap0 = others(d1.store);

  let ok = false;
  try {
    await L.srv.saveProject(prepared, PIN.owner);
    L.srv.flushPersistentStore();
    const d2 = readDisk(storeFile);
    const row = d2.store.projects[PIN.project];
    const pj = JSON.parse(row.data);
    ok =
      row.owner === PIN.owner &&
      row.version === 7 &&
      pj.version === 7 &&
      pj.remote?.status === 'delivered' &&
      L.ready(pj).ready === true &&
      others(d2.store) === snap0;
    readRaw(cwd);
  } catch {
    ok = false;
  }
  const hs = (s) => sha(Buffer.from(String(s)));
  const receipt = {
    kind: 'offline_recovery_from_saved_response',
    newGeneration: false,
    ownerId: PIN.owner,
    projectId: PIN.project,
    actionId: PIN.action,
    originalAuditId: PIN.audit,
    versionBefore: PIN.version,
    versionAfter: ok ? 7 : null,
    verified: ok,
    rawSha256: PIN.rawSha,
    rawBytes: PIN.rawBytes,
    rawChars: PIN.rawChars,
    sourceEpisodes: [1],
    storeSha256Before: d0.sha,
    backupFile: path.basename(backup),
    simplified: prepared.episodes.map((e) => ({ episode: e.episodeNumber, length: e.body.length, sha256: hs(e.body) })),
    traditional: {
      length: prepared.remote.outputs.scriptTraditional.content.length,
      sha256: hs(prepared.remote.outputs.scriptTraditional.content),
    },
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(ops, `recover-saved-transcribe.receipt-${rnd()}.json`), JSON.stringify(receipt, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  need(ok);
  process.stdout.write('recover-saved-transcribe: applied\n');
}

if (process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url) {
  main().then(
    () => process.exit(0),
    () => {
      process.stderr.write('recover-saved-transcribe: refused\n');
      process.exit(1);
    },
  );
}
