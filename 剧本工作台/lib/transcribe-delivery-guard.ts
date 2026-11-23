export interface TranscribeDeliveryCheckResult {
  ok: boolean;
  missingEpisodes: number[];
  invalidEpisodes: number[];
  reason: string;
}

const FAKE_FALLBACK_PHRASES: readonly string[] = [
  "模拟测试稿",
  "不是实际视频还原",
  "结构占位",
  "完成该集结构梳理",
  "已按详细模式完成分集场次与台词还原",
  "已按快速模式完成分集场次与台词还原",
  "本交付未单独写出故事梗概",
  "暂无可交付正文",
  "正文待补",
];

const PLACEHOLDER_ONLY_TEXTS = new Set<string>([
  "无音轨",
  "待补写",
  "待补充",
  "待人工补写",
  "待人工補寫",
  "略",
  "暂无",
  "暂无内容",
  "无法识别画面",
  "无法识别",
  "占位",
  "省略",
]);

const META_SPEAKER_NAMES = new Set<string>([
  "状态",
  "说明",
  "备注",
  "时间",
  "地点",
  "人物",
  "场景",
  "集数",
  "模式",
  "提示",
  "注意",
  "外貌",
  "声线",
  "身份定位",
  "角色定位",
  "人设",
  "关系",
  "年龄",
  "性格",
  "背景",
  "梗概",
  "剧情梗概",
  "导语",
  "场次",
  "标题",
]);

// Recognition copy only: strips a whole-line paired `**...**` and maps traditional
// 場/內 to 场/内. Stored body text is never changed.
function recognitionSceneText(text: string): string {
  let t = text.trim();
  const bold = /^\*\*([^*]+)\*\*$/.exec(t);
  if (bold) t = bold[1].trim();
  return t.replace(/場/g, "场").replace(/內/g, "内");
}

function stripMarkdownWrapper(line: string): string {
  return line
    .trim()
    .replace(/^>+\s*/, "")
    .replace(/^[\-*+]\s+/, "")
    .trim();
}

function extractEffectiveChars(text: string): string {
  return text.replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9]/g, "");
}

function isPlaceholderPhrase(text: string): boolean {
  const cleaned = text
    .replace(/[【】\[\]()（）<>《》“”"'‘’：:，,。.！!？?、…·\-—~\s]/g, "")
    .trim();
  if (!cleaned) return true;
  if (PLACEHOLDER_ONLY_TEXTS.has(cleaned)) return true;
  if (/^(待补|待人工|无音轨|略|暂无|无法识别|占位)/.test(cleaned) && cleaned.length <= 10) {
    return true;
  }
  return false;
}

function isEpisodeHeadingLine(line: string): boolean {
  const s = stripMarkdownWrapper(line);
  if (/^#{1,6}\s*第\s*\d+\s*集(?:\s*(?:[：:·\-—].*|《[^》]+》))?$/.test(s)) return true;
  if (/^【\s*第\s*\d+\s*集\s*】$/.test(s)) return true;
  if (/^第\s*\d+\s*集\s*$/.test(s)) return true;
  return false;
}

function isScriptBodyStartHeading(line: string): boolean {
  const s = stripMarkdownWrapper(line);
  if (
    /^【\s*(?:正文|分集分场次还原剧本|分集分场剧本|分场次还原剧本|分集还原剧本|还原剧本|剧本正文|分场剧本|分集剧本)\s*】$/.test(
      s
    )
  ) {
    return true;
  }
  if (
    /^#{1,6}\s*(?:正文|分集分场次还原剧本|分集分场剧本|分场次还原剧本|分集还原剧本|还原剧本|剧本正文|分场剧本|分集剧本)(?:\s*[：:·\-—].*)?$/.test(
      s
    )
  ) {
    return true;
  }
  return false;
}

function isMetaSectionHeading(line: string): boolean {
  const s = stripMarkdownWrapper(line);
  if (
    /^【\s*(?:全剧人物标准人名锚定表|人物标准人名锚定表|人名锚定表|本集核心剧情梗概|核心剧情梗概|本集剧情梗概|人物设定|故事梗概|剧情梗概|核心人物|主要人物|人物表|人物介绍|备注|说明|导语|交付说明)\s*】$/.test(
      s
    )
  ) {
    return true;
  }
  if (
    /^#{1,6}\s*(?:人物.*|.*梗概.*|导语.*|备注.*|说明.*|人名锚定表.*|核心人物.*|主要人物.*)$/.test(
      s
    ) &&
    !isEpisodeHeadingLine(s) &&
    !isScriptBodyStartHeading(s) &&
    !isSceneHeadingLine(s)
  ) {
    return true;
  }
  return false;
}

function isSceneHeadingLine(line: string): boolean {
  const s = recognitionSceneText(stripMarkdownWrapper(line).replace(/^#{1,6}\s*/, "").trim());
  if (!s) return false;
  if (isEpisodeHeadingLine(recognitionSceneText(line))) return false;

  // 例如: 第1集 场次1-1 内景 客厅 日 / 场次1-1 内景 客厅 日 / 第 1 场 客厅（日·内）
  if (/^(?:第\s*\d+\s*集\s+)?场次\s*\d+(?:\s*[-—.．]\s*\d+)?(?:\s+.*)?$/.test(s)) {
    return true;
  }
  if (/^第\s*\d+\s*场(?:\s*[：:·\-—(（\s].*)?$/.test(s)) {
    return true;
  }
  if (/^\d+\s*[-—–－.．]\s*\d+\s+(?:内景|外景|内外景|内|外)(?:\s+.*)?$/.test(s)) {
    return true;
  }
  // V7.2 标准两行场头首行：例如 `1-1 客厅 日 内` / `1-1 客廳 日 內` / `1-2 走廊 夜 内外`
  if (/^\d+\s*[-—–－.．]\s*\d+\s+\S+(?:\s+\S+)*\s+(?:日|夜|晨|昏|清晨|黄昏|黃昏|傍晚|不明)\s+(?:内外|内|外|不明)$/.test(s)) {
    return true;
  }
  if (/^(?:内景|外景|内外景)\s*[·•\-—:：\s]\s*\S+/.test(s) && s.length <= 40) {
    return true;
  }
  return false;
}

function isValidActionLine(line: string): boolean {
  const s = stripMarkdownWrapper(line);
  const match = s.match(/^[▲△●◆▪]\s*(.*)$/);
  if (!match) return false;
  const content = (match[1] ?? "").trim();
  if (!content) return false;
  if (isPlaceholderPhrase(content)) return false;
  const effective = extractEffectiveChars(content);
  return effective.length >= 4;
}

function isValidDialogueLine(line: string): boolean {
  const s = stripMarkdownWrapper(line);
  if (!s) return false;
  if (/^[▲△●◆▪#>]/.test(s)) return false;
  if (isSceneHeadingLine(s) || isEpisodeHeadingLine(s) || isMetaSectionHeading(s)) {
    return false;
  }

  let speaker = "";
  let utterance = "";

  const bracketMatch = s.match(/^\[([^\]\r\n]{1,48})\]\s*(.+)$/);
  if (bracketMatch) {
    speaker = bracketMatch[1].trim();
    utterance = bracketMatch[2].trim();
  } else {
    const colonMatch = s.match(/^([^：:\r\n]{1,48})[：:]\s*(.+)$/);
    if (!colonMatch) return false;
    speaker = colonMatch[1].trim();
    utterance = colonMatch[2].trim();
  }

  if (!speaker || !utterance) return false;
  if (/[【】#\d]/.test(speaker) && !/^[\u4e00-\u9fffA-Za-z]/.test(speaker)) return false;
  if (/^(?:第\s*\d+\s*[集场]|场次)/.test(speaker)) return false;

  const normalizedSpeaker = speaker.replace(/[（(][^）)]*[）)]/g, "").trim();
  if (!normalizedSpeaker || normalizedSpeaker.length > 16) return false;
  if (META_SPEAKER_NAMES.has(normalizedSpeaker)) return false;

  const cleanedUtterance = utterance
    .replace(/【\s*(?:待人工补写|待人工補寫|待补写|无音轨)\s*】/g, "")
    .trim();
  if (!cleanedUtterance) return false;
  if (isPlaceholderPhrase(cleanedUtterance)) return false;

  const effective = extractEffectiveChars(cleanedUtterance);
  return effective.length >= 2;
}

export function isKnownFakeTranscribeFallback(text: string): boolean {
  if (typeof text !== "string") return true;
  const trimmed = text.trim();
  if (!trimmed) return false;
  for (const phrase of FAKE_FALLBACK_PHRASES) {
    if (trimmed.includes(phrase)) {
      return true;
    }
  }
  return false;
}

export function validateSingleEpisodeBody(episode: number, body: string): boolean {
  if (!Number.isInteger(episode) || episode <= 0) return false;
  if (typeof body !== "string") return false;

  const trimmed = body.trim();
  if (!trimmed) return false;
  if (isKnownFakeTranscribeFallback(trimmed)) return false;

  const lines = trimmed.split(/\r?\n/);
  let inMetaSection = false;
  let sceneCount = 0;
  let validActionCount = 0;
  let validDialogueCount = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^[-*_]{3,}$/.test(line)) continue;

    if (isScriptBodyStartHeading(line)) {
      inMetaSection = false;
      continue;
    }

    if (isEpisodeHeadingLine(line)) {
      inMetaSection = false;
      continue;
    }

    if (isSceneHeadingLine(line)) {
      inMetaSection = false;
      sceneCount += 1;
      continue;
    }

    if (isMetaSectionHeading(line)) {
      inMetaSection = true;
      continue;
    }

    if (inMetaSection) {
      continue;
    }

    if (isValidActionLine(line)) {
      validActionCount += 1;
      continue;
    }

    if (isValidDialogueLine(line)) {
      validDialogueCount += 1;
      continue;
    }
  }

  if (sceneCount >= 1 && (validActionCount >= 1 || validDialogueCount >= 1)) {
    return true;
  }
  if (validActionCount >= 1 && validDialogueCount >= 1) {
    return true;
  }

  return false;
}

export function inspectTranscribeBodiesDelivery(
  expected: number[],
  bodies: Map<number, string>
): TranscribeDeliveryCheckResult {
  if (!Array.isArray(expected) || expected.length === 0) {
    return {
      ok: false,
      missingEpisodes: [],
      invalidEpisodes: [],
      reason: "预期交付集数列表为空，无法验收转录结果。",
    };
  }

  const seen = new Set<number>();
  for (const ep of expected) {
    if (!Number.isInteger(ep) || ep <= 0) {
      return {
        ok: false,
        missingEpisodes: [],
        invalidEpisodes: [],
        reason: "预期交付集数包含非法集号，请检查分集配置。",
      };
    }
    if (seen.has(ep)) {
      return {
        ok: false,
        missingEpisodes: [],
        invalidEpisodes: [],
        reason: `预期交付集数存在重复集号（第 ${ep} 集），无法验收。`,
      };
    }
    seen.add(ep);
  }

  if (!(bodies instanceof Map)) {
    return {
      ok: false,
      missingEpisodes: [...expected],
      invalidEpisodes: [],
      reason: "分集交付容器格式异常，未获取到有效分集正文。",
    };
  }

  const missingEpisodes: number[] = [];
  const invalidEpisodes: number[] = [];

  for (const ep of expected) {
    if (!bodies.has(ep)) {
      missingEpisodes.push(ep);
      continue;
    }
    const content = bodies.get(ep);
    if (typeof content !== "string" || !validateSingleEpisodeBody(ep, content)) {
      invalidEpisodes.push(ep);
    }
  }

  if (missingEpisodes.length === 0 && invalidEpisodes.length === 0) {
    return {
      ok: true,
      missingEpisodes: [],
      invalidEpisodes: [],
      reason: "所有预期分集正文均已通过结构与内容完整性校验。",
    };
  }

  const parts: string[] = [];
  if (missingEpisodes.length > 0) {
    parts.push(`缺少第 ${missingEpisodes.join("、")} 集正文`);
  }
  if (invalidEpisodes.length > 0) {
    parts.push(`第 ${invalidEpisodes.join("、")} 集正文无效或疑似占位内容`);
  }

  return {
    ok: false,
    missingEpisodes,
    invalidEpisodes,
    reason: `${parts.join("；")}，未达到可交付标准。`,
  };
}

export function validateTranscribeBodies(
  expected: number[],
  bodies: Map<number, string>
): boolean {
  return inspectTranscribeBodiesDelivery(expected, bodies).ok;
}
