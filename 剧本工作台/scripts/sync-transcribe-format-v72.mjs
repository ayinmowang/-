#!/usr/bin/env node
/**
 * 离线同步已有扒剧存稿到《扒剧小能手规范 V7.2》正文格式（0 付费 API 调用）。
 *
 * 用法：
 *   node scripts/sync-transcribe-format-v72.mjs [--store <path>] [--project <id>] [--dry-run | --apply]
 *
 * 边界保证：
 * - 默认 --dry-run，不修改磁盘文件。
 * - --apply 前自动按时间戳备份原 studio-store.json。
 * - 逐集校验台词与说话人 100% 字面一致（extractDialogueLinesForParity），任一集不一致立即中止且不落盘。
 * - 绝不改动非目标项目、账号、sessions、审计日志或已锁定集。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const loaderCode = `
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\\.[a-z0-9]+$/i.test(specifier) && context.parentURL?.startsWith('file:')) {
    const parentPath = fileURLToPath(context.parentURL);
    const tsUrl = new URL(specifier + '.ts', pathToFileURL(parentPath));
    if (fs.existsSync(fileURLToPath(tsUrl))) {
      return { url: tsUrl.href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript;base64,${Buffer.from(loaderCode).toString('base64')}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  normalizeTranscribeEpisodeBodyV72,
  normalizeTranscribeScriptMapV72,
  assembleTranscribeV72Script,
  extractDialogueLinesForParity,
  inspectV72BodyFormat,
} = await import(pathToFileURL(path.join(ROOT, 'lib/transcribe-format.ts')).href);
const { parseTranscribeDeliveryBodies } = await import(pathToFileURL(path.join(ROOT, 'lib/transcribe-parse.ts')).href);

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function syncTranscribeStoreToV72(store, options = {}) {
  const targetProjectId = options.projectId ? String(options.projectId).trim() : '';
  const now = options.now || new Date().toISOString();
  const nextStore = structuredClone(store);
  const report = [];

  if (!nextStore || !nextStore.projects || typeof nextStore.projects !== 'object') {
    throw new Error('Invalid store: missing projects object');
  }

  for (const [projId, row] of Object.entries(nextStore.projects)) {
    if (targetProjectId && projId !== targetProjectId) continue;
    if (!row || typeof row.data !== 'string') continue;

    const proj = JSON.parse(row.data);
    if (proj.kind !== 'transcribe') continue;
    const episodes = Array.isArray(proj.episodes) ? proj.episodes : [];
    if (episodes.length === 0) continue;

    let projectChanged = false;
    const updatedBodies = new Map();
    const episodeReports = [];

    for (const ep of episodes) {
      const epNum = Number(ep?.episodeNumber);
      if (!Number.isInteger(epNum) || epNum < 1) continue;
      const prevBody = typeof ep.body === 'string' ? ep.body : '';
      if (!prevBody.trim()) continue;
      if (ep.locked) {
        updatedBodies.set(epNum, prevBody);
        episodeReports.push({ episode: epNum, changed: false, skippedLocked: true });
        continue;
      }

      const nextBody = normalizeTranscribeEpisodeBodyV72(prevBody, epNum, { traditional: false });
      const beforeDlg = extractDialogueLinesForParity(prevBody);
      const afterDlg = extractDialogueLinesForParity(nextBody);
      if (JSON.stringify(beforeDlg) !== JSON.stringify(afterDlg)) {
        throw new Error(
          `Dialogue parity mismatch on project=${projId} ep=${epNum}: before=${beforeDlg.length}, after=${afterDlg.length}`,
        );
      }

      const formatCheck = inspectV72BodyFormat(nextBody, epNum);
      if (!formatCheck.ok) {
        throw new Error(
          `V7.2 format validation failed on project=${projId} ep=${epNum}: ${formatCheck.issues.join('; ')}`,
        );
      }

      const changed = nextBody !== prevBody || ep.title !== `第${epNum}集`;
      if (changed) {
        projectChanged = true;
        ep.snapshots = [
          {
            id: `snap-${crypto.randomUUID()}`,
            at: now,
            body: prevBody,
            wordCount: prevBody.length,
            note: 'V7.2 离线格式同步前自动快照',
          },
          ...(Array.isArray(ep.snapshots) ? ep.snapshots : []),
        ].slice(0, 20);
        ep.body = nextBody;
        if ('content' in ep) ep.content = nextBody;
        ep.title = `第${epNum}集`;
        ep.updatedAt = now;
      }
      updatedBodies.set(epNum, ep.body);
      episodeReports.push({ episode: epNum, changed, dialogueCount: afterDlg.length });
    }

    const assembled = assembleTranscribeV72Script(updatedBodies);
    if (!proj.remote) proj.remote = {};
    if (!proj.remote.outputs) proj.remote.outputs = {};
    const prevScript = proj.remote.outputs.script || {};
    if (assembled && prevScript.content !== assembled) {
      projectChanged = true;
      proj.remote.outputs.script = {
        ...prevScript,
        title: prevScript.title || '分集扒剧还原正文',
        content: assembled,
        updatedAt: now,
        version: (Number(prevScript.version) || 0) + 1,
      };
    }

    let traditionalSynced = false;
    const prevTrad = proj.remote.outputs.scriptTraditional;
    if (prevTrad && typeof prevTrad.content === 'string' && prevTrad.content.trim()) {
      const epNums = Array.from(updatedBodies.keys()).sort((a, b) => a - b);
      const parsedTrad = parseTranscribeDeliveryBodies(prevTrad.content, epNums);
      if (parsedTrad.size === epNums.length) {
        const normTradMap = normalizeTranscribeScriptMapV72(parsedTrad, { traditional: true });
        for (const epNum of epNums) {
          const beforeTradDlg = extractDialogueLinesForParity(parsedTrad.get(epNum) || '');
          const afterTradDlg = extractDialogueLinesForParity(normTradMap.get(epNum) || '');
          if (JSON.stringify(beforeTradDlg) !== JSON.stringify(afterTradDlg)) {
            throw new Error(`Traditional dialogue parity mismatch on project=${projId} ep=${epNum}`);
          }
        }
        const assembledTrad = assembleTranscribeV72Script(normTradMap);
        if (assembledTrad !== prevTrad.content) {
          projectChanged = true;
          traditionalSynced = true;
          proj.remote.outputs.scriptTraditional = {
            ...prevTrad,
            content: assembledTrad,
            updatedAt: now,
            version: (Number(prevTrad.version) || 0) + 1,
          };
        }
      }
    }

    if (projectChanged) {
      proj.version = (Number(row.version) || Number(proj.version) || 1) + 1;
      proj.updatedAt = now;
      row.version = proj.version;
      row.updated_at = now;
      row.data = JSON.stringify(proj);
    }

    report.push({
      projectId: projId,
      changed: projectChanged,
      version: row.version,
      traditionalSynced,
      episodes: episodeReports,
    });
  }

  return { store: nextStore, report };
}

function parseCliArgs(argv) {
  let storePath = path.join(process.cwd(), '.data', 'studio-store.json');
  let projectId = '';
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--store' && argv[i + 1]) {
      storePath = path.resolve(argv[++i]);
    } else if (arg === '--project' && argv[i + 1]) {
      projectId = argv[++i];
    } else if (arg === '--apply') {
      apply = true;
    } else if (arg === '--dry-run') {
      apply = false;
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }
  return { storePath, projectId, apply };
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const { storePath, projectId, apply } = parseCliArgs(process.argv.slice(2));
  const origBuf = fs.readFileSync(storePath);
  const origStore = JSON.parse(origBuf.toString('utf8'));
  const { store: nextStore, report } = syncTranscribeStoreToV72(origStore, { projectId });
  const anyChanged = report.some((r) => r.changed);

  let backupPath = null;
  if (apply && anyChanged) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = `${storePath}.pre-v72-${stamp}.bak`;
    fs.copyFileSync(storePath, backupPath);
    const nextBuf = Buffer.from(JSON.stringify(nextStore, null, 2), 'utf8');
    const tmpPath = `${storePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, nextBuf);
    fs.renameSync(tmpPath, storePath);
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        storePath,
        originalSha256: sha256(origBuf),
        backupPath,
        changedProjects: report.filter((r) => r.changed).length,
        report,
      },
      null,
      2,
    ),
  );
}
