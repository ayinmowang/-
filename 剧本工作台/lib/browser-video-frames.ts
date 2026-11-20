export const MULTIMODAL_VIDEO_CAP_BYTES = 30 * 1024 * 1024;

export interface ExtractedVideoFrame {
  timestampSec: number;
  width: number;
  height: number;
  blob?: Blob;
  dataUrl?: string;
}

export interface ExtractVideoFramesResult {
  frames: ExtractedVideoFrame[];
  frameCount: number;
  skippedEmpty: number;
  durationSec?: number;
}

export interface VideoLike {
  preload?: string;
  muted?: boolean;
  playsInline?: boolean;
  crossOrigin?: string | null;
  src: string;
  currentTime: number;
  readonly duration?: number;
  readonly videoWidth?: number;
  readonly videoHeight?: number;
  readonly readyState?: number;
  addEventListener: (type: string, listener: (ev?: unknown) => void, options?: unknown) => void;
  removeEventListener: (type: string, listener: (ev?: unknown) => void) => void;
  load?: () => void;
  pause?: () => void;
  removeAttribute?: (name: string) => void;
}

export interface CanvasContext2DLike {
  drawImage: (image: unknown, dx: number, dy: number, dw?: number, dh?: number) => void;
  getImageData?: (
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ) => { data: ArrayLike<number> };
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext: (type: '2d') => CanvasContext2DLike | null;
  toBlob?: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void;
  toDataURL?: (type?: string, quality?: number) => string;
}

export interface DocumentLike {
  createElement: (tag: string) => unknown;
}

export interface UrlApiLike {
  createObjectURL: (obj: Blob) => string;
  revokeObjectURL: (url: string) => void;
}

export interface ExtractVideoFramesOptions {
  maxFrames?: number;
  intervalSec?: number;
  maxDimension?: number;
  quality?: number;
  mimeType?: string;
  signal?: AbortSignal;
  document?: DocumentLike;
  urlApi?: UrlApiLike;
  onProgress?: (info: { current: number; total: number; timestampSec: number }) => void;
}

export interface FallbackLimitsInput {
  hasAudioTrack?: boolean | null;
  hasSubtitleSource?: boolean | null;
  ffmpegAvailable?: boolean | null;
}

const DEFAULT_MAX_FRAMES = 10;
const HARD_MAX_FRAMES = 16;
const DEFAULT_MAX_DIMENSION = 960;
const DEFAULT_QUALITY = 0.82;
const DEFAULT_MIME_TYPE = 'image/jpeg';

function createAbortError(message = '关键帧提取已取消'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function isFrameNearlyEmpty(ctx: CanvasContext2DLike, width: number, height: number): boolean {
  if (typeof ctx.getImageData !== 'function') {
    return false;
  }
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  let imageData: { data: ArrayLike<number> };
  try {
    imageData = ctx.getImageData(0, 0, w, h);
  } catch {
    return false;
  }
  const data = imageData?.data;
  if (!data || data.length < 4) {
    return false;
  }

  const totalPixels = Math.floor(data.length / 4);
  const step = Math.max(1, Math.floor(totalPixels / 512));
  let sampled = 0;
  let visibleCount = 0;
  let brightCount = 0;
  let lumaSum = 0;

  for (let p = 0; p < totalPixels; p += step) {
    const idx = p * 4;
    const r = Number(data[idx] ?? 0);
    const g = Number(data[idx + 1] ?? 0);
    const b = Number(data[idx + 2] ?? 0);
    const a = Number(data[idx + 3] ?? 255);
    sampled += 1;

    if (a > 12) {
      visibleCount += 1;
    }
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lumaSum += luma;
    if (a > 12 && luma > 14) {
      brightCount += 1;
    }
  }

  if (sampled === 0) return false;
  const visibleRatio = visibleCount / sampled;
  if (visibleRatio < 0.05) {
    return true;
  }
  const meanLuma = lumaSum / sampled;
  const brightRatio = brightCount / sampled;
  return meanLuma < 8 && brightRatio < 0.03;
}

function buildSampleTimestamps(
  durationSec: number | undefined,
  maxFrames: number,
  intervalSec?: number,
): number[] {
  const safeMax = Math.max(1, Math.min(HARD_MAX_FRAMES, Math.floor(maxFrames)));
  const validDuration =
    typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0
      ? durationSec
      : undefined;

  if (!validDuration) {
    return [0];
  }

  const maxSeek = Math.max(0, validDuration - Math.min(0.05, validDuration * 0.02));
  const raw: number[] = [];

  if (typeof intervalSec === 'number' && Number.isFinite(intervalSec) && intervalSec > 0) {
    for (let t = 0; t <= maxSeek && raw.length < safeMax; t += intervalSec) {
      raw.push(Number(t.toFixed(3)));
    }
    if (raw.length === 0) {
      raw.push(0);
    }
    const tail = Number(maxSeek.toFixed(3));
    if (raw.length < safeMax && tail - raw[raw.length - 1] > 0.02) {
      raw.push(tail);
    }
    return raw;
  }

  if (validDuration <= 0.4 || safeMax === 1) {
    return [0];
  }

  const count = Math.min(safeMax, Math.max(1, Math.ceil(validDuration / 2)));
  if (count === 1) {
    return [0];
  }

  for (let i = 0; i < count; i++) {
    const ratio = i / (count - 1);
    const t = Number((ratio * maxSeek).toFixed(3));
    if (raw.length === 0 || Math.abs(t - raw[raw.length - 1]) >= 0.02) {
      raw.push(t);
    }
  }
  return raw.length > 0 ? raw : [0];
}

function waitForMetadata(video: VideoLike, signal?: AbortSignal): Promise<void> {
  if ((video.readyState ?? 0) >= 1 && (video.videoWidth ?? 0) > 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    throwIfAborted(signal);
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('浏览器无法解码该视频元数据'));
    };
    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function seekToTime(video: VideoLike, targetSec: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    throwIfAborted(signal);
    const alreadyAtTarget =
      Math.abs((video.currentTime || 0) - targetSec) < 0.001 && (video.readyState ?? 0) >= 2;
    if (alreadyAtTarget) {
      resolve();
      return;
    }

    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onSeeked);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`视频定位到 ${targetSec.toFixed(2)}s 失败`));
    };
    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadeddata', onSeeked);
    video.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    video.currentTime = targetSec;
  });
}

function canvasToFramePayload(
  canvas: CanvasLike,
  mimeType: string,
  quality: number,
): Promise<{ blob?: Blob; dataUrl?: string }> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve({ blob });
            return;
          }
          const dataUrl =
            typeof canvas.toDataURL === 'function' ? canvas.toDataURL(mimeType, quality) : undefined;
          resolve({ dataUrl });
        },
        mimeType,
        quality,
      );
      return;
    }
    const dataUrl =
      typeof canvas.toDataURL === 'function' ? canvas.toDataURL(mimeType, quality) : undefined;
    resolve({ dataUrl });
  });
}

export async function extractVideoFramesWithCanvas(
  file: Blob,
  options: ExtractVideoFramesOptions = {},
): Promise<ExtractVideoFramesResult> {
  const {
    maxFrames = DEFAULT_MAX_FRAMES,
    intervalSec,
    maxDimension = DEFAULT_MAX_DIMENSION,
    quality = DEFAULT_QUALITY,
    mimeType = DEFAULT_MIME_TYPE,
    signal,
    onProgress,
  } = options;

  throwIfAborted(signal);

  const doc: DocumentLike | undefined =
    options.document ?? (typeof document !== 'undefined' ? (document as unknown as DocumentLike) : undefined);
  const urlApi: UrlApiLike | undefined =
    options.urlApi ?? (typeof URL !== 'undefined' ? (URL as unknown as UrlApiLike) : undefined);

  if (!doc || typeof doc.createElement !== 'function') {
    throw new Error('当前环境不支持 video+canvas 关键帧提取');
  }
  if (!urlApi || typeof urlApi.createObjectURL !== 'function') {
    throw new Error('当前环境不支持 ObjectURL 视频解码');
  }

  const objectUrl = urlApi.createObjectURL(file);
  const video = doc.createElement('video') as VideoLike;
  const canvas = doc.createElement('canvas') as CanvasLike;
  const frames: ExtractedVideoFrame[] = [];
  let skippedEmpty = 0;
  let durationSec: number | undefined;

  try {
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;
    if (typeof video.load === 'function') {
      video.load();
    }

    await waitForMetadata(video, signal);
    throwIfAborted(signal);

    if (typeof video.duration === 'number' && Number.isFinite(video.duration) && video.duration > 0) {
      durationSec = Number(video.duration.toFixed(3));
    }

    const srcWidth = Math.max(1, Number(video.videoWidth) || 640);
    const srcHeight = Math.max(1, Number(video.videoHeight) || 360);
    const scale = Math.min(1, maxDimension / Math.max(srcWidth, srcHeight));
    const targetWidth = Math.max(1, Math.round(srcWidth * scale));
    const targetHeight = Math.max(1, Math.round(srcHeight * scale));

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('无法初始化 2D Canvas 上下文');
    }

    const timestamps = buildSampleTimestamps(durationSec, maxFrames, intervalSec);

    for (let i = 0; i < timestamps.length; i++) {
      throwIfAborted(signal);
      const ts = timestamps[i];
      onProgress?.({ current: i + 1, total: timestamps.length, timestampSec: ts });

      await seekToTime(video, ts, signal);
      throwIfAborted(signal);

      ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

      if (isFrameNearlyEmpty(ctx, targetWidth, targetHeight)) {
        skippedEmpty += 1;
        continue;
      }

      const payload = await canvasToFramePayload(canvas, mimeType, quality);
      throwIfAborted(signal);

      if (!payload.blob && !payload.dataUrl) {
        skippedEmpty += 1;
        continue;
      }

      frames.push({
        timestampSec: ts,
        width: targetWidth,
        height: targetHeight,
        ...(payload.blob ? { blob: payload.blob } : {}),
        ...(payload.dataUrl ? { dataUrl: payload.dataUrl } : {}),
      });
    }

    return {
      frames,
      frameCount: frames.length,
      skippedEmpty,
      ...(durationSec !== undefined ? { durationSec } : {}),
    };
  } finally {
    try {
      video.pause?.();
      if (typeof video.removeAttribute === 'function') {
        video.removeAttribute('src');
      } else {
        video.src = '';
      }
      video.load?.();
    } catch {}
    try {
      urlApi.revokeObjectURL(objectUrl);
    } catch {}
  }
}

export function describeFallbackLimits({
  hasAudioTrack,
  hasSubtitleSource,
  ffmpegAvailable,
}: FallbackLimitsInput): string[] {
  const notes: string[] = [];

  if (ffmpegAvailable === false) {
    notes.push('服务端未启用 ffmpeg，已改用浏览器 video+canvas 抽帧提取视觉关键帧。');
  } else {
    notes.push('视频体积超过 30MB 多模态上限，已改用浏览器 video+canvas 抽帧提取视觉关键帧。');
  }

  if (hasAudioTrack !== true) {
    notes.push('未使用音轨、不能假装听到任何声音或口播内容。');
  }

  if (hasSubtitleSource !== true) {
    notes.push('无字幕来源，不编造对白与台词。');
  }

  return notes;
}
