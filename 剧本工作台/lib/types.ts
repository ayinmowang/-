export type Kind = 'foreign' | 'domestic' | 'transcribe' | 'original';

export type AttachmentRole = 'source' | 'locked' | 'setting' | 'reference';

export type AccountRole = 'admin' | 'creator' | 'reviewer';

export type StationRoleKey = 'director' | 'analyst' | 'vision' | 'planner' | 'writer' | 'polisher';

export type PromptSlotKey = 'primary' | 'secondary';

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ExecutionMode = 'auto' | 'plan';

export interface SkillPluginRecord {
  id: string;
  kind: Kind; // 'foreign' | 'domestic' | 'transcribe' | 'original'
  slot: PromptSlotKey; // 'transcribe' allows ONLY 'primary'
  name: string;
  description: string; // short creator-visible description (<= 120 chars recommended)
  content: string; // raw .md / .txt text (ADMIN + SERVER ONLY — NEVER sent to creator)
  fileName: string; // ADMIN ONLY
  fileExt: 'md' | 'txt';
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorPromptSummary {
  id: string;
  kind: Kind;
  slot: PromptSlotKey;
  name: string;
  description: string;
  isDefault: boolean;
}

export type PromptSlotSelection = {
  primary?: string; // plugin id or '' / undefined for default/fallback
  secondary?: string; // only valid when kind !== 'transcribe'
};

export type ProjectPromptSelections = Partial<Record<Kind, PromptSlotSelection>>;

export type CreatorPromptCatalog = Record<
  Kind,
  {
    primary: CreatorPromptSummary[];
    secondary?: CreatorPromptSummary[];
  }
>;

export interface CreationTierConfig {
  id: string;
  name: string;
  badge: string;
  description: string;
  costHint: string;
  station: StationRoleKey;
  providerId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  supportsThinking: boolean;
  enabled: boolean;
  isDefault: boolean;
  order: number;
}

export interface CreatorTierSummary {
  id: string;
  name: string;
  badge: string;
  description: string;
  costHint: string;
  supportsThinking: boolean;
  isDefault: boolean;
}

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
  mode?: 'remote' | 'test_channel' | 'local';
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

export interface StudioVolume {
  id: string;
  title: string;
  order: number;
}

export interface StudioEpisodeSnapshot {
  id: string;
  at: string;
  body: string;
  wordCount?: number;
  note?: string;
}

export interface StudioEpisode {
  id: string;
  volumeId?: string;
  episodeNumber: number;
  title: string;
  body: string;
  locked: boolean;
  updatedAt: string;
  snapshots?: StudioEpisodeSnapshot[];
}

export interface StudioAssetNode {
  id: string;
  title: string;
  category?: string;
  parentId?: string;
  order?: number;
  summary?: string;
  body: string;
  tags?: string[];
  meta?: Record<string, string>;
  updatedAt: string;
}

export interface Project {
  id: string;
  owner?: string;
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
  promptSelections?: ProjectPromptSelections;
  volumes?: StudioVolume[];
  episodes?: StudioEpisode[];
  outlineNodes?: StudioAssetNode[];
  characterNodes?: StudioAssetNode[];
  worldNodes?: StudioAssetNode[];
  projectRules?: string;
  preferredTierId?: string;
  thinkingLevel?: ThinkingLevel;
  executionMode?: ExecutionMode;
}

/**
 * Multi-Account & Exclusive Access Key / Invite Code Management Types
 */
export interface StudioAccount {
  id: string;
  username: string;
  displayName: string;
  role: AccountRole;
  password: string;
  accessKey: string; // Exclusive Key generated by Admin for 1-click key login
  status: 'active' | 'disabled';
  budgetCapUsd: number;
  budgetUsedUsd: number;
  tokensUsed: number;
  allowedFlows: Kind[];
  note: string;
  createdAt: string;
  lastLoginAt?: string;
  globalRules?: string;
  themePreference?: 'light' | 'dark';
}

export interface InviteKeyRecord {
  id: string;
  code: string; // e.g. AYIN-INV-8821-XK9
  role: AccountRole;
  budgetCapUsd: number;
  allowedFlows: Kind[];
  maxUses: number;
  usedCount: number;
  boundAccountIds: string[];
  boundUsernames: string[];
  note: string;
  status: 'active' | 'exhausted' | 'revoked';
  createdAt: string;
  createdBy: string;
}

export interface ApiProviderConfig {
  id: string;
  name: string;
  vendor: 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'openrouter' | 'grok' | 'custom';
  baseUrl: string; // 1. 主中转接口地址
  backupBaseUrl1?: string; // 2. 备用中转接口地址 1
  backupBaseUrl2?: string; // 3. 备用中转接口地址 2
  apiKeys: string[]; // Multiple keys for rotation & failover
  models: string[];
  enabled: boolean;
  priority: number;
  keyCursor?: number;
  lastTestStatus?: 'ok' | 'error' | 'untested';
  lastLatencyMs?: number;
  lastTestedAt?: string;
  lastErrorMsg?: string;
  note?: string;
}

export interface StationRouteConfig {
  roleKey: StationRoleKey;
  title: string;
  badge: string;
  description: string;
  primaryProviderId: string;
  primaryModel: string;
  fallbackProviderId: string;
  fallbackModel: string;
  fallbackProvider2Id?: string;
  fallbackModel2?: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  enabled: boolean;
}

export interface ApiAuditLog {
  id: string;
  time: string;
  accountId: string;
  username: string;
  projectId?: string;
  station: StationRoleKey;
  stationTitle: string;
  providerId: string;
  providerName: string;
  model: string;
  latencyMs: number;
  tokens: number;
  estimatedCostUsd: number;
  status: 'success' | 'fallback' | 'failed';
  error?: string;
  tierId?: string;
  tierName?: string;
}

export interface AdminSystemConfig {
  mode: 'direct_llm' | 'custom_backend' | 'hybrid';
  backendUrl: string;
  backendToken: string;
  requireAuthOnFrontend: boolean;
  allowInviteRegistration: boolean;
  globalBudgetCapUsd: number;
  providers: ApiProviderConfig[];
  routes: Record<StationRoleKey, StationRouteConfig>;
  skillPlugins?: SkillPluginRecord[];
  creationTiers?: CreationTierConfig[];
}

export interface PublicAccountProfile {
  id: string;
  username: string;
  displayName: string;
  role: AccountRole;
  budgetCapUsd: number;
  budgetUsedUsd: number;
  allowedFlows: Kind[];
  accessKeyMasked: string;
  globalRules?: string;
  themePreference?: 'light' | 'dark';
}

/**
 * Commercialization Types (Plans, Orders, Subscriptions)
 */
export type CommercePlanKind = 'subscription' | 'topup';

export type CommercePlanPeriod = 'monthly' | 'yearly' | 'once';

export type CommerceOrderStatus = 'pending' | 'paid' | 'cancelled';

export type CommerceSubscriptionStatus = 'active' | 'cancelled' | 'expired';

export interface CommercePlan {
  id: string;
  name: string;
  description: string;
  kind: CommercePlanKind;
  period: CommercePlanPeriod;
  priceUsd: number;
  creditUsd: number;
  paymentChannelSlot?: string;
  enabled: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorPlanSummary {
  id: string;
  name: string;
  description: string;
  kind: CommercePlanKind;
  period: CommercePlanPeriod;
  priceUsd: number;
  creditUsd: number;
  paymentChannelSlot?: string;
  order: number;
}

export interface CommerceOrder {
  id: string;
  accountId: string;
  planId: string;
  planName: string;
  kind: CommercePlanKind;
  period: CommercePlanPeriod;
  status: CommerceOrderStatus;
  priceUsd: number;
  creditUsd: number;
  paymentChannel: string;
  createdAt: string;
  paidAt?: string;
  cancelledAt?: string;
  confirmedByAccountId?: string;
  idempotencyKey?: string;
}

export interface CommerceSubscription {
  id: string;
  accountId: string;
  planId: string;
  planName: string;
  status: CommerceSubscriptionStatus;
  period: CommercePlanPeriod;
  creditUsd: number;
  startedAt: string;
  currentPeriodEnd?: string;
  cancelledAt?: string;
  renewEnabled: boolean;
  orderId?: string;
}