import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { saveProjectProgress, sanitizeForClient, withProjectLock } from './server';
import { repairBrokenRelayLineWraps } from './transcribe-format';
import { inspectTranscribeBodiesDelivery } from './transcribe-delivery-guard';
import { parseTranscribeDeliveryBodies, type EpisodeSourceChunk } from './transcribe-parse';
import type {
  Attachment,
  Project,
  TranscribeEpisodeProgress,
  TranscribeJobStatus,
} from './types';

export const PROCESS_BOOT_AT_MS = Date.now();

export interface TranscribeCheckpointEpisode {
  text: string;
  updatedAt: string;
  elapsedMs?: number;
}

export interface TranscribeCheckpointData {
  projectId: string;
  transcribeMode: 'fast' | 'detailed';
  attachmentIds: string[];
  updatedAt: string;
  episodes: Record<number, TranscribeCheckpointEpisode>;
}

interface TranscribeJobRuntime {
  jobId: string;
  user: string;
  projectId: string;
  cancelled: boolean;
  abortController: AbortController;
  status: TranscribeJobStatus;
  promise: Promise<void>;
}

function getJobsRegistry(): Map<string, TranscribeJobRuntime> {
  const g = globalThis as any;
  if (!(g.__STUDIO_TRANSCRIBE_JOBS__ instanceof Map)) {
    g.__STUDIO_TRANSCRIBE_JOBS__ = new Map<string, TranscribeJobRuntime>();
  }
  return g.__STUDIO_TRANSCRIBE_JOBS__;
}

function jobKey(user: string, projectId: string): string {
  return `${user}:${projectId}`;
}

export function getTranscribeConcurrency(): number {
  const raw = Number(process.env.STUDIO_TRANSCRIBE_CONCURRENCY || 6);
  if (Number.isFinite(raw) && raw >= 1) {
    return Math.max(1, Math.min(8, Math.floor(raw)));
  }
  return 6;
}

function checkpointDir(): string {
  return path.join(process.cwd(), '.data', 'transcribe-checkpoints');
}

export function getTranscribeCheckpointPath(user: string, projectId: string): string {
  const digest = crypto.createHash('sha256').update(`${user}:${projectId}`).digest('hex');
  return path.join(checkpointDir(), `${digest}.json`);
}

let cpSeq = 0;

export function loadTranscribeCheckpoint(user: string, projectId: string): TranscribeCheckpointData | null {
  const filePath = getTranscribeCheckpointPath(user, projectId);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.episodes || typeof parsed.episodes !== 'object') {
      return null;
    }
    return parsed as TranscribeCheckpointData;
  } catch {
    return null;
  }
}

export function saveTranscribeCheckpoint(
  user: string,
  projectId: string,
  data: TranscribeCheckpointData,
): void {
  const dir = checkpointDir();
  const filePath = getTranscribeCheckpointPath(user, projectId);
  const seq = ++cpSeq;
  const tmpPath = `${filePath}.tmp.${process.pid}.${seq}`;
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
}

export function clearTranscribeCheckpoint(user: string, projectId: string): void {
  const filePath = getTranscribeCheckpointPath(user, projectId);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

export function getTranscribeJobState(user: string, projectId: string): TranscribeJobStatus | null {
  const entry = getJobsRegistry().get(jobKey(user, projectId));
  return entry ? structuredClone(entry.status) : null;
}

export function isTranscribeJobRunning(user: string, projectId: string): boolean {
  return getJobsRegistry().has(jobKey(user, projectId));
}

export function cancelTranscribeJob(user: string, projectId: string): boolean {
  const entry = getJobsRegistry().get(jobKey(user, projectId));
  if (!entry) return false;
  entry.cancelled = true;
  try {
    entry.abortController.abort(new Error('TRANSCRIBE_CANCELLED'));
  } catch {}
  return true;
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function isValidatedEpisodeText(epNum: number, rawText: string): boolean {
  const sanitized = sanitizeForClient(rawText || '');
  if (!sanitized.trim()) return false;
  try {
    const epMap = parseTranscribeDeliveryBodies(sanitized, [epNum]);
    return inspectTranscribeBodiesDelivery([epNum], epMap).ok;
  } catch {
    return false;
  }
}

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop?: () => boolean,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      if (shouldStop?.()) break;
      const idx = cursor++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

export interface EpisodeRunResult {
  ok: boolean;
  text: string | null;
  error?: string;
  nonRetryable?: boolean;
  timedOutTargets?: string[];
}

export interface StartAsyncTranscribeJobOptions {
  user: string;
  projectId: string;
  transcribeMode: 'fast' | 'detailed';
  videoAtts: Attachment[];
  nonVideoContextAtts: Attachment[];
  nextCursor: number;
  isFixture: boolean;
  ffmpegWarning?: string;
  runEpisodeVision: (
    videoAtt: Attachment,
    epNum: number,
    epScopedAtts: Attachment[],
    excludeTargets: Set<string>,
    signal?: AbortSignal,
  ) => Promise<EpisodeRunResult>;
  deliverSuccessProject: (
    latestProject: Project,
    combinedRawOutput: string,
    perSourceChunks: EpisodeSourceChunk[],
  ) => { ok: boolean; reason?: string };
  onFailureMessage: (
    latestProject: Project,
    reason: string,
  ) => void;
}

function sameIdList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function startTranscribeJob(opts: StartAsyncTranscribeJobOptions): TranscribeJobStatus {
  const sortedVideos = [...opts.videoAtts].sort(
    (a, b) => (Number(a.episode) || 0) - (Number(b.episode) || 0),
  );
  const attachmentIds = sortedVideos.map((v) => String(v.id || '')).sort();
  const jobId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  // Check existing checkpoint for resume
  const existingCp = loadTranscribeCheckpoint(opts.user, opts.projectId);
  const canResume =
    Boolean(existingCp) &&
    existingCp!.transcribeMode === opts.transcribeMode &&
    sameIdList(
      Array.isArray(existingCp!.attachmentIds) ? [...existingCp!.attachmentIds].sort() : [],
      attachmentIds,
    );

  const resumedEpisodes = new Map<number, string>();
  const checkpointData: TranscribeCheckpointData = {
    projectId: opts.projectId,
    transcribeMode: opts.transcribeMode,
    attachmentIds,
    updatedAt: startedAt,
    episodes: {},
  };

  const episodeProgress: Record<number, TranscribeEpisodeProgress> = {};
  const completedEpisodes: number[] = [];

  for (const va of sortedVideos) {
    const epNum = Number(va.episode) || 1;
    const cachedEp = canResume ? existingCp?.episodes?.[epNum] : undefined;
    if (cachedEp && typeof cachedEp.text === 'string' && isValidatedEpisodeText(epNum, cachedEp.text)) {
      resumedEpisodes.set(epNum, cachedEp.text);
      checkpointData.episodes[epNum] = cachedEp;
      completedEpisodes.push(epNum);
      episodeProgress[epNum] = {
        status: 'done',
        ...(typeof cachedEp.elapsedMs === 'number' ? { elapsedMs: cachedEp.elapsedMs } : {}),
      };
    } else {
      episodeProgress[epNum] = { status: 'pending' };
    }
  }

  completedEpisodes.sort((a, b) => a - b);

  const status: TranscribeJobStatus = {
    jobId,
    startedAt,
    updatedAt: startedAt,
    totalEpisodes: sortedVideos.length,
    completedEpisodes: [...completedEpisodes],
    failedEpisodes: [],
    inFlightEpisodes: [],
    episodeProgress,
    ...(opts.ffmpegWarning ? { ffmpegWarning: opts.ffmpegWarning } : {}),
  };

  // Persist initial checkpoint snapshot (keeps any valid resumed episodes)
  try {
    saveTranscribeCheckpoint(opts.user, opts.projectId, checkpointData);
  } catch (err) {
    console.warn('[transcribe-jobs] Failed to initialize checkpoint:', err);
  }

  const abortController = new AbortController();
  const runtime: TranscribeJobRuntime = {
    jobId,
    user: opts.user,
    projectId: opts.projectId,
    cancelled: false,
    abortController,
    status,
    promise: Promise.resolve(),
  };

  const registry = getJobsRegistry();
  registry.set(jobKey(opts.user, opts.projectId), runtime);

  const syncProgressToStore = async () => {
    status.updatedAt = new Date().toISOString();
    try {
      await saveProjectProgress(opts.projectId, opts.user, (latest) => {
        if (!latest.remote) return latest;
        latest.remote.transcribeJob = sanitizeForClient(structuredClone(status));
        return latest;
      });
    } catch (err) {
      console.warn('[transcribe-jobs] Failed to persist progress:', err);
    }
  };

  const pendingVideos = sortedVideos.filter((va) => !resumedEpisodes.has(Number(va.episode) || 1));
  const concurrency = getTranscribeConcurrency();
  const cpLockKey = `cp:${opts.user}:${opts.projectId}`;

  runtime.promise = (async () => {
    try {
      await runPool(
        pendingVideos,
        concurrency,
        async (va) => {
          if (runtime.cancelled) return;
          const epNum = Number(va.episode) || 1;
          const epStart = Date.now();

          if (!status.inFlightEpisodes.includes(epNum)) {
            status.inFlightEpisodes.push(epNum);
          }
          status.episodeProgress[epNum] = { status: 'running' };
          await syncProgressToStore();

          const epScopedAtts = [
            va,
            ...opts.nonVideoContextAtts.filter((a) => !a.episode || Number(a.episode) === epNum),
          ];

          const maxAttempts = opts.isFixture ? 1 : 2;
          const excludeTargets = new Set<string>();
          let finalText = '';
          let epValid = false;
          let lastError = 'INCOMPLETE_BODY';

          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (runtime.cancelled) {
              lastError = 'CANCELLED';
              break;
            }
            const r = await opts.runEpisodeVision(
              va,
              epNum,
              epScopedAtts,
              excludeTargets,
              abortController.signal,
            );
            if (Array.isArray(r.timedOutTargets)) {
              for (const tk of r.timedOutTargets) excludeTargets.add(tk);
            }
            if (runtime.cancelled && !r.ok) {
              lastError = 'CANCELLED';
              break;
            }
            if (opts.isFixture) {
              finalText =
                r.ok && r.text
                  ? r.text
                  : `第${epNum}集 场次1-1 内景 场景 日\n▲ 完成该集结构梳理。`;
              epValid = true;
              break;
            }

            const repaired = r.ok && r.text ? repairBrokenRelayLineWraps(r.text) : '';
            const sanitized = sanitizeForClient(repaired);
            if (isValidatedEpisodeText(epNum, sanitized)) {
              finalText = repaired;
              epValid = true;
              break;
            }

            finalText = repaired;
            lastError = r.error || (sanitized.trim() ? 'INCOMPLETE_BODY' : 'EMPTY_RESPONSE');
            console.warn(
              JSON.stringify({
                event: 'transcribe_episode_retry',
                projectId: opts.projectId,
                episode: epNum,
                attempt,
                maxAttempts,
                ok: r.ok,
                error: lastError,
                nonRetryable: Boolean(r.nonRetryable),
                elapsedMs: Date.now() - epStart,
              }),
            );
            if (r.nonRetryable || runtime.cancelled) {
              break;
            }
            if (attempt < maxAttempts) {
              await sleepWithAbort(attempt * 1500, abortController.signal);
            }
          }

          status.inFlightEpisodes = status.inFlightEpisodes.filter((n) => n !== epNum);
          const elapsedMs = Date.now() - epStart;

          if (epValid && finalText) {
            resumedEpisodes.set(epNum, finalText);
            if (!status.completedEpisodes.includes(epNum)) {
              status.completedEpisodes.push(epNum);
              status.completedEpisodes.sort((a, b) => a - b);
            }
            status.failedEpisodes = status.failedEpisodes.filter((n) => n !== epNum);
            status.episodeProgress[epNum] = { status: 'done', elapsedMs };

            await withProjectLock(cpLockKey, async () => {
              checkpointData.updatedAt = new Date().toISOString();
              checkpointData.episodes[epNum] = {
                text: finalText,
                updatedAt: checkpointData.updatedAt,
                elapsedMs,
              };
              saveTranscribeCheckpoint(opts.user, opts.projectId, checkpointData);
            });
          } else if (runtime.cancelled) {
            status.episodeProgress[epNum] = { status: 'pending' };
          } else {
            if (!status.failedEpisodes.includes(epNum)) {
              status.failedEpisodes.push(epNum);
              status.failedEpisodes.sort((a, b) => a - b);
            }
            status.episodeProgress[epNum] = {
              status: 'failed',
              elapsedMs,
              error: sanitizeForClient(lastError).slice(0, 120),
            };
          }

          await syncProgressToStore();
        },
        () => runtime.cancelled,
      );

      // Finalize delivery or partial failure
      const allSucceeded =
        !runtime.cancelled &&
        status.failedEpisodes.length === 0 &&
        sortedVideos.every((va) => resumedEpisodes.has(Number(va.episode) || 1));

      if (allSucceeded) {
        const perSourceChunks: EpisodeSourceChunk[] = sortedVideos.map((va) => {
          const epNum = Number(va.episode) || 1;
          return { episode: epNum, text: resumedEpisodes.get(epNum) || '' };
        });
        const combinedRawOutput = perSourceChunks.map((c) => c.text).join('\n\n');

        let deliveryResult: { ok: boolean; reason?: string } = { ok: false, reason: 'DELIVERY_FAILED' };
        await saveProjectProgress(opts.projectId, opts.user, (latest) => {
          if (latest.remote) {
            status.inFlightEpisodes = [];
            status.updatedAt = new Date().toISOString();
            latest.remote.transcribeJob = sanitizeForClient(structuredClone(status));
          }
          deliveryResult = opts.deliverSuccessProject(latest, combinedRawOutput, perSourceChunks);
          if (!deliveryResult.ok && latest.remote) {
            latest.remote.status = 'failed';
            latest.remote.stage = { key: 'transcribe_incomplete', title: '扒剧正文未完整 · 未交付' };
            latest.remote.card = null;
            latest.remote.cursor = Math.max(0, opts.nextCursor - 1);
            const totalSteps = Math.max(1, Number(latest.remote.progress?.total_steps) || 1);
            latest.remote.progress = {
              ...(latest.remote.progress || {}),
              total_steps: totalSteps,
              completed_steps: Math.max(
                0,
                Math.min((Number(latest.remote.progress?.completed_steps) || 1) - 1, totalSteps - 1),
              ),
            };
            opts.onFailureMessage(latest, deliveryResult.reason || '分集正文未达到交付标准');
          }
          return latest;
        });

        if (deliveryResult.ok) {
          clearTranscribeCheckpoint(opts.user, opts.projectId);
        }
      } else if (runtime.cancelled) {
        await saveProjectProgress(opts.projectId, opts.user, (latest) => {
          if (!latest.remote) return latest;
          status.inFlightEpisodes = [];
          status.updatedAt = new Date().toISOString();
          latest.remote.transcribeJob = sanitizeForClient(structuredClone(status));
          latest.remote.status = 'paused';
          latest.remote.stage = { key: 'transcribe_paused', title: '扒剧已暂停 · 断点已保存' };
          latest.remote.card = null;
          return latest;
        });
      } else {
        const reason = `已完成 ${status.completedEpisodes.length}/${status.totalEpisodes} 集（第 ${
          status.failedEpisodes.join('、') || '?'
        } 集未通过），已完成集数已保存断点，点击重试可断点续跑`;
        await saveProjectProgress(opts.projectId, opts.user, (latest) => {
          if (!latest.remote) return latest;
          status.inFlightEpisodes = [];
          status.updatedAt = new Date().toISOString();
          latest.remote.transcribeJob = sanitizeForClient(structuredClone(status));
          latest.remote.status = 'failed';
          latest.remote.stage = { key: 'transcribe_incomplete', title: '扒剧正文未完整 · 未交付' };
          latest.remote.card = null;
          latest.remote.cursor = Math.max(0, opts.nextCursor - 1);
          const totalSteps = Math.max(1, Number(latest.remote.progress?.total_steps) || 1);
          latest.remote.progress = {
            ...(latest.remote.progress || {}),
            total_steps: totalSteps,
            completed_steps: Math.max(
              0,
              Math.min((Number(latest.remote.progress?.completed_steps) || 1) - 1, totalSteps - 1),
            ),
          };
          opts.onFailureMessage(latest, reason);
          return latest;
        });
      }
    } catch (err: any) {
      console.error('[transcribe-jobs] Unexpected job failure:', err);
      try {
        await saveProjectProgress(opts.projectId, opts.user, (latest) => {
          if (!latest.remote) return latest;
          status.inFlightEpisodes = [];
          status.updatedAt = new Date().toISOString();
          latest.remote.transcribeJob = sanitizeForClient(structuredClone(status));
          latest.remote.status = 'failed';
          latest.remote.stage = { key: 'transcribe_failed', title: '扒剧处理失败 · 未交付' };
          latest.remote.card = null;
          opts.onFailureMessage(latest, '后台任务异常中断，已完成集数已保存断点，请点击重试继续。');
          return latest;
        });
      } catch {}
    } finally {
      const current = registry.get(jobKey(opts.user, opts.projectId));
      if (current && current.jobId === jobId) {
        registry.delete(jobKey(opts.user, opts.projectId));
      }
    }
  })();

  return structuredClone(status);
}
