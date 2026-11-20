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
