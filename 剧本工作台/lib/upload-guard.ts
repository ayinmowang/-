import fs from 'node:fs';
import path from 'node:path';

/**
 * 磁盘安全预留空间（512 MiB），防止大文件上传写满宿主盘。
 */
export const DISK_RESERVE_BYTES = 512 * 1024 * 1024;

const DEFAULT_STANDARD_UPLOAD_BYTES = 200 * 1024 * 1024;
const DEFAULT_TRANSCRIBE_UPLOAD_BYTES = 4096 * 1024 * 1024;

function isTruthyEnv(val: string | undefined): boolean {
  if (!val) return false;
  const v = val.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function hasFfmpegBinary(): boolean {
  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const isWin = process.platform === 'win32';
  const names = isWin ? ['ffmpeg.exe', 'ffmpeg.cmd', 'ffmpeg.bat', 'ffmpeg'] : ['ffmpeg'];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, isWin ? fs.constants.F_OK : fs.constants.X_OK);
        const st = fs.statSync(candidate);
        if (st.isFile()) return true;
      } catch {
        // continue
      }
    }
  }
  return false;
}

/**
 * 判断环境是否禁用了 ffmpeg 或当前进程 PATH 中不可见 ffmpeg 可执行文件。
 * 仅反映二进制可用性配置，不代表已完成服务端自动抽帧。
 */
export function isFfmpegDisabled(): boolean {
  if (isTruthyEnv(process.env.STUDIO_FFMPEG_DISABLED)) {
    return true;
  }
  return !hasFfmpegBinary();
}

function getConfiguredBaseUploadBytes(
  kind?: 'foreign' | 'domestic' | 'transcribe' | 'original' | string,
): number {
  const envMbRaw = process.env.STUDIO_MAX_UPLOAD_MB;
  if (envMbRaw !== undefined && envMbRaw.trim() !== '') {
    const parsedMb = Number(envMbRaw);
    if (Number.isFinite(parsedMb) && parsedMb > 0) {
      return Math.floor(parsedMb * 1024 * 1024);
    }
  }
  if (!kind || kind === 'transcribe') {
    return DEFAULT_TRANSCRIBE_UPLOAD_BYTES;
  }
  return DEFAULT_STANDARD_UPLOAD_BYTES;
}

function resolveExistingStatPath(targetDir: string): string {
  let current = path.resolve(targetDir);
  while (true) {
    try {
      if (fs.existsSync(current)) return current;
    } catch {
      // ignore and walk up
    }
    const parent = path.dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
}

function getBucketDiskAvailableBytes(): number | null {
  try {
    const bucketDir = path.join(process.cwd(), '.data', 'buckets');
    const existingPath = resolveExistingStatPath(bucketDir);
    if (typeof fs.statfsSync !== 'function') return null;
    const stats = fs.statfsSync(existingPath);
    const bavail = Number(stats.bavail);
    const bsize = Number(stats.bsize);
    if (!Number.isFinite(bavail) || !Number.isFinite(bsize) || bavail < 0 || bsize <= 0) {
      return null;
    }
    return Math.floor(bavail * bsize);
  } catch {
    return null;
  }
}

/**
 * 计算实际生效的单文件上传字节上限：
 * 1. 先按 STUDIO_MAX_UPLOAD_MB (>0) 或默认规则（transcribe/空=4096MiB，其余=200MiB）取配置上限；
 * 2. 若能读取 .data/buckets 所在分区的可用空间，则与 max(0, diskAvail - DISK_RESERVE_BYTES) 取较小值；
 * 3. 若 statfs 失败，保守回退至配置上限，不因探测异常将上限归零。
 */
export function getEffectiveUploadLimit(
  kind?: 'foreign' | 'domestic' | 'transcribe' | 'original' | string,
): number {
  const baseLimit = getConfiguredBaseUploadBytes(kind);
  const diskAvail = getBucketDiskAvailableBytes();
  if (diskAvail === null) {
    return baseLimit;
  }
  const safeDiskBudget = Math.max(0, diskAvail - DISK_RESERVE_BYTES);
  return Math.min(baseLimit, safeDiskBudget);
}

function getMaxConcurrentUploads(): number {
  const raw = process.env.STUDIO_MAX_CONCURRENT_UPLOADS;
  if (raw !== undefined && raw.trim() !== '') {
    const parsed = Math.floor(Number(raw));
    if (Number.isFinite(parsed) && parsed >= 1) {
      return parsed;
    }
  }
  return 2;
}

let activeUploads = 0;
const waitQueue: Array<() => void> = [];

/**
 * 获取上传并发槽位；超出 STUDIO_MAX_CONCURRENT_UPLOADS（默认 2）时异步排队。
 * 调用方必须在 try/finally 中调用返回的释放函数。
 */
export async function acquireUploadSlot(): Promise<() => void> {
  const limit = getMaxConcurrentUploads();
  if (activeUploads >= limit) {
    await new Promise<void>((resolve) => {
      waitQueue.push(resolve);
    });
  }
  activeUploads += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeUploads = Math.max(0, activeUploads - 1);
    const next = waitQueue.shift();
    if (next) {
      next();
    }
  };
}

/**
 * 校验 bucket key 路径片段安全性，拒绝路径穿越与绝对路径。
 */
export function assertSafeBucketKey(key: string): string {
  if (!key || typeof key !== 'string') {
    throw new Error('INVALID_BUCKET_KEY');
  }
  if (key.includes('\0') || key.startsWith('/') || key.startsWith('\\') || /^[a-zA-Z]:/.test(key)) {
    throw new Error('UNSAFE_BUCKET_KEY');
  }
  const segments = key.split(/[/\\]/);
  for (const seg of segments) {
    if (seg === '..') {
      throw new Error('UNSAFE_BUCKET_KEY');
    }
  }
  return key;
}
