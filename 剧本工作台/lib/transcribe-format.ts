/**
 * V7.2 扒剧正文格式规范（《扒剧小能手_规范_V7.2.md》第六节、第八节及 2026-11-23 格式整理契约）
 *
 * 原则：
 * 1. 只做机械格式统一，绝不修改任何台词原字或说话人身份。
 * 2. 绝不脑补未在画面中出场的人物、道具或动作。
 * 3. 单集还原不凭空编造全剧人物小传或故事梗概。
 */

export const TRANSCRIBE_V72_VISION_SYSTEM_PROMPT =
  '你是专业短剧扒剧还原师，严格遵循《扒剧小能手规范 V7.2》。以连续画面、原始人声与全幅字幕为唯一依据，零脑补还原剧本正文：每集以单次「## 第N集」与「【正文】」开头；场头固定两行（「集数-场次 场景 时段 空间」+「人物：…」）；动作以空心三角「△ 」开头；人物花字与屏幕文字独立成行（「【人物字幕：…】」「【字幕：…】」「【特写：…】」等）；台词说话人不加粗；场末不写常规暗场/黑屏/淡出转场说明；无首行缩进；无法辨认或被遮挡处按最小范围注明【听不清】【文字不清】【物品未辨清】【人物字幕被原片模糊遮挡】或【待人工補寫】。严禁因台词提前切场，严禁把未张嘴表情编造为 OS。';

export const TRANSCRIBE_V72_OUTPUT_GUIDE = [
  '请严格按《扒剧小能手规范 V7.2》第六节正文格式直接输出干净的分集剧本正文（不要索要文件、不要调用外部工具、不要输出引用编号如 [cite: 1]，单集还原不要附加全剧人物小传或故事梗概）：',
  '1. 集标题与正文标识：每集仅以单次 `## 第N集`（原片有正式集名可写 `## 第N集《原片集名》`，无集名不自拟）和 `【正文】` 开头；多集之间使用 `---` 分隔。',
  '2. 固定两行场头：',
  '   第1行：`集数-场次 场景 时段 空间`（例：`1-1 客厅 日 内`；时段用 `日/夜/不明`，空间用 `内/外/内外/不明`，不使用旧格式「第X集 场次1-1 内/外景 地点 日」）。',
  '   第2行：`人物：角色A、角色B`（仅列本场画面实际出场或参与剧情的声音角色，严禁脑补未出场角色）。',
  '3. 动作与画面：独立成行，以空心三角 `△ ` 开头（不使用实心三角符号），严禁凭套路脑补不存在的道具、动作或心理 OS，严禁因台词提及移动而提前切场。',
  '4. 人物花字与屏幕文字：独立成行标注为 `【人物字幕：…】`、`【字幕：…】`、`【特写：…】`、`【手机消息：…】`、`【文件文字：…】`；原片模糊遮挡注明 `【人物字幕被原片模糊遮挡】`。',
  '5. 台词：不给说话人加 `**`，写为 `说话人：台词` 或 `说话人（语气/OS/VO/画外/电话声）：台词`，严格按当秒画面口型锁定说话人。',
  '6. 场末与缩进：场末不加“黑场/暗场黑屏/淡出/快切”等常规转场说明；所有段落无首行缩进；确实看不清/听不清处按最小范围标注 `【听不清】`/`【文字不清】`/`【待人工補寫】`。',
].join('\n');

import { convertTraditionalToSimplified } from './trad-to-simp';

export { convertTraditionalToSimplified };

export interface NormalizeV72Options {
  traditional?: boolean;
  simplifyTraditional?: boolean;
}

export interface V72FormatCheckResult {
  ok: boolean;
  issues: string[];
}

const CITE_TAG_RE = /[ \t]*\[cite:\s*\d+(?:\s*,\s*\d+)*\]/gi;
const CITE_TAG_TEST_RE = /\[cite:\s*\d+(?:\s*,\s*\d+)*\]/i;

const LEGACY_SCENE_TYPE_FIRST_RE =
  /^(?:#{1,6}\s*)?(?:第\s*0*(\d{1,3})\s*集\s*)?(?:场次|場次)\s*0*(\d{1,3})\s*[-－–—]\s*0*(\d{1,3})\s*(内\/外景|內\/外景|内外景|內外景|内景|內景|外景|内|內|外)\s+(.+?)(?:\s+(日|夜|晨|昏|清晨|黄昏|黃昏|傍晚|不明))?$/;

const LEGACY_SCENE_LOC_FIRST_RE =
  /^(?:#{1,6}\s*)?(?:第\s*0*(\d{1,3})\s*集\s*)?(?:场次|場次)\s*0*(\d{1,3})\s*[-－–—]\s*0*(\d{1,3})\s+(.+?)\s+(日|夜|晨|昏|清晨|黄昏|黃昏|傍晚|不明)\s+(内\/外景|內\/外景|内外景|內外景|内景|內景|外景|内|內|外|不明)$/;

export const V72_SCENE_LINE_RE =
  /^0*(\d{1,3})\s*[-－–—]\s*0*(\d{1,3})\s+(.+?)\s+(日|夜|晨|昏|清晨|黄昏|黃昏|傍晚|不明)\s+(内外|內外|内|內|外|不明)$/;

const PURE_TRANSITION_ACTION_RE =
  /^(?:画面|畫面|镜头|鏡頭)?(?:逐渐|逐漸|缓缓|緩緩|慢慢|渐|漸|随后|隨後|随即|隨即)?(?:暗场黑屏|暗場黑屏|黑屏暗场|黑屏暗場|暗场|暗場|黑场|黑場|黑屏|淡出|淡入淡出|渐暗|漸暗|渐黑|漸黑|快切|切黑|切暗|转黑|轉黑|转暗|轉暗)(?:[。．.!！…—\-]*)?$/;

const TRAILING_CHAR_SUBTITLE_RE =
  /[（(](?:字幕|屏幕|螢幕|画面|畫面)?(?:弹出|彈出|出现|出現|显示|顯示)?人物(?:介绍|介紹|花字|名牌)[：:]\s*(?:【([^】]+)】|([^）)]+))[）)][。.]?$/;

const DIALOGUE_META_NAMES = new Set([
  '人物',
  '字幕',
  '人物字幕',
  '特写',
  '特寫',
  '手机消息',
  '手機消息',
  '文件文字',
  '说明',
  '說明',
  '备注',
  '備註',
  '时间',
  '時間',
  '地点',
  '地點',
  '场景',
  '場景',
  '集数',
  '集數',
  '场次',
  '場次',
  '旁白',
]);

function stripOuterBold(line: string): string {
  const t = line.trim();
  const m = /^\*\*([^*]+)\*\*$/.exec(t);
  return m ? m[1].trim() : t;
}

function mapSpaceWord(rawSpace: string, traditional: boolean): string {
  const s = rawSpace.trim();
  if (/^(?:内\/外景|內\/外景|内外景|內外景|内外|內外)$/.test(s)) {
    return traditional ? '內外' : '内外';
  }
  if (/^(?:内景|內景|内|內)$/.test(s)) {
    return traditional ? '內' : '内';
  }
  if (/^(?:外景|外)$/.test(s)) {
    return '外';
  }
  return '不明';
}

function detectTraditional(text: string, hint?: boolean): boolean {
  if (typeof hint === 'boolean') return hint;
  return /[場內螢幕說話劇個這來為們點頭開關門聲體]/.test(text);
}

function parseSceneHeaderLine(
  rawLine: string,
  episodeNumber: number,
  traditional: boolean,
  explicitTraditional?: boolean,
): { sceneLine: string; ep: number; scene: number } | null {
  const unwrapped = stripOuterBold(rawLine).replace(/^#{1,6}\s*/, '').trim();
  if (!unwrapped) return null;

  const v72 = V72_SCENE_LINE_RE.exec(unwrapped);
  if (v72) {
    const ep = Number(v72[1]);
    const sc = Number(v72[2]);
    const loc = v72[3].trim();
    const time = v72[4].trim();
    const useTrad = typeof explicitTraditional === 'boolean' ? explicitTraditional : traditional || v72[5].includes('內');
    const space = mapSpaceWord(v72[5], useTrad);
    return { sceneLine: `${ep}-${sc} ${loc} ${time} ${space}`, ep, scene: sc };
  }

  const leg1 = LEGACY_SCENE_TYPE_FIRST_RE.exec(unwrapped);
  if (leg1) {
    const ep = Number(leg1[2] || leg1[1] || episodeNumber);
    const sc = Number(leg1[3]);
    const useTrad = typeof explicitTraditional === 'boolean' ? explicitTraditional : traditional || leg1[4].includes('內');
    const space = mapSpaceWord(leg1[4], useTrad);
    const loc = leg1[5].trim();
    const time = (leg1[6] || '不明').trim();
    return { sceneLine: `${ep}-${sc} ${loc} ${time} ${space}`, ep, scene: sc };
  }

  const leg2 = LEGACY_SCENE_LOC_FIRST_RE.exec(unwrapped);
  if (leg2) {
    const ep = Number(leg2[2] || leg2[1] || episodeNumber);
    const sc = Number(leg2[3]);
    const loc = leg2[4].trim();
    const time = leg2[5].trim();
    const useTrad = typeof explicitTraditional === 'boolean' ? explicitTraditional : traditional || leg2[6].includes('內');
    const space = mapSpaceWord(leg2[6], useTrad);
    return { sceneLine: `${ep}-${sc} ${loc} ${time} ${space}`, ep, scene: sc };
  }

  return null;
}

function normalizeDialogueLine(line: string): string {
  // Remove markdown bold wrapper around speaker only; preserve speaker, parenthetical, colon and dialogue verbatim.
  let out = line.replace(/^\*\*([^*\r\n：:]{1,48})\*\*([：:])/, '$1$2');
  out = out.replace(/^\*\*([^*\r\n：:]{1,48}[：:])\*\*/, '$1');
  return out;
}

function parseDialogueSpeaker(line: string): { baseName: string; voiceTag?: string } | null {
  if (!line || /^[△▲【#>]/.test(line)) return null;
  if (/^人物[：:]/.test(line)) return null;
  if (V72_SCENE_LINE_RE.test(line)) return null;
  const m = /^([^：:\r\n]{1,48})[：:]\s*\S/.exec(line);
  if (!m) return null;
  const rawSpeaker = m[1].trim();
  const baseName = rawSpeaker.replace(/[（(][^）)]*[）)]/g, '').trim();
  if (!baseName || baseName.length > 16 || DIALOGUE_META_NAMES.has(baseName)) return null;
  if (/^(?:第\s*\d+\s*[集场場]|场次|場次)/.test(baseName)) return null;
  const voiceMatch = /[（(]([^）)]*(?:电话声|電話聲|画外|畫外|OS|VO)[^）)]*)[）)]/.exec(rawSpeaker);
  return { baseName, voiceTag: voiceMatch?.[1] };
}

function extractNameFromCharSubtitle(line: string): string | null {
  const m = /^【人物字幕[：:]\s*([^\s，,。：:【】（）()]{1,12})/.exec(line);
  if (!m) return null;
  const name = m[1].trim();
  if (!name || DIALOGUE_META_NAMES.has(name)) return null;
  return name;
}

interface ParsedSceneBlock {
  header: string;
  explicitPeopleLine?: string;
  lines: string[];
}

const DIALOGUE_LINE_START_RE =
  /^(?:\*\*)?[^\s：:▲△【】#*]{1,48}(?:\*\*)?[：:]\s*\S/;

const VERSION_LABEL_LINE_RE =
  /^(?:#{1,6}\s*)?(?:\*\*)?(?:(?:\d{1,2}|[一二三四五六七八九十]{1,3})\s*[.．、]\s*)?(?:繁[體体](?:[單单]集|全集)?版|[简簡][体體](?:[單单]集|全集)?版)(?:\*\*)?\s*[:：]?$/;

function isStructuralLineStart(trimmed: string): boolean {
  if (!trimmed) return true;
  if (/^#{1,6}\s/.test(trimmed)) return true;
  if (/^-{3,}$/.test(trimmed)) return true;
  if (/^[【\[]/.test(trimmed)) return true;
  if (/^[▲△●◆▪>*•\-]\s*/.test(trimmed)) return true;
  if (/^人物[：:]/.test(trimmed)) return true;
  if (/^(?:\*\*)?(?:第\s*\d+\s*集\s+)?(?:场次|場次)\s*\d+/.test(trimmed)) return true;
  if (/^(?:\*\*)?\d{1,3}\s*[-－–—]\s*\d{1,3}\s+/.test(trimmed)) return true;
  if (/^\d{1,2}\s*[.．、]\s*\S/.test(trimmed)) return true;
  if (VERSION_LABEL_LINE_RE.test(trimmed)) return true;
  if (DIALOGUE_LINE_START_RE.test(trimmed)) return true;
  return false;
}

function isSplittablePrevLine(trimmed: string): boolean {
  if (!trimmed) return false;
  // Never merge onto already-complete standalone structural headers/markers
  if (/^【[^】]+】$/.test(trimmed)) return false;
  if (/^-{3,}$/.test(trimmed)) return false;
  if (VERSION_LABEL_LINE_RE.test(trimmed)) return false;
  if (/^(?:#{1,6}\s*)?第\s*\d+\s*集(?:《[^》]+》)?\s*$/.test(stripOuterBold(trimmed))) return false;
  if (V72_SCENE_LINE_RE.test(stripOuterBold(trimmed))) return false;
  if (LEGACY_SCENE_TYPE_FIRST_RE.test(stripOuterBold(trimmed))) return false;
  if (LEGACY_SCENE_LOC_FIRST_RE.test(stripOuterBold(trimmed))) return false;

  // Incomplete heading (e.g. `## 第` split before `17集`)
  if (/^#{1,6}\s+\S/.test(trimmed)) return true;
  // Incomplete V7.2 scene line (e.g. `17-2 走` split before `廊 日 内`)
  if (/^\d{1,3}\s*[-－–—]\s*\d{1,3}\s+\S/.test(stripOuterBold(trimmed))) return true;
  // Action line (`△ ...` or `▲ ...`)
  if (/^[▲△]/.test(trimmed)) return true;
  // Dialogue line (`说话人：...`)
  if (DIALOGUE_LINE_START_RE.test(trimmed)) return true;
  // People line (`人物：...`)
  if (/^人物[：:]/.test(trimmed)) return true;
  return false;
}

/**
 * Repairs stray single `\n` breaks inserted mid-word/mid-line by OpenAI-compatible
 * relays when aggregating streaming chunks (e.g. `## 第\n17集`, `17-2 走\n廊 日 内`,
 * `△ 男\n生...`, `男生：我绝对不会\n多想`). Preserves all genuine paragraph breaks (`\n\n`)
 * and structural boundaries.
 */
export function repairBrokenRelayLineWraps(rawText: string): string {
  const normalized = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!normalized.includes('\n')) return normalized;

  const lines = normalized.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) {
      out.push('');
      continue;
    }

    if (out.length > 0) {
      const prevRaw = out[out.length - 1];
      const prevTrimmed = prevRaw.trim();
      if (prevTrimmed && isSplittablePrevLine(prevTrimmed) && !isStructuralLineStart(trimmed)) {
        const needsSpace = /[A-Za-z0-9]$/.test(prevTrimmed) && /^[A-Za-z]/.test(trimmed);
        out[out.length - 1] = prevRaw.trimEnd() + (needsSpace ? ' ' : '') + trimmed;
        continue;
      }
    }

    out.push(raw);
  }

  return out.join('\n');
}

export function normalizeTranscribeEpisodeBodyV72(
  rawBody: string,
  episodeNumber: number,
  options: NormalizeV72Options = {},
): string {
  const cleanedRaw = repairBrokenRelayLineWraps(String(rawBody || ''))
    .replace(CITE_TAG_RE, '')
    .trim();

  if (!cleanedRaw) return '';

  const traditional = detectTraditional(cleanedRaw, options.traditional);
  const rawLines = cleanedRaw.split('\n').map((l) => l.replace(/^[ \t\u3000]+/, '').trimEnd());

  // Strip trailing horizontal rule lines (single-episode standalone body should not end with ---)
  while (rawLines.length > 0 && (!rawLines[rawLines.length - 1].trim() || /^-{3,}$/.test(rawLines[rawLines.length - 1].trim()))) {
    rawLines.pop();
  }

  // Extract optional explicit original episode title `## 第1集《原片集名》`
  let explicitTitleSuffix = '';
  let idx = 0;
  while (idx < rawLines.length && !rawLines[idx].trim()) idx++;
  if (idx < rawLines.length) {
    const first = stripOuterBold(rawLines[idx]);
    const epHeadMatch = /^(?:#{1,6}\s*)?第\s*0*(\d{1,3})\s*集(?:\s*(《[^》]+》))?\s*$/.exec(first);
    if (epHeadMatch) {
      if (epHeadMatch[2]) explicitTitleSuffix = epHeadMatch[2];
      idx++;
    }
  }
  while (idx < rawLines.length && !rawLines[idx].trim()) idx++;
  if (idx < rawLines.length) {
    const maybeMarker = stripOuterBold(rawLines[idx]).replace(/^#{1,6}\s*/, '').trim();
    if (/^【(?:正文|剧本正文|劇本正文|分集分场次还原剧本|分集分場次還原劇本)】$/.test(maybeMarker)) {
      idx++;
    }
  }
  while (idx < rawLines.length && !rawLines[idx].trim()) idx++;

  const contentLines = rawLines.slice(idx);
  const prefixLines: string[] = [];
  const scenes: ParsedSceneBlock[] = [];
  let currentScene: ParsedSceneBlock | null = null;

  for (let i = 0; i < contentLines.length; i++) {
    const line = contentLines[i].trim();
    if (!line) continue;
    if (/^-{3,}$/.test(line) && i === contentLines.length - 1) continue;

    // Check if this line is a scene header
    const parsedScene = parseSceneHeaderLine(line, episodeNumber, traditional, options.traditional);
    if (parsedScene) {
      currentScene = { header: parsedScene.sceneLine, lines: [] };
      scenes.push(currentScene);
      continue;
    }

    // Check if this line is an explicit `人物：...` line right at the start of a scene
    const unwrappedLine = stripOuterBold(line);
    if (currentScene && currentScene.lines.length === 0 && !currentScene.explicitPeopleLine && /^人物[：:]/.test(unwrappedLine)) {
      const rest = unwrappedLine.replace(/^人物[：:]\s*/, '').trim();
      currentScene.explicitPeopleLine = `人物：${rest}`;
      continue;
    }

    // Normalize action lines (`▲` / `△`)
    if (/^[▲△]/.test(line)) {
      let actionBody = line.replace(/^[▲△]\s*/, '').trim();
      if (!actionBody) continue;

      // Drop pure conventional end-of-scene transition notes (V7.2 §6.7)
      if (PURE_TRANSITION_ACTION_RE.test(actionBody)) {
        continue;
      }

      // Split unambiguous trailing character subtitle clause into standalone `【人物字幕：…】`
      let extractedCharSubtitle: string | null = null;
      const subMatch = TRAILING_CHAR_SUBTITLE_RE.exec(actionBody);
      if (subMatch) {
        const inner = (subMatch[1] || subMatch[2] || '').trim();
        if (inner) {
          extractedCharSubtitle = `【人物字幕：${inner}】`;
          actionBody = actionBody.slice(0, subMatch.index).trim();
          if (actionBody && !/[。！？!?…—]$/.test(actionBody)) {
            actionBody += '。';
          }
        }
      }

      const targetList = currentScene ? currentScene.lines : prefixLines;
      if (actionBody) {
        targetList.push(`△ ${actionBody}`);
      }
      if (extractedCharSubtitle) {
        targetList.push(extractedCharSubtitle);
      }
      continue;
    }

    // Dialogue or bracket tags or other lines: only strip bold around speaker, preserve wording verbatim
    const normalized = normalizeDialogueLine(line);
    const targetList = currentScene ? currentScene.lines : prefixLines;
    targetList.push(normalized);
  }

  // Gather episode-wide known character names (only from speakers & character subtitles in this episode)
  const episodeKnownChars: string[] = [];
  const addKnown = (name: string) => {
    if (name && name.length >= 2 && !episodeKnownChars.includes(name)) {
      episodeKnownChars.push(name);
    }
  };
  for (const sc of scenes) {
    for (const l of sc.lines) {
      const sp = parseDialogueSpeaker(l);
      if (sp) addKnown(sp.baseName);
      const subName = extractNameFromCharSubtitle(l);
      if (subName) addKnown(subName);
    }
  }

  // Build final V7.2 formatted output
  const out: string[] = [`## 第${episodeNumber}集${explicitTitleSuffix}`, '', '【正文】'];

  if (prefixLines.length > 0) {
    out.push(...prefixLines);
  }

  for (let sIdx = 0; sIdx < scenes.length; sIdx++) {
    const sc = scenes[sIdx];
    if (sIdx > 0 || prefixLines.length > 0) {
      out.push('');
    }
    out.push(sc.header);

    if (sc.explicitPeopleLine) {
      out.push(sc.explicitPeopleLine);
    } else {
      // Derive `人物：` strictly from THIS scene's own lines (zero hallucination!)
      const scenePeople: string[] = [];
      const addPerson = (name: string) => {
        if (name && !scenePeople.includes(name)) scenePeople.push(name);
      };
      for (const l of sc.lines) {
        const subName = extractNameFromCharSubtitle(l);
        if (subName) addPerson(subName);
        if (l.startsWith('△ ')) {
          for (const known of episodeKnownChars) {
            if (l.includes(known)) addPerson(known);
          }
        }
        const sp = parseDialogueSpeaker(l);
        if (sp) addPerson(sp.baseName);
      }
      if (scenePeople.length > 0) {
        out.push(`人物：${scenePeople.join('、')}`);
      } else {
        out.push('人物：不明');
      }
    }

    if (sc.lines.length > 0) {
      out.push('');
      out.push(...sc.lines);
    }
  }

  const joined = out.join('\n').trim();
  if (options.traditional === false && options.simplifyTraditional !== false) {
    return convertTraditionalToSimplified(joined);
  }
  return joined;
}

export function normalizeTranscribeScriptMapV72(
  bodies: Map<number, string>,
  options: NormalizeV72Options = {},
): Map<number, string> {
  const out = new Map<number, string>();
  const sorted = Array.from(bodies.entries()).sort((a, b) => a[0] - b[0]);
  for (const [epNum, body] of sorted) {
    if (!Number.isInteger(epNum) || epNum < 1 || typeof body !== 'string' || !body.trim()) continue;
    const normalized = normalizeTranscribeEpisodeBodyV72(body, epNum, options);
    if (normalized) out.set(epNum, normalized);
  }
  return out;
}

export function assembleTranscribeV72Script(bodies: Map<number, string>): string {
  const sorted = Array.from(bodies.entries())
    .filter(([ep, body]) => Number.isInteger(ep) && ep >= 1 && typeof body === 'string' && body.trim().length > 0)
    .sort((a, b) => a[0] - b[0]);
  return sorted.map(([, body]) => body.trim()).join('\n\n---\n\n');
}

/**
 * Extracts normalized dialogue lines (`speaker: utterance`, with only bold markers
 * around speaker and `[cite: N]` removed) to verify 100% verbatim dialogue & speaker parity.
 */
export function extractDialogueLinesForParity(body: string): string[] {
  const lines = String(body || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(CITE_TAG_RE, '')
    .split('\n');
  const out: string[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const unbold = normalizeDialogueLine(trimmed);
    if (parseDialogueSpeaker(unbold)) {
      out.push(unbold);
    }
  }
  return out;
}

export function inspectV72BodyFormat(body: string, episodeNumber?: number): V72FormatCheckResult {
  const issues: string[] = [];
  const raw = String(body || '').replace(/\r\n?/g, '\n');
  if (!raw.trim()) {
    return { ok: false, issues: ['正文为空'] };
  }

  const lines = raw.split('\n');
  const firstNonEmpty = lines.find((l) => l.trim().length > 0) || '';
  const expectedEpRe =
    typeof episodeNumber === 'number' && Number.isInteger(episodeNumber)
      ? new RegExp(`^##\\s*第${episodeNumber}集(?:《[^》]+》)?$`)
      : /^##\s*第\d+集(?:《[^》]+》)?$/;
  if (!expectedEpRe.test(firstNonEmpty.trim())) {
    issues.push(`首行集标题不符合 V7.2 规范（应为 ## 第${episodeNumber ?? 'N'}集）`);
  }

  if (!lines.some((l) => l.trim() === '【正文】')) {
    issues.push('缺少独立【正文】标识行');
  }

  let sceneCount = 0;
  let missingPeopleCount = 0;
  let actionCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^[ \t\u3000]+/.test(line)) {
      issues.push(`第 ${i + 1} 行存在行首缩进空格`);
    }
    if (trimmed.startsWith('▲')) {
      issues.push(`第 ${i + 1} 行仍使用旧实心三角 ▲`);
    }
    if (CITE_TAG_TEST_RE.test(trimmed)) {
      issues.push(`第 ${i + 1} 行包含模型引用残留 [cite: ...]`);
    }
    if (/^\*\*[^*\r\n：:]{1,48}\*\*[：:]/.test(trimmed)) {
      issues.push(`第 ${i + 1} 行说话人仍带有加粗 **`);
    }
    if (LEGACY_SCENE_TYPE_FIRST_RE.test(stripOuterBold(trimmed)) || LEGACY_SCENE_LOC_FIRST_RE.test(stripOuterBold(trimmed))) {
      issues.push(`第 ${i + 1} 行仍为旧式单行场头`);
    }
    if (trimmed.startsWith('△')) {
      actionCount++;
      const actionContent = trimmed.replace(/^△\s*/, '').trim();
      if (PURE_TRANSITION_ACTION_RE.test(actionContent)) {
        issues.push(`第 ${i + 1} 行包含应清理的场末常规暗场/黑屏说明`);
      }
    }
    if (V72_SCENE_LINE_RE.test(trimmed)) {
      sceneCount++;
      const nextLine = (lines[i + 1] || '').trim();
      if (!/^人物[：:]\s*\S/.test(nextLine)) {
        missingPeopleCount++;
      }
    }
  }

  if (sceneCount === 0) {
    issues.push('缺少 V7.2 标准两行场头（如 1-1 客厅 日 内）');
  }
  if (missingPeopleCount > 0) {
    issues.push(`有 ${missingPeopleCount} 处场头缺少紧随其后的「人物：…」行`);
  }
  if (actionCount === 0 && extractDialogueLinesForParity(raw).length === 0) {
    issues.push('缺少有效动作行或台词行');
  }

  return { ok: issues.length === 0, issues };
}
