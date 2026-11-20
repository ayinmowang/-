import type { Attachment } from './types';

export type SourceMaterialCandidate = Pick<Attachment, 'role' | 'name' | 'episode'>;

const INTERNAL_KEYFRAME_RE = /-kf-\d+-\d+ds/i;
const SOURCE_EXT_RE = /\.(mp4|mov|webm|mkv|avi|srt|ass|vtt|txt|md|docx)$/i;

export function isValidEpisodeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

export function isInternalKeyframeAttachment(item: SourceMaterialCandidate): boolean {
  if (item.role === 'setting') return true;
  const name = String(item.name || '').trim();
  return INTERNAL_KEYFRAME_RE.test(name);
}

export function isSourceMaterialAttachment(item: SourceMaterialCandidate): boolean {
  if (!item || isInternalKeyframeAttachment(item)) return false;
  if (item.role === 'source' || item.role === 'locked') return true;
  const name = String(item.name || '').trim();
  return SOURCE_EXT_RE.test(name);
}

export function getSourceMaterialAttachments<T extends SourceMaterialCandidate>(
  attachments: readonly T[] | undefined | null
): T[] {
  if (!Array.isArray(attachments)) return [];
  return attachments.filter((item) => isSourceMaterialAttachment(item));
}

export function countSourceMaterials(
  attachments: readonly SourceMaterialCandidate[] | undefined | null
): number {
  return getSourceMaterialAttachments(attachments).length;
}

export function hasUnmappedSourceMaterials(
  attachments: readonly SourceMaterialCandidate[] | undefined | null
): boolean {
  const sources = getSourceMaterialAttachments(attachments);
  return sources.some((item) => !isValidEpisodeNumber(item.episode));
}

export function uniqueValidSourceEpisodes(
  attachments: readonly SourceMaterialCandidate[] | undefined | null
): number[] {
  const sources = getSourceMaterialAttachments(attachments);
  const episodes = new Set<number>();
  for (const item of sources) {
    if (isValidEpisodeNumber(item.episode)) {
      episodes.add(item.episode);
    }
  }
  return Array.from(episodes).sort((a, b) => a - b);
}

import { SYNOPSIS_PLACEHOLDER } from './transcribe-parse';

export function resolveAutoTotalFromSources(
  attachments: readonly SourceMaterialCandidate[] | undefined | null
): number | null {
  const sources = getSourceMaterialAttachments(attachments);
  if (sources.length === 0) return null;
  if (sources.some((item) => !isValidEpisodeNumber(item.episode))) return null;
  const uniqueEpisodes = uniqueValidSourceEpisodes(sources);
  if (uniqueEpisodes.length === 0) return null;
  return Math.min(300, Math.max(...uniqueEpisodes));
}

export type SourceMaterialKind = 'video' | 'subtitle' | 'manuscript';

export interface SourceMaterialCounts {
  video: number;
  subtitle: number;
  manuscript: number;
  other: number;
}

export function classifySourceMaterialName(name: string): SourceMaterialKind | null {
  const clean = String(name || '').trim().split(/[?#]/)[0];
  const idx = clean.lastIndexOf('.');
  if (idx < 0) return null;
  const ext = clean.slice(idx + 1).toLowerCase();
  if (/^(mp4|mov|webm|mkv|avi)$/.test(ext)) return 'video';
  if (/^(srt|ass|vtt|txt)$/.test(ext)) return 'subtitle';
  if (/^(docx|md)$/.test(ext)) return 'manuscript';
  return null;
}

export function countSourceMaterialsByKind(
  attachments: readonly SourceMaterialCandidate[] | undefined | null
): SourceMaterialCounts {
  const sources = getSourceMaterialAttachments(attachments);
  const counts: SourceMaterialCounts = { video: 0, subtitle: 0, manuscript: 0, other: 0 };
  for (const item of sources) {
    const kind = classifySourceMaterialName(item.name || '');
    if (kind === 'video') counts.video += 1;
    else if (kind === 'subtitle') counts.subtitle += 1;
    else if (kind === 'manuscript') counts.manuscript += 1;
    else counts.other += 1;
  }
  return counts;
}

function formatChineseJoinedParts(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]}与 ${parts[1]}`;
  return `${parts.slice(0, -1).join('、')}与 ${parts[parts.length - 1]}`;
}

export function describeSourceMaterials(
  attachments: readonly SourceMaterialCandidate[] | undefined | null
): string {
  const counts = countSourceMaterialsByKind(attachments);
  const total = counts.video + counts.subtitle + counts.manuscript + counts.other;
  if (total === 0) return '0 份源素材';

  const parts: string[] = [];
  if (counts.video > 0) parts.push(`${counts.video} 份视频`);
  if (counts.subtitle > 0) parts.push(`${counts.subtitle} 份字幕`);
  if (counts.manuscript > 0) parts.push(`${counts.manuscript} 份文稿`);
  if (counts.other > 0) parts.push(`${counts.other} 份源`);

  const hasOnlyOther =
    counts.video === 0 && counts.subtitle === 0 && counts.manuscript === 0 && counts.other > 0;
  const suffix = hasOnlyOther ? '文件' : '源素材';
  return `${formatChineseJoinedParts(parts)}${suffix}`;
}

export function buildTranscribeDeliveryCopy(params: {
  episodeCount: number;
  modeLabel: string;
  synopsisContent: string;
  isFixture: boolean;
}): { directorText: string; fileDescription: string } {
  const { episodeCount, modeLabel, synopsisContent, isFixture } = params;
  const trimmedSynopsis = String(synopsisContent || '').trim();
  const hasRealSynopsis = trimmedSynopsis.length > 0 && trimmedSynopsis !== SYNOPSIS_PLACEHOLDER;

  const archiveText = hasRealSynopsis
    ? '人物表、梗概和分集剧本已经归档到左侧目录'
    : '人物表和分集剧本已经归档到左侧目录；本次未单独写出故事梗概，请直接阅读分集正文';

  const fileDescription = hasRealSynopsis
    ? '含人物锚定表、剧情梗概与分集正文'
    : '含人物锚定表与分集正文（本次未单独写出故事梗概）';

  const leadText = isFixture
    ? `老板，${episodeCount} 集素材已按「${modeLabel}」产出模拟测试稿，不是对上传原文或成片的忠实分析。`
    : `老板，${episodeCount} 集素材已按「${modeLabel}」处理完成！`;

  const directorText = `${leadText}${archiveText}，真 Word（.docx）文件也打包好了，您可以直接点下方下载或一键转入创作台继续改写。`;

  return { directorText, fileDescription };
}

export function describeTranscribePromptSource(
  attachments: readonly SourceMaterialCandidate[] | undefined | null
): { noun: string; lead: string } {
  const counts = countSourceMaterialsByKind(attachments);
  const hasVideo = counts.video > 0;
  const hasSubtitle = counts.subtitle > 0;
  const hasManuscript = counts.manuscript > 0;
  const kindCount = Number(hasVideo) + Number(hasSubtitle) + Number(hasManuscript);

  if (kindCount <= 1) {
    if (hasVideo) {
      return {
        noun: '短剧视频素材',
        lead: '请直接观看并拆解本次上传的短剧视频素材',
      };
    }
    if (hasSubtitle) {
      return {
        noun: '字幕素材',
        lead: '请根据本次上传的字幕素材拆解（不要写成已观看视频）',
      };
    }
    if (hasManuscript) {
      return {
        noun: '文稿素材',
        lead: '请根据本次上传的文稿素材拆解（不要写成已观看视频）',
      };
    }
    return {
      noun: '源素材',
      lead: '请根据本次上传的源素材拆解（不要写成已观看视频）',
    };
  }

  const labels: string[] = [];
  if (hasVideo) labels.push('视频');
  if (hasSubtitle) labels.push('字幕');
  if (hasManuscript) labels.push('文稿');
  const noun = `${labels.join('、')}混合源素材`;

  const lead = hasVideo
    ? `请根据本次上传的${noun}拆解（仅对其中的视频画面使用观看，不要把文稿或字幕说成已观看视频）`
    : `请根据本次上传的${noun}拆解（不要写成已观看视频）`;

  return { noun, lead };
}
