import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export interface FfmpegResolution {
  available: boolean;
  path: string | null;
  source: 'env' | 'ffmpeg-static' | 'system' | 'none';
}

export interface PrepareCompressedVideoOptions {
  bucketPath: string;
  cacheKey: string;
  mode: 'fast' | 'detailed';
  maxBytes?: number;
}

export interface PrepareCompressedVideoResult {
  filePath: string;
  compressed: boolean;
  originalBytes: number;
  outputBytes: number;
  durationMs: number;
  warning?: string;
}

const DEFAULT_THRESHOLD_BYTES = 3 * 1024 * 1024;
const DEFAULT_MAX_COMPRESSED_BYTES = Math.floor(4.5 * 1024 * 1024);
const DEFAULT_FFMPEG_TIMEOUT_MS = 120_000;

function isTruthyEnv(val: string | undefined): boolean {
  if (!val) return false;
  const v = val.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function isExecutableFile(candidate: string): boolean {
  if (!candidate || typeof candidate !== 'string') return false;
  try {
    const isWin = process.platform === 'win32';
    fs.accessSync(candidate, isWin ? fs.constants.F_OK : fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveStaticPackageBinary(): string | null {
  try {
    const req = createRequire(import.meta.url);
    const resolved = req('ffmpeg-static');
    if (typeof resolved === 'string' && isExecutableFile(resolved)) {
      return resolved;
    }
  } catch {
    // Fallback to direct node_modules lookup when bundled
  }

  const fallbackName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const fallbackCandidate = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', fallbackName);
  if (isExecutableFile(fallbackCandidate)) {
    return fallbackCandidate;
  }
  return null;
}

function resolveSystemPathBinary(): string | null {
  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const isWin = process.platform === 'win32';
  const names = isWin ? ['ffmpeg.exe', 'ffmpeg.cmd', 'ffmpeg.bat', 'ffmpeg'] : ['ffmpeg'];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(/*turbopackIgnore: true*/ dir, name);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Resolves ffmpeg binary path in priority order:
 * 1. STUDIO_FFMPEG_PATH
 * 2. ffmpeg-static package
 * 3. System PATH
 */
export function resolveFfmpegBinary(): FfmpegResolution {
  if (isTruthyEnv(process.env.STUDIO_FFMPEG_DISABLED)) {
    return { available: false, path: null, source: 'none' };
  }

  const envPath = String(process.env.STUDIO_FFMPEG_PATH || '').trim();
  if (envPath && isExecutableFile(envPath)) {
    return { available: true, path: envPath, source: 'env' };
  }

  const staticPath = resolveStaticPackageBinary();
  if (staticPath) {
    return { available: true, path: staticPath, source: 'ffmpeg-static' };
  }

  const systemPath = resolveSystemPathBinary();
  if (systemPath) {
    return { available: true, path: systemPath, source: 'system' };
  }

  return { available: false, path: null, source: 'none' };
}

function getCompressThresholdBytes(): number {
  const raw = Number(process.env.STUDIO_VIDEO_COMPRESS_THRESHOLD_BYTES);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  const rawMb = Number(process.env.STUDIO_VIDEO_COMPRESS_THRESHOLD_MB);
  if (Number.isFinite(rawMb) && rawMb > 0) return Math.floor(rawMb * 1024 * 1024);
  return DEFAULT_THRESHOLD_BYTES;
}

function getFfmpegConcurrency(): number {
  const raw = Number(process.env.STUDIO_FFMPEG_CONCURRENCY);
  if (Number.isFinite(raw) && raw >= 1) {
    return Math.max(1, Math.min(4, Math.floor(raw)));
  }
  return 2;
}

interface FfmpegSemState {
  active: number;
  queue: Array<() => void>;
}

function getFfmpegSemState(): FfmpegSemState {
  const g = globalThis as any;
  if (!g.__STUDIO_FFMPEG_SEM__) {
    g.__STUDIO_FFMPEG_SEM__ = { active: 0, queue: [] } satisfies FfmpegSemState;
  }
  return g.__STUDIO_FFMPEG_SEM__;
}

async function withFfmpegSlot<T>(fn: () => Promise<T>): Promise<T> {
  const sem = getFfmpegSemState();
  const limit = getFfmpegConcurrency();
  if (sem.active >= limit) {
    await new Promise<void>((resolve) => {
      sem.queue.push(resolve);
    });
  }
  sem.active += 1;
  try {
    return await fn();
  } finally {
    sem.active = Math.max(0, sem.active - 1);
    const next = sem.queue.shift();
    if (next) next();
  }
}

function getInflightTranscodeMap(): Map<string, Promise<PrepareCompressedVideoResult>> {
  const g = globalThis as any;
  if (!(g.__STUDIO_TRANSCODE_INFLIGHT__ instanceof Map)) {
    g.__STUDIO_TRANSCODE_INFLIGHT__ = new Map<string, Promise<PrepareCompressedVideoResult>>();
  }
  return g.__STUDIO_TRANSCODE_INFLIGHT__;
}

function hasFtypHeader(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, buf, 0, 12, 0);
    return bytesRead >= 8 && buf.subarray(4, 8).toString('latin1') === 'ftyp';
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

function isValidCompressedMp4(filePath: string): { valid: boolean; size: number } {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size <= 4096) {
      return { valid: false, size: st.size };
    }
    return { valid: hasFtypHeader(filePath), size: st.size };
  } catch {
    return { valid: false, size: 0 };
  }
}

function runFfmpegArgs(ffmpegPath: string, args: string[], timeoutMs = DEFAULT_FFMPEG_TIMEOUT_MS): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(ffmpegPath);
    const child = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      shell: useShell,
    });
    let stderrTail = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-800);
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch {}
      reject(new Error(`FFMPEG_TIMEOUT_${timeoutMs}MS`));
    }, timeoutMs);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFMPEG_EXIT_${code}: ${stderrTail.trim().slice(-240)}`));
      }
    });
  });
}

let tmpSeq = 0;

function safeUnlink(filePath: string) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

/**
 * Generates a transient pre-LLM compressed MP4 in `.data/transcode-cache/`
 * while leaving `.data/buckets/` 100% lossless and untouched.
 */
export async function prepareCompressedVideoForLLM(
  opts: PrepareCompressedVideoOptions,
): Promise<PrepareCompressedVideoResult> {
  const t0 = Date.now();
  const maxBytes =
    typeof opts.maxBytes === 'number' && Number.isFinite(opts.maxBytes) && opts.maxBytes > 0
      ? Math.floor(opts.maxBytes)
      : DEFAULT_MAX_COMPRESSED_BYTES;

  let originalBytes = 0;
  try {
    originalBytes = fs.statSync(opts.bucketPath).size;
  } catch {
    return {
      filePath: opts.bucketPath,
      compressed: false,
      originalBytes: 0,
      outputBytes: 0,
      durationMs: Date.now() - t0,
      warning: 'source video file missing on disk',
    };
  }

  const thresholdBytes = getCompressThresholdBytes();
  if (originalBytes <= thresholdBytes && hasFtypHeader(opts.bucketPath)) {
    return {
      filePath: opts.bucketPath,
      compressed: false,
      originalBytes,
      outputBytes: originalBytes,
      durationMs: Date.now() - t0,
    };
  }

  const bin = resolveFfmpegBinary();
  if (!bin.available || !bin.path) {
    return {
      filePath: opts.bucketPath,
      compressed: false,
      originalBytes,
      outputBytes: originalBytes,
      durationMs: Date.now() - t0,
      warning: 'ffmpeg unavailable',
    };
  }

  const cacheDir = path.join(process.cwd(), '.data', 'transcode-cache');
  const cacheHash = createHash('sha256')
    .update(`${opts.cacheKey}:${originalBytes}:${opts.mode}:${maxBytes}:v2`)
    .digest('hex');
  const cacheFile = path.join(cacheDir, `${cacheHash}.llm.mp4`);

  const cachedCheck = isValidCompressedMp4(cacheFile);
  if (cachedCheck.valid && cachedCheck.size <= maxBytes) {
    return {
      filePath: cacheFile,
      compressed: true,
      originalBytes,
      outputBytes: cachedCheck.size,
      durationMs: Date.now() - t0,
    };
  }

  const inflightMap = getInflightTranscodeMap();
  const inflightKey = `${cacheFile}:${maxBytes}`;
  const existing = inflightMap.get(inflightKey);
  if (existing) {
    return existing;
  }

  const runPromise = (async (): Promise<PrepareCompressedVideoResult> => {
    const seq = ++tmpSeq;
    const tmpPass1 = path.join(cacheDir, `.tmp-${process.pid}-${seq}-p1.mp4`);
    const tmpPass2 = path.join(cacheDir, `.tmp-${process.pid}-${seq}-p2.mp4`);
    try {
      fs.mkdirSync(cacheDir, { recursive: true });

      const cachedInside = isValidCompressedMp4(cacheFile);
      if (cachedInside.valid && cachedInside.size <= maxBytes) {
        return {
          filePath: cacheFile,
          compressed: true,
          originalBytes,
          outputBytes: cachedInside.size,
          durationMs: Date.now() - t0,
        };
      }

      const fpsPass1 = opts.mode === 'detailed' ? 6 : 4;
      const buildArgs = (
        shortEdge: number,
        fps: number,
        crf: number,
        maxrate: string,
        bufsize: string,
        outPath: string,
      ) => [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        opts.bucketPath,
        '-vf',
        `scale='if(lte(iw,ih),trunc(min(${shortEdge},iw)/2)*2,-2)':'if(lte(iw,ih),-2,trunc(min(${shortEdge},ih)/2)*2)',fps=${fps}`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        String(crf),
        '-maxrate',
        maxrate,
        '-bufsize',
        bufsize,
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-b:a',
        '32k',
        '-movflags',
        '+faststart',
        '-f',
        'mp4',
        outPath,
      ];

      await withFfmpegSlot(async () => {
        await runFfmpegArgs(
          bin.path!,
          buildArgs(480, fpsPass1, 28, '300k', '600k', tmpPass1),
        );
      });

      const pass1Check = isValidCompressedMp4(tmpPass1);
      if (!pass1Check.valid) {
        throw new Error('FFMPEG_INVALID_PASS1_OUTPUT');
      }

      let finalTmp = tmpPass1;
      let finalBytes = pass1Check.size;

      if (pass1Check.size > maxBytes) {
        await withFfmpegSlot(async () => {
          await runFfmpegArgs(
            bin.path!,
            buildArgs(360, 2, 32, '200k', '400k', tmpPass2),
          );
        });
        const pass2Check = isValidCompressedMp4(tmpPass2);
        if (pass2Check.valid && pass2Check.size < pass1Check.size) {
          finalTmp = tmpPass2;
          finalBytes = pass2Check.size;
          safeUnlink(tmpPass1);
        } else {
          safeUnlink(tmpPass2);
        }
      }

      fs.renameSync(finalTmp, cacheFile);
      return {
        filePath: cacheFile,
        compressed: true,
        originalBytes,
        outputBytes: finalBytes,
        durationMs: Date.now() - t0,
      };
    } catch (err: any) {
      safeUnlink(tmpPass1);
      safeUnlink(tmpPass2);
      return {
        filePath: opts.bucketPath,
        compressed: false,
        originalBytes,
        outputBytes: originalBytes,
        durationMs: Date.now() - t0,
        warning: String(err?.message || 'video compression failed').slice(0, 180),
      };
    } finally {
      inflightMap.delete(inflightKey);
    }
  })();

  inflightMap.set(inflightKey, runPromise);
  return runPromise;
}
