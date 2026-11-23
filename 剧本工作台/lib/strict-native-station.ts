import { postNativeOnce, type NativeMediaInput, type GeminiUsage } from './gemini-native-sse';

export type StrictUsageStatus = 'known' | 'unknown';

export interface StrictNativeStationInput {
  station: string;
  userPrompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  mediaAttachments?: NativeMediaInput[];
  timeoutMs?: number;
  fetchImpl?: typeof globalThis.fetch;
  transcribeMode?: 'fast' | 'detailed';
}

export interface StrictNativeStationAudit {
  tokens: number;
  estimatedCostUsd: number;
  usageStatus: StrictUsageStatus;
  mediaCount: number;
  mediaMimes: string[];
  inputTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
  diagnostic?: StrictNativeDiagnostic;
}

export interface StrictNativeDiagnostic {
  phases: Record<string, number>;
  lastPhase: string;
  elapsedMs: number;
  timeoutMs: number;
  localDeadline: boolean;
  reasonCode: string;
  httpStatus?: number;
}

export interface StrictNativeStationResult {
  ok: boolean;
  text: string | null;
  /** Internal only: exact model text before trim and notice. Never send to the front-end. */
  rawText?: string;
  error?: string;
  audit: StrictNativeStationAudit;
}

const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 180_000;
const MIN_TIMEOUT_MS = 10;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_VIDEO_BYTES = 19 * 1024 * 1024;
const MIN_VIDEO_BYTES = 12;

const FULL_VIDEO_FAST_ONLY_ERROR =
  '完整视频原生分析目前仅支持“快速”转录模式；详细模式所需的完整分段分析能力尚未提供，已拒绝执行，未发起任何请求，也不会用抽样画面冒充详细结果。';
const FULL_VIDEO_MISSING_ERROR =
  '未检测到完整的 MP4 视频（video/mp4），无法发起完整视频分析；未发起任何请求。';
const FULL_VIDEO_MULTIPLE_ERROR =
  '检测到多个 MP4 视频，完整视频分析只接受一个视频；未发起任何请求。';
const FULL_VIDEO_INVALID_ERROR =
  'MP4 视频无效：需为纯 base64（不含空白、链接或 data URI）、解码后不超过 19MiB 且为有效 MP4 文件；未发起任何请求。';

function isValidMp4Base64(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length < 16 || value.length % 4 !== 0) return false;
  if (!BASE64_RE.test(value)) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const decodedBytes = (value.length / 4) * 3 - padding;
  if (decodedBytes < MIN_VIDEO_BYTES || decodedBytes > MAX_VIDEO_BYTES) return false;
  const head = Buffer.from(value.slice(0, 16), 'base64');
  return head.length >= MIN_VIDEO_BYTES && head.toString('latin1', 4, 8) === 'ftyp';
}

const VISUAL_ONLY_NOTICE =
  '【媒体采样说明：本结果仅基于第1集已提取的抽样关键帧（及画面内可读字幕）生成，未使用音频音轨，亦未读取完整视频流；凡画面未直接呈现的对白、人物姓名或剧情细节均未作虚构补全。】';

export function isStrictNativeGeminiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env?.STUDIO_STRICT_NATIVE_GEMINI ?? '').trim() === '1';
}

function emptyAudit(mediaCount = 0, mediaMimes: string[] = []): StrictNativeStationAudit {
  return {
    tokens: 0,
    estimatedCostUsd: 0,
    usageStatus: 'unknown',
    mediaCount,
    mediaMimes,
  };
}

function isValidJpegBase64(raw: string): { valid: boolean; compact: string } {
  if (typeof raw !== 'string') return { valid: false, compact: '' };
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed || lower.startsWith('data:') || lower.startsWith('http://') || lower.startsWith('https://')) {
    return { valid: false, compact: '' };
  }
  const compact = trimmed.replace(/\s+/g, '');
  if (!compact || compact.length % 4 !== 0 || !BASE64_RE.test(compact)) {
    return { valid: false, compact: '' };
  }
  const buf = Buffer.from(compact, 'base64');
  if (buf.length < 3 || buf.length > MAX_IMAGE_BYTES) {
    return { valid: false, compact: '' };
  }
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
    return { valid: false, compact: '' };
  }
  return { valid: true, compact };
}

function resolveUsageAudit(usage: GeminiUsage | null, mediaCount: number, mediaMimes: string[]): StrictNativeStationAudit {
  if (!usage) return emptyAudit(mediaCount, mediaMimes);
  const p = usage.promptTokenCount;
  const c = usage.candidatesTokenCount;
  const t = usage.thoughtsTokenCount ?? 0;
  const total = usage.totalTokenCount;

  const hasParts =
    typeof p === 'number' && Number.isFinite(p) && p >= 0 &&
    typeof c === 'number' && Number.isFinite(c) && c >= 0 &&
    typeof t === 'number' && Number.isFinite(t) && t >= 0;

  let resolvedTokens: number | null = null;
  if (typeof total === 'number' && Number.isFinite(total) && total >= 0) {
    resolvedTokens = total;
  } else if (hasParts) {
    resolvedTokens = p + c + t;
  }

  if (resolvedTokens === null || !Number.isFinite(resolvedTokens) || resolvedTokens < 0) {
    return emptyAudit(mediaCount, mediaMimes);
  }

  const audit: StrictNativeStationAudit = {
    tokens: resolvedTokens,
    estimatedCostUsd: Number(((resolvedTokens / 1000) * 0.002).toFixed(6)),
    usageStatus: 'known',
    mediaCount,
    mediaMimes,
  };
  if (typeof p === 'number' && Number.isFinite(p) && p >= 0) audit.inputTokens = p;
  if (typeof c === 'number' && Number.isFinite(c) && c >= 0) audit.outputTokens = c;
  if (typeof usage.thoughtsTokenCount === 'number' && Number.isFinite(usage.thoughtsTokenCount) && usage.thoughtsTokenCount >= 0) {
    audit.thoughtTokens = usage.thoughtsTokenCount;
  }
  return audit;
}

function mapClientError(code?: string, status?: number): string {
  if (code === 'REQUEST_FAILED' || code === 'STREAM_READ_FAILED') {
    return '原生视觉服务网络请求失败或超时，请稍后重试。';
  }
  if (code === 'HTTP_ERROR') {
    if (status === 401 || status === 403) return '原生视觉服务鉴权失败，请联系管理员检查服务端密钥配置。';
    if (status === 429) return '原生视觉服务当前请求过于频繁，请稍后重试。';
    return '原生视觉服务上游响应异常，请稍后重试。';
  }
  if (code === 'SAFETY_BLOCKED') return '原生视觉生成因内容安全策略被拦截。';
  if (code === 'OUTPUT_TRUNCATED') return '原生视觉输出未完整结束，请调整提示词或重试。';
  if (code === 'EMPTY_RESPONSE') return '原生视觉服务未返回有效文本内容。';
  return '原生视觉服务调用失败，请稍后重试。';
}

export async function runStrictNativeStation(
  input: StrictNativeStationInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<StrictNativeStationResult | null> {
  if (!isStrictNativeGeminiEnabled(env)) {
    return null;
  }

  if (input.station !== 'vision') {
    return {
      ok: false,
      text: null,
      error: '严格原生视觉通道仅开放给视觉工位，当前工位已禁止回退。',
      audit: emptyAudit(),
    };
  }

  const apiKey = String(env?.STUDIO_STRICT_NATIVE_API_KEY ?? '').trim();
  if (!apiKey) {
    return {
      ok: false,
      text: null,
      error: '服务端缺少原生视觉服务密钥配置，请联系管理员。',
      audit: emptyAudit(),
    };
  }

  const fullVideoMode = process.env.STUDIO_STRICT_NATIVE_FULL_VIDEO === '1';
  let fullVideo: NativeMediaInput | null = null;
  if (fullVideoMode) {
    if (input.transcribeMode !== 'fast') {
      return { ok: false, text: null, error: FULL_VIDEO_FAST_ONLY_ERROR, audit: emptyAudit(0, []) };
    }
    const candidates = (Array.isArray(input.mediaAttachments) ? input.mediaAttachments : []).filter(
      (item) =>
        !!item &&
        typeof item === 'object' &&
        typeof item.mimeType === 'string' &&
        item.mimeType.trim().toLowerCase() === 'video/mp4'
    );
    if (candidates.length === 0) {
      return { ok: false, text: null, error: FULL_VIDEO_MISSING_ERROR, audit: emptyAudit(0, []) };
    }
    if (candidates.length > 1) {
      return { ok: false, text: null, error: FULL_VIDEO_MULTIPLE_ERROR, audit: emptyAudit(0, []) };
    }
    const candidate = candidates[0];
    if (
      'image_url' in candidate ||
      'url' in candidate ||
      'dataUri' in candidate ||
      !isValidMp4Base64(candidate.base64)
    ) {
      return { ok: false, text: null, error: FULL_VIDEO_INVALID_ERROR, audit: emptyAudit(0, []) };
    }
    fullVideo = {
      name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : 'video.mp4',
      mimeType: 'video/mp4',
      base64: candidate.base64,
    };
  }

  const rawList: NativeMediaInput[] = fullVideo
    ? []
    : Array.isArray(input.mediaAttachments)
      ? input.mediaAttachments
      : [];
  const validJpegs: NativeMediaInput[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    if ('image_url' in item || 'url' in item || 'dataUri' in item) continue;
    const mime = typeof item.mimeType === 'string' ? item.mimeType.trim().toLowerCase() : '';
    if (mime !== 'image/jpeg') continue;
    const checked = isValidJpegBase64(item.base64);
    if (!checked.valid) continue;
    validJpegs.push({
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `frame_${validJpegs.length + 1}.jpg`,
      mimeType: 'image/jpeg',
      base64: checked.compact,
    });
    if (validJpegs.length >= MAX_IMAGES) break;
  }

  const sendMedia: NativeMediaInput[] = fullVideo ? [fullVideo] : validJpegs;
  const mediaCount = sendMedia.length;
  const mediaMimes: string[] = fullVideo ? ['video/mp4'] : validJpegs.map(() => 'image/jpeg');

  if (mediaCount === 0) {
    return {
      ok: false,
      text: null,
      error: '未检测到有效的第1集 JPEG 关键帧图片（已忽略原片视频），无法发起视觉分析。',
      audit: emptyAudit(0, []),
    };
  }

  const userPrompt = typeof input.userPrompt === 'string' ? input.userPrompt.trim() : '';
  if (!userPrompt) {
    return {
      ok: false,
      text: null,
      error: '视觉分析提示词不能为空。',
      audit: emptyAudit(mediaCount, mediaMimes),
    };
  }

  const groundedPrompt = fullVideo
    ? `${userPrompt}\n\n【严格真实性约束】请基于提供的完整 MP4 视频作答，同时使用其中的画面与声音（对白、旁白、音效）；严禁虚构视频中未出现的人物姓名、对白或剧情事件；无法确认的内容请如实说明。`
    : `${userPrompt}\n\n【严格真实性约束】仅依据提供的第1集抽样 JPEG 关键帧及画面可读字幕作答；未使用任何音轨，也未读取完整视频；严禁虚构未出现的人物姓名、对白或未见剧情事件，不要自称为完整视频的忠实还原。`;

  const rawTimeout = typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs) ? input.timeoutMs : DEFAULT_TIMEOUT_MS;
  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(rawTimeout)));

  const baseFetch = input.fetchImpl || globalThis.fetch;
  let called = 0;
  const controller = new AbortController();
  const startedAt = Date.now();
  const phases: Record<string, number> = {};
  const knownPhases = new Set([
    'payload_prepare', 'request_start', 'response_headers', 'response_body',
    'first_chunk', 'body_complete', 'parse', 'complete',
  ]);
  let lastPhase = 'init';
  let httpStatus: number | undefined;
  let localDeadline = false;
  const timer = setTimeout(() => {
    localDeadline = true;
    controller.abort();
  }, timeoutMs);
  const onPhase = (phase: string, status?: number) => {
    if (!knownPhases.has(phase) || phases[phase] !== undefined) return;
    phases[phase] = Date.now() - startedAt;
    lastPhase = phase;
    if (typeof status === 'number' && Number.isFinite(status)) httpStatus = Math.trunc(status);
  };
  const diag = (reasonCode: string): StrictNativeDiagnostic => ({
    phases: { ...phases },
    lastPhase,
    elapsedMs: Date.now() - startedAt,
    timeoutMs,
    localDeadline,
    reasonCode,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
  });

  const fetchWrapper: typeof globalThis.fetch = async (url, init) => {
    called += 1;
    if (called > 1) {
      throw new Error('STRICT_SINGLE_ATTEMPT_VIOLATION');
    }
    const headers = new Headers(init?.headers);
    headers.set('User-Agent', 'curl/8.5.0');
    return baseFetch(url, {
      ...init,
      headers,
      redirect: 'error',
      signal: controller.signal,
    });
  };

  try {
    const res = await postNativeOnce(
      {
        apiKey,
        userText: groundedPrompt,
        images: sendMedia,
        systemText: input.systemPrompt,
        temperature: input.temperature,
        maxOutputTokens: input.maxTokens,
      },
      fetchWrapper,
      onPhase
    );

    const audit = resolveUsageAudit(res.usage, mediaCount, mediaMimes);
    const failCode = res.ok
      ? 'NON_STOP_OR_EMPTY'
      : /^[A-Z][A-Z0-9_]{0,63}$/.test(String(res.error ?? ''))
      ? String(res.error)
      : 'NATIVE_FAILED';

    if (!res.ok || res.finish !== 'STOP' || !res.text || !res.text.trim()) {
      return {
        ok: false,
        text: null,
        error: mapClientError(res.error, res.status),
        audit: { ...audit, diagnostic: diag(failCode) },
      };
    }

    const finalText = fullVideo
      ? res.text.trim()
      : res.text.includes('本结果仅基于第1集已提取的抽样关键帧')
      ? res.text.trim()
      : `${VISUAL_ONLY_NOTICE}\n\n${res.text.trim()}`;

    return {
      ok: true,
      text: finalText,
      rawText: res.text,
      audit: { ...audit, diagnostic: diag('OK') },
    };
  } catch (err) {
    const errName = (err as { name?: unknown } | null)?.name;
    return {
      ok: false,
      text: null,
      error: '原生视觉服务请求异常或已超时，请稍后重试。',
      audit: {
        ...emptyAudit(mediaCount, mediaMimes),
        diagnostic: diag(localDeadline ? 'LOCAL_DEADLINE' : errName === 'AbortError' ? 'EXTERNAL_ABORT' : 'EXCEPTION'),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
