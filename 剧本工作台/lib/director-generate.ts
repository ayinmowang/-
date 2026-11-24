import { callStationLLM } from './server';

export type DirectorGenerateTask = 'outline' | 'characters' | 'world' | 'hook' | 'episode' | 'chat';
export type DirectorStage = 'thinking' | 'drafting' | 'writing' | 'written';

export interface AssetNodeLike {
  id: string;
  title: string;
  body: string;
  content?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface EpisodeLike {
  id: string;
  episodeNumber: number;
  title?: string;
  body: string;
  content?: string;
  locked?: boolean;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface StudioMessageLike {
  id?: string;
  role: string;
  text: string;
  stageKey?: string;
  createdAt?: string | number;
  [key: string]: unknown;
}

export interface StudioProjectLike {
  id: string;
  executionMode?: 'auto' | 'plan' | string;
  lockedEpisodes?: number;
  startEpisode?: number;
  currentEpisodeId?: string;
  outlineNodes?: AssetNodeLike[];
  characterNodes?: AssetNodeLike[];
  worldNodes?: AssetNodeLike[];
  episodes?: EpisodeLike[];
  messages?: StudioMessageLike[];
  processedClientIds?: string[];
  [key: string]: unknown;
}

export interface DirectorWriteTarget {
  task: DirectorGenerateTask;
  kind: 'outline' | 'characters' | 'world' | 'episode';
  nodeId?: string;
  episodeId?: string;
  episodeNumber?: number;
  title?: string;
}

export interface DirectorStagePayload {
  stage: DirectorStage;
  label: string;
  elapsedSec: number;
  wrote?: boolean;
  target?: DirectorWriteTarget;
}

export interface DirectorErrorPayload {
  code: string;
  message: string;
}

export const DIRECTOR_TASKS: readonly DirectorGenerateTask[] = [
  'outline',
  'characters',
  'world',
  'hook',
  'episode',
  'chat',
] as const;

export const DIRECTOR_STAGE_LABELS: Record<DirectorStage, string> = {
  thinking: '思考中',
  drafting: '起稿中',
  writing: '正在写入',
  written: '已写入完成',
};

const PLAN_DONE_LABEL = '已给出规划（未写入）';

const TASK_TITLES: Record<DirectorGenerateTask, string> = {
  outline: '核心剧情大纲',
  characters: '核心人物小传',
  world: '世界观与规则设定',
  hook: '本集结尾悬念挂卡',
  episode: '分集剧本正文',
  chat: '总编剧创作建议',
};

export function isValidDirectorTask(v: unknown): v is DirectorGenerateTask {
  return typeof v === 'string' && (DIRECTOR_TASKS as readonly string[]).includes(v);
}

export function hasProcessedClientId(
  p: Pick<StudioProjectLike, 'processedClientIds'> | null | undefined,
  clientId?: string,
): boolean {
  if (!clientId || typeof clientId !== 'string') return false;
  return Array.isArray(p?.processedClientIds) && p.processedClientIds.includes(clientId);
}

export function recordProcessedClientId(p: StudioProjectLike, clientId?: string): void {
  if (!clientId || typeof clientId !== 'string') return;
  const trimmed = clientId.trim();
  if (!trimmed) return;
  const existing = Array.isArray(p.processedClientIds) ? p.processedClientIds.filter((id) => id !== trimmed) : [];
  existing.push(trimmed);
  p.processedClientIds = existing.slice(-200);
}

export function projectIsPlanMode(p: Pick<StudioProjectLike, 'executionMode'> | null | undefined): boolean {
  return p?.executionMode === 'plan';
}

export function isEpisodeEffectivelyLocked(
  p: Pick<StudioProjectLike, 'lockedEpisodes'> | null | undefined,
  ep: Pick<EpisodeLike, 'locked' | 'episodeNumber'> | null | undefined,
): boolean {
  if (!ep) return false;
  if (ep.locked === true) return true;
  const n = typeof p?.lockedEpisodes === 'number' && Number.isFinite(p.lockedEpisodes) ? p.lockedEpisodes : 0;
  return n > 0 && typeof ep.episodeNumber === 'number' && ep.episodeNumber <= n;
}

export interface AssetSnapshot {
  outlineNodes: AssetNodeLike[];
  characterNodes: AssetNodeLike[];
  worldNodes: AssetNodeLike[];
  episodes: EpisodeLike[];
}

function deepClone<T>(val: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(val);
  }
  return JSON.parse(JSON.stringify(val));
}

export function snapshotAssetState(p: StudioProjectLike): AssetSnapshot {
  return {
    outlineNodes: deepClone(Array.isArray(p.outlineNodes) ? p.outlineNodes : []),
    characterNodes: deepClone(Array.isArray(p.characterNodes) ? p.characterNodes : []),
    worldNodes: deepClone(Array.isArray(p.worldNodes) ? p.worldNodes : []),
    episodes: deepClone(Array.isArray(p.episodes) ? p.episodes : []),
  };
}

export function restoreAssetState(p: StudioProjectLike, snap: AssetSnapshot): void {
  p.outlineNodes = deepClone(snap.outlineNodes);
  p.characterNodes = deepClone(snap.characterNodes);
  p.worldNodes = deepClone(snap.worldNodes);
  p.episodes = deepClone(snap.episodes);
}

export function assetStateFingerprint(p: StudioProjectLike): string {
  return JSON.stringify(snapshotAssetState(p));
}

export function redactDirectorError(err: unknown): DirectorErrorPayload {
  const rawCode =
    typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : '';
  const rawMsg =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : typeof err === 'string'
          ? err
          : '';

  if (rawCode === 'PLAN_MODE_READ_ONLY') {
    return { code: 'PLAN_MODE_READ_ONLY', message: '当前处于计划模式，资产为只读状态' };
  }
  if (rawCode === 'EPISODE_LOCKED') {
    return { code: 'EPISODE_LOCKED', message: '目标集已锁定，无法修改或解锁' };
  }
  if (rawCode === 'PROJECT_BUSY') {
    return { code: 'PROJECT_BUSY', message: '当前项目正在生成中，请稍候再试' };
  }
  if (rawCode === 'INVALID_INPUT') {
    return { code: 'INVALID_INPUT', message: '请求参数不合法' };
  }
  if (rawCode === 'GENERATION_CANCELLED' || /abort|cancel/i.test(rawMsg)) {
    return { code: 'GENERATION_CANCELLED', message: '本次生成已取消，未写入任何资产' };
  }
  return { code: 'GENERATION_FAILED', message: '生成失败，未写入任何资产，请重试' };
}

interface ActiveProjectRun {
  runId: string;
  startedAt: number;
  controller: AbortController;
}

const activeRuns = new Map<string, ActiveProjectRun>();

export function getProjectRun(projectId: string): ActiveProjectRun | undefined {
  return activeRuns.get(projectId);
}

export function isProjectBusy(projectId: string): boolean {
  return activeRuns.has(projectId);
}

export function acquireProjectRun(
  projectId: string,
  runId: string,
  externalSignal?: AbortSignal,
): { ok: true; controller: AbortController; startedAt: number } | { ok: false; busy: true } {
  const existing = activeRuns.get(projectId);
  if (existing && existing.runId !== runId) {
    return { ok: false, busy: true };
  }
  if (existing && existing.runId === runId) {
    return { ok: true, controller: existing.controller, startedAt: existing.startedAt };
  }
  const controller = new AbortController();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  const startedAt = Date.now();
  activeRuns.set(projectId, { runId, startedAt, controller });
  return { ok: true, controller, startedAt };
}

export function releaseProjectRun(projectId: string, runId?: string): void {
  const existing = activeRuns.get(projectId);
  if (!existing) return;
  if (!runId || existing.runId === runId) {
    activeRuns.delete(projectId);
  }
}

export function cancelProjectRun(projectId: string, runId?: string): boolean {
  const existing = activeRuns.get(projectId);
  if (!existing) return false;
  if (runId && existing.runId !== runId) return false;
  existing.controller.abort();
  return true;
}


function asDirectorError(res: unknown): DirectorErrorPayload {
  if (res && typeof res === 'object' && 'error' in res) {
    const err = (res as { error?: DirectorErrorPayload }).error;
    if (err && typeof err === 'object' && typeof err.code === 'string') {
      return err;
    }
  }
  return { code: 'GENERATION_FAILED', message: '生成失败，未写入任何资产，请重试' };
}

export function parseFixtureText(task: DirectorGenerateTask): { title: string; body: string } {
  switch (task) {
    case 'outline':
      return {
        title: '三幕主线大纲（夹具）',
        body: '第一幕：主角在雨夜发现旧档案异常，触发调查。\n第二幕：多方线索交汇，关键证人突然失联。\n第三幕：真相浮出水面，主角做出不可逆抉择。',
      };
    case 'characters':
      return {
        title: '核心角色设定（夹具）',
        body: '【林砚】冷静克制的调查记者，执着于还原被掩盖的旧案真相。\n【周沉】表面圆滑的档案管理员，掌握关键索引却各有盘算。',
      };
    case 'world':
      return {
        title: '世界观与规则（夹具）',
        body: '故事发生于近未来沿海雾城，所有记忆影像均需经由中央档案馆核验方可作为合法证据。',
      };
    case 'hook':
      return {
        title: '高能结尾挂卡（夹具）',
        body: '【挂卡】门锁轻响，屏幕亮起一行陌生回信：你找的那份底片，此刻就在你身后。',
      };
    case 'episode':
      return {
        title: '分集剧本正文（夹具）',
        body: '第一场 档案馆走廊 夜 内\n雨点敲打高窗。林砚推开沉重铁门，手电光束扫过编号柜，停在缺失的第七格上。',
      };
    case 'chat':
    default:
      return {
        title: '总编剧建议（夹具）',
        body: '建议先锁定前三集核心冲突与人物动机，再逐集推进悬念挂卡，保持单集节奏紧凑。',
      };
  }
}

export function parseModelText(
  task: DirectorGenerateTask,
  rawText: string,
): { ok: true; title: string; body: string } | { ok: false; error: DirectorErrorPayload } {
  const cleaned = typeof rawText === 'string' ? rawText.replace(/\r\n/g, '\n').trim() : '';
  if (!cleaned) {
    return { ok: false, error: { code: 'GENERATION_FAILED', message: '生成内容为空，未写入任何资产' } };
  }
  const lines = cleaned.split('\n');
  let title = TASK_TITLES[task];
  let body = cleaned;
  const first = lines[0]?.trim() || '';
  if (first.startsWith('#')) {
    const extracted = first.replace(/^#+\s*/, '').trim();
    const rest = lines.slice(1).join('\n').trim();
    if (extracted && rest) {
      title = extracted.slice(0, 60);
      body = rest;
    }
  }
  if (!body.trim()) {
    return { ok: false, error: { code: 'GENERATION_FAILED', message: '生成正文为空，未写入任何资产' } };
  }
  return { ok: true, title, body };
}

function makeNodeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function resolveUnlockedEpisode(
  p: StudioProjectLike,
  opts: { episodeId?: string; episodeNumber?: number },
): { ok: true; episode: EpisodeLike; created: boolean } | { ok: false; error: DirectorErrorPayload } {
  if (!Array.isArray(p.episodes)) {
    p.episodes = [];
  }
  const lockedN = typeof p.lockedEpisodes === 'number' && Number.isFinite(p.lockedEpisodes) ? Math.max(0, p.lockedEpisodes) : 0;

  if (opts.episodeId) {
    const found = p.episodes.find((e) => e.id === opts.episodeId);
    if (found) {
      if (isEpisodeEffectivelyLocked(p, found)) {
        return { ok: false, error: { code: 'EPISODE_LOCKED', message: '目标集已锁定，无法写入' } };
      }
      return { ok: true, episode: found, created: false };
    }
  }

  if (typeof opts.episodeNumber === 'number' && Number.isFinite(opts.episodeNumber)) {
    const targetNum = Math.floor(opts.episodeNumber);
    if (targetNum <= lockedN) {
      return { ok: false, error: { code: 'EPISODE_LOCKED', message: `前 ${lockedN} 集已锁定，无法写入第 ${targetNum} 集` } };
    }
    const found = p.episodes.find((e) => e.episodeNumber === targetNum);
    if (found) {
      if (isEpisodeEffectivelyLocked(p, found)) {
        return { ok: false, error: { code: 'EPISODE_LOCKED', message: '目标集已锁定，无法写入' } };
      }
      return { ok: true, episode: found, created: false };
    }
    const createdEp: EpisodeLike = {
      id: makeNodeId('ep'),
      episodeNumber: targetNum,
      title: `第 ${targetNum} 集`,
      body: '',
      content: '',
      locked: false,
      updatedAt: new Date().toISOString(),
    };
    p.episodes.push(createdEp);
    p.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
    return { ok: true, episode: createdEp, created: true };
  }

  if (p.currentEpisodeId) {
    const cur = p.episodes.find((e) => e.id === p.currentEpisodeId);
    if (cur && !isEpisodeEffectivelyLocked(p, cur)) {
      return { ok: true, episode: cur, created: false };
    }
  }

  const unlockedExisting = [...p.episodes]
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .find((e) => !isEpisodeEffectivelyLocked(p, e));
  if (unlockedExisting) {
    return { ok: true, episode: unlockedExisting, created: false };
  }

  const startEp = typeof p.startEpisode === 'number' && Number.isFinite(p.startEpisode) ? Math.floor(p.startEpisode) : 1;
  const maxExisting = p.episodes.reduce((m, e) => Math.max(m, typeof e.episodeNumber === 'number' ? e.episodeNumber : 0), 0);
  const nextNum = Math.max(lockedN + 1, startEp, maxExisting + 1, 1);
  if (nextNum <= lockedN) {
    return { ok: false, error: { code: 'EPISODE_LOCKED', message: '没有可写入的未锁定集' } };
  }

  const newEp: EpisodeLike = {
    id: makeNodeId('ep'),
    episodeNumber: nextNum,
    title: `第 ${nextNum} 集`,
    body: '',
    content: '',
    locked: false,
    updatedAt: new Date().toISOString(),
  };
  p.episodes.push(newEp);
  p.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
  return { ok: true, episode: newEp, created: true };
}

export function applyDirectorAssetWrite(
  p: StudioProjectLike,
  params: {
    task: DirectorGenerateTask;
    title: string;
    body: string;
    nodeId?: string;
    episodeId?: string;
    episodeNumber?: number;
  },
):
  | { ok: true; wrote: boolean; target?: DirectorWriteTarget }
  | { ok: false; error: DirectorErrorPayload } {
  if (projectIsPlanMode(p)) {
    return { ok: false, error: { code: 'PLAN_MODE_READ_ONLY', message: '计划模式下资产严格只读' } };
  }

  const { task, title, body, nodeId } = params;
  if (task === 'chat') {
    return { ok: true, wrote: false };
  }

  const nowIso = new Date().toISOString();

  if (task === 'outline' || task === 'characters' || task === 'world') {
    const key = task === 'outline' ? 'outlineNodes' : task === 'characters' ? 'characterNodes' : 'worldNodes';
    if (!Array.isArray(p[key])) {
      p[key] = [];
    }
    const list = p[key] as AssetNodeLike[];
    const trimmedBody = body.trim();
    if (nodeId) {
      const targetNode = list.find((n) => n.id === nodeId);
      if (targetNode) {
        if ((targetNode.body || '').trim() === trimmedBody) {
          return {
            ok: true,
            wrote: false,
            target: { task, kind: task, nodeId: targetNode.id, title: targetNode.title },
          };
        }
        targetNode.body = trimmedBody;
        targetNode.content = trimmedBody;
        targetNode.updatedAt = nowIso;
        return {
          ok: true,
          wrote: true,
          target: { task, kind: task, nodeId: targetNode.id, title: targetNode.title },
        };
      }
    }
    const existingSame = list.find((n) => (n.body || '').trim() === trimmedBody);
    if (existingSame) {
      return {
        ok: true,
        wrote: false,
        target: { task, kind: task, nodeId: existingSame.id, title: existingSame.title },
      };
    }
    const node: AssetNodeLike = {
      id: makeNodeId(task === 'outline' ? 'out' : task === 'characters' ? 'char' : 'wld'),
      title: title || TASK_TITLES[task],
      body: trimmedBody,
      content: trimmedBody,
      updatedAt: nowIso,
    };
    list.push(node);
    return {
      ok: true,
      wrote: true,
      target: { task, kind: task, nodeId: node.id, title: node.title },
    };
  }

  const resolved = resolveUnlockedEpisode(p, {
    episodeId: params.episodeId,
    episodeNumber: params.episodeNumber,
  });
  if (!resolved.ok) {
    const err =
      'error' in resolved && resolved.error
        ? resolved.error
        : { code: 'GENERATION_FAILED', message: '目标集不可写入' };
    return { ok: false, error: err };
  }
  const ep = resolved.episode;
  if (isEpisodeEffectivelyLocked(p, ep)) {
    return { ok: false, error: { code: 'EPISODE_LOCKED', message: '目标集已锁定，禁止写入' } };
  }

  const currentBody = typeof ep.body === 'string' ? ep.body : typeof ep.content === 'string' ? ep.content : '';
  const trimmedIncoming = body.trim();
  const savePreEditSnapshot = (note: string) => {
    if (!currentBody.trim()) return;
    const prevSnaps = Array.isArray((ep as any).snapshots) ? (ep as any).snapshots : [];
    (ep as any).snapshots = [
      {
        id: makeNodeId('snap'),
        at: nowIso,
        body: currentBody,
        wordCount: currentBody.length,
        note,
      },
      ...prevSnaps,
    ].slice(0, 20);
  };

  if (task === 'hook') {
    if (currentBody.trim().endsWith(trimmedIncoming)) {
      return {
        ok: true,
        wrote: false,
        target: { task, kind: 'episode', episodeId: ep.id, episodeNumber: ep.episodeNumber, title: ep.title },
      };
    }
    savePreEditSnapshot('AI 挂卡续写前快照');
    const nextBody = currentBody.trim() ? `${currentBody.replace(/\s+$/, '')}\n\n${trimmedIncoming}` : trimmedIncoming;
    ep.body = nextBody;
    ep.content = nextBody;
    ep.updatedAt = nowIso;
    return {
      ok: true,
      wrote: true,
      target: { task, kind: 'episode', episodeId: ep.id, episodeNumber: ep.episodeNumber, title: ep.title },
    };
  }

  // episode 整集覆盖写入（仅限未锁定集）
  if (currentBody.trim() === trimmedIncoming && !resolved.created) {
    return {
      ok: true,
      wrote: false,
      target: { task, kind: 'episode', episodeId: ep.id, episodeNumber: ep.episodeNumber, title: ep.title },
    };
  }
  savePreEditSnapshot('AI 改写前快照');
  ep.body = trimmedIncoming;
  ep.content = trimmedIncoming;
  ep.updatedAt = nowIso;
  if (!ep.title && title) {
    ep.title = title;
  }
  return {
    ok: true,
    wrote: true,
    target: { task, kind: 'episode', episodeId: ep.id, episodeNumber: ep.episodeNumber, title: ep.title },
  };
}

function buildSafeStationUserPrompt(
  p: StudioProjectLike,
  task: DirectorGenerateTask,
  userInput: string,
  opts?: { episodeId?: string; episodeNumber?: number; nodeId?: string },
): string {
  const lockedN = typeof p.lockedEpisodes === 'number' ? p.lockedEpisodes : 0;
  const modeNote = projectIsPlanMode(p) ? '当前为计划模式，仅输出创作规划与建议。' : '当前为自动执行模式，请直接输出完整可用的创作内容。';
  const taskGoal: Record<DirectorGenerateTask, string> = {
    outline: '请生成完整剧情大纲，首行可使用 # 标题，正文分幕清晰，贴合短剧强冲突与付费卡点节奏。',
    characters: '请生成核心角色小传，首行可使用 # 标题，正文包含身份定位、性格反差、动机与人物关系网。',
    world: '请生成世界观与核心规则设定，首行可使用 # 标题，明确舞台阶层、核心冲突机制与本土化细节。',
    hook: '请生成本集结尾悬念挂卡段落，节奏紧凑、与前文自然衔接并留有强反转钩子。',
    episode: '请撰写完整的单集短剧剧本正文（标准场头、△动作描写与人物对白），黄金前3秒切入冲突，结尾留强悬念。',
    chat: '请结合当前项目设定、大纲与已写集数给出具体可落地的总编剧创作建议。',
  };

  const kindMap: Record<string, string> = {
    foreign: '国外迭代（短剧爆款改编）',
    domestic: '国内迭代（本土出海底盘改造）',
    original: '原创短剧',
    transcribe: '拆书 · 扒剧',
  };
  const titleStr = typeof p.title === 'string' && p.title.trim() ? p.title.trim() : '';
  const kindStr = typeof p.kind === 'string' ? (kindMap[p.kind] || p.kind) : '';
  const totalNum = typeof p.total === 'number' && Number.isFinite(p.total) ? p.total : null;
  const projBrief = typeof p.brief === 'string' && p.brief.trim() ? p.brief.trim().slice(0, 1000) : '';
  const projRules = typeof p.projectRules === 'string' && p.projectRules.trim() ? p.projectRules.trim().slice(0, 800) : '';

  const summarizeNodes = (nodes: AssetNodeLike[] | undefined, cap: number): string => {
    if (!Array.isArray(nodes) || nodes.length === 0) return '';
    return nodes
      .slice(0, 5)
      .map((n) => `【${String(n.title || '设定').trim()}】${String(n.body || n.content || '').trim()}`)
      .filter((s) => s.length > 4)
      .join('\n')
      .slice(0, cap);
  };

  const outlineDigest = summarizeNodes(p.outlineNodes, 1200);
  const charDigest = summarizeNodes(p.characterNodes, 1000);
  const worldDigest = summarizeNodes(p.worldNodes, 800);

  let episodeContext = '';
  if ((task === 'episode' || task === 'hook' || task === 'chat') && Array.isArray(p.episodes) && p.episodes.length > 0) {
    const sorted = [...p.episodes].sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0));
    const targetEp =
      (opts?.episodeId ? sorted.find((e) => e.id === opts.episodeId) : undefined) ||
      (typeof opts?.episodeNumber === 'number' ? sorted.find((e) => e.episodeNumber === opts.episodeNumber) : undefined) ||
      (p.currentEpisodeId ? sorted.find((e) => e.id === p.currentEpisodeId) : undefined);
    const targetNum = opts?.episodeNumber ?? targetEp?.episodeNumber ?? null;
    const prevEp =
      targetNum !== null
        ? sorted.filter((e) => e.episodeNumber < targetNum && (e.body || e.content)).slice(-1)[0]
        : sorted.filter((e) => e.body || e.content).slice(-1)[0];

    const parts: string[] = [];
    if (targetNum !== null) parts.push(`目标集号：第 ${targetNum} 集`);
    if (prevEp) {
      const prevBody = String(prevEp.body || prevEp.content || '').trim();
      if (prevBody) {
        parts.push(`【上一集（第 ${prevEp.episodeNumber} 集）衔接摘要】\n${prevBody.slice(-900)}`);
      }
    }
    if (task === 'hook' && targetEp) {
      const curBody = String(targetEp.body || targetEp.content || '').trim();
      if (curBody) {
        parts.push(`【当前集已有正文末尾】\n${curBody.slice(-900)}`);
      }
    } else if ((task === 'episode' || task === 'chat') && targetEp) {
      const curBody = String(targetEp.body || targetEp.content || '').trim();
      if (curBody) {
        parts.push(
          task === 'episode'
            ? `【当前第 ${targetEp.episodeNumber} 集已有正文（请按用户指令直接修改/改写，保留未要求删改的剧情线）】\n${curBody.slice(0, 2600)}`
            : `【当前正在查看的第 ${targetEp.episodeNumber} 集正文】\n${curBody.slice(0, 1600)}`
        );
      }
    }
    episodeContext = parts.join('\n');
  }

  let targetAssetContext = '';
  if (opts?.nodeId && (task === 'outline' || task === 'characters' || task === 'world' || task === 'chat')) {
    const allNodes = [
      ...(Array.isArray(p.outlineNodes) ? p.outlineNodes : []),
      ...(Array.isArray(p.characterNodes) ? p.characterNodes : []),
      ...(Array.isArray(p.worldNodes) ? p.worldNodes : []),
    ];
    const targetNode = allNodes.find((n) => n.id === opts.nodeId);
    if (targetNode) {
      const nodeBody = String(targetNode.body || targetNode.content || '').trim();
      if (nodeBody) {
        targetAssetContext = `【当前正在编辑的设定「${targetNode.title}」（请按用户指令在其基础上直接调整完善）】\n${nodeBody.slice(0, 2200)}`;
      }
    }
  }

  const brief = userInput.trim() ? userInput.trim().slice(0, 1200) : TASK_TITLES[task];
  return [
    `任务类型：${TASK_TITLES[task]}`,
    titleStr ? `项目名称：《${titleStr}》${kindStr ? `（${kindStr}）` : ''}${totalNum ? ` · 全剧 ${totalNum} 集` : ''}` : '',
    modeNote,
    lockedN > 0 ? `约束：前 ${lockedN} 集已锁定，剧情需与之衔接且不得改动已锁定内容。` : '',
    projBrief ? `【项目简介/改编要求】\n${projBrief}` : '',
    projRules ? `【本剧创作规则】\n${projRules}` : '',
    outlineDigest ? `【已有大纲】\n${outlineDigest}` : '',
    charDigest ? `【已有人物设定】\n${charDigest}` : '',
    worldDigest ? `【已有世界观设定】\n${worldDigest}` : '',
    targetAssetContext,
    episodeContext,
    taskGoal[task],
    `用户指令：${brief}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function appendProjectMessage(p: StudioProjectLike, text: string, stageKey?: string, role = 'director'): void {
  if (!Array.isArray(p.messages)) {
    p.messages = [];
  }
  p.messages.push({
    id: makeNodeId('msg'),
    role,
    text,
    ...(stageKey ? { stageKey } : {}),
    createdAt: Date.now(),
  });
}

export interface RunDirectorGenerateArgs {
  project: StudioProjectLike;
  task: DirectorGenerateTask;
  text?: string;
  clientId?: string;
  nodeId?: string;
  episodeId?: string;
  episodeNumber?: number;
  signal?: AbortSignal;
  onStage?: (payload: DirectorStagePayload) => void;
  account?: unknown;
  thinkingLevel?: string;
  tierId?: string;
  fixtureMode?: boolean;
  alreadyProcessed?: boolean;
  callLLM?: (args: {
    station: 'director';
    userPrompt: string;
    systemPromptOverride?: string;
    account?: unknown;
    projectId: string;
    project: StudioProjectLike;
    thinkingLevel?: string;
    tierId?: string;
    signal?: AbortSignal;
  }) => Promise<{ ok: boolean; text?: string; error?: unknown }>;
}

export interface RunDirectorGenerateResult {
  ok: boolean;
  project: StudioProjectLike;
  wrote: boolean;
  idempotent: boolean;
  target?: DirectorWriteTarget;
  error?: DirectorErrorPayload;
  stages: DirectorStagePayload[];
}

export async function runDirectorGenerate(args: RunDirectorGenerateArgs): Promise<RunDirectorGenerateResult> {
  const {
    project,
    task,
    text = '',
    nodeId,
    episodeId,
    episodeNumber,
    signal,
    onStage,
    account,
    thinkingLevel,
    tierId,
    fixtureMode = false,
    alreadyProcessed = false,
    callLLM = callStationLLM as unknown as NonNullable<RunDirectorGenerateArgs['callLLM']>,
  } = args;

  const startedAt = Date.now();
  const stages: DirectorStagePayload[] = [];
  const isPlan = projectIsPlanMode(project);

  const emitStage = (stage: DirectorStage, extra?: { label?: string; wrote?: boolean; target?: DirectorWriteTarget }) => {
    const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const payload: DirectorStagePayload = {
      stage,
      label: extra?.label ?? DIRECTOR_STAGE_LABELS[stage],
      elapsedSec,
      ...(typeof extra?.wrote === 'boolean' ? { wrote: extra.wrote } : {}),
      ...(extra?.target ? { target: extra.target } : {}),
    };
    stages.push(payload);
    onStage?.(payload);
  };

  if (alreadyProcessed) {
    emitStage('written', {
      label: isPlan ? PLAN_DONE_LABEL : DIRECTOR_STAGE_LABELS.written,
      wrote: false,
    });
    return {
      ok: true,
      project,
      wrote: false,
      idempotent: true,
      stages,
    };
  }

  const snap = snapshotAssetState(project);

  try {
    if (signal?.aborted) {
      restoreAssetState(project, snap);
      return {
        ok: false,
        project,
        wrote: false,
        idempotent: false,
        error: { code: 'GENERATION_CANCELLED', message: '本次生成已取消，未写入任何资产' },
        stages,
      };
    }

    emitStage('thinking');

    if (signal?.aborted) {
      restoreAssetState(project, snap);
      return {
        ok: false,
        project,
        wrote: false,
        idempotent: false,
        error: { code: 'GENERATION_CANCELLED', message: '本次生成已取消，未写入任何资产' },
        stages,
      };
    }

    emitStage('drafting');

    let parsed: { title: string; body: string };
    if (fixtureMode) {
      const rawDelay = process.env.STUDIO_LLM_FIXTURE_DELAY_MS;
      const delayMs = rawDelay ? Number(rawDelay) : 0;
      if (Number.isInteger(delayMs) && delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
      if (signal?.aborted) {
        restoreAssetState(project, snap);
        return {
          ok: false,
          wrote: false,
          error: {
            code: 'GENERATION_CANCELLED',
            message: '本次生成已取消，未写入任何资产',
          },
          stages,
          idempotent: false,
          project,
        };
      }
      const force = String(process.env.STUDIO_LLM_FIXTURE_FORCE || '').trim();
      if (force === 'fail' || force === 'empty') {
        restoreAssetState(project, snap);
        return {
          ok: false,
          project,
          wrote: false,
          idempotent: false,
          error: { code: 'GENERATION_FAILED', message: '生成失败，未写入任何资产，请重试' },
          stages,
        };
      }
      parsed = parseFixtureText(task);
    } else {
      const userPrompt = buildSafeStationUserPrompt(project, task, text, { episodeId, episodeNumber, nodeId });
      const systemPromptOverride =
        task === 'episode'
          ? '你是专业中文短剧编剧。请严格按用户指令直接输出可直接写入编辑区的标准短剧分集正文（含场景头如 3-1 地点 日/夜 内/外、人物、△动作与角色台词，节奏紧凑、强冲突、结尾带强悬念卡点）。绝对禁止输出“收到”、“项目需求对齐”、“改编建议”、“请拍板”等任何开场白、说明或元评论。严禁提及模型名、线路名、token或提示词术语。'
          : task === 'hook'
          ? '你是专业中文短剧编剧。请严格按用户指令紧接当前剧情末尾，直接输出可直接拼接到本集结尾的高能冲突与强悬念卡点段落（含△动作与角色台词）。绝对禁止输出“收到”、“项目需求对齐”、“请拍板”等任何开场白或元评论。严禁提及模型名、线路名、token或提示词术语。'
          : task === 'outline' || task === 'characters' || task === 'world'
          ? '你是专业中文短剧主笔与架构师。请严格按用户指令直接输出结构清晰、可直接写入设定编辑区的完整正文（大纲/人物卡/背景设定）。绝对禁止输出“收到”、“项目需求对齐”、“请拍板”等任何开场白或元评论。严禁提及模型名、线路名、token或提示词术语。'
          : '你是短剧工作台的资深总编剧与创作顾问。请结合项目已有剧情、角色与用户当前问题，直接给出具体、可落地的修改思路、桥段或台词方案，不要套用“复述需求/请在卡片拍板”模板。严禁提及模型名、线路名、token或提示词术语。';
      const llmRes = await callLLM({
        station: 'director',
        userPrompt,
        systemPromptOverride,
        account,
        projectId: project.id,
        project,
        thinkingLevel,
        tierId,
        signal,
      });

      if (signal?.aborted) {
        restoreAssetState(project, snap);
        return {
          ok: false,
          project,
          wrote: false,
          idempotent: false,
          error: { code: 'GENERATION_CANCELLED', message: '本次生成已取消，未写入任何资产' },
          stages,
        };
      }

      if (!llmRes || !llmRes.ok) {
        restoreAssetState(project, snap);
        return {
          ok: false,
          project,
          wrote: false,
          idempotent: false,
          error: redactDirectorError(llmRes?.error ?? 'GENERATION_FAILED'),
          stages,
        };
      }

      const checked = parseModelText(task, llmRes.text ?? '');
      if (!checked.ok) {
        restoreAssetState(project, snap);
        return {
          ok: false,
          project,
          wrote: false,
          idempotent: false,
          error: asDirectorError(checked),
          stages,
        };
      }
      parsed = checked;
    }

    if (signal?.aborted) {
      restoreAssetState(project, snap);
      return {
        ok: false,
        project,
        wrote: false,
        idempotent: false,
        error: { code: 'GENERATION_CANCELLED', message: '本次生成已取消，未写入任何资产' },
        stages,
      };
    }

    // 计划模式：严格只读资产，不发 writing/已写入完成，仅追加对话并回传 wrote=false
    if (isPlan || task === 'chat') {
      restoreAssetState(project, snap);
      if (text.trim()) {
        appendProjectMessage(project, text.trim(), undefined, 'user');
      }
      const replyPrefix = isPlan ? `【计划模式·${TASK_TITLES[task]}】\n` : '';
      appendProjectMessage(project, `${replyPrefix}${parsed.title}\n${parsed.body}`, 'written', 'director');
      emitStage('written', {
        label: isPlan ? PLAN_DONE_LABEL : '已回复完成',
        wrote: false,
      });
      return {
        ok: true,
        project,
        wrote: false,
        idempotent: false,
        stages,
      };
    }

    // 自动模式：仅在完整文本就绪后进入 writing 并一次性写回
    emitStage('writing');

    const writeRes = applyDirectorAssetWrite(project, {
      task,
      title: parsed.title,
      body: parsed.body,
      nodeId,
      episodeId,
      episodeNumber,
    });

    if (!writeRes.ok) {
      restoreAssetState(project, snap);
      return {
        ok: false,
        project,
        wrote: false,
        idempotent: false,
        error: asDirectorError(writeRes),
        stages,
      };
    }

    if (signal?.aborted) {
      restoreAssetState(project, snap);
      return {
        ok: false,
        project,
        wrote: false,
        idempotent: false,
        error: { code: 'GENERATION_CANCELLED', message: '本次生成已取消，未写入任何资产' },
        stages,
      };
    }

    if (text.trim()) {
      appendProjectMessage(project, text.trim(), undefined, 'user');
    }
    const targetDesc = writeRes.target?.title
      ? `「${writeRes.target.title}」`
      : `「${TASK_TITLES[task]}」`;
    appendProjectMessage(
      project,
      writeRes.wrote
        ? `已按你的指令更新${targetDesc}并同步到编辑区${
            task === 'episode' || task === 'hook' ? '（修改前版本已存入「历史版本」快照，可随时回滚）' : ''
          }。`
        : `${targetDesc}内容与原稿一致，未重复写入。`,
      'written',
      'director',
    );

    emitStage('written', {
      label: DIRECTOR_STAGE_LABELS.written,
      wrote: writeRes.wrote,
      target: writeRes.target,
    });

    return {
      ok: true,
      project,
      wrote: writeRes.wrote,
      idempotent: false,
      target: writeRes.target,
      stages,
    };
  } catch (err) {
    restoreAssetState(project, snap);
    return {
      ok: false,
      project,
      wrote: false,
      idempotent: false,
      error: redactDirectorError(err),
      stages,
    };
  }
}

export interface DirectorSseEmitter {
  stage: (payload: DirectorStagePayload) => void;
  error: (payload: DirectorErrorPayload) => void;
  done: (payload: {
    ok?: boolean;
    wrote: boolean;
    idempotent: boolean;
    target?: DirectorWriteTarget;
    project?: unknown;
    stages?: DirectorStagePayload[];
    label?: string;
    [key: string]: unknown;
  }) => void;
}

export function createDirectorSseResponse(args: {
  signal?: AbortSignal;
  execute: (emit: DirectorSseEmitter) => Promise<void>;
}): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const sendEvent = (event: string, data: unknown) => {
        if (closed) return;
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          closed = true;
        }
      };

      const onAbort = () => {
        if (!closed) {
          sendEvent('error', { code: 'GENERATION_CANCELLED', message: '本次生成已取消，未写入任何资产' });
          try {
            controller.close();
          } catch {
            // ignore
          }
          closed = true;
        }
      };

      args.signal?.addEventListener('abort', onAbort, { once: true });

      const emit: DirectorSseEmitter = {
        stage: (payload) => sendEvent('stage', payload),
        error: (payload) => sendEvent('error', redactDirectorError(payload)),
        done: (payload) => sendEvent('done', payload),
      };

      try {
        await args.execute(emit);
      } catch (err) {
        emit.error(redactDirectorError(err));
      } finally {
        args.signal?.removeEventListener('abort', onAbort);
        if (!closed) {
          try {
            controller.close();
          } catch {
            // ignore
          }
          closed = true;
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
