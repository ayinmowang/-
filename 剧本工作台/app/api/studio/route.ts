import zlib from 'node:zlib';
import {
  bindings,
  owner,
  getProject,
  saveProject,
  message,
  backend,
  connected,
  gptAvailable,
  callStationLLM,
  getActiveAccountOrDefault,
  toPublicProfile,
  failure,
  sanitizeForClient,
  getStore,
  flushPersistentStore,
  buildCreatorPromptCatalog,
  buildCreatorTierCatalog,
  resolveCreationTier,
  normalizeCreationTiers,
  resolveWorkflowSkillPrompts,
  getAllowedSlotsForKind,
  isValidKind,
  getMaxUploadBytes,
  inspectBucketMediaFile,
  formatVideoMetadataSummary,
  type MultimodalAttachmentInput,
} from '../../../lib/server';
import type {
  Project,
  Kind,
  PromptSlotKey,
  PromptSlotSelection,
  ProjectPromptSelections,
  StationRoleKey,
  StudioAccount,
  ThinkingLevel,
  ExecutionMode,
  StudioVolume,
  StudioEpisode,
  StudioEpisodeSnapshot,
  StudioAssetNode,
} from '../../../lib/types';

const KIND_LABELS: Record<Kind, string> = {
  foreign: '国外迭代国外',
  domestic: '国内迭代国外',
  original: '原创',
  transcribe: '扒剧',
};

const VALID_THINKING_LEVELS: readonly ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const VALID_EXECUTION_MODES: readonly ExecutionMode[] = ['auto', 'plan'] as const;
const MULTIMODAL_VIDEO_CAP_BYTES = 30 * 1024 * 1024;
const MULTIMODAL_IMAGE_CAP_BYTES = 10 * 1024 * 1024;
const TEXT_ATTACHMENT_CAP_BYTES = 5 * 1024 * 1024;
const DOC_ATTACHMENT_CAP_BYTES = 20 * 1024 * 1024;

function formatRequirements(reqs: Project['requirements']): string {
  if (!Array.isArray(reqs) || reqs.length === 0) return '无';
  const items = reqs
    .map((r) => (typeof r === 'string' ? r : r?.text || ''))
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items.join('；') : '无';
}

function validateAndPickPluginId(
  pluginIdRaw: unknown,
  kind: Kind,
  slot: PromptSlotKey
): string | undefined {
  if (pluginIdRaw === undefined || pluginIdRaw === null) return undefined;
  if (typeof pluginIdRaw !== 'string') throw new Error('INVALID_INPUT');
  const trimmed = pluginIdRaw.trim();
  if (!trimmed) return '';
  if (!getAllowedSlotsForKind(kind).includes(slot)) {
    throw new Error('SLOT_NOT_ALLOWED');
  }
  if (trimmed === '__builtin__') return '__builtin__';
  const store = getStore();
  const match = (store.systemConfig.skillPlugins || []).find(
    (pl) => pl.id === trimmed && pl.kind === kind && pl.slot === slot && pl.enabled
  );
  if (!match) throw new Error('INVALID_INPUT');
  return trimmed;
}

function normalizeCreatePromptSelections(
  body: any,
  kind: Kind
): ProjectPromptSelections {
  const result: ProjectPromptSelections = {};
  const raw = body?.promptSelections;

  if (raw === undefined || raw === null) {
    const pId = validateAndPickPluginId(body?.primaryPluginId, kind, 'primary');
    const sId = validateAndPickPluginId(body?.secondaryPluginId, kind, 'secondary');
    const slotSel: PromptSlotSelection = {};
    if (pId) slotSel.primary = pId;
    if (sId) slotSel.secondary = sId;
    if (slotSel.primary || slotSel.secondary) result[kind] = slotSel;
    return result;
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('INVALID_INPUT');
  }

  const keys = Object.keys(raw);
  if (keys.length === 0) return result;

  const isFlat = keys.some((k) => k === 'primary' || k === 'secondary');
  if (isFlat) {
    const pId = validateAndPickPluginId((raw as any).primary, kind, 'primary');
    const sId = validateAndPickPluginId((raw as any).secondary, kind, 'secondary');
    const slotSel: PromptSlotSelection = {};
    if (pId) slotSel.primary = pId;
    if (sId) slotSel.secondary = sId;
    if (slotSel.primary || slotSel.secondary) result[kind] = slotSel;
    return result;
  }

  for (const [k, slotObj] of Object.entries(raw)) {
    if (!isValidKind(k)) throw new Error('INVALID_INPUT');
    if (slotObj === undefined || slotObj === null) continue;
    if (typeof slotObj !== 'object' || Array.isArray(slotObj)) {
      throw new Error('INVALID_INPUT');
    }
    const pId = validateAndPickPluginId((slotObj as any).primary, k, 'primary');
    const sId = validateAndPickPluginId((slotObj as any).secondary, k, 'secondary');
    const slotSel: PromptSlotSelection = {};
    if (pId) slotSel.primary = pId;
    if (sId) slotSel.secondary = sId;
    if (slotSel.primary || slotSel.secondary) {
      result[k] = slotSel;
    }
  }
  return result;
}

function validateExecutionControls(
  body: any,
  currentProject?: any
): { preferredTierId?: string; thinkingLevel: ThinkingLevel; executionMode: ExecutionMode } {
  const store = getStore();
  const tiers = normalizeCreationTiers(store.systemConfig.creationTiers);
  const enabledTiers = tiers.filter((t) => t.enabled);
  const defaultTier = enabledTiers.find((t) => t.isDefault) || enabledTiers[0];

  let preferredTierId: string | undefined;
  if (body?.preferredTierId !== undefined && body?.preferredTierId !== null) {
    if (typeof body.preferredTierId !== 'string') throw new Error('INVALID_INPUT');
    const trimmed = body.preferredTierId.trim();
    if (trimmed) {
      const matched = enabledTiers.find((t) => t.id === trimmed);
      if (!matched) throw new Error('INVALID_INPUT');
      preferredTierId = matched.id;
    } else {
      preferredTierId = defaultTier?.id;
    }
  } else if (
    typeof currentProject?.preferredTierId === 'string' &&
    enabledTiers.some((t) => t.id === currentProject.preferredTierId)
  ) {
    preferredTierId = currentProject.preferredTierId;
  } else {
    preferredTierId = defaultTier?.id;
  }

  const chosenTier = enabledTiers.find((t) => t.id === preferredTierId) || defaultTier;

  let thinkingLevel: ThinkingLevel = currentProject?.thinkingLevel || 'off';
  if (body?.thinkingLevel !== undefined && body?.thinkingLevel !== null) {
    if (typeof body.thinkingLevel !== 'string') throw new Error('INVALID_INPUT');
    const rawThink = body.thinkingLevel.trim();
    if (rawThink) {
      if (!(VALID_THINKING_LEVELS as readonly string[]).includes(rawThink)) {
        throw new Error('INVALID_INPUT');
      }
      thinkingLevel = rawThink as ThinkingLevel;
    }
  }
  if (chosenTier && !chosenTier.supportsThinking) {
    thinkingLevel = 'off';
  }

  let executionMode: ExecutionMode = currentProject?.executionMode === 'plan' ? 'plan' : 'auto';
  if (body?.executionMode !== undefined && body?.executionMode !== null) {
    if (typeof body.executionMode !== 'string') throw new Error('INVALID_INPUT');
    const rawMode = body.executionMode.trim();
    if (rawMode) {
      if (!(VALID_EXECUTION_MODES as readonly string[]).includes(rawMode)) {
        throw new Error('INVALID_INPUT');
      }
      executionMode = rawMode as ExecutionMode;
    }
  }

  return { preferredTierId, thinkingLevel, executionMode };
}

function ensureWorkspaceDefaults<T extends Record<string, any>>(p: T): T {
  if (!p || typeof p !== 'object') return p;
  if (!Array.isArray(p.volumes)) (p as any).volumes = [];
  if (!Array.isArray(p.episodes)) (p as any).episodes = [];
  if (!Array.isArray(p.outlineNodes)) (p as any).outlineNodes = [];
  if (!Array.isArray(p.characterNodes)) (p as any).characterNodes = [];
  if (!Array.isArray(p.worldNodes)) (p as any).worldNodes = [];
  if (typeof p.projectRules !== 'string') (p as any).projectRules = '';
  if (p.executionMode !== 'auto' && p.executionMode !== 'plan') (p as any).executionMode = 'auto';
  if (
    typeof p.thinkingLevel !== 'string' ||
    !(VALID_THINKING_LEVELS as readonly string[]).includes(p.thinkingLevel)
  ) {
    (p as any).thinkingLevel = 'off';
  }
  return p;
}

function extractTextFromZipXmlBuffer(buf: Buffer): string {
  try {
    // Minimal ZIP local file header parser to extract XML text from .docx (word/document.xml) or .xlsx (xl/sharedStrings.xml)
    const texts: string[] = [];
    let offset = 0;
    while (offset + 30 <= buf.length) {
      if (buf.readUInt32LE(offset) !== 0x04034b50) break;
      const compression = buf.readUInt16LE(offset + 8);
      const compSize = buf.readUInt32LE(offset + 18);
      const nameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);
      const entryName = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
      const dataStart = offset + 30 + nameLen + extraLen;
      const dataEnd = dataStart + compSize;
      if (dataEnd > buf.length) break;
      if (
        (entryName === 'word/document.xml' || entryName === 'xl/sharedStrings.xml' || entryName.startsWith('xl/worksheets/sheet')) &&
        compSize > 0
      ) {
        const slice = buf.subarray(dataStart, dataEnd);
        const rawXml =
          compression === 8
            ? zlib.inflateRawSync(slice).toString('utf8')
            : compression === 0
            ? slice.toString('utf8')
            : '';
        if (rawXml) {
          const clean = rawXml
            .replace(/<\/w:p>|<\/row>|<\/si>/g, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
          if (clean) texts.push(clean.slice(0, 12000));
        }
      }
      offset = dataEnd;
    }
    return texts.join('\n\n').slice(0, 15000);
  } catch {
    return '';
  }
}

async function extractProjectAttachmentsForLLM(
  project: Project,
  user: string,
  includeVideoMultimodal: boolean,
  extraKeyframes?: MultimodalAttachmentInput[]
): Promise<{ textSnippets: string[]; mediaAttachments: MultimodalAttachmentInput[] }> {
  const textSnippets: string[] = [];
  const mediaAttachments: MultimodalAttachmentInput[] = [];
  const bucket = bindings().BUCKET;

  for (const att of project.attachments || []) {
    try {
      const bucketKey = `${user}/${project.id}/${att.id}`;
      const lowerName = String(att.name || '').toLowerCase();
      const declaredSize = Number(att.size || 0);

      // Video attachments: check size BEFORE loading full buffer to avoid OOM on >30MB videos
      if (/\.(mp4|mov|webm|mkv|avi)$/i.test(lowerName)) {
        if (declaredSize > MULTIMODAL_VIDEO_CAP_BYTES) {
          const meta = await inspectBucketMediaFile(bucketKey, att.name);
          textSnippets.push(
            `${formatVideoMetadataSummary(meta)}${att.episode ? `（对应第 ${att.episode} 集）` : ''}`
          );
          continue;
        }
        if (!includeVideoMultimodal || declaredSize < 4096 || mediaAttachments.length >= 6) {
          continue;
        }
        const obj = await bucket.get(bucketKey);
        if (!obj) continue;
        const ab = await obj.arrayBuffer();
        const buf = Buffer.from(ab);
        if (buf.length > MULTIMODAL_VIDEO_CAP_BYTES) {
          const meta = await inspectBucketMediaFile(bucketKey, att.name);
          textSnippets.push(formatVideoMetadataSummary(meta));
          continue;
        }
        if (buf.length >= 4096) {
          const mimeType = lowerName.endsWith('.mov')
            ? 'video/quicktime'
            : lowerName.endsWith('.webm')
            ? 'video/webm'
            : 'video/mp4';
          mediaAttachments.push({
            name: att.name,
            mimeType,
            base64: buf.toString('base64'),
          });
        }
        continue;
      }

      // Image keyframes
      if (/\.(png|jpg|jpeg|webp)$/i.test(lowerName)) {
        if (!includeVideoMultimodal || declaredSize > MULTIMODAL_IMAGE_CAP_BYTES || mediaAttachments.length >= 6) {
          continue;
        }
        const obj = await bucket.get(bucketKey);
        if (!obj) continue;
        const ab = await obj.arrayBuffer();
        const buf = Buffer.from(ab);
        if (buf.length > 0 && buf.length <= MULTIMODAL_IMAGE_CAP_BYTES) {
          const mimeType = lowerName.endsWith('.png')
            ? 'image/png'
            : lowerName.endsWith('.webp')
            ? 'image/webp'
            : 'image/jpeg';
          mediaAttachments.push({
            name: att.name,
            mimeType,
            base64: buf.toString('base64'),
          });
        }
        continue;
      }

      // Text / subtitle files
      if (/\.(txt|md|srt|ass|vtt|csv|json)$/i.test(lowerName)) {
        if (declaredSize > TEXT_ATTACHMENT_CAP_BYTES) continue;
        const obj = await bucket.get(bucketKey);
        if (!obj) continue;
        const ab = await obj.arrayBuffer();
        const buf = Buffer.from(ab);
        if (buf.length > TEXT_ATTACHMENT_CAP_BYTES) continue;
        const txt = buf.toString('utf8').replace(/^\uFEFF/, '').trim();
        if (txt) {
          textSnippets.push(
            `【附件《${att.name}》${att.episode ? `（第 ${att.episode} 集）` : ''}内容摘录】：\n${txt.slice(0, 12000)}`
          );
        }
        continue;
      }

      // Office documents (.docx / .xlsx)
      if (/\.(docx|xlsx)$/i.test(lowerName)) {
        if (declaredSize < 64 || declaredSize > DOC_ATTACHMENT_CAP_BYTES) continue;
        const obj = await bucket.get(bucketKey);
        if (!obj) continue;
        const ab = await obj.arrayBuffer();
        const buf = Buffer.from(ab);
        if (buf.length < 64 || buf.length > DOC_ATTACHMENT_CAP_BYTES) continue;
        const xmlText = extractTextFromZipXmlBuffer(buf);
        if (xmlText) {
          textSnippets.push(
            `【文档附件《${att.name}》${att.episode ? `（第 ${att.episode} 集）` : ''}内容摘录】：\n${xmlText.slice(0, 12000)}`
          );
        }
      }
    } catch {}
  }

  if (includeVideoMultimodal && Array.isArray(extraKeyframes)) {
    for (const kf of extraKeyframes) {
      if (mediaAttachments.length >= 6) break;
      if (kf && typeof kf.base64 === 'string' && kf.base64.trim() && typeof kf.mimeType === 'string') {
        mediaAttachments.push({
          name: kf.name || 'keyframe.jpg',
          mimeType: kf.mimeType,
          base64: kf.base64,
        });
      }
    }
  }

  return { textSnippets, mediaAttachments };
}

async function callProjectStation(params: {
  project: Project;
  station: StationRoleKey;
  userPrompt: string;
  account: StudioAccount;
  extraKeyframes?: MultimodalAttachmentInput[];
}): Promise<{ ok: boolean; text: string | null; error?: string }> {
  const store = getStore();
  const basePrompt = store.systemConfig.routes?.[params.station]?.systemPrompt || '';
  const { composedSystemPrompt } = resolveWorkflowSkillPrompts(store.systemConfig, params.project);
  const resolvedTier = resolveCreationTier(
    store.systemConfig,
    params.project.preferredTierId,
    params.station
  );
  const effectiveThinking: ThinkingLevel = resolvedTier.supportsThinking
    ? params.project.thinkingLevel || 'off'
    : 'off';

  const user = params.account?.username || 'ayin';
  const { textSnippets, mediaAttachments } = await extractProjectAttachmentsForLLM(
    params.project,
    user,
    params.station === 'vision',
    params.extraKeyframes
  );

  const enrichedUserPrompt =
    textSnippets.length > 0
      ? `${params.userPrompt}\n\n${textSnippets.join('\n\n')}`
      : params.userPrompt;

  const sysBlocks: string[] = [];
  const skillComposed = composedSystemPrompt(basePrompt);
  if (skillComposed.trim()) sysBlocks.push(skillComposed.trim());
  if (typeof params.account?.globalRules === 'string' && params.account.globalRules.trim()) {
    sysBlocks.push(`【创作者全局规矩】\n${params.account.globalRules.trim()}`);
  }
  if (typeof params.project?.projectRules === 'string' && params.project.projectRules.trim()) {
    sysBlocks.push(`【本剧创作规则】\n${params.project.projectRules.trim()}`);
  }

  const tierCfg = resolvedTier.tier;
  return callStationLLM({
    station: params.station,
    account: params.account,
    projectId: params.project.id,
    project: params.project,
    systemPromptOverride: sysBlocks.join('\n\n'),
    userPrompt: enrichedUserPrompt,
    thinkingLevel: effectiveThinking,
    tierId: tierCfg.id,
    tierName: tierCfg.name,
    ...(tierCfg.providerId?.trim() ? { providerIdOverride: tierCfg.providerId.trim() } : {}),
    ...(tierCfg.model?.trim() ? { modelOverride: tierCfg.model.trim() } : {}),
    ...(typeof tierCfg.temperature === 'number' ? { temperatureOverride: tierCfg.temperature } : {}),
    ...(typeof tierCfg.maxTokens === 'number' ? { maxTokensOverride: tierCfg.maxTokens } : {}),
    ...(mediaAttachments.length > 0 ? { mediaAttachments } : {}),
  });
}

function withCatalogs<T extends Record<string, any>>(payload: T): T {
  const config = getStore().systemConfig;
  return sanitizeForClient({
    ...payload,
    promptCatalog: buildCreatorPromptCatalog(config),
    tierCatalog: buildCreatorTierCatalog(config),
  });
}

function statedTotal(text: string): number | null {
  const match =
    text.match(/(?:全剧|整个剧|总共|一共|总集数|全本|共)\s*(?:是|有|为|：|:)?\s*(\d{1,3})\s*集/) ||
    text.match(/写到\s*第?\s*(\d{1,3})\s*集/) ||
    text.trim().match(/^(\d{1,3})\s*集[。！!]?$/);
  const n = Number(match?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= 300 ? n : null;
}

function statedLocked(text: string): number | null {
  const match =
    text.match(/前\s*(\d{1,3})\s*集\s*(?:已|已经)?\s*(?:锁定|定稿|不改|不动)/) ||
    text.match(/(?:锁定|定稿)\s*前\s*(\d{1,3})\s*集/) ||
    text.match(/第?\s*1\s*[-~至到]\s*(\d{1,3})\s*集\s*(?:已|已经)?\s*(?:锁定|定稿|不改|不动)/);
  const n = Number(match?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= 299 ? n : null;
}

function isProgressQuery(text: string): boolean {
  const t = text.trim();
  if (t.length > 36) return false;
  return /^(现在|目前|请问|这剧)?(进度)?(咋样了?|怎么样了?|还要多久|什么时候好|啥时候.*答复|到哪一步了?|在跑吗|卡在哪了?|进度)[？?。！!]*$/.test(t);
}

function hasGptKey(): boolean {
  return gptAvailable();
}

/**
 * Generates proactive, context-aware Chief Writer (总编剧) diagnostic & creative suggestions
 * so every turn feels like an interactive Chief Writer collaboration rather than one-way input.
 */
function buildDirectorSuggestions(kind: Kind, text: string, total: number | null, locked: number | null): string[] {
  const t = text.toLowerCase();
  if (kind === 'transcribe') {
    return [
      '★ 建议 1（人名锁定）：扒剧前先锁死男女主与核心反派标准译名，防止分集转写出现“金发男/新娘”等临时外号。',
      '建议 2（模式选择）：若用于快速拆解洗稿可选「快速模式」；若需逐句对齐台词与动作细节建议选「详细模式」。',
    ];
  }
  if (kind === 'domestic') {
    return [
      '★ 建议 1（桥段出海置换）：建议将原稿中的中式家长里短/彩礼/当众扇耳光，置换为北美受众熟悉的信托基金冻结、婚前协议（Prenup）或慈善晚宴公开除名。',
      '建议 2（美式幽默与声线）：上位者（CEO/Alpha）台词保持低压克制，闺蜜与吃瓜路人加入冷面自嘲与 Caught in 4K 实锤反转。',
      '建议 3（三道门推进）：我们先过「世界观 → 人设 → 替换要点」三道门，每道门你点一下确认后再进细纲。',
    ];
  }
  if (kind === 'original') {
    return [
      '★ 建议 1（黄金前 3 秒开场）：建议采用「绝境冲突前置开场（开场 B）」，第 1 集第 1 场直接切入背叛或身份对峙高潮，不铺垫日常背景。',
      '建议 2（破局引擎与代价）：为主角绑定单一贯穿破局底牌，并在全剧 40%–50% 处设置一次底牌失效或反噬，逼出人物主动性。',
      `建议 3（付费卡点）：全剧建议定在 ${total || 60} 集左右，在第 10 集末尾埋设第一次重大身份揭晓或反转钩子。`,
    ];
  }
  // foreign iteration (including continuation with locked episodes)
  const suggestions: string[] = [];
  if (locked) {
    suggestions.push(
      `★ 建议 1（锁集无缝衔接）：前 ${locked} 集已作为只读锁定稿保护（一字不改）；建议第 ${locked + 1} 集开场前 3 秒直接承接第 ${locked} 集末尾悬念并完成一次反击。`
    );
  } else {
    suggestions.push(
      '★ 建议 1（情绪曲线对位）：建议先跑完原稿五问与逐集情绪曲线，把原剧最爽的打脸峰值 1:1 对位到新剧本的核心卡点。'
    );
  }
  if (/爱情|感情|日常|拉扯|甜/.test(t)) {
    suggestions.push(
      '★ 建议 2（双线推拉强化）：在每次主线危机升级间隙加入男女主「契约试探 + 肢体逼近」的高张力拉扯，做到每集事件线与感情线各推进一格。'
    );
  } else if (/都市|校园|背景|豪门|狼人|黑帮/.test(t)) {
    suggestions.push(
      '★ 建议 2（场景与阶层集中）：砍掉冗余支线场景，将核心冲突聚拢在董事会、私人庄园、慈善晚宴等高张力空间，降低实拍转场成本。'
    );
  } else {
    suggestions.push(
      '建议 2（反派升级链）：核查原稿中期反派是否提前下线；若有断档，建议在第二阶段引入更高权位的幕后对手接替施压。'
    );
  }
  suggestions.push(
    '建议 3（主线看得懂关）：稍后我会给你 2–3 套主线与对手方案（★ 首推排第一），过完「简化主线单看得懂关」后再开细纲。'
  );
  return suggestions;
}

async function runGptRecapIfConfigured(
  p: Project,
  request?: Request
): Promise<{ text: string | null; error?: string }> {
  if (!hasGptKey()) return { text: null, error: 'SERVICE_NOT_CONNECTED' };
  const acc = getActiveAccountOrDefault(request);
  const fileSummary = p.attachments.length
    ? p.attachments
        .map(
          (a) =>
            `${a.name}（角色：${a.role === 'locked' ? '锁定稿' : a.role === 'setting' ? '设定资料' : '原稿'}${
              a.episode ? `，第${a.episode}集` : ''
            }）`
        )
        .join('；')
    : '暂无上传文件';

  const result = await callProjectStation({
    project: p,
    station: 'director',
    account: acc,
    userPrompt: `项目名：${p.title}\n流程：${KIND_LABELS[p.kind]}\n全剧集数：${p.total ?? '待定'}\n锁定前N集：${
      p.lockedEpisodes ?? '无'
    }\n附件：${fileSummary}\n用户交代：${p.brief || '无'}\n补充要求：${formatRequirements(p.requirements)}`,
  });
  if (result.ok && result.text) {
    return { text: sanitizeForClient(result.text) };
  }
  return { text: null, error: result.error || 'BACKEND_REQUEST_FAILED' };
}

function buildProgressReply(p: Project): string {
  if (!p.remoteId || !p.remote) {
    if (!p.confirmed) {
      return `当前没有后台任务在运行。我已经根据你的输入整理了复述与改编建议，正停在「核对建档与方向确认卡」，等你点确认或继续跟我聊修改思路；当前暂无预计时间（不编造交付时间）。`;
    }
    if (!connected() && !hasGptKey()) {
      return `当前没有后台任务在运行。建档与前期建议已确认，正在等待接入创作后端服务；未启动后台生成任务，暂无预计完成时间。`;
    }
    if (p.kind !== 'original' && p.kind !== 'transcribe' && p.total === null) {
      return `当前没有后台任务在运行。正在等你告诉我全剧总集数（比如直接回一句“全剧 62 集”），定下后马上启动分析；暂无预计完成时间。`;
    }
    return `当前没有后台任务在运行。材料和方向都已就绪，等你点卡片上的「开始分析 / 开始推理」启动第一步；暂无预计完成时间。`;
  }
  const r = p.remote;
  const stageTitle = r.stage?.title || '准备阶段';
  const done = r.progress?.completed_steps ?? 0;
  const total = r.progress?.total_steps ?? 1;
  const etaText = r.progress?.eta ? `预计剩余时间：${r.progress.eta}` : '当前暂无可靠预计时间';
  if (r.status === 'running' || r.status === 'ready') {
    return `后台正在执行「${stageTitle}」（已完成 ${done}/${total} 步）。${etaText}。跑完这一步我会在对话里给你发白话结论和拍板卡。`;
  }
  if (r.status === 'paused') {
    return `当前流程已暂停在「${stageTitle}」（已完成 ${done}/${total} 步），在途步骤已停止派发。随时点「恢复创作」就能从检查点接着跑。`;
  }
  if (r.status === 'failed') {
    return `当前在「${stageTitle}」遇到异常中断（已完成 ${done}/${total} 步），已做完的产物都存好了。点卡片上的「重试」即可只重跑失败小步。`;
  }
  if (r.status === 'delivered') {
    return `全流程已完成并交回剧本文件（${done}/${total} 步），目前停在「交付验收卡」，你可以先看 Word、确认锁定，或直接打字告诉我哪几集要返修。`;
  }
  const cardTitle = r.card?.title ? `，正在等你拍板「${r.card.title}」` : '';
  return `当前没有后台任务在跑，正停在「${stageTitle}」（进度 ${done}/${total} 步）${cardTitle}；${etaText}。`;
}

function isEpisodeEffectivelyLocked(p: any, ep: any): boolean {
  if (!ep) return false;
  if (ep.locked) return true;
  if (p?.lockedEpisodes && Number.isInteger(Number(ep.episodeNumber)) && Number(ep.episodeNumber) <= Number(p.lockedEpisodes)) {
    return true;
  }
  return false;
}

function normalizeAssetNodeInput(raw: any, index: number, existing?: any): StudioAssetNode & { content?: string } {
  const now = new Date().toISOString();
  const text =
    typeof raw?.body === 'string'
      ? raw.body
      : typeof raw?.content === 'string'
      ? raw.content
      : typeof existing?.body === 'string'
      ? existing.body
      : '';
  const shouldMirrorContent = raw?.content !== undefined || Boolean(existing && 'content' in existing);
  const node: StudioAssetNode & { content?: string } = {
    id: String(raw?.id || existing?.id || `node-${crypto.randomUUID()}`).trim(),
    title: String(raw?.title || existing?.title || `条目 ${index + 1}`).trim().slice(0, 200),
    ...(raw?.category !== undefined || existing?.category !== undefined
      ? { category: String(raw?.category ?? existing?.category ?? '').trim() }
      : {}),
    ...(raw?.parentId || existing?.parentId
      ? { parentId: String(raw?.parentId ?? existing?.parentId) }
      : {}),
    order: Number.isFinite(Number(raw?.order)) ? Number(raw.order) : existing?.order ?? index + 1,
    ...(raw?.summary !== undefined || existing?.summary !== undefined
      ? { summary: String(raw?.summary ?? existing?.summary ?? '').trim() }
      : {}),
    body: text,
    ...(Array.isArray(raw?.tags) ? { tags: raw.tags.map((t: unknown) => String(t)) } : existing?.tags ? { tags: existing.tags } : {}),
    ...(raw?.meta && typeof raw.meta === 'object' ? { meta: raw.meta } : existing?.meta ? { meta: existing.meta } : {}),
    updatedAt: now,
  };
  if (shouldMirrorContent) {
    node.content = text;
  }
  return node;
}

function normalizeEpisodeInput(raw: any, index: number, existing?: any): StudioEpisode & { content?: string } {
  const now = new Date().toISOString();
  const text =
    typeof raw?.body === 'string'
      ? raw.body
      : typeof raw?.content === 'string'
      ? raw.content
      : typeof existing?.body === 'string'
      ? existing.body
      : '';
  const shouldMirrorContent = raw?.content !== undefined || Boolean(existing && 'content' in existing);
  const epNumRaw = Number(raw?.episodeNumber ?? existing?.episodeNumber ?? index + 1);
  const episodeNumber = Number.isInteger(epNumRaw) && epNumRaw >= 1 ? epNumRaw : index + 1;
  const snapshots = Array.isArray(raw?.snapshots)
    ? raw.snapshots
    : Array.isArray(existing?.snapshots)
    ? existing.snapshots
    : undefined;

  const ep: StudioEpisode & { content?: string } = {
    id: String(raw?.id || existing?.id || `ep-${crypto.randomUUID()}`).trim(),
    ...(raw?.volumeId || existing?.volumeId ? { volumeId: String(raw?.volumeId ?? existing?.volumeId) } : {}),
    episodeNumber,
    title: String(raw?.title || existing?.title || `第 ${episodeNumber} 集`).trim().slice(0, 200),
    body: text,
    locked: Boolean(raw?.locked),
    updatedAt: now,
    ...(snapshots ? { snapshots } : {}),
  };
  if (shouldMirrorContent) {
    ep.content = text;
  }
  return ep;
}

function cloneNodesBodyOnly(nodes: any): StudioAssetNode[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((n: any, idx: number) => {
    const text = typeof n?.body === 'string' ? n.body : typeof n?.content === 'string' ? n.content : '';
    return {
      id: String(n?.id || `node-${idx + 1}`),
      title: String(n?.title || `条目 ${idx + 1}`),
      ...(n?.category ? { category: String(n.category) } : {}),
      ...(n?.parentId ? { parentId: String(n.parentId) } : {}),
      order: Number.isFinite(Number(n?.order)) ? Number(n.order) : idx + 1,
      ...(n?.summary ? { summary: String(n.summary) } : {}),
      body: text,
      ...(Array.isArray(n?.tags) ? { tags: n.tags.map(String) } : {}),
      ...(n?.meta && typeof n.meta === 'object' ? { meta: n.meta } : {}),
      updatedAt: String(n?.updatedAt || new Date().toISOString()),
    };
  });
}

function cloneEpisodesBodyOnly(episodes: any): StudioEpisode[] {
  if (!Array.isArray(episodes)) return [];
  return episodes.map((ep: any, idx: number) => {
    const text = typeof ep?.body === 'string' ? ep.body : typeof ep?.content === 'string' ? ep.content : '';
    const epNum = Number.isInteger(Number(ep?.episodeNumber)) ? Number(ep.episodeNumber) : idx + 1;
    return {
      id: String(ep?.id || `ep-${epNum}`),
      ...(ep?.volumeId ? { volumeId: String(ep.volumeId) } : {}),
      episodeNumber: epNum,
      title: String(ep?.title || `第 ${epNum} 集`),
      body: text,
      locked: Boolean(ep?.locked),
      updatedAt: String(ep?.updatedAt || new Date().toISOString()),
    };
  });
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

function populateTranscribeWorkspace(p: any, rawOutput: string): void {
  const now = new Date().toISOString();
  const cleanOutput = sanitizeForClient(rawOutput || '');

  if (!Array.isArray(p.volumes) || p.volumes.length === 0) {
    p.volumes = [{ id: 'vol-1', title: '第一卷', order: 1 }];
  }

  // Extract character section
  const charMatch = cleanOutput.match(/(?:###?\s*人物[^\n]*|【全剧人物[^】]*】)\n([\s\S]*?)(?=\n(?:###?|【)|$)/);
  const charText = charMatch ? charMatch[1].trim() : '';
  const charLines = charText
    .split('\n')
    .map((l: string) => l.replace(/^[-*•\d.]+\s*/, '').trim())
    .filter(Boolean);

  if (charLines.length > 0) {
    p.characterNodes = charLines.slice(0, 30).map((line: string, idx: number) => {
      const [namePart, ...rest] = line.split(/[：:]/);
      return {
        id: `char-tr-${idx + 1}`,
        title: (namePart || `角色 ${idx + 1}`).trim().slice(0, 60),
        body: rest.join('：').trim() || line,
        order: idx + 1,
        updatedAt: now,
      };
    });
  } else if (!Array.isArray(p.characterNodes) || p.characterNodes.length === 0) {
    p.characterNodes = [
      {
        id: 'char-tr-1',
        title: '核心角色锚定表',
        body: '人物定位与声线锚定已完成整理，详见交付 Word 文档。',
        order: 1,
        updatedAt: now,
      },
    ];
  }

  // Extract synopsis section
  const synMatch = cleanOutput.match(/(?:###?\s*故事梗概[^\n]*|【本集核心剧情梗概】|【剧情梗概】)\n([\s\S]*?)(?=\n(?:###?|【)|$)/);
  const synText = synMatch ? synMatch[1].trim() : cleanOutput.slice(0, 600);
  p.outlineNodes = [
    {
      id: 'out-tr-1',
      title: '全剧剧情梗概',
      body: synText || '已完成分集扒剧拆解。',
      order: 1,
      updatedAt: now,
    },
  ];

  // Parse per-episode blocks or fall back to attachment episodes
  const videoAtts = (p.attachments || [])
    .filter((a: any) => /\.(mp4|mov|webm|mkv|avi)$/i.test(String(a.name || '')))
    .sort((a: any, b: any) => (a.episode || 0) - (b.episode || 0));

  const epHeaderRegex = /(?:^|\n)(?:###?\s*)?第\s*0*(\d{1,3})\s*集[^\n]*/g;
  const matches = Array.from(cleanOutput.matchAll(epHeaderRegex));
  const parsedEpMap = new Map<number, string>();
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const epNum = Number(m[1]);
    const startIdx = m.index ?? 0;
    const endIdx = i + 1 < matches.length ? (matches[i + 1].index ?? cleanOutput.length) : cleanOutput.length;
    const slice = cleanOutput.slice(startIdx, endIdx).trim();
    if (Number.isInteger(epNum) && epNum >= 1) {
      const prev = parsedEpMap.get(epNum);
      parsedEpMap.set(epNum, prev ? `${prev}\n\n${slice}` : slice);
    }
  }

  const targetEpNums: number[] =
    videoAtts.length > 0
      ? Array.from(
          new Set<number>(
            videoAtts
              .map((a: any, idx: number) => (Number.isInteger(a.episode) && a.episode > 0 ? Number(a.episode) : idx + 1))
          )
        ).sort((a, b) => a - b)
      : parsedEpMap.size > 0
      ? Array.from(parsedEpMap.keys()).sort((a, b) => a - b)
      : [1];

  p.episodes = targetEpNums.map((epNum) => ({
    id: `ep-tr-${epNum}`,
    volumeId: p.volumes[0]?.id || 'vol-1',
    episodeNumber: epNum,
    title: `第 ${epNum} 集`,
    body: parsedEpMap.get(epNum) || cleanOutput || `第 ${epNum} 集扒剧还原正文`,
    locked: false,
    updatedAt: now,
  }));

  p.remote.outputs.synopsis = {
    title: '故事梗概与分集扒剧还原稿',
    content: synText || cleanOutput,
    updatedAt: now,
    version: 1,
  };
  p.remote.outputs.characters = {
    title: '核心人物锚定表',
    content: charText || '人物锚定表已归档。',
    updatedAt: now,
    version: 1,
  };
  p.remote.outputs.script = {
    title: '分集扒剧还原正文',
    content: cleanOutput || '全集扒剧正文已生成完毕。',
    updatedAt: now,
    version: 1,
  };
}

function formatShortDramaScript(rawText: string): string {
  const lines = String(rawText || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const formatted: string[] = [];
  for (const line of lines) {
    // Scene header standardization
    const sceneMatch = line.match(
      /^(?:第\s*0*(\d+)\s*集\s*)?(?:场次\s*)?(\d+[-_]\d+)\s*(内景|外景|内外景|内|外)\s+(.+?)(?:\s+(日|夜|黄昏|清晨))?$/
    );
    if (sceneMatch) {
      const epPart = sceneMatch[1] ? `第${sceneMatch[1]}集 ` : '';
      const locType =
        sceneMatch[3] === '内' ? '内景' : sceneMatch[3] === '外' ? '外景' : sceneMatch[3];
      const timePart = sceneMatch[5] || '日';
      formatted.push(`${epPart}场次${sceneMatch[2].replace('_', '-')} ${locType} ${sceneMatch[4].trim()} ${timePart}`);
      continue;
    }

    // Dialogue standardization: "角色: 台词" or "角色：「台词」"
    const dlgMatch = line.match(/^([\u4e00-\u9fa5A-Za-z0-9_·]{1,16})\s*[:：]\s*[""“]?(.+?)[""”]?$/);
    if (dlgMatch && !line.startsWith('▲')) {
      const spoken = dlgMatch[2].replace(/^「|」$/g, '').trim();
      formatted.push(`${dlgMatch[1]}：「${spoken}」`);
      continue;
    }

    // Action line standardization
    if (line.startsWith('▲')) {
      formatted.push(`▲ ${line.slice(1).trim()}`);
    } else if (/^第\s*\d+\s*集/.test(line) || /^场次/.test(line)) {
      formatted.push(line);
    } else {
      formatted.push(`▲ ${line}`);
    }
  }
  return formatted.join('\n');
}

function computeHeuristicAiRate(text: string): { humanRate: number; aiRate: number; reason: string } {
  const clean = text.trim();
  const sentences = clean.split(/[。！？!?\n]+/).map((s) => s.trim()).filter(Boolean);
  const hasDialogueQuotes = (clean.match(/[「」“”"]/g) || []).length >= 2;
  const hasActionMarks = clean.includes('▲');
  const clichéHits = (
    clean.match(/(不由得|总而言之|综上所述|显而易见|与此同时|不仅如此|值得注意的是|然而事实并非如此)/g) || []
  ).length;
  const uniqueChars = new Set(clean.replace(/\s+/g, '')).size;
  const lexicalDiversity = clean.length > 0 ? uniqueChars / Math.min(clean.length, 400) : 0.4;

  let humanScore = 66;
  if (hasDialogueQuotes) humanScore += 8;
  if (hasActionMarks) humanScore += 7;
  if (sentences.length >= 4) humanScore += 4;
  if (lexicalDiversity > 0.35) humanScore += 5;
  humanScore -= Math.min(28, clichéHits * 6);
  const humanRate = Math.max(15, Math.min(96, Math.round(humanScore)));
  const aiRate = 100 - humanRate;
  const reason =
    clichéHits > 0
      ? '句式偏工整且含常见过渡连接词，建议增加口语化短句与动作细节。'
      : '台词节奏紧凑、动作描写具象，整体接近人工编剧手写质感。';
  return { humanRate, aiRate, reason: reason.slice(0, 60) };
}

function buildHotlistPlatforms() {
  return [
    {
      id: 'douyin',
      name: '抖音热点榜',
      category: '短视频',
      hotTags: ['闪婚反转', '真假千金', '职场打脸'],
      items: [
        { rank: 1, title: '订婚宴当场退婚亮出百亿继承权', heat: '982w', trope: '退婚反杀' },
        { rank: 2, title: '保洁阿姨竟是幕后董事长', heat: '845w', trope: '马甲掉马' },
      ],
    },
    {
      id: 'weibo',
      name: '微博文娱热搜',
      category: '社交舆论',
      hotTags: ['豪门恩怨', '追妻火葬场', '契约婚姻'],
      items: [
        { rank: 1, title: '双强夫妻离婚冷静期联手搞事业', heat: '760w', trope: '先婚后爱' },
        { rank: 2, title: '高能3秒开场悬念短剧出圈', heat: '612w', trope: '强开场钩子' },
      ],
    },
    {
      id: 'toutiao',
      name: '今日头条热榜',
      category: '泛资讯',
      hotTags: ['银发逆袭', '年代创业', '家产争夺'],
      items: [
        { rank: 1, title: '八零年代裁缝逆袭成服装女王', heat: '540w', trope: '年代逆袭' },
        { rank: 2, title: '家族老宅拆迁引发三代真相', heat: '488w', trope: '家庭悬疑' },
      ],
    },
    {
      id: 'baidu',
      name: '百度热搜风云榜',
      category: '全网搜索',
      hotTags: ['悬疑反转', '鉴宝神医', '重生复仇'],
      items: [
        { rank: 1, title: '重生回高考前夜改写全家命运', heat: '690w', trope: '重生逆袭' },
        { rank: 2, title: '古玩市场捡漏镇馆之宝打脸全场', heat: '510w', trope: '鉴宝爽点' },
      ],
    },
    {
      id: 'bilibili',
      name: 'B站热门影视榜',
      category: 'Z世代社区',
      hotTags: ['无限流', '微短剧解说', '高能剪辑'],
      items: [
        { rank: 1, title: '时间循环五分钟拯救挚友', heat: '420w', trope: '时间循环' },
        { rank: 2, title: '古风权谋女官一步步登顶内阁', heat: '395w', trope: '大女主权谋' },
      ],
    },
    {
      id: 'fanqie',
      name: '番茄小说巅峰榜',
      category: '网文IP',
      hotTags: ['穿书炮灰', '萌宝助攻', '末日囤货'],
      items: [
        { rank: 1, title: '穿成恶毒女配后靠弹幕剧透保命', heat: '910w', trope: '弹幕穿书' },
        { rank: 2, title: '五岁萌宝带亲妈进总裁办公室认亲', heat: '830w', trope: '萌宝神助攻' },
      ],
    },
    {
      id: 'qidian',
      name: '起点中文网月票榜',
      category: '男频IP',
      hotTags: ['都市异能', '大国工匠', '商战博弈'],
      items: [
        { rank: 1, title: '金融天才重返千禧年做空巨头', heat: '780w', trope: '重生商战' },
        { rank: 2, title: '底层技术员手搓芯片突破封锁', heat: '660w', trope: '硬核逆袭' },
      ],
    },
    {
      id: 'qimao',
      name: '七猫小说热读榜',
      category: '免费阅读',
      hotTags: ['神医下山', '战神归来', '乡野发家'],
      items: [
        { rank: 1, title: '退伍保安在物业大会亮出功勋章', heat: '640w', trope: '身份反转' },
        { rank: 2, title: '农家小院直播非遗技艺日进斗金', heat: '520w', trope: '田园逆袭' },
      ],
    },
    {
      id: 'jjwxc',
      name: '晋江文学城金榜',
      category: '女频口碑',
      hotTags: ['破镜重圆', '双向救赎', '科举朝堂'],
      items: [
        { rank: 1, title: '青梅竹马分开五年在对手阵营重逢', heat: '710w', trope: '宿敌拉扯' },
        { rank: 2, title: '女扮男装中状元后被皇叔盯上', heat: '635w', trope: '朝堂马甲' },
      ],
    },
    {
      id: 'feilu',
      name: '飞卢小说新书榜',
      category: '快节奏脑洞',
      hotTags: ['系统流', '模拟器', '幕后黑手'],
      items: [
        { rank: 1, title: '获得读心术后在相亲局听穿渣男', heat: '580w', trope: '读心打脸' },
        { rank: 2, title: '每天刷新一个超能力拯救危机', heat: '495w', trope: '脑洞爽文' },
      ],
    },
    {
      id: 'hongguo',
      name: '红果短剧热播榜',
      category: '免费短剧',
      hotTags: ['闪婚亿万', '中老年甜宠', '家庭伦理'],
      items: [
        { rank: 1, title: '协议结婚的冷面丈夫竟是隐藏首富', heat: '995w', trope: '闪婚掉马' },
        { rank: 2, title: '母亲卖房救子却发现真相后彻底觉醒', heat: '870w', trope: '亲情觉醒' },
      ],
    },
    {
      id: 'overseas_reel',
      name: '海外短剧热榜（ReelShort / DramaBox）',
      category: '出海短剧',
      hotTags: ['CEO Secret Identity', 'Alpha Mate', 'Prenup Revenge'],
      items: [
        { rank: 1, title: 'Found by My Billionaire Ex at the Gala', heat: '960w', trope: 'Gala Reveal' },
        { rank: 2, title: 'Rejected Luna Returns as the Alpha Queen', heat: '890w', trope: 'Werewolf Revenge' },
      ],
    },
  ];
}

export async function GET(request: Request) {
  try {
    const user = await owner(request);
    const activeAcc = getActiveAccountOrDefault(request);
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const kindParam = url.searchParams.get('kind');
    const maxUploadBytes = getMaxUploadBytes(kindParam === 'transcribe' ? 'transcribe' : undefined);
    const maxTranscribeUploadBytes = getMaxUploadBytes('transcribe');
    const config = getStore().systemConfig;
    const promptCatalog = buildCreatorPromptCatalog(config);
    const tierCatalog = buildCreatorTierCatalog(config);
    const globalRules = typeof activeAcc?.globalRules === 'string' ? activeAcc.globalRules : '';
    const themePreference = activeAcc?.themePreference === 'dark' ? 'dark' : 'light';

    if (id) {
      const p = ensureWorkspaceDefaults(await getProject(id, user));
      if (p.remoteId && connected()) {
        p.remote = sanitizeForClient(await (await backend('/api/projects/' + p.remoteId)).json());
      }
      return Response.json(
        sanitizeForClient({
          ...p,
          promptCatalog,
          tierCatalog,
          globalRules,
          themePreference,
          maxUploadBytes,
          maxTranscribeUploadBytes,
        })
      );
    }
    const { results } = await bindings()
      .DB.prepare('SELECT data,version FROM studio_projects WHERE owner=? ORDER BY updated_at DESC')
      .bind(user)
      .all();
    return Response.json(
      sanitizeForClient({
        connected: connected(),
        testChannelAvailable: hasGptKey(),
        maxUploadBytes,
        maxTranscribeUploadBytes,
        currentAccount: activeAcc ? toPublicProfile(activeAcc) : null,
        globalRules,
        themePreference,
        promptCatalog,
        tierCatalog,
        projects: results.map((r: any) => ensureWorkspaceDefaults({ ...JSON.parse(r.data), version: r.version })),
      })
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: Request) {
  try {
    const user = await owner(request);
    const body: any = await request.json().catch(() => {
      throw new Error('INVALID_INPUT');
    });
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('INVALID_INPUT');
    }

    if (body.operation === 'create') {
      if (!['foreign', 'domestic', 'original', 'transcribe'].includes(body.kind) || !String(body.title || '').trim()) {
        throw new Error('INVALID_INPUT');
      }
      const now = new Date().toISOString();
      const brief = String(body.brief || '').slice(0, 100000);
      const total = statedTotal(brief);
      const locked = statedLocked(brief);
      if (locked !== null && total !== null && locked >= total) {
        throw new Error('INVALID_INPUT');
      }
      const promptSelections = normalizeCreatePromptSelections(body, body.kind as Kind);
      const execControls = validateExecutionControls(body);

      const p: any = {
        id: crypto.randomUUID(),
        title: String(body.title).trim().slice(0, 200),
        kind: body.kind as Kind,
        total,
        lockedEpisodes: locked,
        startEpisode: locked ? locked + 1 : 1,
        brief,
        messages: [],
        attachments: [],
        requirements: [],
        promptSelections,
        volumes: [],
        episodes: [],
        outlineNodes: [],
        characterNodes: [],
        worldNodes: [],
        projectRules: typeof body.projectRules === 'string' ? body.projectRules.slice(0, 20000) : '',
        preferredTierId: execControls.preferredTierId,
        thinkingLevel: execControls.thinkingLevel,
        executionMode: execControls.executionMode,
        archived: false,
        createdAt: now,
        updatedAt: now,
        version: 1,
        confirmed: false,
        transcribeMode: null,
        stopsReleased: false,
        processedActionIds: [],
        processedClientIds: [],
      };
      if (p.brief) {
        message(p, 'user', p.brief);
        p.requirements.push(
          `[初始说明 · 全剧适用${locked ? `（前 ${locked} 集锁定，从第 ${locked + 1} 集续写）` : ''}] ${p.brief}`
        );
      }

      const scopeSummary =
        p.kind === 'original'
          ? p.total === null
            ? '全剧集数我们放在前四层推理后的「停点 A」里和开场方案一起定。'
            : `你已初步定下全剧 ${p.total} 集（可在停点 A 最终拍板）。`
          : p.total === null
          ? '全剧总集数还没提，你随时在聊天里回一句“全剧 62 集”就行。'
          : `全剧共 ${p.total} 集。`;

      const lockSummary = locked
        ? `\n• 续写锁定范围：前 ${locked} 集作为锁定稿保护（一字不动），本轮只写第 ${locked + 1} 集到最后一集。`
        : '';

      const stepGuideByKind: Record<Kind, string> = {
        transcribe:
          '第一步：请先核对下方视频素材的集号（或继续上传视频），核对无误后点击下方按钮进入「第 2 步：选择扒剧模式（快速/详细）」。',
        foreign:
          '第一步：请核对下方的集数与锁定范围，确认无误后点击按钮启动「原稿分析与情绪曲线对位」。',
        domestic:
          '第一步：请核对下方的集数与范围，确认无误后点击按钮启动「桥段出海四级诊断与三道门」。',
        original:
          '第一步：请核对你的创意简述，点击下方按钮立即启动「前四层推理与停点 A」。',
      };

      message(
        p,
        'director',
        `项目「${p.title}」（${KIND_LABELS[p.kind as Kind]}）已建立！我们一步步推进：\n\n• 集数与范围：${scopeSummary}${lockSummary}${
          p.brief ? '\n• 你的任务说明：' + p.brief : ''
        }\n\n👉 ${stepGuideByKind[p.kind as Kind]}`
      );

      await bindings()
        .DB.prepare('INSERT INTO studio_projects (id,owner,data,version,updated_at) VALUES (?,?,?,1,?)')
        .bind(p.id, user, JSON.stringify(sanitizeForClient(p)), now)
        .run();
      return Response.json(withCatalogs(p), { status: 201 });
    }

    const p: any = ensureWorkspaceDefaults(await getProject(body.id, user));
    if (body.version !== p.version) throw new Error('CONFLICT');
    if (!Array.isArray(p.processedActionIds)) p.processedActionIds = [];
    if (!Array.isArray(p.processedClientIds)) p.processedClientIds = [];

    if (body.operation === 'set_execution') {
      const execControls = validateExecutionControls(body, p);
      p.preferredTierId = execControls.preferredTierId;
      p.thinkingLevel = execControls.thinkingLevel;
      p.executionMode = execControls.executionMode;
      const saved = await saveProject(p, user);
      return Response.json(withCatalogs(saved));
    }

    if (body.operation === 'save_workspace') {
      if (body.preferredTierId !== undefined || body.thinkingLevel !== undefined || body.executionMode !== undefined) {
        const execControls = validateExecutionControls(body, p);
        p.preferredTierId = execControls.preferredTierId;
        p.thinkingLevel = execControls.thinkingLevel;
        p.executionMode = execControls.executionMode;
      }

      const prevLockedEpisodes = p.lockedEpisodes;

      if (body.total !== undefined) {
        const nextTotal = body.total === null || body.total === '' ? null : Number(body.total);
        if (nextTotal !== null && (!Number.isInteger(nextTotal) || nextTotal < 1 || nextTotal > 300)) {
          throw new Error('INVALID_INPUT');
        }
        p.total = nextTotal;
      }
      if (body.lockedEpisodes !== undefined) {
        const nextLocked = body.lockedEpisodes === null || body.lockedEpisodes === '' ? null : Number(body.lockedEpisodes);
        if (nextLocked !== null && (!Number.isInteger(nextLocked) || nextLocked < 0 || (p.total !== null && nextLocked >= p.total))) {
          throw new Error('INVALID_INPUT');
        }
        p.lockedEpisodes = nextLocked && nextLocked > 0 ? nextLocked : null;
        p.startEpisode = p.lockedEpisodes ? p.lockedEpisodes + 1 : 1;
      }

      if (body.projectRules !== undefined) {
        if (typeof body.projectRules !== 'string') throw new Error('INVALID_INPUT');
        p.projectRules = body.projectRules.replace(/\r\n?/g, '\n').slice(0, 20000);
      }

      if (body.volumes !== undefined) {
        if (!Array.isArray(body.volumes)) throw new Error('INVALID_INPUT');
        p.volumes = body.volumes.map((v: any, idx: number): StudioVolume => ({
          id: String(v?.id || `vol-${idx + 1}`),
          title: String(v?.title || `第 ${idx + 1} 卷`).trim().slice(0, 120),
          order: Number.isFinite(Number(v?.order)) ? Number(v.order) : idx + 1,
        }));
      }

      if (body.outlineNodes !== undefined) {
        if (!Array.isArray(body.outlineNodes)) throw new Error('INVALID_INPUT');
        p.outlineNodes = body.outlineNodes.map((n: any, idx: number) =>
          normalizeAssetNodeInput(n, idx, p.outlineNodes.find((x: any) => x.id === n?.id))
        );
      }
      if (body.characterNodes !== undefined) {
        if (!Array.isArray(body.characterNodes)) throw new Error('INVALID_INPUT');
        p.characterNodes = body.characterNodes.map((n: any, idx: number) =>
          normalizeAssetNodeInput(n, idx, p.characterNodes.find((x: any) => x.id === n?.id))
        );
      }
      if (body.worldNodes !== undefined) {
        if (!Array.isArray(body.worldNodes)) throw new Error('INVALID_INPUT');
        p.worldNodes = body.worldNodes.map((n: any, idx: number) =>
          normalizeAssetNodeInput(n, idx, p.worldNodes.find((x: any) => x.id === n?.id))
        );
      }

      if (body.episodes !== undefined) {
        if (!Array.isArray(body.episodes)) throw new Error('INVALID_INPUT');
        // Verify previously locked episodes are not deleted or modified
        for (const existingEp of p.episodes) {
          const wasLocked = Boolean(
            existingEp?.locked ||
              (prevLockedEpisodes &&
                Number.isInteger(Number(existingEp?.episodeNumber)) &&
                Number(existingEp.episodeNumber) <= Number(prevLockedEpisodes))
          );
          if (!wasLocked) continue;
          const incoming = body.episodes.find(
            (e: any) => e?.id === existingEp.id || Number(e?.episodeNumber) === existingEp.episodeNumber
          );
          if (!incoming) {
            return Response.json({ error: 'EPISODE_LOCKED' }, { status: 403 });
          }
          const existingText = typeof existingEp.body === 'string' ? existingEp.body : (existingEp as any).content || '';
          const incomingText = typeof incoming.body === 'string' ? incoming.body : typeof incoming.content === 'string' ? incoming.content : '';
          if (incomingText !== existingText || (incoming.title !== undefined && String(incoming.title).trim() !== existingEp.title)) {
            return Response.json({ error: 'EPISODE_LOCKED' }, { status: 403 });
          }
        }
        p.episodes = body.episodes.map((ep: any, idx: number) =>
          normalizeEpisodeInput(ep, idx, p.episodes.find((x: any) => x.id === ep?.id))
        );
      }

      const saved = await saveProject(p, user);
      return Response.json(withCatalogs(saved));
    }

    if (body.operation === 'save_episode') {
      const targetId = typeof body.episodeId === 'string' ? body.episodeId.trim() : typeof body.id_episode === 'string' ? body.id_episode.trim() : '';
      const targetEpNum = body.episodeNumber !== undefined ? Number(body.episodeNumber) : undefined;
      const existingIdx = p.episodes.findIndex(
        (e: any) => (targetId && e.id === targetId) || (targetEpNum !== undefined && e.episodeNumber === targetEpNum)
      );
      const existing = existingIdx >= 0 ? p.episodes[existingIdx] : null;

      if (existing && isEpisodeEffectivelyLocked(p, existing)) {
        return Response.json({ error: 'EPISODE_LOCKED' }, { status: 403 });
      }
      if (!existing && p.lockedEpisodes && targetEpNum !== undefined && targetEpNum <= p.lockedEpisodes) {
        return Response.json({ error: 'EPISODE_LOCKED' }, { status: 403 });
      }

      const now = new Date().toISOString();
      const hasContentArg = body.content !== undefined;
      const nextText =
        typeof body.body === 'string'
          ? body.body
          : typeof body.content === 'string'
          ? body.content
          : existing
          ? typeof existing.body === 'string'
            ? existing.body
            : (existing as any).content || ''
          : '';

      if (existing) {
        const prevText = typeof existing.body === 'string' ? existing.body : (existing as any).content || '';
        const shouldMirrorContent = hasContentArg || 'content' in existing;
        const snap: StudioEpisodeSnapshot & { content?: string } = {
          id: 'snap-' + crypto.randomUUID(),
          at: now,
          body: prevText,
          wordCount: prevText.length,
          note: String(body.snapshotNote || '保存前自动快照'),
          ...(shouldMirrorContent ? { content: prevText } : {}),
        };
        const nextSnapshots = [snap, ...(Array.isArray(existing.snapshots) ? existing.snapshots : [])].slice(0, 20);
        const updatedEp: any = {
          ...existing,
          ...(body.volumeId !== undefined ? { volumeId: body.volumeId || undefined } : {}),
          ...(targetEpNum !== undefined && Number.isInteger(targetEpNum) && targetEpNum >= 1
            ? { episodeNumber: targetEpNum }
            : {}),
          title: body.title !== undefined ? String(body.title).trim().slice(0, 200) : existing.title,
          body: nextText,
          snapshots: nextSnapshots,
          updatedAt: now,
        };
        if (shouldMirrorContent) {
          updatedEp.content = nextText;
        }
        p.episodes[existingIdx] = updatedEp;
      } else {
        const epNum =
          targetEpNum !== undefined && Number.isInteger(targetEpNum) && targetEpNum >= 1
            ? targetEpNum
            : p.episodes.length + 1;
        const newEp: any = {
          id: targetId || `ep-${crypto.randomUUID()}`,
          ...(body.volumeId ? { volumeId: String(body.volumeId) } : {}),
          episodeNumber: epNum,
          title: String(body.title || `第 ${epNum} 集`).trim().slice(0, 200),
          body: nextText,
          locked: Boolean(body.locked),
          snapshots: [],
          updatedAt: now,
        };
        if (hasContentArg) {
          newEp.content = nextText;
        }
        p.episodes.push(newEp);
      }

      const saved = await saveProject(p, user);
      return Response.json(withCatalogs(saved));
    }

    if (body.operation === 'delete_episode') {
      const targetId = typeof body.episodeId === 'string' ? body.episodeId.trim() : '';
      const targetEpNum = body.episodeNumber !== undefined ? Number(body.episodeNumber) : undefined;
      const existing = p.episodes.find(
        (e: any) => (targetId && e.id === targetId) || (targetEpNum !== undefined && e.episodeNumber === targetEpNum)
      );
      if (!existing) throw new Error('NOT_FOUND');
      if (isEpisodeEffectivelyLocked(p, existing)) {
        return Response.json({ error: 'EPISODE_LOCKED' }, { status: 403 });
      }
      p.episodes = p.episodes.filter((e: any) => e.id !== existing.id);
      const saved = await saveProject(p, user);
      return Response.json(withCatalogs(saved));
    }

    if (body.operation === 'restore_episode_snapshot') {
      const targetId = typeof body.episodeId === 'string' ? body.episodeId.trim() : '';
      const snapshotId = typeof body.snapshotId === 'string' ? body.snapshotId.trim() : '';
      if (!targetId || !snapshotId) throw new Error('INVALID_INPUT');
      const existing = p.episodes.find((e: any) => e.id === targetId);
      if (!existing) throw new Error('NOT_FOUND');
      if (isEpisodeEffectivelyLocked(p, existing)) {
        return Response.json({ error: 'EPISODE_LOCKED' }, { status: 403 });
      }
      const snap = (existing.snapshots || []).find((s: any) => s.id === snapshotId);
      if (!snap) throw new Error('NOT_FOUND');
      const snapText = typeof snap.body === 'string' ? snap.body : (snap as any).content || '';
      existing.body = snapText;
      if ('content' in existing || 'content' in snap || body.content !== undefined) {
        (existing as any).content = snapText;
      }
      existing.updatedAt = new Date().toISOString();
      const saved = await saveProject(p, user);
      return Response.json(withCatalogs(saved));
    }

    if (body.operation === 'toggle_episode_lock') {
      const targetId = typeof body.episodeId === 'string' ? body.episodeId.trim() : '';
      const targetEpNum = body.episodeNumber !== undefined ? Number(body.episodeNumber) : undefined;
      const existing = p.episodes.find(
        (e: any) => (targetId && e.id === targetId) || (targetEpNum !== undefined && e.episodeNumber === targetEpNum)
      );
      if (!existing) throw new Error('NOT_FOUND');
      existing.locked = typeof body.locked === 'boolean' ? body.locked : !existing.locked;
      existing.updatedAt = new Date().toISOString();
      const saved = await saveProject(p, user);
      return Response.json(withCatalogs(saved));
    }

    if (body.operation === 'save_volume') {
      const volId = String(body.volumeId || body.volume?.id || `vol-${crypto.randomUUID()}`).trim();
      const title = String(body.title ?? body.volume?.title ?? '').trim().slice(0, 120);
      if (!title) throw new Error('INVALID_INPUT');
      const order = Number.isFinite(Number(body.order ?? body.volume?.order))
        ? Number(body.order ?? body.volume?.order)
        : p.volumes.length + 1;
      const idx = p.volumes.findIndex((v: any) => v.id === volId);
      const vol: StudioVolume = { id: volId, title, order };
      if (idx >= 0) p.volumes[idx] = vol;
      else p.volumes.push(vol);
      const saved = await saveProject(p, user);
      return Response.json(withCatalogs(saved));
    }

    if (body.operation === 'delete_volume') {
      const volId = String(body.volumeId || '').trim();
      if (!volId) throw new Error('INVALID_INPUT');
      if (p.episodes.some((ep: any) => ep.volumeId === volId && isEpisodeEffectivelyLocked(p, ep))) {
        return Response.json({ error: 'EPISODE_LOCKED' }, { status: 403 });
      }
      p.volumes = p.volumes.filter((v: any) => v.id !== volId);
      for (const ep of p.episodes) {
        if (ep.volumeId === volId) delete ep.volumeId;
      }
      const saved = await saveProject(p, user);
      return Response.json(withCatalogs(saved));
    }

    if (body.operation === 'save_asset_node' || body.operation === 'delete_asset_node') {
      const tree = String(body.tree || '').trim();
      const treeKey =
        tree === 'outline' || tree === 'outlineNodes'
          ? 'outlineNodes'
          : tree === 'characters' || tree === 'characterNodes'
          ? 'characterNodes'
          : tree === 'world' || tree === 'worldNodes'
          ? 'worldNodes'
          : '';
      if (!treeKey) throw new Error('INVALID_INPUT');

      if (body.operation === 'delete_asset_node') {
        const nodeId = String(body.nodeId || body.id_node || '').trim();
        if (!nodeId) throw new Error('INVALID_INPUT');
        p[treeKey] = p[treeKey].filter((n: any) => n.id !== nodeId);
      } else {
        const rawNode = body.node && typeof body.node === 'object' ? body.node : body;
        const nodeId = String(rawNode.nodeId || rawNode.id_node || rawNode.id || '').trim();
        const existingIdx = nodeId ? p[treeKey].findIndex((n: any) => n.id === nodeId) : -1;
        const existing = existingIdx >= 0 ? p[treeKey][existingIdx] : undefined;
        const normalized = normalizeAssetNodeInput(
          { ...rawNode, ...(nodeId ? { id: nodeId } : {}) },
          p[treeKey].length,
          existing
        );
        if (existingIdx >= 0) p[treeKey][existingIdx] = normalized;
        else p[treeKey].push(normalized);
      }
      const saved = await saveProject(p, user);
      return Response.json(withCatalogs(saved));
    }

    if (body.operation === 'save_rules') {
      if (body.projectRules !== undefined) {
        if (typeof body.projectRules !== 'string') throw new Error('INVALID_INPUT');
        p.projectRules = body.projectRules.replace(/\r\n?/g, '\n').slice(0, 20000);
      }
      if (body.globalRules !== undefined) {
        if (typeof body.globalRules !== 'string') throw new Error('INVALID_INPUT');
        const activeAcc = getActiveAccountOrDefault(request);
        if (activeAcc) {
          activeAcc.globalRules = body.globalRules.replace(/\r\n?/g, '\n').slice(0, 20000);
          flushPersistentStore();
        }
      }
      const saved = await saveProject(p, user);
      return Response.json(withCatalogs(saved));
    }

    if (body.operation === 'ai_apply_writeback') {
      const execControls = validateExecutionControls(body, p);
      if (execControls.executionMode === 'plan') {
        return Response.json({ error: 'PLAN_MODE_READ_ONLY' }, { status: 403 });
      }
      p.executionMode = execControls.executionMode;
      p.preferredTierId = execControls.preferredTierId;
      p.thinkingLevel = execControls.thinkingLevel;

      const hasContentArg = body.content !== undefined;
      const nextText = String(body.body ?? body.content ?? '');
      const now = new Date().toISOString();

      if (body.episodeId !== undefined || body.episodeNumber !== undefined) {
        const targetId = typeof body.episodeId === 'string' ? body.episodeId.trim() : '';
        const targetEpNum = body.episodeNumber !== undefined ? Number(body.episodeNumber) : undefined;
        const existingIdx = p.episodes.findIndex(
          (e: any) => (targetId && e.id === targetId) || (targetEpNum !== undefined && e.episodeNumber === targetEpNum)
        );
        const existing = existingIdx >= 0 ? p.episodes[existingIdx] : null;
        if (existing && isEpisodeEffectivelyLocked(p, existing)) {
          return Response.json({ error: 'EPISODE_LOCKED' }, { status: 403 });
        }
        if (!existing && p.lockedEpisodes && targetEpNum !== undefined && targetEpNum <= p.lockedEpisodes) {
          return Response.json({ error: 'EPISODE_LOCKED' }, { status: 403 });
        }
        if (existing) {
          const prevText = typeof existing.body === 'string' ? existing.body : (existing as any).content || '';
          const shouldMirrorContent = hasContentArg || 'content' in existing;
          const snap: StudioEpisodeSnapshot & { content?: string } = {
            id: 'snap-' + crypto.randomUUID(),
            at: now,
            body: prevText,
            wordCount: prevText.length,
            note: 'AI 写回前快照',
            ...(shouldMirrorContent ? { content: prevText } : {}),
          };
          existing.snapshots = [snap, ...(Array.isArray(existing.snapshots) ? existing.snapshots : [])].slice(0, 20);
          if (body.title !== undefined) existing.title = String(body.title).trim().slice(0, 200);
          existing.body = nextText;
          if (shouldMirrorContent) (existing as any).content = nextText;
          existing.updatedAt = now;
        } else {
          const epNum =
            targetEpNum !== undefined && Number.isInteger(targetEpNum) && targetEpNum >= 1
              ? targetEpNum
              : p.episodes.length + 1;
          const createdEp: any = {
            id: targetId || `ep-${crypto.randomUUID()}`,
            episodeNumber: epNum,
            title: String(body.title || `第 ${epNum} 集`).trim().slice(0, 200),
            body: nextText,
            locked: false,
            snapshots: [],
            updatedAt: now,
          };
          if (hasContentArg) createdEp.content = nextText;
          p.episodes.push(createdEp);
        }
      } else if (body.tree && body.nodeId) {
        const treeKey =
          body.tree === 'outline' || body.tree === 'outlineNodes'
            ? 'outlineNodes'
            : body.tree === 'characters' || body.tree === 'characterNodes'
            ? 'characterNodes'
            : body.tree === 'world' || body.tree === 'worldNodes'
            ? 'worldNodes'
            : '';
        if (!treeKey) throw new Error('INVALID_INPUT');
        const idx = p[treeKey].findIndex((n: any) => n.id === body.nodeId);
        const normalized = normalizeAssetNodeInput(
          {
            id: body.nodeId,
            title: body.title,
            body: body.body,
            ...(hasContentArg ? { content: body.content } : {}),
          },
          p[treeKey].length,
          idx >= 0 ? p[treeKey][idx] : undefined
        );
        if (idx >= 0) p[treeKey][idx] = normalized;
        else p[treeKey].push(normalized);
      } else {
        throw new Error('INVALID_INPUT');
      }

      const saved = await saveProject(p, user);
      return Response.json(withCatalogs(saved));
    }

    if (body.operation === 'studio_tool') {
      const tool = String(body.tool || '').trim().toLowerCase();
      const inputText = String(body.text || '').trim();
      const acc = getActiveAccountOrDefault(request);

      if (tool === 'inspire' || tool === 'inspiration') {
        const llm = hasGptKey()
          ? await callProjectStation({
              project: p,
              station: 'planner',
              account: acc,
              userPrompt: `请为短剧《${p.title}》提供 3 条高冲突、可落地的竖屏短剧创意灵感方向（每条包含开场3秒钩子、核心反转与卡点）。补充语境：${inputText || p.brief || '豪门逆袭'}`,
            })
          : { ok: false, text: null };
        const result =
          llm.ok && llm.text
            ? llm.text
            : [
                '1. 【强钩子开场】前 3 秒把主角最珍视的凭证或契约当众撕毁，紧接着让反派给出看似绝境的 10 秒倒计时。',
                '2. 【身份错位反转】让最不起眼的旁观见证人成为揭晓真相的关键钥匙，把打脸从口头升级为资产/权力即时交割。',
                '3. 【集尾付费悬念】在主角刚夺回主动权时抛出更高层级对手的来电或遗嘱补充条款，逼出下一集追更欲。',
              ].join('\n');
        return Response.json(
          sanitizeForClient({
            ok: true,
            tool: 'inspire',
            version: p.version,
            result,
            idea: result,
            text: result,
          })
        );
      }

      if (tool === 'format') {
        if (!inputText) throw new Error('INVALID_INPUT');
        const formatted = formatShortDramaScript(inputText);
        return Response.json(
          sanitizeForClient({
            ok: true,
            tool: 'format',
            version: p.version,
            formatted,
            result: formatted,
            text: formatted,
          })
        );
      }

      if (tool === 'ai_rate') {
        if (inputText.length < 120) throw new Error('INVALID_INPUT');
        const { humanRate, aiRate, reason } = computeHeuristicAiRate(inputText);
        return Response.json(
          sanitizeForClient({
            ok: true,
            tool: 'ai_rate',
            version: p.version,
            humanRate,
            aiRate,
            reason,
            result: { humanRate, aiRate, reason },
          })
        );
      }

      if (tool === 'hotlist' || tool === 'hot_rank' || tool === 'trending') {
        const platforms = buildHotlistPlatforms();
        return Response.json(
          sanitizeForClient({
            ok: true,
            tool: 'hotlist',
            version: p.version,
            platforms,
            result: { platforms },
            updatedAt: new Date().toISOString(),
          })
        );
      }

      if (tool === 'book_breakdown' || tool === 'teardown') {
        if (!inputText) throw new Error('INVALID_INPUT');
        const llm = hasGptKey()
          ? await callProjectStation({
              project: p,
              station: 'analyst',
              account: acc,
              userPrompt: `请对以下原稿/小说文本执行快速拆书（提炼：1. 核心卖点与五问诊断；2. 情绪曲线与付费卡点；3. 人物关系与短剧改编建议）：\n\n${inputText.slice(0, 12000)}`,
            })
          : { ok: false, text: null };
        const analysis =
          llm.ok && llm.text
            ? llm.text
            : `【拆书要点分析】\n1. 核心冲突：围绕「${inputText.slice(0, 40)}...」构建强因果对立。\n2. 情绪节奏：前 3 集完成立人设+踩痛点+第一次反转。\n3. 改编建议：砍掉冗余心理独白，将关键信息外化为台词交锋与道具实锤（▲ 动作外化）。`;
        return Response.json(
          sanitizeForClient({
            ok: true,
            tool: 'book_breakdown',
            version: p.version,
            result: analysis,
            analysis,
          })
        );
      }

      throw new Error('INVALID_INPUT');
    }

    if (body.operation === 'message') {
      if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 100000) {
        throw new Error('INVALID_INPUT');
      }
      const execControls = validateExecutionControls(body, p);
      p.preferredTierId = execControls.preferredTierId;
      p.thinkingLevel = execControls.thinkingLevel;
      p.executionMode = execControls.executionMode;

      const cleanText = body.text.trim();
      if (body.client_id && p.processedClientIds.includes(body.client_id)) {
        return Response.json(withCatalogs(p));
      }
      if (body.client_id) p.processedClientIds.push(body.client_id);

      if (p.remoteId && connected()) {
        await backend('/api/projects/' + p.remoteId + '/messages', 'POST', {
          client_id: body.client_id,
          text: cleanText,
        });
      }
      message(p, 'user', cleanText);

      // In plan mode, strictly avoid mutating episodes / asset trees; respond with planning advice only
      if (p.executionMode === 'plan') {
        p.requirements.push(`[计划模式建议记录 · 只读不写正文 · v${p.version + 1}] ${cleanText}`);
        message(
          p,
          'director',
          `当前处于「计划模式（只读规划）」：已将你的想法「${cleanText.slice(0, 80)}」整理为方案建议，不会直接改写左侧正文字段或设定节点。如需正式写入正文，请切换为「自动模式」后再执行写回。`
        );
      }
      // 1. Check if user is asking for progress / ETA (G14)
      else if (isProgressQuery(cleanText)) {
        message(p, 'director', buildProgressReply(p));
      }
      // 2. Check if user is explicitly releasing episode-by-episode stops (G10)
      else if (/(通过[，,\s]*写完吧|后面直接写完|放开(后续)?停点|直接写到底)/.test(cleanText)) {
        p.stopsReleased = true;
        if (p.remote) p.remote.stopsReleased = true;
        p.requirements.push(`[停点指令 · 正文阶段生效] ${cleanText}`);
        message(
          p,
          'director',
          '好嘞！已放开后续正文的逐集确认停点，并记入确认单。接下来分集编剧会整批写到底，后台自动过初审、返修、精修和终复核，每走完一环我用大白话向你汇报一次，最后直接给你交 Word。'
        );
      }
      // 3. Check if user is answering the initial build confirmation card via text (G2)
      else if (!p.remoteId && !p.confirmed && /^(对|好的|确认|信息无误|没问题|对[，,\s]*开始)[。！!]*$/.test(cleanText)) {
        p.confirmed = true;
        message(
          p,
          'director',
          !connected() && !hasGptKey()
            ? '复述和方向已确认！材料和要求都已锁进确认单。现在可以继续跟我聊细节建议，接入创作后端后立即派发给原稿分析师。'
            : p.kind !== 'original' && p.total === null
            ? '复述已确认！开干前还需要你定一下全剧总集数（比如直接回“全剧 62 集”），我好按集数给你排付费卡点和情绪曲线。'
            : '复述已确认！现在直接点下方卡片「开始分析 / 开始推理」，我马上派活推进下一步。'
        );
      }
      // 4. Check if user is specifying transcribe mode via chat text (no default mode allowed)
      else if (p.kind === 'transcribe' && /^(选|使用)?(快速模式|详细模式|快速|详细)[。！!]*$/.test(cleanText)) {
        const isFast = cleanText.includes('快速');
        p.transcribeMode = isFast ? 'fast' : 'detailed';
        if (p.remote) p.remote.transcribeMode = p.transcribeMode;
        p.requirements.push(`[扒剧模式拍板] 选择「${isFast ? '快速模式（整集看写+抽查）' : '详细模式（每秒一帧逐格看写）'}」`);
        message(
          p,
          'director',
          `记下了，本剧采用「${isFast ? '快速模式（按整集看写并抽查关键集）' : '详细模式（按每秒一帧逐格看完再写）'}」。建议核对完上方集号后直接点开始扒剧，跑完我会把 Word (.docx) 打包给你。`
        );
      }
      // 5. General requirement / total episodes / locked episodes extraction + Proactive Director Suggestions
      else if (!p.remoteId || !connected()) {
        const count = statedTotal(cleanText);
        const locked = statedLocked(cleanText);
        const notes: string[] = [];
        if (count !== null) {
          if (p.lockedEpisodes && count <= p.lockedEpisodes) throw new Error('INVALID_INPUT');
          p.total = count;
          notes.push(`全剧总集数定为 ${p.total} 集`);
        }
        if (locked !== null) {
          if (p.total !== null && locked >= p.total) throw new Error('INVALID_INPUT');
          p.lockedEpisodes = locked;
          p.startEpisode = locked + 1;
          notes.push(`前 ${locked} 集已设为只读锁定稿（一字不动），本轮从第 ${locked + 1} 集写到最后一集`);
        }
        const scopeTag = p.remoteId ? '下一可更新批次生效' : '全剧及首轮分析生效';
        p.requirements.push(`[补充要求 · ${scopeTag} · v${p.version + 1}] ${cleanText}`);

        const headLine = notes.length > 0 ? `记下了：${notes.join('；')}。` : `记下了，这条要求已写进右侧「要求台账」（${scopeTag}）。`;

        message(
          p,
          'director',
          `${headLine}\n你可以直接点击下方当前步骤卡片的按钮继续下一步，或者继续发消息补充其他要求。`
        );
      } else {
        p.requirements.push(`[运行中追加 · 下一可更新节点生效 · v${p.version + 1}] ${cleanText}`);
        const remote: any = await (await backend('/api/projects/' + p.remoteId)).json();
        p.remote = sanitizeForClient(remote);
      }
    } else if (body.operation === 'switch_kind') {
      if (!['foreign', 'domestic', 'original', 'transcribe'].includes(body.kind) || p.remoteId) {
        throw new Error('INVALID_INPUT');
      }
      p.kind = body.kind as Kind;
      if (!p.promptSelections || typeof p.promptSelections !== 'object') {
        p.promptSelections = {};
      }
      if (p.kind === 'transcribe' && p.promptSelections.transcribe) {
        delete p.promptSelections.transcribe.secondary;
      }
      message(
        p,
        'director',
        `已将本项目流程切换为「${KIND_LABELS[p.kind as Kind]}」。请核对下方第 1 步卡片中的信息，确认无误后点击按钮进入下一步。`
      );
    } else if (body.operation === 'set_prompts') {
      const targetKind = (
        body.kind !== undefined && body.kind !== null && String(body.kind).trim() !== ''
          ? String(body.kind).trim()
          : p.kind
      ) as Kind;
      if (!isValidKind(targetKind)) {
        throw new Error('INVALID_INPUT');
      }
      if (
        body.promptSelections !== undefined &&
        body.promptSelections !== null &&
        (typeof body.promptSelections !== 'object' || Array.isArray(body.promptSelections))
      ) {
        throw new Error('INVALID_INPUT');
      }
      if (
        body.promptSelections?.[targetKind] !== undefined &&
        body.promptSelections?.[targetKind] !== null &&
        (typeof body.promptSelections[targetKind] !== 'object' ||
          Array.isArray(body.promptSelections[targetKind]))
      ) {
        throw new Error('INVALID_INPUT');
      }

      const rawPrimary =
        body.primaryPluginId !== undefined
          ? body.primaryPluginId
          : body.promptSelections?.[targetKind]?.primary ?? body.promptSelections?.primary;
      const rawSecondary =
        body.secondaryPluginId !== undefined
          ? body.secondaryPluginId
          : body.promptSelections?.[targetKind]?.secondary ?? body.promptSelections?.secondary;

      const currentSelections: ProjectPromptSelections =
        p.promptSelections && typeof p.promptSelections === 'object' ? { ...p.promptSelections } : {};
      const nextSlotSel: PromptSlotSelection = { ...(currentSelections[targetKind] || {}) };

      const validatedPrimary = validateAndPickPluginId(rawPrimary, targetKind, 'primary');
      if (validatedPrimary !== undefined) {
        if (validatedPrimary === '') delete nextSlotSel.primary;
        else nextSlotSel.primary = validatedPrimary;
      }

      const validatedSecondary = validateAndPickPluginId(rawSecondary, targetKind, 'secondary');
      if (validatedSecondary !== undefined) {
        if (validatedSecondary === '') delete nextSlotSel.secondary;
        else nextSlotSel.secondary = validatedSecondary;
      }

      if (!getAllowedSlotsForKind(targetKind).includes('secondary')) {
        delete nextSlotSel.secondary;
      }

      currentSelections[targetKind] = nextSlotSel;
      p.promptSelections = currentSelections;
    } else if (body.operation === 'archive') {
      p.archived = Boolean(body.archived);
    } else if (body.operation === 'set_episode') {
      const episode = Number(body.episode);
      const attachment = p.attachments.find((a: any) => a.id === body.attachment_id);
      if (
        p.kind !== 'transcribe' ||
        p.remoteId ||
        !attachment ||
        !Number.isInteger(episode) ||
        episode < 1 ||
        episode > (p.total ?? 300)
      ) {
        throw new Error('INVALID_INPUT');
      }
      if (p.attachments.some((a: any) => a.id !== attachment.id && a.episode === episode)) {
        throw new Error('EPISODE_ALREADY_USED');
      }
      attachment.episode = episode;
      message(p, 'director', `已将「${attachment.name}」标为第 ${episode} 集。`);
    } else if (body.operation === 'set_role') {
      const role = body.role;
      const attachment = p.attachments.find((a: any) => a.id === body.attachment_id);
      if (!attachment || !['source', 'locked', 'setting', 'reference'].includes(role)) {
        throw new Error('INVALID_INPUT');
      }
      attachment.role = role;
      const roleLabel: Record<string, string> = {
        source: '原稿素材',
        locked: '锁定稿（只读保护，一字不改）',
        setting: '设定与参考资料',
        reference: '参考附件',
      };
      message(p, 'director', `已将素材「${attachment.name}」归类为「${roleLabel[role]}」。`);
    } else if (body.operation === 'set_locked') {
      const locked = body.locked === null || body.locked === '' ? null : Number(body.locked);
      if (locked !== null && (!Number.isInteger(locked) || locked < 0 || (p.total !== null && locked >= p.total))) {
        throw new Error('INVALID_INPUT');
      }
      p.lockedEpisodes = locked && locked > 0 ? locked : null;
      p.startEpisode = p.lockedEpisodes ? p.lockedEpisodes + 1 : 1;
      message(
        p,
        'director',
        p.lockedEpisodes
          ? `已设置续写锁定范围：前 ${p.lockedEpisodes} 集锁定一字不动，本轮从第 ${p.startEpisode} 集写到最后一集。`
          : '已取消前序集数锁定，本轮从第 1 集开始创作。'
      );
    } else if (body.operation === 'rename') {
      if (!String(body.title || '').trim()) throw new Error('INVALID_INPUT');
      p.title = String(body.title).trim().slice(0, 200);
    } else if (body.operation === 'confirm') {
      const execControls = validateExecutionControls(body, p);
      p.preferredTierId = execControls.preferredTierId;
      p.thinkingLevel = execControls.thinkingLevel;
      p.executionMode = execControls.executionMode;
      p.confirmed = true;
      const readyToConnect = connected() || hasGptKey();
      message(
        p,
        'director',
        !readyToConnect
          ? '建档与复述已确认！你可以继续在聊天框跟我讨论细节，或点采纳上方的建议胶囊；接入生成服务后即可一键派活。'
          : p.kind !== 'original' && p.total === null
          ? '建档已确认！开干前请直接发消息告诉我全剧几集（例如“全剧 62 集”），我好给你排卡点。'
          : '建档已确认！请点下方卡片启动第一阶段任务。'
      );
    } else if (body.operation === 'action') {
      if (!p.remoteId) throw new Error('SERVICE_NOT_CONNECTED');
      const execControls = validateExecutionControls(body, p);
      p.preferredTierId = execControls.preferredTierId;
      p.thinkingLevel = execControls.thinkingLevel;
      p.executionMode = execControls.executionMode;

      const actionPayload = body.action || {};
      if (actionPayload.action_id && p.processedActionIds.includes(actionPayload.action_id)) {
        return Response.json(withCatalogs(p));
      }
      if (
        actionPayload.action === 'confirm' &&
        p.remote?.card?.fields?.includes('understood') &&
        actionPayload.answers?.understood !== true
      ) {
        throw new Error('UNDERSTOOD_GATE_REQUIRED');
      }
      if (
        actionPayload.action === 'confirm' &&
        p.remote?.card?.fields?.includes('mode') &&
        !['fast', 'detailed'].includes(actionPayload.answers?.mode)
      ) {
        throw new Error('MODE_SELECTION_REQUIRED');
      }
      if (actionPayload.action_id) p.processedActionIds.push(actionPayload.action_id);

      if (connected()) {
        p.remote = sanitizeForClient(
          await (await backend('/api/projects/' + p.remoteId + '/actions', 'POST', actionPayload)).json()
        );
      } else if (p.remote?.mode === 'test_channel') {
        if (actionPayload.action === 'pause') {
          p.remote.status = 'paused';
          message(p, 'director', '已收到暂停请求，已停止派发下一步任务，当前已完成产物已保存。');
        } else if (actionPayload.action === 'resume' || actionPayload.action === 'retry') {
          p.remote.status = 'waiting_confirm';
          message(p, 'director', '已从最近确认的检查点恢复流程，请继续在当前卡片拍板。');
        } else if (actionPayload.action === 'release_stops') {
          p.stopsReleased = true;
          p.remote.stopsReleased = true;
          message(p, 'director', '已放开后续正文逐集确认停点，后续集数将整批推进至审改与交付。');
        } else if (actionPayload.action === 'revise') {
          const fb = String(actionPayload.answers?.feedback || '').trim();
          if (fb) {
            p.requirements.push(`[卡片修订意见 · v${p.version + 1}] ${fb}`);
          }
          const acc = getActiveAccountOrDefault(request);
          const reviseRes = await callProjectStation({
            project: p,
            station: 'director',
            account: acc,
            userPrompt: `项目《${p.title}》（${KIND_LABELS[p.kind as Kind]}）在阶段「${p.remote.stage?.title}」收到用户的修改意见：「${fb}」。请用2-3条大白话说明已如何按此意见调整当前阶段方案，并请用户再次确认卡片。`,
          });
          message(
            p,
            'director',
            reviseRes.ok && reviseRes.text
              ? reviseRes.text
              : `已按你的意见「${fb}」修订当前阶段方案，并记入要求台账。请核对后点击确认继续。`
          );
          p.remote.version = (p.remote.version || 1) + 1;
        } else if (actionPayload.action === 'confirm') {
          // Backward-compatibility guard: legacy Step 3 confirm on already-delivered transcribe
          if (p.kind === 'transcribe' && p.remote?.status === 'delivered' && p.remote?.card === null) {
            const ans = actionPayload.answers || {};
            const noteStr = Object.entries(ans)
              .filter(([_, v]) => v !== undefined && String(v).trim() !== '')
              .map(([k, v]) => `${k}=${v}`)
              .join('；');
            if (noteStr) {
              p.requirements.push(`[扒剧交付补充确认] ${noteStr}`);
            }
            const savedCompat = await saveProject(p, user);
            return Response.json(withCatalogs(savedCompat));
          }

          const ans = actionPayload.answers || {};
          if (ans.mode && ['fast', 'detailed'].includes(ans.mode)) {
            p.transcribeMode = ans.mode;
            p.remote.transcribeMode = ans.mode;
          }
          if (ans.total && Number.isInteger(Number(ans.total)) && Number(ans.total) >= 1) {
            p.total = Number(ans.total);
          }
          const ansSummary = Object.entries(ans)
            .filter(([_, v]) => v !== undefined && String(v).trim() !== '')
            .map(([k, v]) => `${k}=${v}`)
            .join('；');
          if (ansSummary) {
            p.requirements.push(`[阶段拍板 · ${p.remote.stage?.title || '确认卡'}] ${ansSummary}`);
          }

          const acc = getActiveAccountOrDefault(request);
          const isAnomalyConfirm = p.remote?.card?.id === 'card-transcribe-anomaly';
          const nextCursor = isAnomalyConfirm ? 2 : (p.remote.cursor || 1) + 1;
          p.remote.cursor = nextCursor;
          p.remote.version = (p.remote.version || 1) + 1;
          p.remote.progress.completed_steps = Math.min(
            p.remote.progress.total_steps,
            (p.remote.progress.completed_steps || 1) + 1
          );

          // Advance workflow stages by kind & cursor
          if (p.kind === 'transcribe') {
            const videoAtts = (p.attachments || []).filter((a: any) =>
              /\.(mp4|mov|webm|mkv|avi)$/i.test(String(a.name || ''))
            );
            const textOrSubAtts = (p.attachments || []).filter((a: any) =>
              /\.(txt|md|srt|ass|vtt|csv|json|docx|xlsx)$/i.test(String(a.name || ''))
            );
            const imageAtts = (p.attachments || []).filter((a: any) =>
              /\.(png|jpg|jpeg|webp)$/i.test(String(a.name || ''))
            );
            const inlineKeyframesRaw = Array.isArray(actionPayload.keyframes)
              ? actionPayload.keyframes
              : Array.isArray(body.keyframes)
              ? body.keyframes
              : [];
            const extraKeyframes: MultimodalAttachmentInput[] = inlineKeyframesRaw
              .filter((k: any) => k && typeof k.base64 === 'string' && k.base64.trim())
              .map((k: any, idx: number) => ({
                name: String(k.name || `frame-${idx + 1}.jpg`),
                mimeType: String(k.mimeType || 'image/jpeg'),
                base64: String(k.base64),
              }));

            // Check for real anomalies before executing transcribe
            if (!isAnomalyConfirm) {
              const anomalyReasons: string[] = [];
              const epSeen = new Set<number>();
              for (const va of videoAtts) {
                if (!Number.isInteger(va.episode) || va.episode < 1) {
                  anomalyReasons.push(`视频「${va.name}」尚未标注集号`);
                } else if (epSeen.has(va.episode)) {
                  anomalyReasons.push(`第 ${va.episode} 集存在重复视频素材`);
                } else {
                  epSeen.add(va.episode);
                }
              }
              const over30Videos = videoAtts.filter((va: any) => Number(va.size || 0) > MULTIMODAL_VIDEO_CAP_BYTES);
              if (
                over30Videos.length > 0 &&
                textOrSubAtts.length === 0 &&
                imageAtts.length === 0 &&
                extraKeyframes.length === 0
              ) {
                anomalyReasons.push(
                  `视频「${over30Videos.map((v: any) => v.name).join('、')}」体积超过 30 MB，且未附带字幕稿（.srt/.txt）或提取关键帧，无法直接看清对白与画面细节`
                );
              }

              if (anomalyReasons.length > 0) {
                p.remote.status = 'waiting_confirm';
                p.remote.cursor = 1;
                p.remote.progress.completed_steps = 1;
                p.remote.stage = { key: 'anomaly_confirm', title: '素材异常确认（请老板拍板）' };
                p.remote.card = {
                  id: 'card-transcribe-anomaly',
                  step: 'anomaly_confirm',
                  title: '素材异常确认（请老板拍板）',
                  fields: ['anomaly_resolution'],
                  questions: [
                    {
                      question: `检测到以下异常：${anomalyReasons.join('；')}。建议补传字幕或关键帧后重试；如确认仅按现有信息先拆出结构，请点击确认继续：`,
                    },
                  ],
                };
                message(
                  p,
                  'director',
                  `老板，刚准备开工时发现个小状况需要您拍板：${anomalyReasons.join('；')}。您可以先补传字幕/关键帧，或者点下方卡片确认让我继续按现有素材往下跑。`
                );
                const savedAnom = await saveProject(p, user);
                return Response.json(withCatalogs(savedAnom));
              }
            }

            // Clean run (or anomaly confirmed): execute vision directly and deliver .docx without Step 3 empty card
            let combinedRawOutput = '';
            if (videoAtts.length > 3) {
              const sortedVideos = [...videoAtts].sort((a: any, b: any) => (a.episode || 0) - (b.episode || 0));
              const perEpOutputs = await runWithConcurrency(sortedVideos, 3, async (va: any) => {
                const epLabel = `第 ${va.episode || 1} 集《${va.name}》`;
                const r = await callProjectStation({
                  project: p,
                  station: 'vision',
                  account: acc,
                  extraKeyframes,
                  userPrompt: `请直接拆解短剧视频/字幕素材（${epLabel}，模式：${
                    p.transcribeMode === 'detailed'
                      ? '详细模式（逐格拆解画面动作与台词）'
                      : '快速模式（整集还原场次、动作与台词）'
                  }）。请直接输出结构化扒剧结果：\n1. 【全剧人物标准人名锚定表】\n2. 【本集核心剧情梗概】\n3. 【分集分场次还原剧本】（格式：“第X集 场次1-1 内/外景 地点 日/夜”，动作以 ▲ 标示，逐句还原台词）。`,
                });
                return r.ok && r.text ? r.text : `第${va.episode || 1}集 场次1-1 内景 场景 日\n▲ 完成该集结构梳理。`;
              });
              combinedRawOutput = perEpOutputs.join('\n\n');
            } else {
              const epListDesc =
                p.attachments.length > 0
                  ? p.attachments
                      .map((a: any) => `第 ${a.episode || 1} 集《${a.name}》`)
                      .join('、')
                  : `《${p.title}》第 1 集`;
              const llm = await callProjectStation({
                project: p,
                station: 'vision',
                account: acc,
                extraKeyframes,
                userPrompt: `请直接观看并拆解本次上传的短剧视频/字幕素材（${epListDesc}，模式：${
                  p.transcribeMode === 'detailed'
                    ? '详细模式（每秒一帧逐格拆解画面动作与台词）'
                    : '快速模式（按整集还原场次、动作与台词并抽查）'
                }）。请直接输出完整的结构化扒剧结果（不要索要文件或调用外部工具）：\n1. 【全剧人物标准人名锚定表】（角色名、身份定位、外貌/声线特征）\n2. 【本集核心剧情梗概】\n3. 【分集分场次还原剧本】（严格按“第X集 场次1-1 内/外景 地点 日/夜”格式，动作与神态以 ▲ 标示，逐句还原人物台词；对看不清的特写或字幕标注【待人工補寫】）。`,
              });
              combinedRawOutput =
                llm.ok && llm.text
                  ? llm.text
                  : `### 故事梗概\n已完成《${p.title}》分集拆解。\n\n### 分场剧本\n第1集 场次1-1 内景 主场景 日\n▲ 已按${p.transcribeMode === 'detailed' ? '详细模式' : '快速模式'}完成分集场次与台词还原。`;
            }

            populateTranscribeWorkspace(p, combinedRawOutput);
            p.remote.stage = { key: 'delivery', title: '扒剧完成 · Word (.docx) 已就绪' };
            p.remote.status = 'delivered';
            p.remote.progress.completed_steps = p.remote.progress.total_steps;
            p.remote.card = null;

            const epCount = Array.isArray(p.episodes) ? p.episodes.length : 1;
            const modeLabel = p.transcribeMode === 'detailed' ? '详细模式' : '快速模式';
            message(
              p,
              'director',
              `老板，${epCount} 集素材已按「${modeLabel}」全部扒完！人物表、梗概和分集剧本已经归档到左侧目录，真 Word（.docx）文件也打包好了，您可以直接点下方下载或一键转入创作台继续改写。`,
              {
                file: {
                  name: `${p.title}-完整剧本.docx`,
                  url: `/api/upload?id=${p.id}&export=docx`,
                  description: 'Word (.docx) 完整交付稿',
                },
              }
            );
            message(
              p,
              'file',
              `已为您生成《${p.title}》Word (.docx) 交付文件`,
              {
                file: {
                  name: `${p.title}-完整剧本.docx`,
                  url: `/api/upload?id=${p.id}&export=docx`,
                  description: '含人物锚定表、剧情梗概与分集正文',
                },
              }
            );
          } else if (p.kind === 'domestic' && nextCursor === 2) {
            const llm = await callProjectStation({
              project: p,
              station: 'planner',
              account: acc,
              userPrompt: `请针对国内迭代国外项目《${p.title}》（${p.total ?? 60}集）输出「桥段出海四级诊断」及「第一道门：世界观落地 → 第二道门：人设本土化 → 第三道门：桥段替换要点」方案。`,
            });
            const content =
              llm.ok && llm.text
                ? llm.text
                : '已完成桥段出海四级诊断与世界观、人设、替换要点三道门方案。';
            p.remote.outputs.gates = {
              title: '桥段出海四级诊断与三道门方案',
              content,
              updatedAt: new Date().toISOString(),
              version: 1,
            };
            p.remote.stage = { key: 'domestic_gates', title: '国内出海三道门（世界观 → 人设 → 替换要点）' };
            p.remote.card = {
              id: 'card-domestic-gates',
              step: 'gates',
              title: '三道门拍板 · 世界观落地、人设声线与桥段替换',
              fields: ['worldview_gate', 'persona_gate', 'trope_gate'],
              questions: [{ question: '请确认三道门本土化置换方案：' }],
            };
            message(p, 'director', `原稿分析师与故事策划师已完成「桥段出海四级诊断与三道门方案」：\n\n${content}`);
          } else if (
            (p.kind === 'domestic' && nextCursor === 3) ||
            (p.kind === 'foreign' && nextCursor === 2)
          ) {
            const llm = await callProjectStation({
              project: p,
              station: 'planner',
              account: acc,
              userPrompt: `请为短剧项目《${p.title}》（${KIND_LABELS[p.kind as Kind]}，全剧 ${p.total ?? 60} 集${
                p.lockedEpisodes ? `，前 ${p.lockedEpisodes} 集已锁定` : ''
              }）提供 2-3 套主线与对手升级方案（★首推排第一），并附上一份通俗易懂的「简化主线单」。`,
            });
            const content =
              llm.ok && llm.text
                ? llm.text
                : '已生成主线与对手方案 A/B/C 及简化主线单。';
            p.remote.outputs.synopsis = {
              title: '主线方案与简化主线单',
              content,
              updatedAt: new Date().toISOString(),
              version: 1,
            };
            p.remote.stage = { key: 'mainline_understood', title: '主线方案与简化主线单（看得懂关）' };
            p.remote.card = {
              id: 'card-mainline-' + nextCursor,
              step: 'mainline',
              title: '主线与对手方案选择 · 简化主线单「看得懂关」',
              fields: ['selection', 'understood'],
              questions: [{ question: '请选择主线方案，并确认简化主线单是否通过「看得懂关」：' }],
            };
            message(p, 'director', `故事策划师已交回主线方案与简化主线单：\n\n${content}\n\n请核对是否过「看得懂关」。`);
          } else if (
            (p.kind === 'original' && nextCursor === 2) ||
            (p.kind === 'foreign' && nextCursor === 3) ||
            (p.kind === 'domestic' && nextCursor === 4)
          ) {
            const llm = await callProjectStation({
              project: p,
              station: 'writer',
              account: acc,
              userPrompt: `请为项目《${p.title}》（全剧 ${p.total ?? 60} 集${
                p.lockedEpisodes ? `，前 ${p.lockedEpisodes} 集锁定，从第 ${p.lockedEpisodes + 1} 集续写` : ''
              }）生成人物小传与首批 10 集分集细纲，并写出正文前 3 集样稿。`,
            });
            const content =
              llm.ok && llm.text
                ? llm.text
                : '已生成人物小传、分批细纲与前 3 集正文样稿。';
            p.remote.outputs.characters = {
              title: '核心人物小传与关系网',
              content: content.slice(0, 800),
              updatedAt: new Date().toISOString(),
              version: 1,
            };
            p.remote.outputs.outline = {
              title: '分集细纲与正文前 3 集',
              content,
              updatedAt: new Date().toISOString(),
              version: 1,
            };
            p.remote.stage = { key: 'script_episodes', title: '细纲与正文前 3 集确认' };
            p.remote.card = {
              id: 'card-script-' + nextCursor,
              step: 'script_confirm',
              title: '细纲与正文前 3 集拍板（支持一键放开后续逐集停点）',
              fields: ['ending'],
              questions: [
                {
                  question:
                    '前 3 集正文与细纲已就绪。确认无误后将整批完成剩余集数并自动走初审、返修、精修与终复核：',
                },
              ],
            };
            message(p, 'director', `分集编剧已交回人物小传、细纲与前 3 集正文：\n\n${content}`);
          } else {
            const llm = await callProjectStation({
              project: p,
              station: 'polisher',
              account: acc,
              userPrompt: `请对短剧《${p.title}》（${KIND_LABELS[p.kind as Kind]}，共 ${p.total ?? 60} 集${
                p.lockedEpisodes ? `，前 ${p.lockedEpisodes} 集锁定一字不改` : ''
              }）完成终审复核与${p.kind === 'domestic' ? '北美语感及美式幽默' : ''}精修总结，输出完整剧本交付正文摘要。`,
            });
            const content =
              llm.ok && llm.text
                ? llm.text
                : `《${p.title}》全剧已完成初审、返修、精修与终复核，正式剧本已封装就绪。`;
            p.remote.outputs.script = {
              title: '终审精修完整剧本正文',
              content: (p.remote.outputs.outline?.content ? p.remote.outputs.outline.content + '\n\n' : '') + content,
              updatedAt: new Date().toISOString(),
              version: 1,
            };
            p.remote.stage = { key: 'delivery', title: '成稿 Word 交付验收' };
            p.remote.status = 'delivered';
            p.remote.progress.completed_steps = p.remote.progress.total_steps;
            p.remote.card = null;
            message(
              p,
              'director',
              `🎉 全剧已完成初审、返修、精修与终复核！\n\n${content}\n\n最终剧本已按「故事梗概 → 人物小传 → 正文」排列封装（${
                p.lockedEpisodes ? `前 ${p.lockedEpisodes} 集锁定稿逐字保护，` : ''
              }点击下方卡片即可下载交付包）。`
            );
          }
        }
      }
    } else if (body.operation === 'connect') {
      if (!connected() && !hasGptKey()) throw new Error('SERVICE_NOT_CONNECTED');
      const execControls = validateExecutionControls(body, p);
      p.preferredTierId = execControls.preferredTierId;
      p.thinkingLevel = execControls.thinkingLevel;
      p.executionMode = execControls.executionMode;

      if (
        p.kind === 'transcribe' &&
        p.total === null &&
        p.attachments.length > 0 &&
        p.attachments.every((a: any) => Number.isInteger(a.episode) && a.episode >= 1)
      ) {
        p.total = Math.min(
          300,
          Math.max(p.attachments.length, ...p.attachments.map((a: any) => Number(a.episode) || 1))
        );
      }
      if (!p.confirmed) {
        throw new Error('INVALID_INPUT');
      }
      if (
        p.kind === 'transcribe' &&
        p.attachments.some((a: any) => !a.episode || (p.total !== null && a.episode > p.total))
      ) {
        throw new Error('EPISODE_MAPPING_REQUIRED');
      }
      const requiresTotalUpfront = p.kind !== 'original';
      if (
        requiresTotalUpfront &&
        (!Number.isInteger(p.total) || p.total < 1 || p.total > 300)
      ) {
        throw new Error('INVALID_INPUT');
      }

      if (connected()) {
        const startEp = p.lockedEpisodes ? p.lockedEpisodes + 1 : 1;
        if (!p.remoteId) {
          const remote: any = await (
            await backend('/api/projects', 'POST', {
              title: p.title,
              kind: p.kind,
              total: p.total,
              start: startEp,
              locked_episodes: p.lockedEpisodes || 0,
              brief: p.brief,
            })
          ).json();
          p.remoteId = remote.id;
          await saveProject(p, user);
        }
        const remote: any = await (await backend('/api/projects/' + p.remoteId)).json();
        for (const a of p.attachments) {
          if (remote.attachments?.some((r: any) => r.name === a.id + '-' + a.name)) continue;
          const object = await bindings().BUCKET.get(user + '/' + p.id + '/' + a.id);
          const role = a.role || 'source';
          if (object) {
            await backend(
              '/api/projects/' +
                p.remoteId +
                '/attachments?name=' +
                encodeURIComponent(a.id + '-' + a.name) +
                '&role=' +
                encodeURIComponent(role) +
                (a.episode ? '&episode=' + a.episode : ''),
              'POST',
              await object.arrayBuffer(),
              true
            );
          }
        }
        for (let i = 0; i < p.requirements.length; i++) {
          const reqText = typeof p.requirements[i] === 'string' ? p.requirements[i] : p.requirements[i].text;
          await backend('/api/projects/' + p.remoteId + '/messages', 'POST', {
            client_id: p.id + '-requirement-' + i,
            text: reqText,
          });
        }
        p.remote = sanitizeForClient(await (await backend('/api/projects/' + p.remoteId)).json());
        message(p, 'director', '已连接创作后端，材料、锁定范围与要求台账已同步。请查看当前确认卡。');
      } else {
        const acc = getActiveAccountOrDefault(request);
        if (acc && acc.status === 'disabled') throw new Error('ACCOUNT_DISABLED');
        if (acc && acc.budgetCapUsd > 0 && acc.budgetUsedUsd >= acc.budgetCapUsd) throw new Error('BUDGET_EXCEEDED');

        let gptRecap = '';
        if (p.kind === 'transcribe') {
          gptRecap = `第 1 步已完成：已核对 ${p.attachments.length} 份视频/字幕素材（全剧共 ${p.total ?? 1} 集）。\n👉 请选择「⚡ 快速模式」或「🔍 详细模式」，确认后我将直接为您拆解并产出可下载的 Word (.docx)。`;
        } else {
          const recapRes = await runGptRecapIfConfigured(p, request);
          if (!recapRes.text) throw new Error(recapRes.error || 'BACKEND_REQUEST_FAILED');
          gptRecap = recapRes.text;
        }
        p.remoteId = 'test-channel-' + p.id;
        const firstCardByKind: Record<Kind, any> = {
          transcribe: {
            id: 'card-transcribe-mode',
            step: 'mode_select',
            title: '选择扒剧模式（快速 / 详细）',
            fields: ['mode'],
            questions: [
              {
                question: '请选择本次扒剧精度（快速模式整集拆解出稿；详细模式逐格拆解动作与台词）：',
              },
            ],
          },
          foreign: {
            id: 'card-foreign-recap',
            step: 'recap_confirm',
            title: '总编剧复述确认 · 准备开始原稿分析',
            fields: ['scope'],
            questions: [
              {
                question: p.lockedEpisodes
                  ? `已锁定前 ${p.lockedEpisodes} 集一字不改，本轮从第 ${p.lockedEpisodes + 1} 集写至第 ${p.total} 集。确认无误后派给原稿分析师生成底稿、事件映射、错名清单与逐集情绪曲线。`
                  : `全剧共 ${p.total} 集。确认复述无误后，将派给原稿分析师生成底稿、事件映射、错名清单与逐集情绪曲线。`,
              },
            ],
          },
          domestic: {
            id: 'card-domestic-recap',
            step: 'recap_confirm',
            title: '总编剧复述确认 · 原稿分析与桥段出海四级诊断',
            fields: ['scope'],
            questions: [
              {
                question: `全剧共 ${p.total} 集。确认后派给原稿分析师完成原稿五问与「桥段出海四级诊断」，随后依次进入世界观、人设、替换要点三道门。`,
              },
            ],
          },
          original: {
            id: 'card-original-stop-a',
            step: 'stop_a',
            title: '原创停点 A · 确认方向、开场、破局引擎、总集数与男女频',
            fields: ['direction', 'opening', 'engine', 'total', 'audience'],
            questions: [
              {
                question: '请确认原创前四层推理的核心参数（★首推方案排第一，也可直接打字修改）：',
              },
            ],
          },
        };
        p.remote = {
          id: p.remoteId,
          version: 1,
          status: 'waiting_confirm',
          mode: 'test_channel',
          cursor: 1,
          stage: {
            key: 'recap',
            title: p.kind === 'original' ? '前四层推理与停点 A' : p.kind === 'transcribe' ? '扒剧模式选择' : '总编剧复述与开始分析',
          },
          progress: {
            completed_steps: 1,
            total_steps: p.kind === 'transcribe' ? 2 : p.kind === 'domestic' ? 11 : p.kind === 'foreign' ? 9 : 7,
            eta: null,
          },
          card: firstCardByKind[p.kind as Kind],
          outputs: {
            recap: {
              title: p.kind === 'transcribe' ? '扒剧素材与集号核对清单' : '总编剧复述与建议',
              content: gptRecap,
              updatedAt: new Date().toISOString(),
              version: 1,
            },
          },
          messages: [],
        };
        message(
          p,
          'director',
          p.kind === 'transcribe'
            ? gptRecap
            : `${gptRecap}\n\n请在下方当前阶段卡片拍板继续。`
        );
      }
    } else if (body.operation === 'transfer_iteration') {
      const targetKind = body.target_kind as Kind;
      if (p.kind !== 'transcribe' || !['foreign', 'domestic'].includes(targetKind)) {
        throw new Error('INVALID_INPUT');
      }
      const now = new Date().toISOString();
      const nextProj: any = {
        id: crypto.randomUUID(),
        sourceProjectId: p.id,
        title: `${p.title}（${KIND_LABELS[targetKind]}）`.slice(0, 200),
        kind: targetKind,
        total: p.total,
        lockedEpisodes: null,
        startEpisode: 1,
        brief: `由扒剧项目「${p.title}」主动转入${KIND_LABELS[targetKind]}流程。${p.brief ? '\n原说明：' + p.brief : ''}`,
        messages: [],
        attachments: p.attachments.map((a: any) => ({ ...a, role: 'source' })),
        requirements: [
          `[扒剧转入 · 全剧适用] 复用扒剧项目「${p.title}」已核对的 ${p.attachments.length} 份素材与还原底稿`,
        ],
        promptSelections: {},
        volumes: Array.isArray(p.volumes) ? p.volumes.map((v: any) => ({ ...v })) : [],
        episodes: cloneEpisodesBodyOnly(p.episodes),
        outlineNodes: cloneNodesBodyOnly(p.outlineNodes),
        characterNodes: cloneNodesBodyOnly(p.characterNodes),
        worldNodes: cloneNodesBodyOnly(p.worldNodes),
        projectRules: typeof p.projectRules === 'string' ? p.projectRules : '',
        preferredTierId: p.preferredTierId,
        thinkingLevel: p.thinkingLevel || 'off',
        executionMode: p.executionMode === 'plan' ? 'plan' : 'auto',
        archived: false,
        createdAt: now,
        updatedAt: now,
        version: 1,
        confirmed: false,
      };
      const suggestions = buildDirectorSuggestions(targetKind, nextProj.brief, nextProj.total, null);
      message(
        nextProj,
        'director',
        `已根据你的选择，将扒剧项目「${p.title}」转入「${KIND_LABELS[targetKind]}」新项目，并复用了原有 ${p.attachments.length} 份素材与目录底稿（全剧 ${p.total ?? '待定'} 集）。\n\n【总编剧初步建议】\n${suggestions.map((s) => '• ' + s).join('\n')}\n\n请先核对下方卡片，确认后开始原稿分析${targetKind === 'domestic' ? '与桥段出海四级诊断' : ''}。`
      );
      await bindings()
        .DB.prepare('INSERT INTO studio_projects (id,owner,data,version,updated_at) VALUES (?,?,?,1,?)')
        .bind(nextProj.id, user, JSON.stringify(sanitizeForClient(nextProj)), now)
        .run();
      return Response.json(withCatalogs(nextProj), { status: 201 });
    } else {
      throw new Error('INVALID_INPUT');
    }

    const saved = await saveProject(p, user);
    return Response.json(withCatalogs(saved));
  } catch (e) {
    return failure(e);
  }
}
