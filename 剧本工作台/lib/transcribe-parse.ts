export const SYNOPSIS_PLACEHOLDER = '（本交付未单独写出故事梗概，请直接阅读分集正文。）';

export interface EpisodeSourceChunk {
  episode: number;
  text: string;
}

interface BoundaryMatch {
  episode: number;
  index: number;
}

/**
 * Match start-of-line episode boundaries:
 * 1) `### 第 N 集` (not followed immediately by `场`)
 * 2) `第 N 集` at line start (e.g. `第1集 场次1-1`)
 * 3) `## ... 第 N 集 ...` episode intro headings
 * Must NOT match scene headers like `### 第 1 场  第 1 集核查室`.
 */
function findEpisodeBoundaries(text: string): BoundaryMatch[] {
  const results: BoundaryMatch[] = [];
  const lines = text.split('\n');
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    let epNum: number | null = null;

    // 1) Line-start `### 第 N 集` (not `场`)
    const h3Match = trimmed.match(/^###\s*第\s*0*(\d{1,3})\s*集(?!\s*场)(?:\b|[^\d]|$)/);
    if (h3Match) {
      epNum = Number(h3Match[1]);
    }

    // 2) Line-start `第 N 集` (e.g. `第1集 场次1-1`)
    if (epNum === null) {
      const plainMatch = trimmed.match(/^第\s*0*(\d{1,3})\s*集(?!\s*场)(?:\b|[^\d]|$)/);
      if (plainMatch) {
        epNum = Number(plainMatch[1]);
      }
    }

    // 3) Line-start `## ... 第 N 集 ...` (but not `###` and not `第 N 场`)
    if (epNum === null && /^##(?!#)\s*/.test(trimmed)) {
      const withoutHashes = trimmed.replace(/^##\s*/, '');
      if (!/^第\s*\d+\s*场/.test(withoutHashes)) {
        const h2EpMatch = withoutHashes.match(/第\s*0*(\d{1,3})\s*集(?!\s*场)/);
        if (h2EpMatch) {
          epNum = Number(h2EpMatch[1]);
        }
      }
    }

    if (epNum !== null && Number.isInteger(epNum) && epNum >= 1) {
      results.push({ episode: epNum, index: offset });
    }

    offset += line.length + 1;
  }

  return results;
}

function appendSegmentDedup(map: Map<number, string>, epNum: number, segment: string): void {
  const normalized = segment.trim();
  if (!normalized || !Number.isInteger(epNum) || epNum < 1) return;

  const prev = map.get(epNum);
  if (!prev) {
    map.set(epNum, normalized);
    return;
  }

  if (prev === normalized || prev.includes(normalized)) {
    return;
  }

  if (normalized.includes(prev)) {
    map.set(epNum, normalized);
    return;
  }

  map.set(epNum, `${prev}\n\n${normalized}`);
}

export function parseEpisodeBodiesFromSingleSource(
  text: string,
  expectedEpisode?: number,
): Map<number, string> {
  const result = new Map<number, string>();
  const source = (text || '').trim();
  if (!source) return result;

  const boundaries = findEpisodeBoundaries(source);

  if (boundaries.length === 0) {
    if (typeof expectedEpisode === 'number' && Number.isInteger(expectedEpisode) && expectedEpisode >= 1) {
      result.set(expectedEpisode, source);
    }
    return result;
  }

  // Leading intro text before the first episode boundary belongs to expectedEpisode or the first boundary episode
  const firstBoundary = boundaries[0];
  const leading = source.slice(0, firstBoundary.index).trim();
  const leadingTargetEp =
    typeof expectedEpisode === 'number' && Number.isInteger(expectedEpisode) && expectedEpisode >= 1
      ? expectedEpisode
      : firstBoundary.episode;

  if (leading) {
    appendSegmentDedup(result, leadingTargetEp, leading);
  }

  for (let i = 0; i < boundaries.length; i++) {
    const curr = boundaries[i];
    const nextIdx = i + 1 < boundaries.length ? boundaries[i + 1].index : source.length;
    const slice = source.slice(curr.index, nextIdx).trim();
    if (slice) {
      appendSegmentDedup(result, curr.episode, slice);
    }
  }

  return result;
}

export function mergePerSourceEpisodeBodies(sources: EpisodeSourceChunk[]): Map<number, string> {
  const merged = new Map<number, string>();

  for (const item of sources) {
    if (!item || typeof item.text !== 'string') continue;
    const expected =
      typeof item.episode === 'number' && Number.isInteger(item.episode) && item.episode >= 1
        ? item.episode
        : undefined;
    const singleMap = parseEpisodeBodiesFromSingleSource(item.text, expected);
    for (const [epNum, body] of singleMap.entries()) {
      appendSegmentDedup(merged, epNum, body);
    }
  }

  return merged;
}

export function extractSynopsisOrPlaceholder(text: string): string {
  const source = (text || '').trim();
  if (!source) return SYNOPSIS_PLACEHOLDER;

  const synMatch = source.match(
    /(?:^|\n)(?:###?\s*[^\n]*?(?:剧情梗概|故事梗概)[^\n]*|【[^】\n]*?(?:剧情梗概|故事梗概)[^】\n]*】)\s*\n([\s\S]*?)(?=\n(?:###?|【)|$)/,
  );
  const extracted = synMatch ? synMatch[1].trim() : '';
  return extracted || SYNOPSIS_PLACEHOLDER;
}

export function assembleScriptFromEpisodeBodies(bodies: Map<number, string>): string {
  const sortedEntries = Array.from(bodies.entries())
    .filter(([ep, body]) => Number.isInteger(ep) && ep >= 1 && typeof body === 'string' && body.trim().length > 0)
    .sort((a, b) => a[0] - b[0]);

  return sortedEntries.map(([, body]) => body.trim()).join('\n\n');
}
