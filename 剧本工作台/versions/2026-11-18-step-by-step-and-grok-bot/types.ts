export type Kind = 'foreign' | 'domestic' | 'transcribe' | 'original';

export type AttachmentRole = 'source' | 'locked' | 'setting' | 'reference';

export interface FlowOption {
  kind: Kind;
  title: string;
  description: string;
  tag: string;
}

export const flows: FlowOption[] = [
  {
    kind: 'foreign',
    title: '国外迭代国外',
    description: '上传海外原稿与锁定集，完成原稿分析、四项配置、主线细纲与双语交付。',
    tag: '迭代改编 · 支持锁集续写',
  },
  {
    kind: 'domestic',
    title: '国内迭代国外',
    description: '在迭代流程上增加桥段出海四级诊断、世界观/人设/替换三道门与美式幽默精修。',
    tag: '跨文化出海 · 三道门把关',
  },
  {
    kind: 'transcribe',
    title: '扒剧',
    description: '导入短剧视频或导出表，核对集号并选择快速或详细模式，产出繁简双版 Word。',
    tag: '视频还原 · 可转迭代',
  },
  {
    kind: 'original',
    title: '原创',
    description: '从一句话脑洞出发，经前四层推理与停点 A 拍板，推进设定集、分批细纲与正文。',
    tag: '脑洞起盘 · 停点 A 决策',
  },
];

export interface CardOption {
  value: string;
  label: string;
  recommended?: boolean;
  reason?: string;
}

export interface CardQuestion {
  key?: string;
  question: string;
  options?: CardOption[];
  recommended?: string;
  basis?: string;
}

export interface WorkflowCard {
  id: string;
  step: string;
  title: string;
  subtitle?: string;
  assignee?: string;
  reviewer?: string;
  fields: string[];
  fieldOptions?: Record<string, CardOption[]>;
  questions?: CardQuestion[];
  actions?: { key: string; label: string; primary?: boolean; requiresUnderstood?: boolean }[];
  version?: number;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type?: string;
  role?: AttachmentRole;
  episode?: number;
  durationSec?: number;
  uploadedAt?: string;
}

export interface RequirementEntry {
  id: string;
  text: string;
  time: string;
  scope: string;
  effectiveFrom: string;
  version: number;
}

export interface StudioMessage {
  id: string;
  role: 'user' | 'director' | 'report' | 'progress' | 'file';
  speaker?: string;
  text: string;
  time: string;
  client_id?: string;
  stageKey?: string;
  file?: {
    id?: string;
    name: string;
    url: string;
    description?: string;
    version?: number;
  };
  progress?: {
    stage: string;
    completed: number;
    total: number;
    eta?: string | null;
  };
}

export interface StageOutput {
  title: string;
  summary?: string[];
  content: string;
  updatedAt: string;
  version: number;
}

export interface RemoteState {
  id: string;
  version: number;
  status: 'idle' | 'waiting_confirm' | 'running' | 'ready' | 'paused' | 'failed' | 'delivered';
  mode?: 'remote' | 'gpt_test' | 'local';
  cursor: number;
  stage: {
    key: string;
    title: string;
    stopLabel?: string;
    assignee?: string;
    reviewer?: string;
  };
  progress: {
    completed_steps: number;
    total_steps: number;
    current_episode?: number | null;
    eta?: string | null;
    waiting_for?: string;
  };
  card: WorkflowCard | null;
  outputs: Record<string, StageOutput>;
  messages: StudioMessage[];
  stopsReleased?: boolean;
  transcribeMode?: 'fast' | 'detailed' | null;
  budget?: {
    cap: number;
    used: number;
    reserved: number;
  };
}

export interface Project {
  id: string;
  title: string;
  kind: Kind;
  total: number | null;
  lockedEpisodes?: number | null;
  startEpisode?: number | null;
  brief: string;
  messages: StudioMessage[];
  attachments: Attachment[];
  requirements: (string | RequirementEntry)[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
  confirmed: boolean;
  transcribeMode?: 'fast' | 'detailed' | null;
  stopsReleased?: boolean;
  budgetCap?: number;
  budgetUsed?: number;
  processedActionIds?: string[];
  processedClientIds?: string[];
  remoteId?: string;
  remote?: RemoteState;
}
