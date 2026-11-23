import {
  inspectTranscribeBodiesDelivery,
  isKnownFakeTranscribeFallback,
} from './transcribe-delivery-guard';
import {
  hasOverlappingSourceCoverage,
  hasUnmappedSourceMaterials,
  uniqueValidSourceEpisodes,
} from './source-materials';
import { parseEpisodeBodiesFromSingleSource } from './transcribe-parse';
import type { Attachment, RemoteState, StudioEpisode, StudioMessage } from './types';

export interface TranscribeDeliveryReadyResult {
  ready: boolean;
  code: string;
  reason: string;
  expectedEpisodes: number[];
  missingEpisodes: number[];
  invalidEpisodes: number[];
}

export interface TranscribeStartFeedback {
  success: boolean;
  toast: string;
  error: string;
}

const TRANSCRIBE_DELIVERED_TOAST = '扒剧已完成，规范 Word（.docx）已可直接下载！';
const MAX_TOTAL_EPISODES = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidEpisodeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_TOTAL_EPISODES;
}

function makeNotReady(
  code: string,
  reason: string,
  expectedEpisodes: number[] = [],
  missingEpisodes: number[] = [],
  invalidEpisodes: number[] = [],
): TranscribeDeliveryReadyResult {
  return {
    ready: false,
    code,
    reason,
    expectedEpisodes,
    missingEpisodes,
    invalidEpisodes,
  };
}

function formatEpisodeList(episodes: number[]): string {
  const safe = episodes.filter((ep) => isValidEpisodeNumber(ep));
  if (safe.length === 0) return '';
  return safe.map((ep) => `第${ep}集`).join('、');
}

function extractAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Attachment => isRecord(item));
}

function extractRemote(raw: unknown): RemoteState | null {
  if (!isRecord(raw)) return null;
  return raw as unknown as RemoteState;
}

function extractScriptContent(remote: RemoteState | null): string {
  if (!remote || !isRecord(remote.outputs)) return '';
  const script = (remote.outputs as Record<string, unknown>).script;
  if (!isRecord(script)) return '';
  return typeof script.content === 'string' ? script.content : '';
}

function extractEpisodeBodiesFromList(rawEpisodes: unknown): {
  ok: boolean;
  hasNonEmptyArray: boolean;
  bodies: Map<number, string>;
} {
  if (!Array.isArray(rawEpisodes) || rawEpisodes.length === 0) {
    return { ok: true, hasNonEmptyArray: false, bodies: new Map<number, string>() };
  }

  const bodies = new Map<number, string>();
  for (const item of rawEpisodes as StudioEpisode[]) {
    if (!isRecord(item)) {
      return { ok: false, hasNonEmptyArray: true, bodies: new Map<number, string>() };
    }
    const epNum = item.episodeNumber;
    const body = item.body;
    if (!isValidEpisodeNumber(epNum) || typeof body !== 'string') {
      return { ok: false, hasNonEmptyArray: true, bodies: new Map<number, string>() };
    }
    if (bodies.has(epNum)) {
      return { ok: false, hasNonEmptyArray: true, bodies: new Map<number, string>() };
    }
    bodies.set(epNum, body);
  }

  return { ok: true, hasNonEmptyArray: true, bodies };
}

export function inspectTranscribeProjectDeliveryReady(project: unknown): TranscribeDeliveryReadyResult {
  const proj = isRecord(project) ? project : {};
  const remote = extractRemote(proj.remote);
  const status = typeof remote?.status === 'string' ? remote.status.trim() : '';
  const stageKey = isRecord(remote?.stage) && typeof remote.stage.key === 'string'
    ? remote.stage.key.trim()
    : '';

  if (status === 'failed') {
    if (stageKey === 'transcribe_incomplete') {
      return makeNotReady(
        'TRANSCRIBE_INCOMPLETE',
        '扒剧分集正文未完整通过验收，请检查上传的视频或字幕素材是否完整清晰，并核对「扒剧未验收草稿」。',
      );
    }
    return makeNotReady(
      'TRANSCRIBE_FAILED',
      '扒剧执行未通过验收，请检查上传的视频或字幕素材是否完整清晰，并核对「扒剧未验收草稿」。',
    );
  }

  if (status === 'running') {
    return makeNotReady(
      'TRANSCRIBE_RUNNING',
      '扒剧任务正在运行中，请耐心等待当前进度完成，请勿重复触发。',
    );
  }

  if (status !== 'delivered') {
    return makeNotReady(
      'TRANSCRIBE_NOT_DELIVERED',
      '扒剧尚未完成正式交付，当前暂不可导出正式分集稿，请等待执行完成或核对「扒剧未验收草稿」。',
    );
  }

  const attachments = extractAttachments(proj.attachments);
  if (hasOverlappingSourceCoverage(attachments)) {
    return makeNotReady(
      'EPISODE_COVERAGE_CONFLICT',
      '上传的源素材存在集数覆盖冲突，请调整素材分集映射后再进行正式交付。',
    );
  }

  if (hasUnmappedSourceMaterials(attachments)) {
    return makeNotReady(
      'EPISODE_MAPPING_REQUIRED',
      '存在未映射具体集数的源素材，请先为全部素材指定对应集数后再进行正式交付。',
    );
  }

  const sourceEpisodes = uniqueValidSourceEpisodes(attachments);
  const rawTotal = proj.total;
  const hasValidTotal = isValidEpisodeNumber(rawTotal);
  const total = hasValidTotal ? rawTotal : null;

  let expectedEpisodes: number[] = [];
  if (sourceEpisodes.length > 0) {
    if (total !== null && sourceEpisodes.some((ep) => ep > total)) {
      return makeNotReady(
        'TARGET_EPISODES_MISMATCH',
        '源素材映射的集号超出项目总集数设定，请核对目标总集数与素材分集映射。',
      );
    }
    expectedEpisodes = sourceEpisodes;
  } else if (total !== null) {
    expectedEpisodes = Array.from({ length: total }, (_, idx) => idx + 1);
  } else {
    return makeNotReady(
      'EXPECTED_EPISODES_UNKNOWN',
      '无法确定预期目标集数，请先上传已映射集数的源素材或设置有效总集数。',
    );
  }

  const scriptContent = extractScriptContent(remote);
  if (scriptContent.trim().length > 0 && isKnownFakeTranscribeFallback(scriptContent)) {
    return makeNotReady(
      'FAKE_PLACEHOLDER_SCRIPT',
      '检测到占位或模拟试运行脚本，尚未生成可交付的真实分集正文，请检查上传的视频或字幕素材是否完整清晰。',
      expectedEpisodes,
    );
  }

  const extracted = extractEpisodeBodiesFromList(proj.episodes);
  if (!extracted.ok) {
    return makeNotReady(
      'DUPLICATE_EPISODE_NUMBER',
      '分集正文数据存在重复或非法集号，暂未通过交付校验，请核对「扒剧未验收草稿」。',
      expectedEpisodes,
    );
  }

  let bodies = extracted.bodies;
  if (!extracted.hasNonEmptyArray) {
    bodies = parseEpisodeBodiesFromSingleSource(scriptContent);
  }

  for (const body of bodies.values()) {
    if (body.trim().length > 0 && isKnownFakeTranscribeFallback(body)) {
      return makeNotReady(
        'FAKE_PLACEHOLDER_SCRIPT',
        '检测到占位或模拟试运行脚本，尚未生成可交付的真实分集正文，请检查上传的视频或字幕素材是否完整清晰。',
        expectedEpisodes,
      );
    }
  }

  const check = inspectTranscribeBodiesDelivery(expectedEpisodes, bodies);
  if (!check.ok) {
    const missingText = formatEpisodeList(check.missingEpisodes);
    const invalidText = formatEpisodeList(check.invalidEpisodes);
    const parts: string[] = [];
    if (missingText) parts.push(`缺失${missingText}`);
    if (invalidText) parts.push(`${invalidText}正文格式或内容不完整`);
    const detail = parts.length > 0 ? `（${parts.join('，')}）` : '';

    return makeNotReady(
      'DELIVERY_CONTENT_INVALID',
      `目标分集正文未通过完整度验收${detail}，请检查上传的视频或字幕素材是否完整清晰，并核对「扒剧未验收草稿」。`,
      expectedEpisodes,
      check.missingEpisodes,
      check.invalidEpisodes,
    );
  }

  // Keep reference to StudioMessage type for strict type-only usage compatibility
  const _messagesCheck: StudioMessage[] | undefined = Array.isArray(proj.messages)
    ? (proj.messages as StudioMessage[])
    : undefined;
  void _messagesCheck;

  return {
    ready: true,
    code: 'DELIVERED_READY',
    reason: '所有目标分集正文已通过完整度验收。',
    expectedEpisodes,
    missingEpisodes: [],
    invalidEpisodes: [],
  };
}

export function resolveTranscribeStartFeedback(project: unknown): TranscribeStartFeedback {
  const res = inspectTranscribeProjectDeliveryReady(project);
  if (res.ready) {
    return {
      success: true,
      toast: TRANSCRIBE_DELIVERED_TOAST,
      error: '',
    };
  }
  return {
    success: false,
    toast: '',
    error: res.reason,
  };
}
