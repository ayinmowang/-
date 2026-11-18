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
import { flows, type Kind, type Project, type PublicAccountProfile } from '../lib/types';

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
  CONFLICT: '项目刚刚有更新，已为你同步最新状态，请重试。',
  SERVICE_NOT_CONNECTED: '创作服务尚未连接，你的项目和材料已安全保存。',
  FILE_TOO_LARGE: '单个文件上限为 20 MB，请拆分后上传。',
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
    ? `已收到你拖进来的 ${files.length} 份文件（${files.map((f) => f.name).join('、')}）`
    : '目前还没挂附件（随时可拖入原稿或视频）';

  const recapLines = [
    `1. 推荐流程：根据你的描述，我建议归入「★ ${labels[preferredKind]}」（你也可以在下方卡片切换其他三类流程或弹窗建档）。`,
    `2. 集数与范围：${totalNum ? `全剧 ${totalNum} 集` : preferredKind === 'original' ? '集数我们留到前四层推理后的「停点 A」一起拍板' : '全剧集数待确认'}${lockNum ? `；前 ${lockNum} 集作为只读锁定稿（一字不动），本轮从第 ${lockNum + 1} 集写到末尾` : ''}。`,
    `3. 材料与要点：${fileNote}${text ? `；核心交代：“${text.slice(0, 70)}${text.length > 70 ? '…' : ''}”` : ''}。`,
  ];

  const suggestions =
    preferredKind === 'transcribe'
      ? [
          '★ 建议 A：先核对每个视频的集号（认不出集号的文件我会单独列卡让你填），再选「快速模式」或「详细模式」。',
          '建议 B：扒完交付繁简双版 Word 后，如果觉得底子好，可以一键转入「国外迭代」或「国内迭代」。',
        ]
      : preferredKind === 'domestic'
      ? [
          '★ 建议 A（桥段出海四级诊断）：先把原稿里的中式家庭伦理/彩礼/口舌之争，替换成欧美契约条款（Prenup）、信托冻结或晚宴除名。',
          '建议 B（逐道过三道门）：我们先按「世界观 → 人设 → 替换要点」逐道确认，全部过关再进梗概和细纲。',
          '建议 C（美式幽默加持）：正文精修时给闺蜜/路人加上美式自嘲与 Caught in 4K 实锤反转，去掉说教感。',
        ]
      : preferredKind === 'foreign'
      ? [
          lockNum
            ? `★ 建议 A（锁集无缝接力）：前 ${lockNum} 集锁死一字不动，第 ${lockNum + 1} 集开场前 3 秒直接承接第 ${lockNum} 集尾钩做高能反击。`
            : '★ 建议 A（情绪曲线 1:1 对位）：先让原稿分析师跑出事件映射和逐集情绪曲线，把最高爽点精准对位。',
          '建议 B（主线 3 选 1 + 看得懂关）：主线与对手方案我会给你出 2–3 套，附上简化主线单，必须你觉得「看得懂、立得住」才开细纲。',
          '建议 C（拉扯感强化）：每集保证「事件危机线 + 男女主情感推拉线」各推进一格，杜绝站桩纯聊。',
        ]
      : [
          '★ 建议 A（前 3 秒冲突开场）：采用「开场 B：绝境危机冲突前置」，第 1 集第 1 场直接亮出核心矛盾与身份反差。',
          '建议 B（单一破局引擎 + 中期反转）：设计一个好记的破局底牌（视觉锤），在第 25–30 集左右让底牌面临一次反噬或失效，拉高追剧留存。',
          '建议 C（停点 A 拍板）：我们先跑前四层推理，然后在「停点 A」卡片上把方向、开场 A/B/C、破局引擎、总集数和男女频一次定准。',
        ];

  return {
    recapText: `我先按总编剧的视角把你的意思复述一遍，并给你提几条切入建议：\n\n${recapLines.join('\n')}`,
    suggestions,
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

export default function Studio() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState<Project | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [preChat, setPreChat] = useState<PreChatTurn[]>([]);
  const [pendingBrief, setPendingBrief] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [gptTest, setGptTest] = useState(false);
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

  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const activeRef = useRef(active);

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
      setGptTest(Boolean(result.gptTestAvailable));
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

  async function mutate(operation: string, extra: any = {}) {
    if (!active) return;
    setBusy(true);
    setError('');
    try {
      const p = await api('/api/studio', { operation, id: active.id, version: active.version, ...extra });
      update(p);
      return p;
    } catch (e: any) {
      setError(errors[e.message] || '操作未完成，请重试。');
      if (e.message === 'CONFLICT') {
        const p = await api('/api/studio?id=' + active.id);
        update(p);
      }
    } finally {
      setBusy(false);
    }
  }

  async function select(p: Project) {
    setBusy(true);
    setLeft(false);
    setEditingEpisode(null);
    setError('');
    try {
      const result = await api('/api/studio?id=' + p.id);
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
    if (files.some((f) => f.size > 20 * 1024 * 1024)) {
      setError(errors.FILE_TOO_LARGE);
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
    let created = false;
    setBusy(true);
    setError('');
    try {
      let p = await api('/api/studio', {
        operation: 'create',
        title: fallbackTitle,
        kind: targetKind,
        brief: rawBrief,
      });
      created = true;
      update(p);
      setModal('');
      setText('');
      setTitle('');
      setPendingBrief('');
      setPreChat([]);
      safeSetStorage('studio_draft_text', '');
      safeSetStorage('studio_draft_title', '');
      safeSetStorage('studio_draft_kind', '');
      if (queued.length) p = await uploadFiles(p, queued);
      setQueued([]);
      setToast('项目已建立，总编剧建议与确认单已就绪');
    } catch (e: any) {
      if (created) {
        setQueued(e.remaining || queued);
        setError(`项目已建立，但「${e.fileName || '素材'}」上传失败。请在输入框点击重试上传。`);
      } else {
        setError(errors[e.message] || '建立项目失败，请重试。');
      }
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if ((!text.trim() && !(queued.length || active)) || busy) return;
    if (!active) {
      // Grok Bot style: allow user to chat first on home screen without forcing flow selection upfront!
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
    await mutate('action', {
      action: {
        version: remote.version,
        action_id: crypto.randomUUID(),
        action,
        answers: { ...answers, ...extra },
      },
    });
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
  const serviceReady = connected || gptTest;
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
              <span className={connected ? 'dot green' : gptTest ? 'dot amber' : 'dot green'} />
              {!active ? '弹窗快速建档' : connected ? '创作服务已连接' : gptTest ? 'GPT 测试通道就绪' : '云端工作区'}
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
            {/* Opening Director Bot message (Grok Bot style) */}
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

                {/* Inline Grok-Bot Triage & Quick Start Card */}
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

            {/* Pre-creation back-and-forth turns where Director Bot gives proactive suggestions & triage card */}
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
                      总编剧<span>{time(turn.time)} · 复述与参谋建议</span>
                    </div>
                  )}
                  <div className="message-text">{turn.text}</div>

                  {turn.suggestions && turn.suggestions.length > 0 && (
                    <div className="suggestion-box">
                      <span className="suggestion-title">✦ 总编剧建议（点击即可采纳进确认单，也可在下方打字反驳或补充）：</span>
                      <div className="preset-chips">
                        {turn.suggestions.map((sug, sIdx) => (
                          <button
                            key={sIdx}
                            type="button"
                            className="preset-chip"
                            onClick={() => adoptSuggestion(sug)}
                          >
                            ＋ 采纳：{sug}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {turn.role === 'director' && idx === preChat.length - 1 && (
                    <div className="decision inline-bot-card" role="region" aria-label="确认四项分流并建档">
                      <div className="decision-title">
                        <span>
                          <Check size={16} />
                        </span>
                        <div>
                          拍板四项分流与建档（★ 推荐项已排第一）
                          <small>可在此直接点选流程并建档，或点击「弹窗修改详情」，也可继续在底部打字聊</small>
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
                          项目暂定名称（可直接修改）
                          <input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="输入项目名称，如：豪门闪婚第11-62集续写"
                          />
                        </label>
                      </div>
                      <div className="decision-actions">
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => create(kind || turn.recommendedKind || 'foreign', title, pendingBrief)}
                        >
                          ★ 对，按「{labels[kind || turn.recommendedKind || 'foreign']}」建档开始
                          <ArrowUpRight size={14} />
                        </button>
                        <button
                          className="secondary"
                          onClick={() => {
                            if (!kind && turn.recommendedKind) setKind(turn.recommendedKind);
                            setModal('create');
                          }}
                        >
                          弹窗核对四项与建档
                        </button>
                        <button
                          className="secondary"
                          onClick={() => {
                            setText('我补充一下：');
                            composerRef.current?.focus();
                          }}
                        >
                          不对，我再补充几句
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

            <div className="date-divider">
              {new Date(active.createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })} · 项目建立
            </div>

            {active.messages.map((m) => {
              const isLong = m.text.length > 420;
              const expanded = expandedMsgs[m.id] ?? false;
              const displayText = isLong && !expanded ? m.text.slice(0, 420) + '…' : m.text;
              const speakerLabel = m.speaker || (m.role === 'report' ? '专项角色汇报' : '总编剧');
              const inlineSuggestions = m.role !== 'user' ? extractSuggestionsFromMessage(m.text) : [];
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
                    {inlineSuggestions.length > 0 && (
                      <div className="suggestion-box">
                        <span className="suggestion-title">✦ 一键采纳总编剧建议（点击直接写入确认单台账）：</span>
                        <div className="preset-chips">
                          {inlineSuggestions.map((sug, i) => (
                            <button
                              key={i}
                              type="button"
                              className="preset-chip"
                              disabled={busy}
                              onClick={() => adoptSuggestion(sug)}
                            >
                              ＋ 采纳：{sug.slice(0, 38)}
                              {sug.length > 38 ? '…' : ''}
                            </button>
                          ))}
                        </div>
                      </div>
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

            {active.kind === 'transcribe' && !active.remoteId && (needsEpisode || editingEpisode) && (
              <div className="decision" role="region" aria-label="补录或核对素材集号">
                <div className="decision-title">
                  <span>
                    <FileText size={16} />
                  </span>
                  <div>
                    {needsEpisode ? '补录或核对素材集号' : '调整素材集号'}
                    <small>已识别且正确的集号无需重填；补齐后不会自动误触发开工</small>
                  </div>
                </div>
                <div className="card-fields">
                  {active.attachments
                    .filter(
                      (a) =>
                        !a.episode ||
                        (active.total !== null && a.episode > active.total) ||
                        a.id === editingEpisode
                    )
                    .map((a) => (
                      <div className="episode-field" key={a.id}>
                        <label htmlFor={'episode-' + a.id}>{a.name}</label>
                        <input
                          id={'episode-' + a.id}
                          type="number"
                          min={1}
                          max={active.total ?? 300}
                          value={episodes[a.id] ?? String(a.episode ?? '')}
                          onChange={(e) => setEpisodes({ ...episodes, [a.id]: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              saveEpisode(a.id);
                            }
                          }}
                          placeholder={`这份素材是第几集？（1-${active.total ?? 300}）`}
                        />
                        <button
                          className="secondary"
                          disabled={busy || !(episodes[a.id] ?? a.episode)}
                          onClick={() => saveEpisode(a.id)}
                        >
                          保存集号
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {!active.remoteId && !active.confirmed && (
              <div className="decision" role="region" aria-label="复述确认与四项切换">
                <div className="decision-title">
                  <span>
                    <Check size={16} />
                  </span>
                  <div>
                    总编剧复述确认卡（可在此拍板开始，也可切换四项流程或继续打字聊）
                    <small>★ 推荐先采纳上方合适的建议，再点击「对，开始」</small>
                  </div>
                </div>
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
                          : '待确认'
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
                <div className="decision-actions">
                  <button className="primary" disabled={busy} onClick={() => mutate('confirm')}>
                    ★ 对，开始下一步
                    <ArrowUpRight size={14} />
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      setText('关于你提的建议，我想调整一下：');
                      composerRef.current?.focus();
                    }}
                  >
                    不对，我补充/聊建议
                  </button>
                </div>
              </div>
            )}

            {active.confirmed && !active.remoteId && (
              <div className="service-card" role="status">
                <Cloud size={20} />
                <div>
                  <strong>
                    {needsEpisode
                      ? '请先在上方补齐或核对素材集号'
                      : !serviceReady
                      ? '复述与建议已确认，可随时继续跟总编剧聊细节'
                      : requiresTotalBeforeConnect && active.total === null
                      ? '请在下方聊天框告诉我全剧集数'
                      : active.kind === 'original'
                      ? '可以启动原创前四层推理了'
                      : active.kind === 'transcribe'
                      ? '素材集号已核对，可以启动扒剧流程了'
                      : '可以派给原稿分析师开始分析了'}
                  </strong>
                  <p>
                    {needsEpisode
                      ? '在上方卡片中补录未识别集号或修正超出总集数的文件后，即可启动流程。'
                      : !serviceReady
                      ? '你在聊天框发的任何想法，总编剧都会继续给你出落地建议并记入右侧台账；接入生成服务后即可一键派活。'
                      : requiresTotalBeforeConnect && active.total === null
                      ? '直接发一句“全剧 62 集”或“全剧 62 集，前 10 集已锁定”即可。'
                      : '点击右侧按钮同步材料、锁定范围与要求台账，进入下一阶段拍板卡。'}
                  </p>
                </div>
                {canConnect && (
                  <button className="primary" disabled={busy} onClick={() => mutate('connect')}>
                    {active.kind === 'original' ? '★ 开始推理' : '★ 开始分析'}
                  </button>
                )}
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
                    {currentCard.title}
                    <small>★ 为推荐项（排首位），每步均支持点选或自由打字输入；未答卡时下方聊天框仍可正常发消息</small>
                  </div>
                </div>
                <div className="card-fields">
                  {currentCard.fields.map((field: string) => {
                    const presets = fieldPresets[field];
                    return (
                      <label key={field}>
                        {fieldLabels[field] || field}
                        {field === 'mode' ? (
                          <select
                            value={answers[field] || ''}
                            onChange={(e) => setAnswers({ ...answers, [field]: e.target.value })}
                          >
                            <option value="">请选择扒剧模式（无默认值，必选）</option>
                            <option value="fast">快速模式（按整集看写并抽查几集）</option>
                            <option value="detailed">详细模式（按每秒一帧逐格看完再写）</option>
                          </select>
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
                    补充或修改意见
                    <textarea
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      placeholder="如有需要调整的地方请写在这里…"
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
                    提示：扒剧每部剧均需明确选择「快速模式」或「详细模式」，不设默认项。
                  </p>
                )}

                <div className="decision-actions">
                  <button
                    disabled={busy || requiresUnderstoodGate || requiresModeSelection}
                    className="primary"
                    onClick={() => act('confirm', feedback ? { resolution: feedback } : {})}
                  >
                    ★ 确认，继续下一步
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

            {running && (
              <div className="progress-card" role="status">
                <LoaderCircle className="spin" size={18} />
                <div>
                  <strong>{active.remote?.stage?.title || '正在执行任务'}</strong>
                  <p>
                    已完成 {active.remote?.progress?.completed_steps ?? 0} /{' '}
                    {active.remote?.progress?.total_steps ?? 1} 个步骤 ·{' '}
                    {active.remote?.progress?.eta ? `预计剩余 ${active.remote.progress.eta}` : '暂无可靠预计时间（实时刷新中）'}
                  </p>
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

            {(active.remote?.stage?.key === 'delivery' || state === 'delivered' || active.confirmed) && (
              <div className="delivery-block">
                <a className="download-card" href={'/api/upload?id=' + active.id + '&export=1'}>
                  <span>
                    <FileText size={25} />
                  </span>
                  <div>
                    <strong>
                      {active.title} · {active.kind === 'transcribe' ? '扒剧繁简双版与还原稿' : '完整剧本交付包'}
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
                  : '像在 Grok Bot 一样直接打字聊脑洞/交任务（无需先选流程），总编剧会先给建议再帮你建档…'
              }
              rows={2}
            />
            <div className="composer-bottom">
              <div>
                <button
                  title="上传材料（支持 DOCX、XLSX、MP4、ZIP、图片、TXT、MD）"
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
        accept=".docx,.xlsx,.mp4,.zip,.png,.jpg,.jpeg,.webp,.txt,.md"
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
                <h2>和总编剧一起写故事（Grok Bot 协作模式）</h2>
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
                  <span>GPT 真实流程测试通道</span>
                  <strong className={gptTest ? 'green-text' : ''}>{gptTest ? '已配置密钥（可用）' : '未配置环境变量密钥'}</strong>
                </div>
                <p className="settings-note">
                  {connected
                    ? '生产创作后端已连接。确认方向后，可在项目中同步材料与锁定范围，按停点推进四类流程。'
                    : gptTest
                    ? '当前已检测到 GPT 测试密钥，可进行真实模型复述、提建议与卡片流转测试（界面明确区分测试通道与多角色生产后端）。'
                    : '工作台已启用 Grok Bot 式对话参谋、四类流程分流、锁集续写识别与要求台账。接入 STUDIO_BACKEND_URL 或配置 OPENAI_API_KEY 后即可开启后台生成。'}
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
                      placeholder="输入如 AYIN-KEY-W01-9921 或 AYIN-INV-2026-TEAM01"
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
                        placeholder="如：ayin 或 writer01"
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
                        placeholder="如：AYIN-INV-2026-TEAM01"
                      />
                    </label>
                    <label>
                      设置你的登录账号 (Username)
                      <input
                        value={authUserInput}
                        onChange={(e) => setAuthUserInput(e.target.value)}
                        placeholder="如：writer05"
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

                <div className="preset-chips" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="preset-chip"
                    onClick={() => {
                      setAuthMode('key');
                      setAuthKeyInput('AYIN-ADMIN-8888-KEY');
                    }}
                  >
                    填入管理员Key (ayin)
                  </button>
                  <button
                    type="button"
                    className="preset-chip"
                    onClick={() => {
                      setAuthMode('key');
                      setAuthKeyInput('AYIN-KEY-W01-9921');
                    }}
                  >
                    填入编剧A组Key (writer01)
                  </button>
                  <button
                    type="button"
                    className="preset-chip"
                    onClick={() => {
                      setAuthMode('key');
                      setAuthKeyInput('AYIN-INV-2026-TEAM01');
                    }}
                  >
                    填入团队邀请码
                  </button>
                </div>
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
