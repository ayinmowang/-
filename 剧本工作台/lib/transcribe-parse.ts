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

// ---------------------------------------------------------------------------
// Strict transcription-delivery parser.
// Independent of the permissive manuscript parser above. No imports.
// `sourceEpisodes` is the trusted server attachment mapping. Any ambiguity or
// failure yields an empty Map. Success means the extracted episode set equals
// the mapping exactly (no filtering, no filling).
// ---------------------------------------------------------------------------
type TdvHeadingKind = 'body' | 'people' | 'synopsis' | 'meta';

interface TdvMark {
  line: number;
  episode: number;
}

interface TdvSegment {
  episode: number;
  start: number;
  end: number;
}

const TDV_MAX_EPISODE = 300;
const TDV_PEOPLE_TITLE = '全剧人物标准人名锚定表';
const TDV_SYNOPSIS_TITLE = '本集核心剧情梗概';
const TDV_BODY_TITLES = ['分集分场次还原剧本', '正文', '剧本正文'];
const TDV_OTHER_META_RE = /^(?:人物|角色|梗概|剧情|备注|说明|附注|附录|校验|自检|检查|总结|统计|下集|待确认)/;
const TDV_SECTION_LINE_RE =
  /^(?:#{1,6}\s*)?(?:(?:\d{1,2}|[一二三四五六七八九十]{1,3})\s*[.．、]\s*)?【([^】\n]{1,40})】\s*[:：]?$/;
const TDV_SCENE_LINE_RE =
  /^(?:#{1,6}\s*)?(?:第\s*0*(\d{1,3})\s*集\s*)?场次\s*\d{1,3}\s*[-－–—]\s*\d{1,3}\s*(?:内\/外景|内外景|内景|外景|内|外)\s+\S/;
const TDV_ACTION_LINE_RE = /^[▲△]\s*\S/;
const TDV_DIALOGUE_LINE_RE = /^[^\s：:▲△【】#]{1,20}[：:]\s*\S/;
const TDV_FAKE_RE =
  /暂无(?:正文|内容)|正文缺失|原文缺失|原文未提供|未提供原文|无法(?:还原|提取|转写)|占位|待补(?:充|全)|此处省略|内容省略|[（(]略[）)]|\b(?:placeholder|lorem ipsum|todo|tbd)\b/i;
const TDV_PLACEHOLDER_ONLY_RE = /^(?:略|无|暂无|空|待补|同上|省略|占位|na|none|null|undefined|tbd|todo)+$/i;
const TDV_STRIP_RE = /[\s`~!@#$%^&*()_+\-=\[\]{}|\\;:'",.<>\/?，。！？；：、（）【】《》…—·“”‘’▲△]/g;

export interface TranscribeDeliveryVariants {
  primary: Map<number, string>;
  simplified?: Map<number, string>;
  traditional?: Map<number, string>;
}

interface TdvVersionSplit {
  traditional: string;
  simplified: string;
}

// Fixed explicit version labels only. Any other heading is ordinary body text.
const TDV_VERSION_RE =
  /^(?:#{1,6}\s*)?(?:\*\*)?(?:(?:\d{1,2}|[一二三四五六七八九十]{1,3})\s*[.．、]\s*)?(繁[體体](?:[單单]集|全集)?版|[简簡][体體](?:[單单]集|全集)?版)(?:\*\*)?\s*[:：]?$/;

// Recognition copy only: strips a whole-line paired `**...**` and maps traditional
// 場/內 to 场/内. The stored body text is never changed.
function tdvRecog(trimmed: string): string {
  let t = trimmed.trim();
  const bold = /^\*\*([^*]+)\*\*$/.exec(t);
  if (bold) t = bold[1].trim();
  return t.replace(/場/g, '场').replace(/內/g, '内');
}

function tdvSplitVersions(bodyText: string): TdvVersionSplit | 'invalid' | null {
  const lines = bodyText.split('\n');
  const marks: Array<{ line: number; traditional: boolean }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = TDV_VERSION_RE.exec(lines[i].trim());
    if (m) marks.push({ line: i, traditional: m[1].charAt(0) === '繁' });
  }
  if (marks.length === 0) return null;
  if (marks.length !== 2 || marks[0].traditional === marks[1].traditional) return 'invalid';
  for (let i = 0; i < marks[0].line; i++) {
    if (lines[i].trim()) return 'invalid';
  }
  const first = lines.slice(marks[0].line + 1, marks[1].line).join('\n').trim();
  const second = lines.slice(marks[1].line + 1).join('\n').trim();
  if (!first || !second) return 'invalid';
  return marks[0].traditional
    ? { traditional: first, simplified: second }
    : { traditional: second, simplified: first };
}

function tdvClassifyLine(trimmed: string): TdvHeadingKind | null {
  const m = TDV_SECTION_LINE_RE.exec(trimmed);
  if (!m) return null;
  const title = m[1].trim();
  if (TDV_BODY_TITLES.indexOf(title) >= 0) return 'body';
  if (title === TDV_PEOPLE_TITLE) return 'people';
  if (title === TDV_SYNOPSIS_TITLE) return 'synopsis';
  if (TDV_OTHER_META_RE.test(title)) return 'meta';
  return null;
}

// Same boundary forms as the legacy parser: `### 第N集`, `第N集`, `## ... 第N集 ...`.
// `第N集 场次...` is a scene line, never a boundary.
function tdvHeadingEpisode(trimmed: string): number | null {
  trimmed = trimmed.replace(/場/g, '场');
  const h3 = trimmed.match(/^###\s*第\s*0*(\d{1,3})\s*集(?!\s*场)(?:\b|[^\d]|$)/);
  if (h3) return Number(h3[1]);
  const plain = trimmed.match(/^第\s*0*(\d{1,3})\s*集(?!\s*场)(?:\b|[^\d]|$)/);
  if (plain) return Number(plain[1]);
  if (/^##(?!#)\s*/.test(trimmed)) {
    const without = trimmed.replace(/^##\s*/, '');
    if (!/^第\s*\d+\s*场/.test(without)) {
      const h2 = without.match(/第\s*0*(\d{1,3})\s*集(?!\s*场)/);
      if (h2) return Number(h2[1]);
    }
  }
  return null;
}

function tdvHasActionOrDialogue(lines: string[]): boolean {
  for (const line of lines) {
    const t = line.trim();
    if (TDV_ACTION_LINE_RE.test(t) || TDV_DIALOGUE_LINE_RE.test(t)) return true;
  }
  return false;
}

function tdvBodyUsable(body: string): boolean {
  if (!body || TDV_FAKE_RE.test(body)) return false;
  const kept: string[] = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t || tdvHeadingEpisode(t) !== null) continue;
    kept.push(t);
  }
  const stripped = kept.join('').replace(TDV_STRIP_RE, '');
  return stripped.length > 0 && !TDV_PLACEHOLDER_ONLY_RE.test(stripped);
}

function tdvParse(text: string, expected: Set<number>): TranscribeDeliveryVariants | null {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!source) return null;
  // No whole-reply unwrapping of code fences or JSON.
  if (/^(?:```|~~~|[{[])/.test(source) || /(?:```|~~~)$/.test(source)) return null;

  const lines = source.split('\n');
  const kinds: Array<TdvHeadingKind | null> = [];
  let markerLine = -1;
  let markerCount = 0;
  let peopleCount = 0;
  let synopsisCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const kind = tdvClassifyLine(lines[i].trim());
    kinds.push(kind);
    if (kind === 'body') {
      markerCount++;
      markerLine = i;
    } else if (kind === 'people') {
      peopleCount++;
    } else if (kind === 'synopsis') {
      synopsisCount++;
    }
  }
  if (markerCount > 1 || peopleCount > 1 || synopsisCount > 1) return null;

  const hasMarker = markerCount === 1;
  let bodyText: string;
  if (hasMarker) {
    // Only metadata sections may precede the body marker.
    for (let i = 0; i < markerLine; i++) {
      if (lines[i].trim()) {
        if (kinds[i] === null) return null;
        break;
      }
    }
    let end = lines.length;
    for (let i = markerLine + 1; i < lines.length; i++) {
      if (kinds[i] !== null && kinds[i] !== 'body') {
        end = i;
        break;
      }
    }
    bodyText = lines.slice(markerLine + 1, end).join('\n').trim();
  } else {
    // Metadata without an explicit body marker is never a body.
    for (const kind of kinds) {
      if (kind !== null) return null;
    }
    bodyText = source;
  }
  if (!bodyText) return null;

  const split = tdvSplitVersions(bodyText);
  if (split === 'invalid') return null;
  if (split !== null) {
    const traditional = tdvParseBody(split.traditional, hasMarker, expected);
    const simplified = tdvParseBody(split.simplified, hasMarker, expected);
    if (traditional === null || simplified === null) return null;
    return { primary: simplified, simplified, traditional };
  }
  const single = tdvParseBody(bodyText, hasMarker, expected);
  return single === null ? null : { primary: single };
}

function tdvParseBody(bodyText: string, hasMarker: boolean, expected: Set<number>): Map<number, string> | null {
  const bodyLines = bodyText.split('\n');
  const headings: TdvMark[] = [];
  const scenes: TdvMark[] = [];
  let sceneSeen = false;
  for (let i = 0; i < bodyLines.length; i++) {
    const t = bodyLines[i].trim();
    const headingEp = tdvHeadingEpisode(t);
    if (headingEp !== null) {
      if (headingEp < 1 || headingEp > TDV_MAX_EPISODE) return null;
      headings.push({ line: i, episode: headingEp });
      continue;
    }
    const sm = TDV_SCENE_LINE_RE.exec(tdvRecog(t));
    if (sm) {
      sceneSeen = true;
      if (sm[1] !== undefined) {
        const sceneEp = Number(sm[1]);
        if (sceneEp < 1 || sceneEp > TDV_MAX_EPISODE) return null;
        scenes.push({ line: i, episode: sceneEp });
      }
    }
  }

  const segments: TdvSegment[] = [];
  if (expected.size === 1) {
    const only = Array.from(expected)[0];
    const explicit = headings.concat(scenes);
    for (const mark of explicit) {
      if (mark.episode !== only) return null;
    }
    if (explicit.length === 0) {
      // Headerless: needs an explicit body marker and real scene structure.
      if (!hasMarker || !sceneSeen || !tdvHasActionOrDialogue(bodyLines)) return null;
    }
    segments.push({ episode: only, start: 0, end: bodyLines.length });
  } else {
    const anchors = headings.length > 0 ? headings : scenes;
    if (anchors.length === 0) return null;
    for (let i = 0; i < anchors[0].line; i++) {
      const t = bodyLines[i].trim();
      if (t && !/^#\s/.test(t)) return null;
    }
    const seen = new Set<number>();
    for (const anchor of anchors) {
      const last = segments.length > 0 ? segments[segments.length - 1] : null;
      if (last && last.episode === anchor.episode) continue;
      if (seen.has(anchor.episode)) return null;
      seen.add(anchor.episode);
      if (last) last.end = anchor.line;
      segments.push({ episode: anchor.episode, start: anchor.line, end: bodyLines.length });
    }
    if (headings.length > 0) {
      for (const scene of scenes) {
        let owner: TdvSegment | null = null;
        for (const seg of segments) {
          if (scene.line >= seg.start && scene.line < seg.end) owner = seg;
        }
        if (!owner || owner.episode !== scene.episode) return null;
      }
    }
  }

  const result = new Map<number, string>();
  for (const seg of segments) {
    const body = bodyLines.slice(seg.start, seg.end).join('\n').trim();
    if (!tdvBodyUsable(body)) return null;
    result.set(seg.episode, body);
  }
  if (result.size !== expected.size) return null;
  for (const ep of Array.from(result.keys())) {
    if (!expected.has(ep)) return null;
  }
  return result;
}

export function parseTranscribeDeliveryVariants(text: string, sourceEpisodes: number[]): TranscribeDeliveryVariants {
  if (typeof text !== 'string' || !Array.isArray(sourceEpisodes) || sourceEpisodes.length === 0) {
    return { primary: new Map<number, string>() };
  }
  const expected = new Set<number>();
  for (const ep of sourceEpisodes) {
    if (typeof ep !== 'number' || !Number.isInteger(ep) || ep < 1 || ep > TDV_MAX_EPISODE || expected.has(ep)) {
      return { primary: new Map<number, string>() };
    }
    expected.add(ep);
  }
  const parsed = tdvParse(text, expected);
  return parsed === null ? { primary: new Map<number, string>() } : parsed;
}

export function parseTranscribeDeliveryBodies(text: string, sourceEpisodes: number[]): Map<number, string> {
  return parseTranscribeDeliveryVariants(text, sourceEpisodes).primary;
}

export interface ManuscriptCoverageConflict {
  episode: number;
  reason: 'duplicate_heading';
  message: string;
}

export interface ManuscriptCoverageInspection {
  episodes: number[];
  bodies: Map<number, string>;
  conflicts: ManuscriptCoverageConflict[];
}

export function inspectManuscriptEpisodeCoverage(text: string): ManuscriptCoverageInspection {
  const bodies = parseEpisodeBodiesFromSingleSource(text);
  const filtered = new Map<number, string>();
  for (const [ep, body] of bodies.entries()) {
    if (Number.isInteger(ep) && ep >= 1 && ep <= 300 && typeof body === 'string' && body.trim()) {
      filtered.set(ep, body);
    }
  }
  const episodes = Array.from(filtered.keys()).sort((a, b) => a - b);
  const headingCounts = new Map<number, number>();
  for (const item of findEpisodeBoundaries(text || '')) {
    if (Number.isInteger(item.episode) && item.episode >= 1 && item.episode <= 300) {
      headingCounts.set(item.episode, (headingCounts.get(item.episode) || 0) + 1);
    }
  }
  const conflicts: ManuscriptCoverageConflict[] = [];
  for (const [episode, count] of headingCounts.entries()) {
    if (count > 1) {
      conflicts.push({
        episode,
        reason: 'duplicate_heading',
        message: `第${episode}集标题出现多次，请核对`,
      });
    }
  }
  conflicts.sort((a, b) => a.episode - b.episode);
  return { episodes, bodies: filtered, conflicts };
}
