'use client';
import { useState, useEffect, useRef } from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  Plus,
  Search,
  PanelLeftOpen,
  SlidersHorizontal,
  Feather,
  Globe2,
  Compass,
  Clapperboard,
  Sparkles,
  Paperclip,
  ChevronDown,
  ChevronRight,
  Check,
  CheckCheck,
  FileText,
  Download,
  X,
  MoreHorizontal,
  BookOpen,
  Archive,
  RotateCcw,
  LoaderCircle,
  FolderOpen,
  Pause,
  Play,
  Settings2,
  Cloud,
  AlertCircle,
  NotebookPen,
  Lock,
  FastForward,
  Wand2,
} from 'lucide-react';
import {
  flows,
  type CreatorPromptCatalog,
  type CreatorPromptSummary,
  type Kind,
  type Project,
  type ProjectPromptSelections,
  type PromptSlotKey,
  type PromptSlotSelection,
  type PublicAccountProfile,
} from '../lib/types';

const icons: Record<Kind, any> = {
  foreign: Globe2,
  domestic: Compass,
  transcribe: Clapperboard,
  original: Sparkles,
};

const labels: Record<Kind, string> = {
  foreign: '国外迭代国外',
  domestic: '国内迭代国外',
  transcribe: '扒剧',
  original: '原创',
};

const EMPTY_PROMPT_CATALOG: CreatorPromptCatalog = {
  foreign: { primary: [], secondary: [] },
  domestic: { primary: [], secondary: [] },
  transcribe: { primary: [] },
  original: { primary: [], secondary: [] },
};

const fieldLabels: Record<string, string> = {
  direction: '故事方向',
  opening: '开场选择（A/B/C）',
  engine: '破局引擎',
  total: '总集数',
  audience: '受众频道（男女频）',
  alignment: '对位口径',
  peak: '情绪最高点',
  unresolved: '悬空点处理',
  numbers: '矛盾数字统一',
  scope: '本轮创作范围',
  background: '世界观与背景',
  ending: '规模与结局走向',
  boundaries: '补充要求与红线边界',
  selection: '主线与对手方案',
  understood: '简化主线单 · 看得懂关',
  mode: '扒剧还原模式（必选，无默认）',
  worldview_gate: '第一道门 · 世界观落地',
  persona_gate: '第二道门 · 人设与声线本土化',
  trope_gate: '第三道门 · 桥段替换要点',
};

const fieldPresets: Record<string, { label: string; value: string; recommended?: boolean }[]> = {
  direction: [
    { label: '★ 方案 A（首推：强反差高频打脸+情感拉扯）', value: '方案 A：强反差高频打脸+情感拉扯', recommended: true },
    { label: '方案 B（双强智性博弈+悬疑翻盘）', value: '方案 B：双强智性博弈+悬疑翻盘' },
    { label: '方案 C（契约闪婚+隐藏大佬护短）', value: '方案 C：契约闪婚+隐藏大佬护短' },
  ],
  opening: [
    { label: '★ 开场 B（首推：绝境冲突前置，前3秒抓人）', value: '开场 B：绝境危机冲突前置', recommended: true },
    { label: '开场 A（全景世界观反差切入）', value: '开场 A：全景世界观反差切入' },
    { label: '开场 C（双线并行交汇开场）', value: '开场 C：双线并行交汇开场' },
  ],
  audience: [
    { label: '★ 女频（救赎/逆袭/宿命拉扯）', value: '女频', recommended: true },
    { label: '男频（绝境反杀/底牌碾压）', value: '男频' },
  ],
  selection: [
    { label: '★ 方案 A（推荐主线）', value: '方案 A', recommended: true },
    { label: '方案 B', value: '方案 B' },
    { label: '方案 C', value: '方案 C' },
    { label: 'A 为主掺 B（混搭）', value: '方案 A 为主，融合方案 B 对手戏' },
  ],
  alignment: [
    { label: '★ 按原稿情绪峰值 1:1 对位（推荐）', value: '按原稿情绪峰值 1:1 对位', recommended: true },
    { label: '前移付费卡点至第 8–10 集', value: '前移付费卡点至第 8–10 集' },
  ],
  ending: [
    { label: '★ HE 圆满收束 + 反派彻底清算（推荐）', value: 'HE 圆满收束 + 反派彻底清算', recommended: true },
    { label: '开放式悬念钩子（留第二季）', value: '开放式悬念钩子' },
  ],
};

const timelineByKind: Record<Kind, string[]> = {
  foreign: ['资料收集与复述', '原稿分析与曲线', '四项配置与主线', '梗概与分批细纲', '正文与自动审改', 'Word 成稿交付'],
  domestic: ['资料收集与复述', '四级诊断与三道门', '四项配置与主线', '梗概与分批细纲', '正文与北美精修', 'Word 成稿交付'],
  transcribe: ['上传视频与核对集号', '选择快速/详细模式', '确认清单并开始扒剧', '分集还原与抽查', '生成繁简双版 Word', 'ZIP 交付或转迭代'],
  original: ['脑洞收集与复述', '前四层推理与停点 A', '设定集与每10集细纲', '正文前3集逐集确认', '整批写作与自动审改', 'Word 成稿交付'],
};

const errors: Record<string, string> = {
  AUTH_REQUIRED: '请先登录后使用工作台。',
  ACCOUNT_DISABLED: '当前账号已被停用，请联系管理员确认账号状态。',
  BUDGET_EXCEEDED: '当前账号可用创作额度已用尽，请联系管理员调整额度后重试。',
  SLOT_NOT_ALLOWED: '该创作流程不支持此提示词槽位（扒剧仅支持 1 个主槽位）。',
  CONFLICT: '项目刚刚有更新，已为你同步最新状态，请重试。',
  SERVICE_NOT_CONNECTED: '创作服务尚未连接，你的项目和材料已安全保存。',
  FILE_TOO_LARGE: '单个文件超过上传上限（默认 200 MB），请拆分或调整后上传。',
  INVALID_INPUT: '请检查输入内容（如集数范围 1–300，且锁定集数须小于总集数）。',
  EPISODE_ALREADY_USED: '这个集号已有其他素材使用，请核对后重填。',
  EPISODE_MAPPING_REQUIRED: '请先在卡片中补齐或纠正扒剧素材的集号。',
  MODE_SELECTION_REQUIRED: '扒剧模式无默认值，请先明确选择「快速模式」或「详细模式」。',
  UNDERSTOOD_GATE_REQUIRED: '简化主线单须先确认通过「看得懂关」，未看懂请点「按意见修改」。',
  BACKEND_REQUEST_FAILED: '创作后端暂时未响应，已完成进度已保存，请稍后重试。',
};

interface PreChatTurn {
  id: string;
  role: 'user' | 'director';
  text: string;
  time: string;
  recommendedKind?: Kind;
  suggestions?: string[];
}

function inferKindFromInput(text: string, files: File[]): Kind {
  if (files.some((f) => /\.(mp4|mov|mkv|avi|xlsx)$/i.test(f.name)) || /扒剧|视频|字幕|转写|导出表/.test(text)) {
    return 'transcribe';
  }
  if (/国内|红果|出海|三道门|本土化|北美|狼人|彩礼/.test(text)) {
    return 'domestic';
  }
  if (/前\s*\d+\s*集|锁定|定稿|续写|原稿|底稿|迭代|改编/.test(text) || files.length > 0) {
    return 'foreign';
  }
  return 'original';
}

function buildPreChatDirectorReply(text: string, files: File[], preferredKind: Kind): {
  recapText: string;
  suggestions: string[];
} {
  const totalMatch = text.match(/(?:全剧|整个剧|总共|一共|总集数|全本|共)\s*(?:是|有|为|：|:)?\s*(\d{1,3})\s*集/) || text.match(/(\d{1,3})\s*集/);
  const lockMatch = text.match(/前\s*(\d{1,3})\s*集\s*(?:已|已经)?\s*(?:锁定|定稿|不改|不动)/);
  const totalNum = totalMatch ? Number(totalMatch[1]) : null;
  const lockNum = lockMatch ? Number(lockMatch[1]) : null;

  const fileNote = files.length
    ? `已收到你添加的 ${files.length} 份素材（${files.map((f) => f.name).join('、')}）。`
    : '已收到你的创作说明。';

  const summaryParts = [
    `推荐进入「${labels[preferredKind]}」流程`,
    totalNum ? `全剧 ${totalNum} 集` : null,
    lockNum ? `前 ${lockNum} 集锁定不改` : null,
  ].filter(Boolean);

  return {
    recapText: `${fileNote}\n${summaryParts.join(' · ')}。请核对下方卡片中的项目名称与流程，点击按钮即可进入第 1 步（我们一步步来，每一步完成后再进下一步）。`,
    suggestions: [],
  };
}

function extractSuggestionsFromMessage(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^•\s*(★\s*)?建议/.test(line))
    .map((line) => line.replace(/^•\s*/, ''));
}

function time(value: string) {
  try {
    return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function bytes(n: number) {
  return n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}

function safeGetStorage(key: string): string {
  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function safeSetStorage(key: string, val: string) {
  try {
    if (!val) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, val);
  } catch {}
}

async function api(path: string, body?: any) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await r.json();
  if (!r.ok) throw new Error(data.error || 'REQUEST_FAILED');
  return data;
}

function FlowIcon({ kind, size = 20 }: { kind: Kind; size?: number }) {
  const Icon = icons[kind] || Globe2;
  return <Icon size={size} strokeWidth={1.6} />;
}

function computeProjectStatus(p: Project): { dot: 'action' | 'running' | 'idle'; text: string } {
  const rStatus = p.remote?.status;
  if (rStatus === 'running' || rStatus === 'ready') {
    return { dot: 'running', text: '后台在跑' };
  }
  if (rStatus === 'delivered') {
    return { dot: 'idle', text: '已交付' };
  }
  if (rStatus === 'failed') {
    return { dot: 'action', text: '待重试' };
  }
  if (!p.confirmed) {
    return { dot: 'action', text: '等你拍板 · 复述确认' };
  }
  if (p.kind === 'transcribe' && p.attachments.some((a) => !a.episode || (p.total !== null && a.episode > p.total))) {
    return { dot: 'action', text: '等你拍板 · 补录集号' };
  }
  if (p.remote?.card) {
    return { dot: 'action', text: `等你拍板 · ${p.remote.card.title.slice(0, 8)}` };
  }
  return { dot: 'idle', text: p.remoteId ? '空闲' : '已确认待启动' };
}

function computeStopBadge(p: Project, needsEpisode: boolean, connected: boolean): string {
  if (p.remote?.stage?.title) {
    return p.remote.card?.title ? `当前停点：${p.remote.card.title}` : `当前阶段：${p.remote.stage.title}`;
  }
  if (needsEpisode) return '当前停点：补录素材集号';
  if (!p.confirmed) return '当前停点：总编剧复述与建议确认';
  if (p.kind !== 'original' && p.total === null) return '当前停点：待确认全剧集数';
  if (!connected) return '当前状态：方向已确认（可继续聊细节）';
  return '当前停点：待启动第一阶段';
}

function computeTimelineIndex(p: Project): number {
  if (!p.confirmed) return 0;
  if (!p.remote) return 0;
  if (p.remote.status === 'delivered' || p.remote.stage?.key === 'delivery') return 5;
  const key = (p.remote.stage?.key || '').toLowerCase();
  if (key.includes('review') || key.includes('polish') || key.includes('audit')) return 4;
  if (key.includes('script') || key.includes('episode') || key.includes('body')) return 3;
  if (key.includes('outline') || key.includes('synopsis') || key.includes('mainline') || key.includes('config')) return 2;
  if (key.includes('analysis') || key.includes('gate') || key.includes('stop_a') || key.includes('mode')) return 1;
  const ratio = (p.remote.progress?.completed_steps || 0) / Math.max(1, p.remote.progress?.total_steps || 6);
  return Math.min(5, Math.max(1, Math.floor(ratio * 5)));
}

function PromptSlotControls({
  kind,
  catalog,
  selection,
  disabled,
  compact,
  idPrefix,
  onChange,
}: {
  kind: Kind;
  catalog: CreatorPromptCatalog;
  selection?: PromptSlotSelection;
  disabled?: boolean;
  compact?: boolean;
  idPrefix: string;
  onChange: (next: PromptSlotSelection) => void;
}) {
  const slotsForKind = catalog[kind] || { primary: [] };
  const showSecondary = kind !== 'transcribe';
  const slotList: { slot: PromptSlotKey; label: string; options: CreatorPromptSummary[] }[] = [
    {
      slot: 'primary',
      label: kind === 'transcribe' ? '提示词' : '主提示词',
      options: slotsForKind.primary || [],
    },
    ...(showSecondary
      ? [
          {
            slot: 'secondary' as PromptSlotKey,
            label: '副提示词',
            options: slotsForKind.secondary || [],
          },
        ]
      : []),
  ];

  return (
    <div className={'prompt-slot-group' + (compact ? ' compact' : '')}>
      <div className="prompt-slot-header">
        <span>提示词</span>
        <span className="prompt-slot-badge">{showSecondary ? '主 / 副双槽位' : '单槽位'}</span>
      </div>
      <div className={'prompt-slot-grid' + (!showSecondary ? ' single-slot' : '')}>
        {slotList.map(({ slot, label, options }) => {
          const currentVal = (slot === 'primary' ? selection?.primary : selection?.secondary) || '';
          const selectedItem = options.find((o) => o.id === currentVal);
          const defItem = options.find((o) => o.isDefault);
          const defaultOptionText = defItem
            ? `跟随系统默认（内置规则 · 当前默认：${defItem.name}）`
            : '跟随系统默认（内置规则）';

          return (
            <div className="prompt-slot-field" key={slot}>
              <label htmlFor={`${idPrefix}-${slot}`}>{label}</label>
              <select
                id={`${idPrefix}-${slot}`}
                value={currentVal}
                disabled={disabled}
                onChange={(e) => {
                  const val = e.target.value;
                  if (kind === 'transcribe') {
                    onChange({ primary: val });
                  } else {
                    onChange({
                      primary: slot === 'primary' ? val : selection?.primary || '',
                      secondary: slot === 'secondary' ? val : selection?.secondary || '',
                    });
                  }
                }}
              >
                <option value="">{defaultOptionText}</option>
                {(defItem || currentVal === '__builtin__') && (
                  <option value="__builtin__">仅用系统内置规则（跳过默认插件）</option>
                )}
                {currentVal && currentVal !== '__builtin__' && !selectedItem && (
                  <option value={currentVal}>已停用或已移除的提示词（自动回退默认/内置）</option>
                )}
                {options.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                    {opt.isDefault ? '（默认）' : ''}
                  </option>
                ))}
              </select>
              <p className="prompt-slot-desc">
                {selectedItem
                  ? selectedItem.description || selectedItem.name
                  : currentVal === '__builtin__'
                  ? '已指定仅使用系统内置规则'
                  : currentVal
                  ? defItem
                    ? `所选提示词已停用或移除，将自动回退当前默认（${defItem.name}）`
                    : '所选提示词已停用或移除，将自动回退系统内置规则'
                  : defItem
                  ? defItem.description
                    ? `当前默认：${defItem.description}`
                    : `当前默认：${defItem.name}`
                  : '未配置默认插件时，自动使用系统内置规则'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Studio() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState<Project | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [preChat, setPreChat] = useState<PreChatTurn[]>([]);
  const [pendingBrief, setPendingBrief] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [testChannelReady, setTestChannelReady] = useState(false);
  const [maxUploadBytes, setMaxUploadBytes] = useState(200 * 1024 * 1024);
  const [promptCatalog, setPromptCatalog] = useState<CreatorPromptCatalog>(EMPTY_PROMPT_CATALOG);
  const [draftPromptSelections, setDraftPromptSelections] = useState<ProjectPromptSelections>({});
  const [auth, setAuth] = useState(false);
  const [currentAccount, setCurrentAccount] = useState<PublicAccountProfile | null>(null);
  const [authMode, setAuthMode] = useState<'key' | 'password' | 'register'>('key');
  const [authKeyInput, setAuthKeyInput] = useState('');
  const [authUserInput, setAuthUserInput] = useState('');
  const [authPassInput, setAuthPassInput] = useState('');
  const [authNameInput, setAuthNameInput] = useState('');
  const [authInviteInput, setAuthInviteInput] = useState('');
  const [query, setQuery] = useState('');
  const [text, setText] = useState('');
  const [modal, setModal] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [title, setTitle] = useState('');
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [feedback, setFeedback] = useState('');
  const [episodes, setEpisodes] = useState<Record<string, string>>({});
  const [editingEpisode, setEditingEpisode] = useState<string | null>(null);
  const [expandedMsgs, setExpandedMsgs] = useState<Record<string, boolean>>({});
  const [left, setLeft] = useState(false);
  const [right, setRight] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [trash, setTrash] = useState(false);
  const [queued, setQueued] = useState<File[]>([]);
  const [tab, setTab] = useState<'overview' | 'files' | 'outputs' | 'requirements'>('overview');
  const [uploadStatus, setUploadStatus] = useState('');
  const [busyStageText, setBusyStageText] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [inlineTotalInput, setInlineTotalInput] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const activeRef = useRef(active);

  useEffect(() => {
    const isWorking = busy || Boolean(uploadStatus) || active?.remote?.status === 'running' || active?.remote?.status === 'ready';
    if (!isWorking) {
      setElapsedSec(0);
      return;
    }
    const startTs = Date.now();
    setElapsedSec(0);
    const timer = setInterval(() => {
      setElapsedSec(Math.max(1, Math.floor((Date.now() - startTs) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [busy, uploadStatus, active?.remote?.status]);

  useEffect(() => {
    activeRef.current = active;
    if (active) {
      safeSetStorage('studio_active_id', active.id);
    }
  }, [active]);

  useEffect(() => {
    const savedText = safeGetStorage('studio_draft_text');
    const savedTitle = safeGetStorage('studio_draft_title');
    const savedKind = safeGetStorage('studio_draft_kind') as Kind;
    if (savedText) setText(savedText);
    if (savedTitle) setTitle(savedTitle);
    if (['foreign', 'domestic', 'transcribe', 'original'].includes(savedKind)) {
      setKind(savedKind);
    }
  }, []);

  useEffect(() => {
    if (!active) {
      safeSetStorage('studio_draft_text', text);
      safeSetStorage('studio_draft_title', title);
      safeSetStorage('studio_draft_kind', kind || '');
    }
  }, [text, title, kind, active]);

  async function refresh(restoreActive = false) {
    try {
      const result = await api('/api/studio');
      const list: Project[] = result.projects || [];
      setProjects(list);
      setConnected(Boolean(result.connected));
      setTestChannelReady(Boolean(result.testChannelAvailable));
      if (typeof result.maxUploadBytes === 'number' && result.maxUploadBytes > 0) {
        setMaxUploadBytes(result.maxUploadBytes);
      }
      if (result.promptCatalog) {
        setPromptCatalog(result.promptCatalog);
      }
      if (result.currentAccount) setCurrentAccount(result.currentAccount);
      setAuth(false);

      if (restoreActive && !activeRef.current && list.length > 0) {
        const urlId = new URLSearchParams(window.location.search).get('id') || safeGetStorage('studio_active_id');
        const found = urlId ? list.find((p) => p.id === urlId && !p.archived) : null;
        if (found) {
          setActive(found);
          setKind(found.kind);
        }
      }
    } catch (e: any) {
      if (e.message === 'AUTH_REQUIRED') setAuth(true);
      else setError(errors[e.message] || '工作区加载失败，请刷新重试。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh(true);
  }, []);

  useEffect(() => {
    const desktopMedia = window.matchMedia('(min-width: 1001px)');
    const mobileMedia = window.matchMedia('(max-width: 700px)');
    const adapt = () => {
      setRight(desktopMedia.matches);
      setIsMobileView(mobileMedia.matches);
    };
    adapt();
    desktopMedia.addEventListener('change', adapt);
    mobileMedia.addEventListener('change', adapt);
    return () => {
      desktopMedia.removeEventListener('change', adapt);
      mobileMedia.removeEventListener('change', adapt);
    };
  }, []);

  useEffect(() => {
    if (!modal && !left && !(isMobileView && right)) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        if (modal) setModal('');
        else if (left) setLeft(false);
        else if (isMobileView && right) setRight(false);
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [modal, left, right, isMobileView, busy]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [active?.messages.length, active?.remote?.cursor, preChat.length]);

  useEffect(() => {
    if (!active?.remoteId) return;
    const id = setInterval(async () => {
      try {
        const current = activeRef.current;
        if (current) {
          const p = await api('/api/studio?id=' + current.id);
          if (p.promptCatalog) setPromptCatalog(p.promptCatalog);
          if (activeRef.current?.id === p.id) setActive(p);
        }
      } catch {}
    }, 4000);
    return () => clearInterval(id);
  }, [active?.remoteId]);

  useEffect(() => {
    const card = active?.remote?.card;
    if (!card) {
      setAnswers({});
      return;
    }
    const init: Record<string, any> = {};
    if (card.fields.includes('total') && active?.total !== null) {
      init.total = String(active.total);
    }
    if (card.fields.includes('scope') && active?.lockedEpisodes) {
      init.scope = `前 ${active.lockedEpisodes} 集锁定，本轮续写第 ${active.lockedEpisodes + 1}–${active.total ?? '末'} 集`;
    }
    setAnswers(init);
  }, [active?.remote?.card?.id]);

  function update(p: Project) {
    setActive(p);
    setProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
  }

  async function mutate(operation: string, extra: any = {}, customBusyText?: string) {
    if (!active) return;
    setBusy(true);
    setBusyStageText(
      customBusyText ||
        (operation === 'connect'
          ? active.kind === 'transcribe'
            ? '正在核对视频清单并准备「第 2 步：选择扒剧模式」卡片…'
            : '正在连接创作工位并执行首轮原稿/脑洞分析，请稍候…'
          : operation === 'confirm'
          ? '正在确认第 1 步信息…'
          : operation === 'message'
          ? '总编剧正在思考并更新要求台账…'
          : '正在同步项目状态…')
    );
    setError('');
    try {
      const p = await api('/api/studio', { operation, id: active.id, version: active.version, ...extra });
      if (p.promptCatalog) setPromptCatalog(p.promptCatalog);
      update(p);
      return p;
    } catch (e: any) {
      setError(errors[e.message] || '操作未完成，请重试。');
      if (e.message === 'CONFLICT') {
        const p = await api('/api/studio?id=' + active.id);
        if (p.promptCatalog) setPromptCatalog(p.promptCatalog);
        update(p);
      }
    } finally {
      setBusy(false);
      setBusyStageText('');
    }
  }

  async function proceedFromStep1() {
    if (!active || busy) return;
    setBusy(true);
    setError('');
    try {
      let currentProj: any = active;

      // 1. Save any pending episode numbers entered in the inputs
      if (currentProj.kind === 'transcribe') {
        for (const att of currentProj.attachments) {
          const pendingVal = episodes[att.id];
          if (pendingVal !== undefined && pendingVal.trim() !== '') {
            const n = Number(pendingVal);
            if (!Number.isInteger(n) || n < 1 || n > (currentProj.total ?? 300)) {
              setError(`素材「${att.name}」的集号无效，请输入 1-${currentProj.total ?? 300} 之间的整数。`);
              return;
            }
            setBusyStageText(`正在保存「${att.name}」的集号（第 ${n} 集）…`);
            currentProj = await api('/api/studio', {
              operation: 'set_episode',
              id: currentProj.id,
              version: currentProj.version,
              attachment_id: att.id,
              episode: n,
            });
            update(currentProj);
          }
        }
        setEpisodes({});
        setEditingEpisode(null);

        const stillMissing = currentProj.attachments.some(
          (a) => !a.episode || (currentProj.total !== null && a.episode > currentProj.total)
        );
        if (stillMissing) {
          setError('还有视频素材未填写集号，请先在上方输入框填好集号后再进入下一步。');
          return;
        }
      }

      // 2. Save inline total episodes if needed for foreign / domestic
      if ((currentProj.kind === 'foreign' || currentProj.kind === 'domestic') && currentProj.total === null) {
        const parsedTotal = Number(inlineTotalInput.trim());
        if (!Number.isInteger(parsedTotal) || parsedTotal < 1 || parsedTotal > 300) {
          setError('请先填写全剧总集数（1–300 集），再进入下一步。');
          return;
        }
        setBusyStageText(`正在登记全剧总集数（${parsedTotal} 集）…`);
        currentProj = await api('/api/studio', {
          operation: 'message',
          id: currentProj.id,
          version: currentProj.version,
          text: `全剧 ${parsedTotal} 集`,
          client_id: crypto.randomUUID(),
        });
        update(currentProj);
        setInlineTotalInput('');
      }

      // 3. Confirm Step 1 if not yet confirmed
      if (!currentProj.confirmed) {
        setBusyStageText('正在确认第 1 步信息…');
        currentProj = await api('/api/studio', {
          operation: 'confirm',
          id: currentProj.id,
          version: currentProj.version,
        });
        update(currentProj);
      }

      // 4. Immediately connect to advance to Step 2 so the user doesn't have to click twice
      if (serviceReady && !currentProj.remoteId) {
        setBusyStageText(
          currentProj.kind === 'transcribe'
            ? '正在准备「第 2 步：选择扒剧模式（快速 / 详细）」卡片…'
            : '正在调用创作工位执行第 2 步分析，请稍候（约需 10–30 秒）…'
        );
        currentProj = await api('/api/studio', {
          operation: 'connect',
          id: currentProj.id,
          version: currentProj.version,
        });
        if (currentProj.promptCatalog) setPromptCatalog(currentProj.promptCatalog);
        update(currentProj);
        setToast(
          currentProj.kind === 'transcribe'
            ? '已进入第 2 步：请选择「快速模式」或「详细模式」'
            : '第 1 步已完成，已进入下一阶段拍板卡'
        );
      }
    } catch (e: any) {
      setError(errors[e.message] || '进入下一步未完成，请重试。');
    } finally {
      setBusy(false);
      setBusyStageText('');
    }
  }

  async function saveProjectPrompts(targetKind: Kind, nextSel: PromptSlotSelection) {
    if (!active) return;
    const payload: Record<string, any> = {
      kind: targetKind,
      primaryPluginId: nextSel.primary || '',
    };
    if (targetKind !== 'transcribe') {
      payload.secondaryPluginId = nextSel.secondary || '';
    }
    const updated = await mutate('set_prompts', payload);
    if (updated) setToast('提示词配置已更新');
  }

  async function select(p: Project) {
    setBusy(true);
    setLeft(false);
    setEditingEpisode(null);
    setError('');
    try {
      const result = await api('/api/studio?id=' + p.id);
      if (result.promptCatalog) setPromptCatalog(result.promptCatalog);
      setActive(result);
      setText('');
      setKind(p.kind);
    } catch (e: any) {
      setError(errors[e.message] || '项目打开失败');
    } finally {
      setBusy(false);
    }
  }

  function newChat() {
    setActive(null);
    setPreChat([]);
    setPendingBrief('');
    setDraftPromptSelections({});
    setQueued([]);
    safeSetStorage('studio_active_id', '');
    setEditingEpisode(null);
    setTrash(false);
    setLeft(false);
    setError('');
  }

  async function uploadFiles(p: Project, files: File[]) {
    let result = p;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadStatus(`正在上传 ${i + 1}/${files.length}：${file.name}`);
        try {
          const r = await fetch('/api/upload?id=' + p.id + '&name=' + encodeURIComponent(file.name), {
            method: 'POST',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            body: file,
          });
          const data: any = await r.json();
          if (!r.ok) throw new Error(data.error);
          result = data;
          update(result);
        } catch (e: any) {
          e.remaining = files.slice(i);
          e.fileName = file.name;
          throw e;
        }
      }
      return result;
    } finally {
      setUploadStatus('');
    }
  }

  async function attach(files: File[], retry = false) {
    if (!files.length) return;
    if (files.some((f) => f.size > maxUploadBytes)) {
      const limitMb = Math.max(1, Math.round(maxUploadBytes / (1024 * 1024)));
      setError(`单个文件上限为 ${limitMb} MB，请拆分后上传。`);
      return;
    }
    if (!active) {
      const nextFiles = [...queued, ...files];
      setQueued(nextFiles);
      const inferred = kind || inferKindFromInput(text || pendingBrief, nextFiles);
      if (!kind) setKind(inferred);
      const { recapText, suggestions } = buildPreChatDirectorReply(text || pendingBrief, nextFiles, inferred);
      const now = new Date().toISOString();
      setPreChat((prev) => [
        ...prev,
        {
          id: 'u-file-' + Date.now(),
          role: 'user',
          text: `［已拖入 ${files.length} 份素材：${files.map((f) => f.name).join('、')}］`,
          time: now,
        },
        {
          id: 'd-file-' + Date.now(),
          role: 'director',
          text: recapText,
          time: now,
          recommendedKind: inferred,
          suggestions,
        },
      ]);
      if (!title.trim() && files[0]?.name) {
        setTitle(files[0].name.replace(/\.[^.]+$/, '').slice(0, 24));
      }
      setToast(`已接收 ${files.length} 份素材，总编剧已给出分流与建议`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await uploadFiles(active, files);
      if (retry) setQueued([]);
      setToast('素材已保存并归档');
    } catch (e: any) {
      setQueued((prev) => (retry ? e.remaining || files : [...prev, ...(e.remaining || files)]));
      setError(`「${e.fileName || '素材'}」上传失败：${errors[e.message] || '请重试。'}`);
    } finally {
      setBusy(false);
    }
  }

  async function create(overrideKind?: Kind, overrideTitle?: string, overrideBrief?: string) {
    const targetKind = overrideKind || kind;
    const rawBrief = overrideBrief !== undefined ? overrideBrief : pendingBrief || text;
    const fallbackTitle =
      (overrideTitle !== undefined ? overrideTitle : title).trim() ||
      (rawBrief ? rawBrief.split(/[，。！？\n]/)[0].slice(0, 18) : '') ||
      (queued[0] ? queued[0].name.replace(/\.[^.]+$/, '').slice(0, 18) : '') ||
      (targetKind ? `${labels[targetKind]}新项目` : '');
    if (!fallbackTitle || !targetKind) {
      setError('请先选择四类流程之一并确认项目名称。');
      return;
    }
    const rawSel = draftPromptSelections[targetKind];
    const promptSelectionsPayload =
      rawSel && (rawSel.primary || (targetKind !== 'transcribe' && rawSel.secondary))
        ? {
            [targetKind]:
              targetKind === 'transcribe'
                ? { primary: rawSel.primary || '' }
                : { primary: rawSel.primary || '', secondary: rawSel.secondary || '' },
          }
        : undefined;
    let created = false;
    setBusy(true);
    setBusyStageText(
      queued.length > 0
        ? `正在建立「${fallbackTitle}」项目并上传 ${queued.length} 份素材…`
        : `正在建立「${fallbackTitle}」项目并初始化第 1 步…`
    );
    setError('');
    try {
      let p = await api('/api/studio', {
        operation: 'create',
        title: fallbackTitle,
        kind: targetKind,
        brief: rawBrief,
        ...(promptSelectionsPayload ? { promptSelections: promptSelectionsPayload } : {}),
      });
      created = true;
      if (p.promptCatalog) setPromptCatalog(p.promptCatalog);
      update(p);
      setModal('');
      setText('');
      setTitle('');
      setPendingBrief('');
      setPreChat([]);
      setDraftPromptSelections({});
      safeSetStorage('studio_draft_text', '');
      safeSetStorage('studio_draft_title', '');
      safeSetStorage('studio_draft_kind', '');
      if (queued.length) p = await uploadFiles(p, queued);
      setQueued([]);
      setToast('项目已建立，请按下方第 1 步卡片指引继续');
    } catch (e: any) {
      if (created) {
        setQueued(e.remaining || queued);
        setError(`项目已建立，但「${e.fileName || '素材'}」上传失败。请在输入框点击重试上传。`);
      } else {
        setError(errors[e.message] || '建立项目失败，请重试。');
      }
    } finally {
      setBusy(false);
      setBusyStageText('');
    }
  }

  async function send() {
    if ((!text.trim() && !(queued.length || active)) || busy) return;
    if (!active) {
      // Conversational triage: allow user to chat first on home screen without forcing flow selection upfront!
      const userMsg = text.trim();
      const combinedBrief = pendingBrief ? `${pendingBrief}\n${userMsg}` : userMsg;
      setPendingBrief(combinedBrief);
      const inferred = kind || inferKindFromInput(combinedBrief, queued);
      setKind(inferred);
      if (!title.trim() && userMsg) {
        const snippet = userMsg.split(/[，。！？\n]/)[0].slice(0, 18);
        if (snippet.length >= 2) setTitle(snippet);
      }
      const { recapText, suggestions } = buildPreChatDirectorReply(combinedBrief, queued, inferred);
      const now = new Date().toISOString();
      setPreChat((prev) => [
        ...prev,
        ...(userMsg ? [{ id: 'u-' + Date.now(), role: 'user' as const, text: userMsg, time: now }] : []),
        {
          id: 'd-' + Date.now(),
          role: 'director' as const,
          text: recapText,
          time: now,
          recommendedKind: inferred,
          suggestions,
        },
      ]);
      setText('');
      return;
    }
    const p = await mutate('message', { text: text.trim(), client_id: crypto.randomUUID() });
    if (p) setText('');
  }

  async function adoptSuggestion(suggestionText: string) {
    const clean = suggestionText.replace(/^(★\s*)?建议\s*[0-9A-Z]+（[^）]+）：?/, '').replace(/^(★\s*)?建议\s*[0-9A-Z]+：?/, '').trim();
    if (!active) {
      const nextBrief = pendingBrief ? `${pendingBrief}\n采纳总编剧建议：${clean}` : `采纳总编剧建议：${clean}`;
      setPendingBrief(nextBrief);
      setToast('已采纳该建议，建档时将一并写入确认单');
      return;
    }
    await mutate('message', {
      text: `我采纳这条建议：${clean}`,
      client_id: crypto.randomUUID(),
    });
    setToast('已采纳建议并记入要求台账');
  }

  async function act(action: string, extra: any = {}) {
    const remote = active?.remote;
    if (!remote) return;
    const isTranscribeMode = Boolean(remote.card?.fields?.includes('mode'));
    const nextBusyLabel =
      action === 'revise'
        ? '编剧工位正在根据你的修改意见重新生成当前阶段内容，请稍候…'
        : isTranscribeMode
        ? `扒剧工位正在按「${answers.mode === 'detailed' ? '详细模式（逐帧拆解）' : '快速模式（整集还原+抽查）'}」生成分集场次、动作（▲）与台词，请稍候…`
        : active?.kind === 'transcribe'
        ? '总编剧与精修工位正在汇总全剧故事梗概、人物小传与繁简双版剧本交付包，请稍候…'
        : '智能编剧团队正在生成下一阶段内容，请稍候（约需 15–40 秒）…';
    await mutate(
      'action',
      {
        action: {
          version: remote.version,
          action_id: crypto.randomUUID(),
          action,
          answers: { ...answers, ...extra },
        },
      },
      nextBusyLabel
    );
  }

  async function saveEpisode(id: string) {
    const n = Number(episodes[id] ?? active?.attachments.find((a) => a.id === id)?.episode);
    if (!Number.isInteger(n) || n < 1 || n > (active?.total ?? 300)) {
      setError(`请输入有效集号（1-${active?.total ?? 300}）。`);
      return;
    }
    const p = await mutate('set_episode', { attachment_id: id, episode: n });
    if (p) {
      setEditingEpisode(null);
      setToast(`第 ${n} 集集号已保存`);
      setEpisodes((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  async function transferToIteration(targetKind: 'foreign' | 'domestic') {
    if (!active) return;
    setBusy(true);
    setError('');
    try {
      const nextProj = await api('/api/studio', {
        operation: 'transfer_iteration',
        id: active.id,
        version: active.version,
        target_kind: targetKind,
      });
      update(nextProj);
      if (nextProj.promptCatalog) setPromptCatalog(nextProj.promptCatalog);
      setKind(nextProj.kind);
      setToast(`已转入「${labels[targetKind]}」项目并复用素材`);
    } catch (e: any) {
      setError(errors[e.message] || '转入迭代失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  const visible = projects.filter(
    (p) => Boolean(p.archived) === trash && p.title.toLowerCase().includes(query.toLowerCase())
  );
  const state = active?.remote?.status;
  const running = state === 'running' || state === 'ready';
  const currentCard = active?.remote?.card;
  const needsEpisode = Boolean(
    active?.kind === 'transcribe' &&
      active.attachments.some((a) => !a.episode || (active.total !== null && a.episode > active.total))
  );
  const serviceReady = connected || testChannelReady;
  const requiresTotalBeforeConnect = active ? active.kind !== 'original' : true;
  const canConnect = Boolean(
    active &&
      active.confirmed &&
      serviceReady &&
      (!requiresTotalBeforeConnect || active.total !== null) &&
      !needsEpisode
  );
  const timelineSteps = active ? timelineByKind[active.kind] : timelineByKind.foreign;
  const currentStepIdx = active ? computeTimelineIndex(active) : 0;
  const outputEntries = active?.remote?.outputs ? Object.entries(active.remote.outputs) : [];
  const requiresUnderstoodGate = Boolean(currentCard?.fields?.includes('understood') && answers.understood !== true);
  const requiresModeSelection = Boolean(
    currentCard?.fields?.includes('mode') && !['fast', 'detailed'].includes(answers.mode)
  );

  return (
    <div className="studio">
      {(left || (isMobileView && right)) && (
        <div
          className="scrim"
          onClick={() => {
            setLeft(false);
            if (isMobileView) setRight(false);
          }}
        />
      )}
      <aside className={'sidebar ' + (left ? 'open' : '')} aria-label="项目导航栏">
        <button className="brand" onClick={newChat}>
          <span className="brand-icon">
            <Feather size={22} />
          </span>
          <span>
            总编剧<small>STORY STUDIO</small>
          </span>
        </button>
        <button className="new-chat" onClick={newChat}>
          <Plus size={18} />
          新对话<span>↵</span>
        </button>
        <label className="search">
          <Search size={16} />
          <input
            aria-label="搜索项目"
            placeholder="搜索项目"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>⌘</kbd>
        </label>
        <div className="section-label">
          <span>{trash ? '回收站' : '我的项目'}</span>
          <span>{visible.length}</span>
        </div>
        <div className="project-list">
          {loading ? (
            <div className="side-empty" role="status">
              <LoaderCircle className="spin" size={19} />
              正在打开工作区
            </div>
          ) : visible.length ? (
            visible.map((p) => {
              const st = computeProjectStatus(p);
              return (
                <div className={'project-item ' + (active?.id === p.id ? 'selected' : '')} key={p.id}>
                  <button onClick={()=>select(p)}>
                    <span className={'status-dot ' + st.dot} title={st.text} aria-hidden="true">
                      {st.dot === 'action' ? '●' : st.dot === 'running' ? '◐' : '○'}
                    </span>
                    <span>
                      {p.title}
                      <small>
                        {labels[p.kind]}
                        <i>·</i>
                        {st.text}
                      </small>
                    </span>
                  </button>
                </div>
              );
            })
          ) : (
            <div className="side-empty">
              <FolderOpen size={24} />
              <span>{query ? '没有找到匹配项目' : trash ? '回收站是空的' : '故事，等你开始'}</span>
              <small>{query ? '试试其他关键词' : '和总编剧聊准后建档，会排在这里'}</small>
            </div>
          )}
        </div>
        <div className="sidebar-bottom">
          <button
            className={trash ? 'active' : ''}
            onClick={() => {
              setTrash(!trash);
              setActive(null);
              setPreChat([]);
              setPendingBrief('');
              setQueued([]);
              setDraftPromptSelections({});
            }}
          >
            <Archive size={16} />
            {trash ? '返回我的项目' : '回收站'}
          </button>
          <button onClick={() => setModal('help')}>
            <BookOpen size={16} />
            使用指南
            <ArrowUpRight size={13} />
          </button>
          <div className="account">
            <span className="avatar">
              {(currentAccount?.displayName || 'A').slice(0, 1).toUpperCase()}
            </span>
            <div style={{ cursor: 'pointer' }} onClick={() => setModal('login')}>
              {currentAccount ? currentAccount.displayName.slice(0, 10) : '我的创作空间'}
              <small>
                {currentAccount ? `@${currentAccount.username} · 切换账号` : '点击登录 / 切换账号'}
              </small>
            </div>
            <button aria-label="设置与账号切换" onClick={() => setModal('login')}>
              <Settings2 size={17} />
            </button>
          </div>
        </div>
      </aside>

      <main className={'main ' + (active && right ? 'with-panel' : '')}>
        <header className="topbar">
          <div className="breadcrumbs">
            <button className="mobile-menu" aria-label="展开项目列表" onClick={() => setLeft(true)}>
              <PanelLeftOpen size={19} />
            </button>
            <span>{active ? '我的项目' : '总编剧 Bot'}</span>
            {active ? (
              <>
                <ChevronRight size={14} />
                <strong>{active.title}</strong>
              </>
            ) : (
              <span className="bot-status-pill">● 在线 · 先聊想法与建议，再选四项建档</span>
            )}
          </div>
          <div className="top-actions">
            <button
              className="connection"
              onClick={() => {
                if (!active) {
                  if (!kind) setKind('foreign');
                  setModal('create');
                } else {
                  setModal('settings');
                }
              }}
            >
              <span className={connected ? 'dot green' : testChannelReady ? 'dot amber' : 'dot green'} />
              {!active ? '弹窗快速建档' : connected ? '创作服务已连接' : testChannelReady ? '智能创作通道就绪' : '云端工作区'}
              <ChevronDown size={13} />
            </button>
            {active && (
              <button
                className="icon-button"
                aria-label={right ? '收起项目面板' : '展开项目面板'}
                aria-expanded={right}
                onClick={() => setRight(!right)}
              >
                <SlidersHorizontal size={18} />
              </button>
            )}
          </div>
        </header>

        {auth && (
          <div className="notice" role="status">
            <span>请先使用管理员分发的「专属邀请码/Key」或「账号密码」登录工作台。</span>
            <button className="primary" onClick={() => setModal('login')}>
              立即登录工作台 <ArrowUpRight size={14} />
            </button>
          </div>
        )}

        {error && (
          <div className="error-banner" role="alert">
            <AlertCircle size={17} />
            <span>{error}</span>
            <button aria-label="关闭提示" onClick={() => setError('')}>
              <X size={15} />
            </button>
          </div>
        )}

        {!active ? (
          <div className="conversation bot-home">
            {/* Opening Chief Director message */}
            <div className="message director">
              <span className="director-avatar">
                <Feather size={17} />
              </span>
              <div className="message-body">
                <div className="message-meta">
                  总编剧<span>在线 · 随时接稿</span>
                </div>
                <div className="message-text">
                  今天想聊哪部戏？你可以直接把原稿、前 N 集锁定稿或视频拖进来，或者直接在下方打字跟我聊你的想法。
                  {'\n'}我会先帮你拆解看点、提几条改编建议、复述核对你的要求；咱们聊准了，再在下方选四项流程或弹窗建档开干。
                </div>

                {/* Inline Triage & Quick Start Card */}
                <div className="decision inline-bot-card" role="region" aria-label="四类创作流程与快捷起盘">
                  <div className="decision-title">
                    <span>
                      <Wand2 size={16} />
                    </span>
                    <div>
                      分流与起盘卡（可先在下方打字聊，也可直接点选四项或弹窗建档）
                      <small>支持：国外迭代国外 / 国内迭代国外 / 扒剧 / 原创 / 继续之前的项目</small>
                    </div>
                  </div>
                  <div className="flow-grid compact-grid" role="group" aria-label="四类创作流程">
                    {flows.map((f) => (
                      <button
                        className={'flow-card ' + (kind === f.kind ? 'chosen' : '')}
                        key={f.kind}
                        aria-pressed={kind === f.kind}
                        onClick={() => {
                          setKind(f.kind);
                          setError('');
                        }}
                      >
                        <div className="flow-head">
                          <span className="flow-icon">
                            <FlowIcon kind={f.kind} size={20} />
                          </span>
                          <span className="selection-circle">{kind === f.kind && <Check size={11} />}</span>
                        </div>
                        <h3>{f.title}</h3>
                        <p>{f.description}</p>
                        <div className="flow-foot">
                          <span>{f.tag}</span>
                          <ArrowUpRight size={14} />
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="suggestions">
                    <span>点一下试试跟总编剧开聊：</span>
                    {[
                      {
                        label: '「前 10 集已锁定，帮我续写到 62 集，给点建议」',
                        targetKind: 'foreign' as Kind,
                        prompt: '全剧 62 集，前 10 集已锁定（一字不动），本轮从第 11 集续写到第 62 集，反派第 15 集下线，帮我复述并给点建议。',
                      },
                      {
                        label: '「我有一个都市豪门闪婚的脑洞，先帮我参谋下」',
                        targetKind: 'original' as Kind,
                        prompt: '我有一个都市豪门契约闪婚的脑洞，女主表面是急诊科实习医生，实则是顶级医疗财阀唯一继承人，你觉得开场怎么设计最抓人？',
                      },
                      {
                        label: '「把这部国内短剧改北美本土化，怎么过三道门？」',
                        targetKind: 'domestic' as Kind,
                        prompt: '全剧 50 集，把这部国内女频逆袭短剧改成面向北美受众的版本，原稿有逼婚要彩礼和医院抢病房桥段，帮我做四级诊断并提替换建议。',
                      },
                      {
                        label: '「上传分集视频，先按集扒剧还原」',
                        targetKind: 'transcribe' as Kind,
                        prompt: '全剧 45 集，我准备上传分集视频素材，请先帮我核对集号并选扒剧模式。',
                      },
                    ].map((s) => (
                      <button
                        key={s.label}
                        onClick={() => {
                          setKind(s.targetKind);
                          const { recapText, suggestions } = buildPreChatDirectorReply(s.prompt, queued, s.targetKind);
                          const now = new Date().toISOString();
                          setPendingBrief(s.prompt);
                          setTitle(s.prompt.split(/[，。！？\n]/)[0].slice(0, 18));
                          setPreChat((prev) => [
                            ...prev,
                            { id: 'u-' + Date.now(), role: 'user', text: s.prompt, time: now },
                            {
                              id: 'd-' + Date.now(),
                              role: 'director',
                              text: recapText,
                              time: now,
                              recommendedKind: s.targetKind,
                              suggestions,
                            },
                          ]);
                        }}
                      >
                        {s.label}
                        <ArrowUpRight size={12} />
                      </button>
                    ))}
                  </div>
                  <div className="decision-actions" style={{ marginTop: '14px' }}>
                    <button
                      className="secondary"
                      onClick={() => {
                        if (!kind) setKind('foreign');
                        setModal('create');
                      }}
                    >
                      <Plus size={14} />
                      直接弹窗完成四项建档
                    </button>
                    {visible.length > 0 && (
                      <button className="secondary" onClick={() => select(visible[0])}>
                        继续最近项目：{visible[0].title.slice(0, 12)}
                        <ArrowUpRight size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Pre-creation back-and-forth turns where Director Bot confirms flow & project creation */}
            {preChat.map((turn, idx) => (
              <div className={'message ' + (turn.role === 'user' ? 'user' : 'director')} key={turn.id}>
                {turn.role !== 'user' && (
                  <span className="director-avatar">
                    <Feather size={17} />
                  </span>
                )}
                <div className="message-body">
                  {turn.role !== 'user' && (
                    <div className="message-meta">
                      总编剧<span>{time(turn.time)} · 准备启动</span>
                    </div>
                  )}
                  <div className="message-text">{turn.text}</div>

                  {turn.role === 'director' && idx === preChat.length - 1 && (
                    <div className="decision inline-bot-card" role="region" aria-label="确认四项分流并建档">
                      <div className="decision-title">
                        <span>
                          <Check size={16} />
                        </span>
                        <div>
                          准备启动 · 核对项目名称与流程（★ 推荐项已高亮）
                          <small>确认下方流程与名称后，点击主按钮即可进入第 1 步</small>
                        </div>
                      </div>
                      <div className="preset-chips" style={{ marginTop: '12px' }}>
                        {(['foreign', 'domestic', 'transcribe', 'original'] as Kind[]).map((k) => {
                          const isRec = (kind || turn.recommendedKind) === k;
                          return (
                            <button
                              key={k}
                              type="button"
                              className={'preset-chip ' + (isRec ? 'active' : '')}
                              onClick={() => setKind(k)}
                            >
                              {isRec ? '★ ' : ''}
                              {labels[k]}
                            </button>
                          );
                        })}
                      </div>
                      <div className="card-fields" style={{ margin: '12px 0' }}>
                        <label>
                          项目名称（可直接修改）
                          <input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="输入项目名称，如：天降神運重生致富_1"
                          />
                        </label>
                      </div>
                      <PromptSlotControls
                        kind={kind || turn.recommendedKind || 'foreign'}
                        catalog={promptCatalog}
                        selection={draftPromptSelections[kind || turn.recommendedKind || 'foreign']}
                        disabled={busy}
                        compact
                        idPrefix="prechat-prompt"
                        onChange={(next) => {
                          const tk = kind || turn.recommendedKind || 'foreign';
                          setDraftPromptSelections((prev) => ({ ...prev, [tk]: next }));
                        }}
                      />
                      <div className="decision-actions">
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => create(kind || turn.recommendedKind || 'foreign', title, pendingBrief)}
                        >
                          🚀 确认建档，按「{labels[kind || turn.recommendedKind || 'foreign']}」进入第 1 步
                          <ArrowUpRight size={14} />
                        </button>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => {
                            if (!kind && turn.recommendedKind) setKind(turn.recommendedKind);
                            setModal('create');
                          }}
                        >
                          弹窗修改详情
                        </button>
                      </div>
                    </div>
                  )}

                  {turn.role === 'user' && (
                    <div className="user-time">
                      {time(turn.time)}
                      <CheckCheck size={12} />
                    </div>
                  )}
                </div>
              </div>
            ))}

            {(busy || Boolean(uploadStatus)) && (
              <div
                className="progress-card"
                role="status"
                style={{
                  border: '1.5px solid #2563eb',
                  background: 'rgba(37, 99, 235, 0.08)',
                  padding: '16px 18px',
                  borderRadius: '14px',
                  marginTop: '12px',
                }}
              >
                <LoaderCircle className="spin" size={20} />
                <div>
                  <strong style={{ fontSize: '14px', color: '#1d4ed8' }}>
                    ⏳ 正在处理中 · 已用时 {elapsedSec} 秒
                  </strong>
                  <p style={{ marginTop: '4px' }}>
                    {uploadStatus || busyStageText || '正在建立项目并上传素材，请稍候…'}
                  </p>
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div>
        ) : (
          <div className="conversation">
            <div className="project-heading">
              <div>
                <div className="project-meta-row">
                  <span className="project-type">
                    <FlowIcon kind={active.kind} size={14} />
                    {labels[active.kind]}
                  </span>
                  <span className="stop-badge">{computeStopBadge(active, needsEpisode, serviceReady)}</span>
                  {active.lockedEpisodes && (
                    <span className="lock-badge">
                      <Lock size={11} />前 {active.lockedEpisodes} 集锁定（第 {active.lockedEpisodes + 1} 集起续写）
                    </span>
                  )}
                </div>
                <h1>{active.title}</h1>
              </div>
              <div className="project-tools">
                {active.archived ? (
                  <button onClick={() => mutate('archive', { archived: false })}>
                    <RotateCcw size={16} />
                    恢复项目
                  </button>
                ) : (
                  <button
                    aria-label="项目选项"
                    onClick={() => {
                      setTitle(active.title);
                      setModal('project');
                    }}
                  >
                    <MoreHorizontal size={22} />
                  </button>
                )}
                {running && (
                  <button className="pause-button" onClick={() => act('pause')} disabled={busy}>
                    <Pause size={14} />
                    一键叫停
                  </button>
                )}
              </div>
            </div>

            {/* Clear Step-by-Step Progress Bar so the user never gets confused */}
            <div
              role="region"
              aria-label="当前创作步骤进度"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                padding: '10px 14px',
                marginBottom: '12px',
                borderRadius: '12px',
                background: 'rgba(15, 23, 42, 0.04)',
                border: '1px solid rgba(15, 23, 42, 0.08)',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '12px', fontWeight: 700, opacity: 0.75, marginRight: '4px' }}>
                当前流程进度：
              </span>
              {timelineSteps.map((stepLabel, idx) => {
                const isDone = idx < currentStepIdx || (idx === 0 && Boolean(active.remoteId));
                const isCurrent = idx === currentStepIdx;
                return (
                  <span
                    key={stepLabel}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '4px 10px',
                      borderRadius: '999px',
                      fontSize: '12px',
                      fontWeight: isCurrent ? 700 : 500,
                      background: isCurrent
                        ? '#2563eb'
                        : isDone
                        ? 'rgba(22, 163, 74, 0.12)'
                        : 'rgba(148, 163, 184, 0.14)',
                      color: isCurrent ? '#ffffff' : isDone ? '#15803d' : 'inherit',
                      opacity: isCurrent || isDone ? 1 : 0.65,
                    }}
                  >
                    {isDone ? '✓' : `${idx + 1}.`} {stepLabel}
                  </span>
                );
              })}
            </div>

            <div className="date-divider">
              {new Date(active.createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })} · 项目建立
            </div>

            {active.messages.map((m) => {
              const isLong = m.text.length > 420;
              const expanded = expandedMsgs[m.id] ?? false;
              const displayText = isLong && !expanded ? m.text.slice(0, 420) + '…' : m.text;
              const speakerLabel = m.speaker || (m.role === 'report' ? '专项角色汇报' : '总编剧');
              return (
                <div className={'message ' + (m.role === 'user' ? 'user' : 'director')} key={m.id}>
                  {m.role !== 'user' && (
                    <span className="director-avatar">
                      <Feather size={17} />
                    </span>
                  )}
                  <div className="message-body">
                    {m.role !== 'user' && (
                      <div className="message-meta">
                        {speakerLabel}
                        <span>{time(m.time)}</span>
                      </div>
                    )}
                    <div className="message-text">{displayText}</div>
                    {isLong && (
                      <button
                        className="fold-toggle"
                        onClick={() => setExpandedMsgs({ ...expandedMsgs, [m.id]: !expanded })}
                      >
                        {expanded ? '收起长文' : `展开完整内容（共 ${m.text.length} 字）`}
                      </button>
                    )}
                    {m.file && (
                      <a className="inline-file-card" href={m.file.url}>
                        <FileText size={18} />
                        <span>
                          <strong>{m.file.name}</strong>
                          {m.file.description && <small>{m.file.description}</small>}
                        </span>
                        <Download size={15} />
                      </a>
                    )}
                    {m.role === 'user' && (
                      <div className="user-time">
                        {time(m.time)}
                        <CheckCheck size={12} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Unified Step 1 Card (!active.remoteId): One clear card at a time, auto-chains confirm + connect */}
            {!active.remoteId && (
              <div
                className="decision"
                role="region"
                aria-label={active.kind === 'transcribe' ? '补录或核对素材集号' : '复述确认与四项切换'}
              >
                <div className="decision-title">
                  <span>
                    <Check size={16} />
                  </span>
                  <div>
                    {active.kind === 'transcribe'
                      ? '第 1 步（共 3 步）：核对视频素材与集号'
                      : '第 1 步：核对项目信息与启动分析'}
                    <small>
                      {active.kind === 'transcribe'
                        ? '已根据文件名自动识别集号；核对无误后点击下方主按钮，直接进入「第 2 步：选择扒剧模式」'
                        : '核对下方流程、集数与提示词后，点击下方主按钮直接进入下一阶段'}
                    </small>
                  </div>
                </div>

                {active.kind === 'transcribe' ? (
                  <div className="card-fields" style={{ marginBottom: '14px' }}>
                    {active.attachments.length === 0 ? (
                      <div
                        style={{
                          padding: '12px 14px',
                          borderRadius: '10px',
                          background: 'rgba(245, 158, 11, 0.1)',
                          border: '1px solid rgba(245, 158, 11, 0.3)',
                          fontSize: '13px',
                        }}
                      >
                        当前尚未上传视频或字幕素材，请点击下方「＋ 添加视频素材」按钮或直接将文件拖入页面。
                      </div>
                    ) : (
                      active.attachments.map((a) => {
                        const isMissingOrInvalid =
                          !a.episode || (active.total !== null && a.episode > active.total);
                        const isEditing = isMissingOrInvalid || editingEpisode === a.id;
                        return (
                          <div
                            className="episode-field"
                            key={a.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '10px',
                              padding: '10px 12px',
                              borderRadius: '10px',
                              background: 'rgba(15, 23, 42, 0.03)',
                              border: '1px solid rgba(15, 23, 42, 0.08)',
                            }}
                          >
                            <label htmlFor={'episode-' + a.id} style={{ flex: 1, margin: 0, fontWeight: 600 }}>
                              🎬 {a.name} <small style={{ opacity: 0.65 }}>({bytes(a.size)})</small>
                            </label>
                            {isEditing ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input
                                  id={'episode-' + a.id}
                                  type="number"
                                  min={1}
                                  max={active.total ?? 300}
                                  style={{ width: '140px' }}
                                  value={episodes[a.id] ?? String(a.episode ?? '')}
                                  onChange={(e) => setEpisodes({ ...episodes, [a.id]: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      saveEpisode(a.id);
                                    }
                                  }}
                                  placeholder={`第几集？(1-${active.total ?? 300})`}
                                />
                                <button
                                  className="secondary"
                                  disabled={busy || !(episodes[a.id] ?? a.episode)}
                                  onClick={() => saveEpisode(a.id)}
                                >
                                  保存集号
                                </button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span
                                  style={{
                                    padding: '4px 10px',
                                    borderRadius: '999px',
                                    background: 'rgba(22, 163, 74, 0.12)',
                                    color: '#15803d',
                                    fontSize: '12px',
                                    fontWeight: 700,
                                  }}
                                >
                                  ✓ 已识别：第 {a.episode} 集
                                </span>
                                <button
                                  type="button"
                                  className="secondary"
                                  style={{ padding: '4px 10px', fontSize: '12px' }}
                                  onClick={() => setEditingEpisode(a.id)}
                                >
                                  修改集号
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                    <div>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy || Boolean(uploadStatus)}
                        onClick={() => fileRef.current?.click()}
                      >
                        <Plus size={14} />
                        继续添加分集视频 / 字幕素材
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="recap-grid">
                      <div>
                        创作流程<strong>{labels[active.kind]}</strong>
                      </div>
                      <div>
                        全剧集数
                        <strong>
                          {active.total === null
                            ? active.kind === 'original'
                              ? '停点 A 拍板'
                              : '待填写'
                            : `${active.total} 集`}
                        </strong>
                      </div>
                      <div>
                        锁定与素材
                        <strong>
                          {active.lockedEpisodes
                            ? `锁前 ${active.lockedEpisodes} 集 · ${active.attachments.length} 份素材`
                            : `${active.attachments.length} 份素材`}
                        </strong>
                      </div>
                    </div>
                    {(active.kind === 'foreign' || active.kind === 'domestic') && active.total === null && (
                      <div className="card-fields" style={{ marginBottom: '12px' }}>
                        <label>
                          全剧总集数（1–300 集，必填后即可启动分析）
                          <input
                            type="number"
                            min={1}
                            max={300}
                            value={inlineTotalInput}
                            onChange={(e) => setInlineTotalInput(e.target.value)}
                            placeholder="例如：60（代表全剧共 60 集）"
                          />
                        </label>
                      </div>
                    )}
                  </>
                )}

                <div className="preset-chips" style={{ marginBottom: '14px' }}>
                  {(['foreign', 'domestic', 'transcribe', 'original'] as Kind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      disabled={busy}
                      className={'preset-chip ' + (active.kind === k ? 'active' : '')}
                      onClick={() => {
                        if (active.kind !== k) mutate('switch_kind', { kind: k });
                      }}
                    >
                      {active.kind === k ? '★ 当前：' : '切换为：'}
                      {labels[k]}
                    </button>
                  ))}
                </div>

                <PromptSlotControls
                  kind={active.kind}
                  catalog={promptCatalog}
                  selection={active.promptSelections?.[active.kind]}
                  disabled={busy || active.archived}
                  compact
                  idPrefix="recap-prompt"
                  onChange={(next) => saveProjectPrompts(active.kind, next)}
                />

                <div className="decision-actions">
                  <button
                    className="primary"
                    disabled={busy || Boolean(uploadStatus)}
                    onClick={proceedFromStep1}
                  >
                    {active.kind === 'transcribe'
                      ? '🚀 第 1 步完成：集号无误，进入第 2 步（选择扒剧模式）'
                      : active.kind === 'original'
                      ? '🚀 第 1 步完成：启动原创前四层推理'
                      : '🚀 第 1 步完成：确认信息并开始原稿分析'}
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {outputEntries
              .filter(([key]) => key !== 'recap')
              .map(([key, value]: any) => (
                <div className="message director" key={'output-' + key}>
                  <span className="director-avatar">
                    <Feather size={17} />
                  </span>
                  <div className="message-body">
                    <div className="message-meta">
                      阶段成果<span>{value.title || key.replaceAll('_', ' ')}</span>
                    </div>
                    <details className="output" open={key === active.remote?.stage?.key}>
                      <summary>
                        查看完整内容
                        <ChevronDown size={14} />
                      </summary>
                      <div className="message-text">{value.content}</div>
                    </details>
                  </div>
                </div>
              ))}

            {active.remote?.messages
              ?.filter((m: any) => m.role !== 'user')
              .map((m: any) => (
                <div className="message director" key={'remote-' + m.id}>
                  <span className="director-avatar">
                    <Feather size={17} />
                  </span>
                  <div className="message-body">
                    <div className="message-meta">{m.speaker || '总编剧'}</div>
                    <div className="message-text">{m.text}</div>
                  </div>
                </div>
              ))}

            {currentCard && (
              <div className="decision" role="region" aria-label={currentCard.title}>
                <div className="decision-title">
                  <span>
                    <NotebookPen size={17} />
                  </span>
                  <div>
                    {currentCard.fields.includes('mode')
                      ? '第 2 步（共 3 步）：请选择扒剧还原模式'
                      : active.kind === 'transcribe'
                      ? '第 3 步（共 3 步）：核对分集还原稿并生成繁简双版交付包'
                      : currentCard.title}
                    <small>
                      {currentCard.fields.includes('mode')
                        ? '请点选下方「快速模式」或「详细模式」，然后点击主按钮立即开始扒剧还原'
                        : '★ 为推荐项，每步完成后点击主按钮进入下一步'}
                    </small>
                  </div>
                </div>
                <div className="card-fields">
                  {currentCard.fields.map((field: string) => {
                    const presets = fieldPresets[field];
                    return (
                      <label key={field}>
                        {fieldLabels[field] || field}
                        {field === 'mode' ? (
                          <>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                                gap: '10px',
                                marginTop: '8px',
                                marginBottom: '8px',
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => setAnswers({ ...answers, [field]: 'fast' })}
                                style={{
                                  textAlign: 'left',
                                  padding: '12px 14px',
                                  borderRadius: '12px',
                                  border:
                                    answers[field] === 'fast'
                                      ? '2px solid #2563eb'
                                      : '1px solid rgba(15, 23, 42, 0.15)',
                                  background:
                                    answers[field] === 'fast'
                                      ? 'rgba(37, 99, 235, 0.08)'
                                      : 'rgba(15, 23, 42, 0.02)',
                                  cursor: 'pointer',
                                }}
                              >
                                <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>
                                  ⚡ 快速模式（推荐）
                                </div>
                                <div style={{ fontSize: '12px', opacity: 0.78, lineHeight: 1.45 }}>
                                  按整集快速还原场次、动作（▲）与台词，并自动抽查关键集，速度快、适合快速出底稿。
                                </div>
                              </button>
                              <button
                                type="button"
                                onClick={() => setAnswers({ ...answers, [field]: 'detailed' })}
                                style={{
                                  textAlign: 'left',
                                  padding: '12px 14px',
                                  borderRadius: '12px',
                                  border:
                                    answers[field] === 'detailed'
                                      ? '2px solid #2563eb'
                                      : '1px solid rgba(15, 23, 42, 0.15)',
                                  background:
                                    answers[field] === 'detailed'
                                      ? 'rgba(37, 99, 235, 0.08)'
                                      : 'rgba(15, 23, 42, 0.02)',
                                  cursor: 'pointer',
                                }}
                              >
                                <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>
                                  🔍 详细模式（逐帧拆解）
                                </div>
                                <div style={{ fontSize: '12px', opacity: 0.78, lineHeight: 1.45 }}>
                                  按每秒一帧逐格拆解画面细节、微表情、走位与台词，还原颗粒度最细。
                                </div>
                              </button>
                            </div>
                            <select
                              value={answers[field] || ''}
                              onChange={(e) => setAnswers({ ...answers, [field]: e.target.value })}
                            >
                              <option value="">请选择扒剧模式（无默认值，必选）</option>
                              <option value="fast">快速模式（按整集看写并抽查几集）</option>
                              <option value="detailed">详细模式（按每秒一帧逐格看完再写）</option>
                            </select>
                          </>
                        ) : field === 'understood' ? (
                          <select
                            value={answers[field] === true ? 'yes' : answers[field] === false ? 'no' : ''}
                            onChange={(e) =>
                              setAnswers({
                                ...answers,
                                [field]: e.target.value === 'yes' ? true : e.target.value === 'no' ? false : undefined,
                              })
                            }
                          >
                            <option value="">请核对简化主线单是否看懂（必过门禁）</option>
                            <option value="yes">★ 我看懂了，通过（开放进入梗概与人物）</option>
                            <option value="no">还没看懂，需修改或重新生成</option>
                          </select>
                        ) : (
                          <>
                            {presets && (
                              <div className="preset-chips">
                                {presets.map((opt) => (
                                  <button
                                    type="button"
                                    key={opt.value}
                                    className={'preset-chip ' + (answers[field] === opt.value ? 'active' : '')}
                                    onClick={() => setAnswers({ ...answers, [field]: opt.value })}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            )}
                            <input
                              value={answers[field] || ''}
                              onChange={(e) => setAnswers({ ...answers, [field]: e.target.value })}
                              placeholder="可直接点选上方推荐项，或在此自由打字填写你的决定"
                            />
                          </>
                        )}
                      </label>
                    );
                  })}

                  {currentCard.questions && currentCard.questions.length > 0 && (
                    <label>
                      待拍板事项（★ 推荐项排第一）
                      {currentCard.questions.map((q: any, i: number) => (
                        <p key={i}>
                          {i + 1}. {q.question}
                        </p>
                      ))}
                      <textarea
                        value={answers.decisions || ''}
                        onChange={(e) => setAnswers({ ...answers, decisions: e.target.value })}
                        placeholder="逐项填写决定，或直接输入如“美国都市，不要校园元素了”"
                      />
                    </label>
                  )}

                  <label>
                    补充或修改意见（选填）
                    <textarea
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      placeholder="如有需要调整的地方请写在这里，无修改可直接点击下方确认按钮…"
                    />
                  </label>
                </div>

                {requiresUnderstoodGate && (
                  <p className="gate-hint">
                    提示：简化主线单必须先过「看得懂关」（选择“我看懂了，通过”）才开放确认通过；若未看懂，请填写修改意见并点击「按意见修改」。
                  </p>
                )}
                {requiresModeSelection && (
                  <p className="gate-hint">
                    提示：请先在上方点击选择「⚡ 快速模式」或「🔍 详细模式」，选好后下方按钮即会自动亮起。
                  </p>
                )}

                <div className="decision-actions">
                  <button
                    disabled={busy || requiresUnderstoodGate || requiresModeSelection}
                    className="primary"
                    onClick={() => act('confirm', feedback ? { resolution: feedback } : {})}
                  >
                    {currentCard.fields.includes('mode')
                      ? '🚀 第 2 步完成：确认模式并立即开始扒剧'
                      : active.kind === 'transcribe'
                      ? '🚀 第 3 步完成：确认无误，生成繁简双版交付包'
                      : '★ 确认，继续下一步'}
                    <ArrowUpRight size={14} />
                  </button>
                  <button
                    disabled={busy || !feedback.trim()}
                    className="secondary"
                    onClick={() => act('revise', { feedback })}
                  >
                    按意见修改
                  </button>
                  {(active.remote?.stage?.key?.includes('episode') ||
                    active.remote?.stage?.key?.includes('script')) &&
                    !active.stopsReleased && (
                      <button
                        disabled={busy}
                        className="secondary"
                        onClick={() => act('release_stops')}
                        title="放开后续正文逐集停点，整批写完"
                      >
                        <FastForward size={14} />
                        通过，写完吧（放开后续逐集停点）
                      </button>
                    )}
                </div>
              </div>
            )}

            {/* Prominent Live Waiting Banner so the user always knows what is happening during API calls & uploads */}
            {(busy || Boolean(uploadStatus) || running) && (
              <div
                className="progress-card"
                role="status"
                style={{
                  border: '1.5px solid #2563eb',
                  background: 'rgba(37, 99, 235, 0.08)',
                  padding: '16px 18px',
                  borderRadius: '14px',
                  marginTop: '14px',
                  marginBottom: '10px',
                }}
              >
                <LoaderCircle className="spin" size={22} />
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: '14px', color: '#1d4ed8', display: 'block' }}>
                    ⏳ 正在处理当前步骤 · 已用时 {elapsedSec} 秒
                  </strong>
                  <p style={{ marginTop: '4px', fontSize: '13px' }}>
                    {uploadStatus ||
                      busyStageText ||
                      active.remote?.stage?.title ||
                      '智能编剧工位正在通过 API 中转接口生成内容，请稍候…'}
                  </p>
                  <small style={{ display: 'block', marginTop: '4px', opacity: 0.75 }}>
                    真实调用大模型生成剧本内容通常需要 10–40 秒，请耐心等待，无需重复点击按钮。
                  </small>
                </div>
              </div>
            )}

            {state === 'failed' && (
              <div className="service-card" role="alert">
                <AlertCircle size={20} />
                <div>
                  <strong>当前步骤暂未完成</strong>
                  <p>已成功上传的素材和已完成阶段产物均已保存。可点击右侧按钮仅重试失败小步。</p>
                </div>
                <button className="secondary" disabled={busy} onClick={() => act('retry')}>
                  重试当前步骤
                </button>
              </div>
            )}

            {state === 'paused' && (
              <div className="service-card" role="status">
                <Pause size={18} />
                <div>
                  <strong>创作已暂停</strong>
                  <p>已停止派发后续步骤，已完成检查点产物已保存。</p>
                </div>
                <button className="secondary" disabled={busy} onClick={() => act('resume')}>
                  <Play size={14} />
                  恢复创作
                </button>
              </div>
            )}

            {(active.remote?.stage?.key === 'delivery' || state === 'delivered') && (
              <div className="delivery-block">
                <a className="download-card" href={'/api/upload?id=' + active.id + '&export=1'}>
                  <span>
                    <FileText size={25} />
                  </span>
                  <div>
                    <strong>
                      {active.title} · {active.kind === 'transcribe' ? '扒剧繁简双版与还原稿（点击下载）' : '完整剧本交付包（点击下载）'}
                    </strong>
                    <small>
                      按「故事梗概 → 人物小传 → 正文」结构导出
                      {active.lockedEpisodes ? ` · 前 ${active.lockedEpisodes} 集锁定稿逐字保护` : ''}
                    </small>
                  </div>
                  <Download size={19} />
                </a>
                {active.kind === 'transcribe' && (
                  <div className="transfer-bar">
                    <span>扒剧完成后如需改编，可主动转入迭代流程（不自动跳转）：</span>
                    <div>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => transferToIteration('foreign')}
                      >
                        转入「国外迭代国外」
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => transferToIteration('domestic')}
                      >
                        转入「国内迭代国外」
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div ref={endRef} />
          </div>
        )}

        <div className={'composer-area ' + (!active ? 'home-composer' : '')}>
          <div
            className="composer"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              attach(Array.from(e.dataTransfer.files));
            }}
          >
            {uploadStatus && (
              <div className="upload-status" role="status">
                <LoaderCircle className="spin" size={14} />
                {uploadStatus}
              </div>
            )}
            {active && queued.length > 0 && (
              <button className="retry-upload" disabled={busy} onClick={() => attach(queued, true)}>
                重试上传剩余 {queued.length} 份素材
              </button>
            )}
            {queued.length > 0 && (
              <div className="queued-files">
                {queued.map((f, i) => (
                  <span key={i}>
                    <FileText size={14} />
                    {f.name}
                    <button
                      aria-label={`移除附件 ${f.name}`}
                      onClick={() => setQueued((q) => q.filter((_, n) => n !== i))}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={composerRef}
              aria-label="发给总编剧的消息"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={
                active
                  ? '直接跟总编剧聊修改想法（他会先给建议再入台账）、问进度，或直接回答上方卡片…'
                  : '直接打字聊脑洞/交任务（无需先选流程），总编剧会先给建议再帮你建档…'
              }
              rows={2}
            />
            <div className="composer-bottom">
              <div>
                <button
                  title="上传材料（支持 DOCX、PDF、MD、TXT、SRT、CSV、JSON、MP4、MOV、ZIP、图片等常见格式，默认单文件上限 200 MB）"
                  className="attach"
                  disabled={busy || auth || Boolean(uploadStatus)}
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip size={18} />
                  <span>拖入或添加素材</span>
                </button>
                <span className="composer-divider" />
                <button
                  type="button"
                  className="composer-kind-btn"
                  onClick={() => {
                    if (!active) {
                      if (!kind) setKind('foreign');
                      setModal('create');
                    }
                  }}
                >
                  {active?.kind || kind ? (
                    <>
                      <FlowIcon kind={(active?.kind || kind)!} size={14} />
                      {labels[(active?.kind || kind)!]}
                      {!active && <span>（点击可弹窗建档）</span>}
                    </>
                  ) : (
                    '直接发消息先聊 · 或点击弹窗选四项'
                  )}
                </button>
              </div>
              <button
                className="send"
                aria-label={active ? '发送消息' : '发给总编剧'}
                onClick={send}
                disabled={busy || auth || Boolean(uploadStatus) || (!text.trim() && !queued.length)}
              >
                {busy ? <LoaderCircle className="spin" size={19} /> : <ArrowUp size={20} />}
              </button>
            </div>
          </div>
          <div className="composer-caption">
            <Cloud size={12} />
            总编剧有来有回实时参谋 · 有卡片或后台运行时照常可发消息
            <span>Enter 发送 · Shift + Enter 换行</span>
          </div>
        </div>
      </main>

      {active && right && (
        <aside className="right-panel" aria-label="项目资料手册">
          <div className="panel-title">
            <span>项目手册</span>
            <button aria-label="关闭项目面板" onClick={() => setRight(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="panel-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'overview'}
              className={tab === 'overview' ? 'active' : ''}
              onClick={() => setTab('overview')}
            >
              概览
            </button>
            <button
              role="tab"
              aria-selected={tab === 'files'}
              className={tab === 'files' ? 'active' : ''}
              onClick={() => setTab('files')}
            >
              素材 <span>{active.attachments.length}</span>
            </button>
            <button
              role="tab"
              aria-selected={tab === 'outputs'}
              className={tab === 'outputs' ? 'active' : ''}
              onClick={() => setTab('outputs')}
            >
              产出 <span>{outputEntries.length}</span>
            </button>
            <button
              role="tab"
              aria-selected={tab === 'requirements'}
              className={tab === 'requirements' ? 'active' : ''}
              onClick={() => setTab('requirements')}
            >
              要求 <span>{active.requirements.length}</span>
            </button>
          </div>

          {tab === 'overview' ? (
            <>
              <div className="panel-section">
                <span className="panel-label">当前停点与进度</span>
                <h3>{active.remote?.stage?.title || (active.confirmed ? '方向已确认' : '总编剧复述与建议确认')}</h3>
                <div className="progress-track">
                  <i
                    style={{
                      width: active.remote
                        ? Math.max(
                            8,
                            Math.round(
                              ((active.remote.progress?.completed_steps || 1) /
                                Math.max(1, active.remote.progress?.total_steps || 6)) *
                                100
                            )
                          ) + '%'
                        : active.confirmed
                        ? '18%'
                        : '8%',
                    }}
                  />
                </div>
                <small>
                  {running
                    ? '后台正在处理'
                    : active.remote?.status === 'delivered'
                    ? '已完成全部流程并交付'
                    : active.remoteId
                    ? '等待你在当前卡片拍板'
                    : active.confirmed
                    ? serviceReady
                      ? requiresTotalBeforeConnect && active.total === null
                        ? '等待确认全剧集数'
                        : '可点击「开始分析/推理」启动'
                      : '可继续在对话中打磨细节'
                    : '等待核对总编剧复述与建议'}
                </small>
              </div>

              <div className="panel-section timeline">
                {timelineSteps.map((s, i) => {
                  const isDone = i < currentStepIdx || (i === 0 && active.confirmed);
                  const isCurrent = i === currentStepIdx;
                  return (
                    <div className={isCurrent ? 'current' : isDone ? 'done' : ''} key={s}>
                      <span>{isDone ? <Check size={10} /> : <i />}</span>
                      <p>{s}</p>
                      {(isCurrent || isDone) && <small>{isDone && !isCurrent ? '完成' : '当前'}</small>}
                    </div>
                  );
                })}
              </div>

              <div className="panel-section">
                <span className="panel-label">项目规格与台账概况</span>
                <dl>
                  <dt>创作类型</dt>
                  <dd>{labels[active.kind]}</dd>
                  <dt>全剧集数</dt>
                  <dd>
                    {active.total === null
                      ? active.kind === 'original'
                        ? '停点 A 确认'
                        : '待确认'
                      : `${active.total} 集`}
                  </dd>
                  {(active.kind === 'foreign' || active.kind === 'domestic') && (
                    <>
                      <dt>锁集续写范围</dt>
                      <dd>
                        {active.lockedEpisodes
                          ? `锁 1–${active.lockedEpisodes} 集（写 ${active.lockedEpisodes + 1} 集起）`
                          : '从第 1 集起（未锁集）'}
                      </dd>
                    </>
                  )}
                  {active.kind === 'transcribe' && (
                    <>
                      <dt>扒剧模式</dt>
                      <dd>
                        {active.transcribeMode === 'fast'
                          ? '快速模式'
                          : active.transcribeMode === 'detailed'
                          ? '详细模式'
                          : '待选择（无默认）'}
                      </dd>
                    </>
                  )}
                  <dt>已归档素材</dt>
                  <dd>{active.attachments.length} 份</dd>
                  <dt>创建日期</dt>
                  <dd>{new Date(active.createdAt).toLocaleDateString('zh-CN')}</dd>
                </dl>
              </div>
              <div className="panel-section">
                <PromptSlotControls
                  kind={active.kind}
                  catalog={promptCatalog}
                  selection={active.promptSelections?.[active.kind]}
                  disabled={busy || active.archived}
                  compact
                  idPrefix="panel-overview-prompt"
                  onChange={(next) => saveProjectPrompts(active.kind, next)}
                />
              </div>
            </>
          ) : tab === 'files' ? (
            <div className="panel-section">
              {active.attachments.length ? (
                active.attachments.map((a) => (
                  <div className="file-item" key={a.id}>
                    <a className="file-row" href={'/api/upload?id=' + active.id + '&file=' + a.id}>
                      <FileText size={19} />
                      <span>
                        {a.name}
                        <small>
                          {bytes(a.size)}
                          {a.episode
                            ? ' · 第 ' + a.episode + ' 集'
                            : a.role === 'locked'
                            ? ' · 锁定稿（一字不改）'
                            : a.role === 'setting'
                            ? ' · 设定资料'
                            : ' · 原稿素材'}
                        </small>
                      </span>
                      <Download size={14} />
                    </a>
                    <div className="file-item-actions">
                      {active.kind === 'transcribe' && !active.remoteId && (
                        <button
                          onClick={() => {
                            setEditingEpisode(a.id);
                            if (window.innerWidth <= 1000) setRight(false);
                            requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
                          }}
                        >
                          {a.episode ? '修改集号' : '补录集号'}
                        </button>
                      )}
                      {(active.kind === 'foreign' || active.kind === 'domestic') && !active.remoteId && (
                        <button
                          onClick={() =>
                            mutate('set_role', {
                              attachment_id: a.id,
                              role: a.role === 'locked' ? 'source' : 'locked',
                            })
                          }
                        >
                          {a.role === 'locked' ? '改为原稿素材' : '设为前N集锁定稿'}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="panel-empty">
                  <FolderOpen size={29} />
                  <p>素材还没到场</p>
                  <small>上传原稿、锁定稿、视频或参考资料</small>
                  <button onClick={() => fileRef.current?.click()}>添加素材</button>
                </div>
              )}
            </div>
          ) : tab === 'outputs' ? (
            <div className="panel-section">
              {outputEntries.length > 0 ? (
                outputEntries.map(([k, val]: any) => (
                  <div className="requirement" key={k}>
                    <span>
                      <Check size={12} />
                      {val.title || k}
                    </span>
                    <p>{String(val.content || '').slice(0, 180)}…</p>
                  </div>
                ))
              ) : (
                <div className="panel-empty">
                  <FileText size={29} />
                  <p>尚无阶段产物</p>
                  <small>启动分析、推理或写稿后，各阶段文档与导出链接会归档在这里</small>
                </div>
              )}
              <a className="download-card compact" href={'/api/upload?id=' + active.id + '&export=1'}>
                <FileText size={18} />
                <span>导出当前剧本包（梗概·人物·正文）</span>
                <Download size={15} />
              </a>
            </div>
          ) : (
            <div className="panel-section">
              {active.requirements.length ? (
                active.requirements.map((r, i) => {
                  const textVal = typeof r === 'string' ? r : r.text;
                  return (
                    <div className="requirement" key={i}>
                      <span>
                        <Check size={12} />
                        台账记录 #{i + 1}
                      </span>
                      <p>{textVal}</p>
                    </div>
                  );
                })
              ) : (
                <div className="panel-empty">
                  <NotebookPen size={29} />
                  <p>把你的要求告诉总编剧</p>
                  <small>对话中补充的要求、采纳的建议与锁定范围会自动记入台账</small>
                </div>
              )}
            </div>
          )}
          <div className="panel-bottom">
            <Feather size={16} />
            <span>你的每一次拍板，都算数。</span>
          </div>
        </aside>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".doc,.docx,.pdf,.txt,.md,.rtf,.srt,.ass,.vtt,.csv,.xlsx,.xls,.json,.mp4,.mov,.mkv,.avi,.webm,.mp3,.wav,.zip,.rar,.7z,.png,.jpg,.jpeg,.webp,text/*,video/*,audio/*,image/*"
        className="hidden"
        onChange={(e) => {
          attach(Array.from(e.target.files || []));
          e.target.value = '';
        }}
      />

      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onClick={() => !busy && setModal('')}>
          <section className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" aria-label="关闭弹层" disabled={busy} onClick={() => setModal('')}>
              <X size={19} />
            </button>
            {modal === 'create' ? (
              <>
                <span className="modal-icon">{kind && <FlowIcon kind={kind} size={27} />}</span>
                <h2>确认四项流程与建立项目</h2>
                <p>可在下方选择或切换四类流程（★ 推荐项已高亮），填写项目名后直接进入总编剧对话。</p>
                <label>
                  选择四项创作流程
                  <div className="preset-chips" style={{ marginTop: '8px' }}>
                    {(['foreign', 'domestic', 'transcribe', 'original'] as Kind[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        className={'preset-chip ' + (kind === k ? 'active' : '')}
                        onClick={() => setKind(k)}
                      >
                        {kind === k ? '★ ' : ''}
                        {labels[k]}
                      </button>
                    ))}
                  </div>
                </label>
                <label>
                  项目名称
                  <input
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && title.trim() && kind && !busy) {
                        e.preventDefault();
                        create();
                      }
                    }}
                    placeholder="给故事起一个暂定名称（按 Enter 即可建档）"
                    maxLength={200}
                  />
                </label>
                {kind && (
                  <PromptSlotControls
                    kind={kind}
                    catalog={promptCatalog}
                    selection={draftPromptSelections[kind]}
                    disabled={busy}
                    compact
                    idPrefix="modal-create-prompt"
                    onChange={(next) => setDraftPromptSelections((prev) => ({ ...prev, [kind]: next }))}
                  />
                )}
                {queued.length > 0 && <small>{queued.length} 份排队素材将在建档后自动上传归档</small>}
                <button className="primary wide" disabled={busy || !kind || !title.trim()} onClick={() => create()}>
                  {busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
                  建立项目，让总编剧给出复述与建议
                </button>
              </>
            ) : modal === 'help' ? (
              <>
                <span className="modal-icon">
                  <BookOpen size={27} />
                </span>
                <h2>和总编剧一起写故事（实时参谋协作模式）</h2>
                <div className="help-list">
                  <p>
                    <strong>1. 先聊天、有来有回拿建议</strong>
                    无需先填繁琐表单，打开就能直接跟总编剧聊脑洞或拖入原稿/视频。总编剧会先复述理解、主动给你提 2–3 条剧情和卡点建议。
                  </p>
                  <p>
                    <strong>2. 卡片或弹窗完成四项分流</strong>
                    聊准方向后，直接在对话气泡下方的分流卡（或点「弹窗核对四项」）一键建档，进入「国外迭代国外」「国内迭代国外」「扒剧」或「原创」。
                  </p>
                  <p>
                    <strong>3. 随时补要求、一键采纳建议</strong>
                    在任何停点或生成过程中，你都可以继续发消息。总编剧每次都会先给落地建议，你点一下「＋ 采纳」就会自动记入右侧要求台账。
                  </p>
                </div>
                <button className="primary wide" onClick={() => setModal('')}>
                  知道了，回到工作台
                </button>
              </>
            ) : modal === 'settings' ? (
              <>
                <span className="modal-icon">
                  <Settings2 size={27} />
                </span>
                <h2>工作区与服务连接状态</h2>
                <div className="settings-row">
                  <span>项目与素材云端存储</span>
                  <strong className="green-text">已就绪（支持历史恢复）</strong>
                </div>
                <div className="settings-row">
                  <span>多角色创作生产后端</span>
                  <strong className={connected ? 'green-text' : ''}>{connected ? '已连接' : '待连接（保留 API 接入槽位）'}</strong>
                </div>
                <div className="settings-row">
                  <span>智能创作测试通道</span>
                  <strong className={testChannelReady ? 'green-text' : ''}>
                    {testChannelReady ? '已就绪（可用）' : '未配置（仅管理员后台可见）'}
                  </strong>
                </div>
                <p className="settings-note">
                  {connected
                    ? '生产创作后端已连接。确认方向后，可在项目中同步材料与锁定范围，按停点推进四类流程。'
                    : testChannelReady
                    ? '当前智能创作测试通道已就绪，可进行实时复述、提建议与卡片流转测试（界面已区分测试通道与多角色生产后端）。'
                    : '工作台已启用实时对话参谋、四类流程分流、锁集续写识别与要求台账。请联系管理员在管理后台完成服务端引擎配置后即可开启后台生成。'}
                </p>
                <button
                  className="secondary wide"
                  onClick={() => {
                    refresh();
                    setToast('连接状态已刷新');
                  }}
                >
                  刷新连接状态
                </button>
                <button
                  className="secondary wide"
                  style={{ marginTop: 8 }}
                  onClick={() => setModal('login')}
                >
                  切换团队账号 / 使用专属 Key 登录
                </button>
              </>
            ) : modal === 'login' ? (
              <>
                <span className="modal-icon">
                  <Lock size={25} />
                </span>
                <h2>团队账号与专属 Key 登录</h2>
                <p>
                  支持管理员在后台生成的「专属邀请码/Key 一键登录」或「账号+密码登录」。不同成员的项目与台账相互独立。
                </p>

                {currentAccount && (
                  <div className="settings-row" style={{ marginBottom: 10 }}>
                    <span>
                      当前已登录：<strong>{currentAccount.displayName}</strong> (@{currentAccount.username})
                    </span>
                    <strong className="green-text">
                      额度 ${currentAccount.budgetUsedUsd.toFixed(2)} / ${currentAccount.budgetCapUsd.toFixed(2)}
                    </strong>
                  </div>
                )}

                <div className="preset-chips" style={{ marginBottom: 12 }}>
                  <button
                    type="button"
                    className={'preset-chip ' + (authMode === 'key' ? 'active' : '')}
                    onClick={() => setAuthMode('key')}
                  >
                    🔑 专属 Key / 邀请码登录
                  </button>
                  <button
                    type="button"
                    className={'preset-chip ' + (authMode === 'password' ? 'active' : '')}
                    onClick={() => setAuthMode('password')}
                  >
                    👤 账号 + 密码登录
                  </button>
                  <button
                    type="button"
                    className={'preset-chip ' + (authMode === 'register' ? 'active' : '')}
                    onClick={() => setAuthMode('register')}
                  >
                    ✨ 凭邀请码激活新账号
                  </button>
                </div>

                {authMode === 'key' ? (
                  <label>
                    专属登录 Key 或管理员邀请码
                    <input
                      autoFocus
                      value={authKeyInput}
                      onChange={(e) => setAuthKeyInput(e.target.value)}
                      placeholder="输入管理员分发的专属 Key 或邀请码"
                    />
                  </label>
                ) : authMode === 'password' ? (
                  <>
                    <label>
                      登录账号 (Username)
                      <input
                        autoFocus
                        value={authUserInput}
                        onChange={(e) => setAuthUserInput(e.target.value)}
                        placeholder="输入成员账号（Username）"
                      />
                    </label>
                    <label>
                      登录密码 (Password)
                      <input
                        type="password"
                        value={authPassInput}
                        onChange={(e) => setAuthPassInput(e.target.value)}
                        placeholder="输入密码"
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      管理员分发的专属邀请码
                      <input
                        autoFocus
                        value={authInviteInput}
                        onChange={(e) => setAuthInviteInput(e.target.value)}
                        placeholder="输入管理员分发的专属邀请码"
                      />
                    </label>
                    <label>
                      设置你的登录账号 (Username)
                      <input
                        value={authUserInput}
                        onChange={(e) => setAuthUserInput(e.target.value)}
                        placeholder="设置登录账号名"
                      />
                    </label>
                    <label>
                      你的成员昵称
                      <input
                        value={authNameInput}
                        onChange={(e) => setAuthNameInput(e.target.value)}
                        placeholder="如：海外短剧编剧小周"
                      />
                    </label>
                    <label>
                      设置登录密码
                      <input
                        type="password"
                        value={authPassInput}
                        onChange={(e) => setAuthPassInput(e.target.value)}
                        placeholder="至少 4 位密码"
                      />
                    </label>
                  </>
                )}

                <button
                  className="primary wide"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      const payload =
                        authMode === 'key'
                          ? { action: 'login_key', key: authKeyInput.trim() }
                          : authMode === 'password'
                          ? { action: 'login_password', username: authUserInput.trim(), password: authPassInput }
                          : {
                              action: 'register_with_invite',
                              inviteCode: authInviteInput.trim(),
                              username: authUserInput.trim(),
                              displayName: authNameInput.trim() || authUserInput.trim(),
                              password: authPassInput,
                            };
                      const res = await fetch('/api/auth', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                      });
                      const data = await res.json();
                      if (!res.ok) {
                        throw new Error(
                          data.error === 'INVALID_CREDENTIALS'
                            ? '密钥或账号密码错误，请核对后重试'
                            : data.error === 'ACCOUNT_DISABLED'
                            ? '该账号已被停用，请联系管理员确认账号状态'
                            : data.error === 'INVALID_INVITE_CODE'
                            ? '邀请码无效、已吊销或已达使用上限'
                            : data.error === 'USERNAME_EXISTS'
                            ? '该账号名已被占用，请换一个'
                            : data.error || '登录失败'
                        );
                      }
                      setCurrentAccount(data.account);
                      setActive(null);
                      setModal('');
                      await refresh(false);
                      setToast(`已切换至账号：${data.account.displayName}`);
                    } catch (err: any) {
                      setError(err.message || '登录未成功');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {authMode === 'register' ? '✨ 激活邀请码并登录' : '🚀 立即登录 / 切换工作区'}
                </button>

                <p className="settings-note" style={{ marginTop: 10 }}>
                  如需账号、专属 Key 或团队邀请码，请联系团队管理员在管理后台生成并分发。
                </p>
              </>
            ) : (
              <>
                <h2>项目管理</h2>
                <p>{active?.title}</p>
                <label>
                  修改项目名称
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter' && title.trim() && !busy) {
                        e.preventDefault();
                        const p = await mutate('rename', { title: title.trim() });
                        if (p) setModal('');
                      }
                    }}
                  />
                </label>
                {(active?.kind === 'foreign' || active?.kind === 'domestic') && !active?.remoteId && (
                  <label>
                    前 N 集锁定范围（留空或 0 表示不锁集）
                    <input
                      type="number"
                      min="0"
                      max={(active?.total ?? 300) - 1}
                      defaultValue={active?.lockedEpisodes ?? ''}
                      placeholder="例如：10（代表前 10 集一字不动，从第 11 集续写）"
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        const num = val ? Number(val) : null;
                        if (num !== (active?.lockedEpisodes ?? null)) {
                          mutate('set_locked', { locked: num });
                        }
                      }}
                    />
                  </label>
                )}
                {active && (
                  <PromptSlotControls
                    kind={active.kind}
                    catalog={promptCatalog}
                    selection={active.promptSelections?.[active.kind]}
                    disabled={busy || active.archived}
                    compact
                    idPrefix="modal-project-prompt"
                    onChange={(next) => saveProjectPrompts(active.kind, next)}
                  />
                )}
                <button
                  className="primary wide"
                  disabled={busy || !title.trim()}
                  onClick={async () => {
                    const p = await mutate('rename', { title: title.trim() });
                    if (p) setModal('');
                  }}
                >
                  保存名称
                </button>
                <button
                  className="secondary wide"
                  onClick={async () => {
                    const p = await mutate('archive', { archived: true });
                    if (p) {
                      setActive(null);
                      setModal('');
                      setToast('项目已移入回收站，可随时恢复');
                    }
                  }}
                >
                  移入回收站
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
