'use client';

import React, { useEffect, useRef, useState } from 'react';
import type {
  AccountRole,
  AdminSystemConfig,
  ApiAuditLog,
  ApiProviderConfig,
  InviteKeyRecord,
  Kind,
  PromptSlotKey,
  SkillPluginRecord,
  StationRoleKey,
  StationRouteConfig,
  StudioAccount,
} from '../../lib/types';

interface AccountWithStats extends StudioAccount {
  projectCount?: number;
}

const ROLE_LABELS: Record<AccountRole, { label: string; color: string }> = {
  admin: { label: '🛡️ 管理员 (Admin)', color: '#ff9f0a' },
  creator: { label: '✒️ 编剧创作者 (Creator)', color: '#0a84ff' },
  reviewer: { label: '🔍 审稿验收人 (Reviewer)', color: '#30d158' },
};

const STATION_ORDER: StationRoleKey[] = ['director', 'analyst', 'vision', 'planner', 'writer', 'polisher'];

const WORKFLOW_SKILL_META: {
  kind: Kind;
  title: string;
  badge: string;
  slots: { slot: PromptSlotKey; label: string; hint: string }[];
}[] = [
  {
    kind: 'transcribe',
    title: '扒剧 (transcribe)',
    badge: '1 个提示词槽位',
    slots: [
      {
        slot: 'primary',
        label: '主提示词槽位（唯一）',
        hint: '仅支持 1 个 .md/.txt 槽位；未配置、已停用或创作者未选定且无默认时，自动回退系统内置扒剧规则',
      },
    ],
  },
  {
    kind: 'domestic',
    title: '国内迭代国外 (domestic)',
    badge: '主 / 副 2 个槽位',
    slots: [
      {
        slot: 'primary',
        label: '主提示词槽位 (Primary)',
        hint: '主流程与三道门规范；未配置默认或停用时自动回退系统内置规则',
      },
      {
        slot: 'secondary',
        label: '副提示词槽位 (Secondary)',
        hint: '北美精修/美式幽默/专项补充约束；可选，未配置时仅用主规则',
      },
    ],
  },
  {
    kind: 'foreign',
    title: '国外迭代国外 (foreign)',
    badge: '主 / 副 2 个槽位',
    slots: [
      {
        slot: 'primary',
        label: '主提示词槽位 (Primary)',
        hint: '原稿分析、对位与主线规范；未配置默认或停用时自动回退系统内置规则',
      },
      {
        slot: 'secondary',
        label: '副提示词槽位 (Secondary)',
        hint: '锁集衔接/节奏/文风补充规则；可选',
      },
    ],
  },
  {
    kind: 'original',
    title: '原创 (original)',
    badge: '主 / 副 2 个槽位',
    slots: [
      {
        slot: 'primary',
        label: '主提示词槽位 (Primary)',
        hint: '前四层推理、停点 A 与世界观规范；未配置默认或停用时自动回退系统内置规则',
      },
      {
        slot: 'secondary',
        label: '副提示词槽位 (Secondary)',
        hint: '付费卡点、爽点或对白质感补充规则；可选',
      },
    ],
  },
];

export default function AdminConsolePage() {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'accounts' | 'providers' | 'routes' | 'skills' | 'monitor' | 'tiers' | 'plans' | 'orders'
  >('accounts');
  const [plansList, setPlansList] = useState<any[]>([]);
  const [ordersList, setOrdersList] = useState<any[]>([]);
  const [subscriptionsList, setSubscriptionsList] = useState<any[]>([]);
  const [planForm, setPlanForm] = useState({
    id: '',
    planName: '',
    priceUsd: '',
    creditUsd: '',
    period: 'monthly',
    status: 'active',
    description: '',
  });
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingMsg, setBillingMsg] = useState('');
  const [billingErr, setBillingErr] = useState('');  const [toast, setToast] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Admin Login Gate state
  const [loginMode, setLoginMode] = useState<'key' | 'password'>('key');
  const [loginKey, setLoginKey] = useState('');
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');

  // Admin Snapshot state
  const [adminProfile, setAdminProfile] = useState<any>(null);
  const [accounts, setAccounts] = useState<AccountWithStats[]>([]);
  const [invites, setInvites] = useState<InviteKeyRecord[]>([]);
  const [systemConfig, setSystemConfig] = useState<AdminSystemConfig | null>(null);
  const [projectsSummary, setProjectsSummary] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<ApiAuditLog[]>([]);

  // Create Account Form state
  const [newAccUser, setNewAccUser] = useState('');
  const [newAccName, setNewAccName] = useState('');
  const [newAccPass, setNewAccPass] = useState('');
  const [newAccRole, setNewAccRole] = useState<AccountRole>('creator');
  const [newAccBudget, setNewAccBudget] = useState('15');
  const [newAccNote, setNewAccNote] = useState('');

  // Generate Invite Keys Form state
  const [invCount, setInvCount] = useState('1');
  const [invRole, setInvRole] = useState<AccountRole>('creator');
  const [invBudget, setInvBudget] = useState('15');
  const [invMaxUses, setInvMaxUses] = useState('1');
  const [invPrefix, setInvPrefix] = useState('AYIN-INV');
  const [invNote, setInvNote] = useState('编剧组专属邀请码');

  // Provider test & Station test feedbacks
  const [providerTestMsg, setProviderTestMsg] = useState<Record<string, string>>({});
  const [stationTestMsg, setStationTestMsg] = useState<Record<string, string>>({});
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [selectedFamilies, setSelectedFamilies] = useState<Record<string, { gemini: boolean; gpt: boolean }>>({});
  const [discoveredCatalog, setDiscoveredCatalog] = useState<
    Record<string, { geminiModels: string[]; gptModels: string[]; keySupportedModels: string[] }>
  >({});
  const [editingPassId, setEditingPassId] = useState<string | null>(null);
  const [editingPassVal, setEditingPassVal] = useState('');

  // Skill Plugin (Prompt) Management state
  const [skillFilterKind, setSkillFilterKind] = useState<'all' | Kind>('all');
  const [skillKind, setSkillKind] = useState<Kind>('foreign');
  const [skillSlot, setSkillSlot] = useState<PromptSlotKey>('primary');
  const [skillName, setSkillName] = useState('');
  const [skillDesc, setSkillDesc] = useState('');
  const [skillFile, setSkillFile] = useState<File | null>(null);
  const [skillFileName, setSkillFileName] = useState('');
  const [skillContent, setSkillContent] = useState('');
  const [skillIsDefault, setSkillIsDefault] = useState(false);
  const skillFileInputRef = useRef<HTMLInputElement>(null);

  // Inline replace / edit / preview state
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [editSkillName, setEditSkillName] = useState('');
  const [editSkillDesc, setEditSkillDesc] = useState('');
  const [editSkillFile, setEditSkillFile] = useState<File | null>(null);
  const [editSkillFileName, setEditSkillFileName] = useState('');
  const [editSkillContent, setEditSkillContent] = useState('');
  const [previewSkillId, setPreviewSkillId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3800);
  };

  async function fetchAdminSnapshot() {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/admin');
      const data = await res.json();
      if (!res.ok || !data.authorized) {
        setAuthorized(false);
        return;
      }
      applySnapshot(data);
      setAuthorized(true);
    } catch (e: any) {
      setErrorMsg(e?.message || '加载后台数据失败');
    } finally {
      setLoading(false);
    }
  }

  function applySnapshot(data: any) {
    if (data.adminAccount) setAdminProfile(data.adminAccount);
    if (Array.isArray(data.accounts)) setAccounts(data.accounts);
    if (Array.isArray(data.invites)) setInvites(data.invites);
    if (data.systemConfig) setSystemConfig(data.systemConfig);
    if (Array.isArray(data.projectsSummary)) setProjectsSummary(data.projectsSummary);
    if (Array.isArray(data.auditLogs)) setAuditLogs(data.auditLogs);
    if (Array.isArray(data.plans)) setPlansList(data.plans);
    if (Array.isArray(data.orders)) setOrdersList(data.orders);
    if (Array.isArray(data.subscriptions)) setSubscriptionsList(data.subscriptions);
  }

  async function handleSavePlan(e: React.FormEvent) {
    e.preventDefault();
    setBillingErr('');
    setBillingMsg('');
    const priceNum = Number(planForm.priceUsd);
    const creditNum = Number(planForm.creditUsd);
    if (!planForm.planName.trim()) {
      setBillingErr('请填写套餐名称（planName）');
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setBillingErr('套餐价格（priceUsd）必须为大于 0 的正数');
      return;
    }
    if (!Number.isFinite(creditNum) || creditNum <= 0) {
      setBillingErr('包含额度（creditUsd）必须为大于 0 的正数');
      return;
    }
    setBillingBusy(true);
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'save_plans',
          plan: {
            id: planForm.id || undefined,
            name: planForm.planName.trim(),
            kind: planForm.period === 'once' ? 'topup' : 'subscription',
            period: planForm.period,
            priceUsd: priceNum,
            creditUsd: creditNum,
            enabled: planForm.status !== 'disabled' && planForm.status !== 'inactive',            description: planForm.description.trim(),
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || json.error || '保存套餐失败');
      }
      setBillingMsg(`套餐「${planForm.planName.trim()}」已保存`);
      setPlanForm({
        id: '',
        planName: '',
        priceUsd: '',
        creditUsd: '',
        period: 'monthly',
        status: 'active',
        description: '',
      });
      await fetchAdminSnapshot();
    } catch (err: any) {
      setBillingErr(err.message || '保存失败');
    } finally {
      setBillingBusy(false);
    }
  }

  async function handleConfirmOrder(order: any) {
    setBillingErr('');
    setBillingMsg('');
    if (!order || !order.id) return;
    if (order.status !== 'pending') {
      setBillingMsg(`订单 ${order.id} 已入账或非待审核状态，无需重复确认`);
      return;
    }
    setBillingBusy(true);
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'confirm_order',
          orderId: order.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || json.error || '确认入账失败');
      }
      setBillingMsg(`订单 ${order.id} 已确认入账，额度与订阅周期已生效`);
      await fetchAdminSnapshot();

    } catch (err: any) {
      setBillingErr(err.message || '确认入账失败');
    } finally {
      setBillingBusy(false);
    }
  }
  useEffect(() => {
    fetchAdminSnapshot();
  }, []);

  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrorMsg('');
    try {
      const payload =
        loginMode === 'key'
          ? { action: 'login_key', key: loginKey.trim() }
          : { action: 'login_password', username: loginUser.trim(), password: loginPass };
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error === 'INVALID_CREDENTIALS' ? '账号密码或密钥不正确' : data.error || '登录失败');
      }
      if (data.account?.role !== 'admin') {
        throw new Error('该账号不是管理员（admin）角色，无法进入 /admin 后台');
      }
      await fetchAdminSnapshot();
      showToast(`欢迎回来，${data.account.displayName}`);
    } catch (err: any) {
      setErrorMsg(err.message || '登录失败');
    } finally {
      setBusy(false);
    }
  }

  async function adminAction(operation: string, payload: any = {}, successToast?: string) {
    setBusy(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error === 'USERNAME_EXISTS'
            ? '该用户名已存在，请换一个用户名'
            : data.error === 'SLOT_NOT_ALLOWED'
            ? '该流程不允许配置此槽位（扒剧仅支持 1 个主槽位）'
            : data.error === 'EMPTY_PLUGIN_CONTENT'
            ? '提示词正文不能为空，请上传 .md/.txt 文件或输入内容'
            : data.error === 'BINARY_CONTENT_REJECTED'
            ? '检测到二进制或非有效 UTF-8 文本内容，请上传纯文本 .md 或 .txt 文件'
            : data.error === 'INVALID_PLUGIN_FILE_TYPE'
            ? '仅支持上传 .md 或 .txt 格式的提示词插件文件'
            : data.error || '操作未成功'
        );
      }
      applySnapshot(data);
      if (successToast) showToast(successToast);
      return data;
    } catch (err: any) {
      setErrorMsg(err.message || '请求失败');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function adminFormAction(formData: FormData, successToast?: string) {
    setBusy(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error === 'FILE_TOO_LARGE'
            ? '提示词文件体积过大，请控制在限制范围内'
            : data.error === 'SLOT_NOT_ALLOWED'
            ? '该流程不允许配置此槽位（扒剧仅支持 1 个主槽位）'
            : data.error === 'BINARY_CONTENT_REJECTED'
            ? '检测到二进制或非有效 UTF-8 文本内容，请上传纯文本 .md 或 .txt 文件'
            : data.error === 'INVALID_PLUGIN_FILE_TYPE'
            ? '仅支持上传 .md 或 .txt 格式的提示词插件文件'
            : data.error === 'INVALID_INPUT' || data.error === 'EMPTY_PLUGIN_CONTENT'
            ? '请确认上传有效 UTF-8 编码的 .md 或 .txt 文本文件（不可为空或二进制文件），且槽位符合流程规范'
            : data.error || '上传操作未成功'
        );
      }
      applySnapshot(data);
      if (successToast) showToast(successToast);
      return data;
    } catch (err: any) {
      setErrorMsg(err.message || '请求失败');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadSkillPlugin(e: React.FormEvent) {
    e.preventDefault();
    const effectiveSlot: PromptSlotKey = skillKind === 'transcribe' ? 'primary' : skillSlot;
    if (!skillName.trim()) {
      setErrorMsg('请填写提示词名称');
      return;
    }
    if (!skillFile && !skillContent.trim()) {
      setErrorMsg('请选择 .md/.txt 文件，或直接粘贴提示词正文');
      return;
    }

    let data: any = null;
    if (skillFile) {
      const fd = new FormData();
      fd.append('operation', 'upload_skill_plugin');
      fd.append('kind', skillKind);
      fd.append('slot', effectiveSlot);
      fd.append('name', skillName.trim());
      fd.append('description', skillDesc.trim());
      fd.append('isDefault', String(skillIsDefault));
      fd.append('file', skillFile);
      data = await adminFormAction(fd, `✓ 已上传提示词插件「${skillName.trim()}」`);
    } else {
      const safeName = skillFileName.trim() || `${skillKind}-${effectiveSlot}.md`;
      const normalizedFileName = /\.(md|txt)$/i.test(safeName) ? safeName : `${safeName}.md`;
      data = await adminAction(
        'upload_skill_plugin',
        {
          kind: skillKind,
          slot: effectiveSlot,
          name: skillName.trim(),
          description: skillDesc.trim(),
          fileName: normalizedFileName,
          content: skillContent,
          isDefault: skillIsDefault,
        },
        `✓ 已保存提示词插件「${skillName.trim()}」`
      );
    }

    if (data) {
      setSkillName('');
      setSkillDesc('');
      setSkillFile(null);
      setSkillFileName('');
      setSkillContent('');
      setSkillIsDefault(false);
      if (skillFileInputRef.current) skillFileInputRef.current.value = '';
    }
  }

  function startEditSkill(plugin: SkillPluginRecord) {
    setEditingSkillId(plugin.id);
    setEditSkillName(plugin.name);
    setEditSkillDesc(plugin.description || '');
    setEditSkillFile(null);
    setEditSkillFileName(plugin.fileName);
    setEditSkillContent(plugin.content);
  }

  async function handleReplaceSkillPlugin(pluginId: string) {
    if (!editSkillName.trim()) {
      setErrorMsg('提示词名称不能为空');
      return;
    }
    if (!editSkillFile && !editSkillContent.trim()) {
      setErrorMsg('请上传替换的 .md/.txt 文件或保留有效正文内容');
      return;
    }
    let data: any = null;
    if (editSkillFile) {
      const fd = new FormData();
      fd.append('operation', 'replace_skill_plugin');
      fd.append('id', pluginId);
      fd.append('name', editSkillName.trim());
      fd.append('description', editSkillDesc.trim());
      fd.append('file', editSkillFile);
      data = await adminFormAction(fd, `✓ 已替换更新提示词「${editSkillName.trim()}」`);
    } else {
      data = await adminAction(
        'replace_skill_plugin',
        {
          id: pluginId,
          name: editSkillName.trim(),
          description: editSkillDesc.trim(),
          fileName: editSkillFileName.trim() || undefined,
          content: editSkillContent,
        },
        `✓ 已更新提示词「${editSkillName.trim()}」`
      );
    }
    if (data) {
      setEditingSkillId(null);
      setEditSkillFile(null);
    }
  }

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!newAccUser.trim() || !newAccPass.trim()) {
      setErrorMsg('请填写用户名和初始密码');
      return;
    }
    const data = await adminAction(
      'create_account',
      {
        username: newAccUser.trim(),
        displayName: newAccName.trim() || newAccUser.trim(),
        password: newAccPass.trim(),
        role: newAccRole,
        budgetCapUsd: Number(newAccBudget || 15),
        note: newAccNote.trim(),
      },
      `✓ 已创建账号「${newAccUser.trim()}」并生成专属 Key`
    );
    if (data) {
      setNewAccUser('');
      setNewAccName('');
      setNewAccNote('');
    }
  }

  async function handleGenerateInvites(e: React.FormEvent) {
    e.preventDefault();
    await adminAction(
      'generate_invites',
      {
        count: Number(invCount || 1),
        role: invRole,
        budgetCapUsd: Number(invBudget || 15),
        maxUses: Number(invMaxUses || 1),
        prefix: invPrefix.trim() || 'AYIN-INV',
        note: invNote.trim(),
      },
      `✓ 已生成 ${invCount} 个专属邀请码/Key`
    );
  }

  function copyText(text: string, label: string) {
    navigator.clipboard?.writeText(text);
    showToast(`📋 已复制：${label}`);
  }

  function copyAccountCard(acc: AccountWithStats) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const cardText = [
      `【剧本工作台 · 团队成员登录凭证】`,
      `入口网址：${origin}/`,
      `成员名称：${acc.displayName} (${ROLE_LABELS[acc.role]?.label || acc.role})`,
      `--------------------------------`,
      `方式一（专属 Key 一键登录）：${acc.accessKey}`,
      `方式二（账号 + 密码登录）：账号 ${acc.username} ｜ 密码请由管理员私信告知（或在后台点「改密」重置）`,
      `可用额度上限：$${acc.budgetCapUsd.toFixed(2)}`,
    ].join('\n');
    copyText(cardText, `「${acc.displayName}」完整登录卡（含专属Key+账号密码）`);
  }

  function copyInviteCard(inv: InviteKeyRecord) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const cardText = [
      `【剧本工作台 · 专属邀请码/Key】`,
      `入口网址：${origin}/`,
      `专属邀请码/Key：${inv.code}`,
      `分配角色：${ROLE_LABELS[inv.role]?.label || inv.role}（初始额度 $${inv.budgetCapUsd.toFixed(2)}）`,
      `使用说明：打开网页左下角点击「切换账号 / 密钥登录」，可直接输入此邀请码一键登录，或用此邀请码注册绑定你自己的账号和密码。`,
    ].join('\n');
    copyText(cardText, `邀请码 ${inv.code} 分发卡片`);
  }

  function addPresetProvider(preset: 'primary_relay' | 'backup_relay_1' | 'backup_relay_2') {
    if (!systemConfig) return;
    const templates: Record<string, Partial<ApiProviderConfig>> = {
      primary_relay: {
        name: '① 主 API 中转接口 (Primary Relay · GPT / Gemini)',
        vendor: 'custom',
        baseUrl: 'https://your-primary-relay.example.com/v1',
        backupBaseUrl1: 'https://your-backup-relay-1.example.com/v1',
        backupBaseUrl2: 'https://your-backup-relay-2.example.com/v1',
        models: ['gpt-4o', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gpt-4o-mini', 'gpt-4.1'],
        note: '主力中转接口（内置 1主+2备接口地址自动切换与多 Key 轮询，支持 GPT 与 Gemini）',
      },
      backup_relay_1: {
        name: '② 备用 API 中转接口 1 (Backup Relay 1 · Gemini / GPT)',
        vendor: 'custom',
        baseUrl: 'https://your-backup-relay-1.example.com/v1',
        backupBaseUrl1: '',
        backupBaseUrl2: '',
        models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gpt-4o', 'gpt-4o-mini'],
        note: '第一备用中转接口（主接口超时或报错时自动切入）',
      },
      backup_relay_2: {
        name: '③ 备用 API 中转接口 2 (Backup Relay 2 · GPT / Gemini)',
        vendor: 'custom',
        baseUrl: 'https://your-backup-relay-2.example.com/v1',
        backupBaseUrl1: '',
        backupBaseUrl2: '',
        models: ['gpt-4o', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gpt-4o-mini'],
        note: '第二备用中转接口（二级兜底中转站）',
      },
    };
    const tpl = templates[preset];
    const newProv: ApiProviderConfig = {
      id: 'prov-' + Date.now(),
      name: tpl.name || '新 API 中转接口',
      vendor: 'custom',
      baseUrl: tpl.baseUrl || 'https://api.openai.com/v1',
      backupBaseUrl1: tpl.backupBaseUrl1 || '',
      backupBaseUrl2: tpl.backupBaseUrl2 || '',
      apiKeys: [],
      models: tpl.models || ['gpt-4o', 'gemini-2.5-pro'],
      enabled: true,
      priority: systemConfig.providers.length + 1,
      lastTestStatus: 'untested',
      note: tpl.note || '',
    };
    setSystemConfig({
      ...systemConfig,
      providers: [...systemConfig.providers, newProv],
    });
    showToast(`已添加「${newProv.name}」卡片，请填写中转地址与 API Key 后点击保存`);
  }

  function updateLocalProvider(id: string, patch: Partial<ApiProviderConfig>) {
    if (!systemConfig) return;
    setSystemConfig({
      ...systemConfig,
      providers: systemConfig.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  }

  function updateLocalRoute(roleKey: StationRoleKey, patch: Partial<StationRouteConfig>) {
    if (!systemConfig) return;
    setSystemConfig({
      ...systemConfig,
      routes: {
        ...systemConfig.routes,
        [roleKey]: {
          ...systemConfig.routes[roleKey],
          ...patch,
        },
      },
    });
  }

  if (loading) {
    return (
      <main style={styles.shell}>
        <div style={{ maxWidth: 520, margin: '120px auto', textAlign: 'center', color: '#939db0' }}>
          正在验证管理员权限并加载后台配置…
        </div>
      </main>
    );
  }

  if (!authorized) {
    return (
      <main style={styles.shell}>
        <div style={{ maxWidth: 480, margin: '70px auto' }}>
          <section style={styles.card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={styles.badgeIcon}>🛡️</div>
              <div>
                <h1 style={{ margin: 0, fontSize: 19 }}>剧本工作台 · 管理后台登录 (/admin)</h1>
                <small style={{ color: '#939db0', fontSize: 12 }}>
                  多账号分发 · 多渠道 API 池 · 六大编剧工位路由中心
                </small>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button
                type="button"
                onClick={() => setLoginMode('key')}
                style={loginMode === 'key' ? styles.tabActive : styles.tabBtn}
              >
                🔑 管理员专属 Key 登录
              </button>
              <button
                type="button"
                onClick={() => setLoginMode('password')}
                style={loginMode === 'password' ? styles.tabActive : styles.tabBtn}
              >
                👤 管理员账号密码登录
              </button>
            </div>

            {errorMsg && <div style={styles.errorBox}>⚠ {errorMsg}</div>}

            <form onSubmit={handleAdminLogin} style={{ display: 'grid', gap: 14 }}>
              {loginMode === 'key' ? (
                <label style={styles.label}>
                  管理员专属访问密钥 (Access Key)
                  <input
                    style={styles.input}
                    value={loginKey}
                    onChange={(e) => setLoginKey(e.target.value)}
                    placeholder="输入管理员专属访问密钥"
                  />
                </label>
              ) : (
                <>
                  <label style={styles.label}>
                    管理员账号 (Username)
                    <input
                      style={styles.input}
                      value={loginUser}
                      onChange={(e) => setLoginUser(e.target.value)}
                      placeholder="输入管理员账号"
                    />
                  </label>
                  <label style={styles.label}>
                    管理员密码 (Password)
                    <input
                      type="password"
                      style={styles.input}
                      value={loginPass}
                      onChange={(e) => setLoginPass(e.target.value)}
                      placeholder="输入管理员密码"
                    />
                  </label>
                </>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button type="submit" disabled={busy} style={styles.primaryBtn}>
                  {busy ? '正在验证…' : '🛡️ 立即进入管理后台'}
                </button>
              </div>
            </form>

            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#939db0' }}>
              <span>请使用管理员专属 Key 或管理员账号密码登录</span>
              <a href="/" style={{ color: '#7cc0ff', textDecoration: 'none' }}>
                返回创作者前台 (/) ↗
              </a>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const activeProvidersCount = systemConfig?.providers.filter((p) => p.enabled && p.apiKeys.length > 0).length || 0;
  const totalBudgetUsed = accounts.reduce((acc, item) => acc + (item.budgetUsedUsd || 0), 0);
  const allSkillPlugins = systemConfig?.skillPlugins || [];
  const enabledSkillCount = allSkillPlugins.filter((p) => p.enabled).length;

  return (
    <main style={styles.shell}>
      <div style={{ maxWidth: 1240, margin: '0 auto', display: 'grid', gap: 20 }}>
        {/* Top Header */}
        <header style={styles.topbar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={styles.badgeIcon}>🛡️</div>
            <div>
              <h1 style={{ margin: 0, fontSize: 18 }}>
                剧本工作台 · 多账号与 API 路由管理后台 (/admin)
              </h1>
              <small style={{ color: '#939db0', fontSize: 12 }}>
                服务端持久化存储 · 支持管理员分发专属邀请码/Key + 账号密码双登录 · 前台 100% 脱敏隔离
              </small>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: '#30d158', background: 'rgba(48,209,88,0.12)', padding: '6px 12px', borderRadius: 999 }}>
              ● 当前管理员：{adminProfile?.displayName || '管理员'}
            </span>
            <a href="/" style={{ ...styles.secondaryBtn, textDecoration: 'none' }}>
              前往创作者前台 (/) ↗
            </a>
            <button
              type="button"
              style={styles.secondaryBtn}
              onClick={async () => {
                await fetch('/api/auth', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'logout' }),
                });
                setAuthorized(false);
              }}
            >
              退出后台
            </button>
          </div>
        </header>

        {/* KPI Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
          <div style={styles.kpiCard}>
            <span style={{ fontSize: 12, color: '#939db0' }}>团队账号 & 可用邀请码</span>
            <strong style={{ fontSize: 22, display: 'block', margin: '6px 0 2px' }}>
              {accounts.filter((a) => a.status === 'active').length} 个账号 /{' '}
              {invites.filter((i) => i.status === 'active').length} 枚邀请码
            </strong>
            <small style={{ color: '#30d158', fontSize: 11 }}>✓ 支持专属 Key + 账号密码双登录</small>
          </div>
          <div style={styles.kpiCard}>
            <span style={{ fontSize: 12, color: '#939db0' }}>API 渠道池状态</span>
            <strong style={{ fontSize: 22, display: 'block', margin: '6px 0 2px' }}>
              {activeProvidersCount} / {systemConfig?.providers.length || 0} 条已配密钥
            </strong>
            <small style={{ color: activeProvidersCount > 0 ? '#30d158' : '#ff9f0a', fontSize: 11 }}>
              {activeProvidersCount > 0 ? '✓ 支持多 Key 轮询与主备自动切换' : '○ 填入任一渠道 API Key 即可激活动态生成'}
            </small>
          </div>
          <div style={styles.kpiCard}>
            <span style={{ fontSize: 12, color: '#939db0' }}>六大 AI 编剧工位路由</span>
            <strong style={{ fontSize: 22, display: 'block', margin: '6px 0 2px' }}>
              6 / 6 工位已绑定
            </strong>
            <small style={{ color: '#7cc0ff', fontSize: 11 }}>✓ 总编剧/分析/扒剧/策划/分集/精修独立配置</small>
          </div>
          <div style={styles.kpiCard}>
            <span style={{ fontSize: 12, color: '#939db0' }}>全站项目 & 累计用费账本</span>
            <strong style={{ fontSize: 22, display: 'block', margin: '6px 0 2px' }}>
              {projectsSummary.length} 个项目 · ${totalBudgetUsed.toFixed(2)}
            </strong>
            <small style={{ color: '#30d158', fontSize: 11 }}>✓ 前台严格隐藏模型名/Token/Prompt</small>
          </div>
          <div style={styles.kpiCard}>
            <span style={{ fontSize: 12, color: '#939db0' }}>提示词插件库 (Skills)</span>
            <strong style={{ fontSize: 22, display: 'block', margin: '6px 0 2px' }}>
              {enabledSkillCount} / {allSkillPlugins.length} 份已启用
            </strong>
            <small style={{ color: '#7cc0ff', fontSize: 11 }}>
              ✓ 4 流程槽位管理 · 停用/未选自动回退内置规则
            </small>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button
            type="button"
            onClick={() => setActiveTab('accounts')}
            style={activeTab === 'accounts' ? styles.tabActive : styles.tabBtn}
          >
            👥 1. 团队多账号 & 专属邀请码/Key 分发 ({accounts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('providers')}
            style={activeTab === 'providers' ? styles.tabActive : styles.tabBtn}
          >
            🔌 2. API 渠道池 & 多 Key 轮询配置 ({systemConfig?.providers.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('routes')}
            style={activeTab === 'routes' ? styles.tabActive : styles.tabBtn}
          >
            🎭 3. 六大 AI 编剧工位模型路由与 Prompt (6)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('monitor')}
            style={activeTab === 'monitor' ? styles.tabActive : styles.tabBtn}
          >
            📊 4. 全站项目监控、安全策略 & API 审计日志 ({auditLogs.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('skills')}
            style={activeTab === 'skills' ? styles.tabActive : styles.tabBtn}
          >
            🧩 5. 提示词插件 (Skills) ({allSkillPlugins.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('tiers')}
            style={activeTab === 'tiers' ? styles.tabActive : styles.tabBtn}
          >
            🎛️ 6. 创作档位配置 ({systemConfig?.creationTiers?.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('plans')}
            style={activeTab === 'plans' ? styles.tabActive : styles.tabBtn}
          >
            💎 7. 套餐与价格额度 ({plansList.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            style={activeTab === 'orders' ? styles.tabActive : styles.tabBtn}
          >
            🧾 8. 订单审核入账 ({ordersList.filter((o) => o.status === 'pending').length} 待审 / {ordersList.length})
          </button>
        </div>
        {toast && <div style={styles.toastBox}>{toast}</div>}
        {errorMsg && <div style={styles.errorBox}>⚠ {errorMsg}</div>}

        {/* TAB 1: Multi-Account & Exclusive Invite Keys */}
        {activeTab === 'accounts' && (
          <div style={{ display: 'grid', gap: 20 }}>
            {/* Section 1A: Exclusive Invite Code / Key Generator */}
            <section style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div>
                  <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>
                    🔑 方式 A：生成专属邀请码 / Key 分发给团队成员
                  </h2>
                  <p style={{ margin: 0, color: '#939db0', fontSize: 13 }}>
                    管理员在此一键生成专属邀请码/Key。成员拿到后，既可以在前台直接输入该 Key 一键登录，也可以用该邀请码注册并绑定自己的账号密码。
                  </p>
                </div>
              </div>

              <form
                onSubmit={handleGenerateInvites}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
                  gap: 12,
                  background: '#1b202c',
                  padding: 16,
                  borderRadius: 14,
                  marginBottom: 16,
                }}
              >
                <label style={styles.label}>
                  生成数量 (个)
                  <input
                    type="number"
                    min={1}
                    max={20}
                    style={styles.input}
                    value={invCount}
                    onChange={(e) => setInvCount(e.target.value)}
                  />
                </label>
                <label style={styles.label}>
                  分配角色权限
                  <select
                    style={styles.input}
                    value={invRole}
                    onChange={(e) => setInvRole(e.target.value as AccountRole)}
                  >
                    <option value="creator">✒️ 编剧创作者</option>
                    <option value="reviewer">🔍 审稿验收人</option>
                    <option value="admin">🛡️ 管理员</option>
                  </select>
                </label>
                <label style={styles.label}>
                  初始额度上限 ($ USD)
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    style={styles.input}
                    value={invBudget}
                    onChange={(e) => setInvBudget(e.target.value)}
                  />
                </label>
                <label style={styles.label}>
                  每码可用人数 (Max Uses)
                  <input
                    type="number"
                    min={1}
                    max={100}
                    style={styles.input}
                    value={invMaxUses}
                    onChange={(e) => setInvMaxUses(e.target.value)}
                  />
                </label>
                <label style={styles.label}>
                  Key 前缀标识
                  <input
                    style={styles.input}
                    value={invPrefix}
                    onChange={(e) => setInvPrefix(e.target.value)}
                    placeholder="AYIN-INV"
                  />
                </label>
                <label style={styles.label}>
                  用途备注 / 分组名
                  <input
                    style={styles.input}
                    value={invNote}
                    onChange={(e) => setInvNote(e.target.value)}
                    placeholder="如：北美狼人组编剧"
                  />
                </label>
                <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="submit" disabled={busy} style={styles.primaryBtn}>
                    ✨ 立即生成专属邀请码 / Key
                  </button>
                </div>
              </form>

              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>专属邀请码 / Key</th>
                      <th style={styles.th}>角色与额度</th>
                      <th style={styles.th}>已激活次数 / 上限</th>
                      <th style={styles.th}>已绑定成员账号</th>
                      <th style={styles.th}>备注说明</th>
                      <th style={styles.th}>状态</th>
                      <th style={styles.th}>分发与操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((inv) => (
                      <tr key={inv.id}>
                        <td style={styles.td}>
                          <code style={styles.codeBadge}>{inv.code}</code>
                        </td>
                        <td style={styles.td}>
                          <span style={{ color: ROLE_LABELS[inv.role]?.color || '#fff', fontWeight: 600 }}>
                            {ROLE_LABELS[inv.role]?.label || inv.role}
                          </span>
                          <div style={{ fontSize: 11, color: '#939db0' }}>额度：${inv.budgetCapUsd.toFixed(2)}</div>
                        </td>
                        <td style={styles.td}>
                          {inv.usedCount} / {inv.maxUses} 人
                        </td>
                        <td style={styles.td}>
                          {inv.boundUsernames?.length ? inv.boundUsernames.join(', ') : <span style={{ color: '#6e7687' }}>待成员使用</span>}
                        </td>
                        <td style={styles.td}>{inv.note || '-'}</td>
                        <td style={styles.td}>
                          <span
                            style={{
                              padding: '3px 8px',
                              borderRadius: 999,
                              fontSize: 11,
                              background:
                                inv.status === 'active'
                                  ? 'rgba(48,209,88,0.15)'
                                  : inv.status === 'exhausted'
                                  ? 'rgba(255,159,10,0.15)'
                                  : 'rgba(255,69,58,0.15)',
                              color:
                                inv.status === 'active'
                                  ? '#30d158'
                                  : inv.status === 'exhausted'
                                  ? '#ff9f0a'
                                  : '#ff453a',
                            }}
                          >
                            {inv.status === 'active' ? '● 可用' : inv.status === 'exhausted' ? '已领完' : '已吊销'}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              style={styles.smallPrimaryBtn}
                              onClick={() => copyInviteCard(inv)}
                            >
                              📋 复制邀请函发成员
                            </button>
                            <button
                              type="button"
                              style={styles.smallSecondaryBtn}
                              onClick={() => copyText(inv.code, `邀请码 ${inv.code}`)}
                            >
                              仅复制 Key
                            </button>
                            <button
                              type="button"
                              style={styles.smallSecondaryBtn}
                              onClick={() => adminAction('revoke_invite', { id: inv.id }, '已切换邀请码状态')}
                            >
                              {inv.status === 'revoked' ? '恢复' : '吊销'}
                            </button>
                            <button
                              type="button"
                              style={styles.smallDangerBtn}
                              onClick={() => adminAction('delete_invite', { id: inv.id }, '已删除邀请码')}
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Section 1B: Direct Team Account Management (Username + Password + Exclusive Key) */}
            <section style={styles.card}>
              <div style={{ marginBottom: 14 }}>
                <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>
                  👥 方式 B：直接管理团队账号（账号密码 + 专属 Key 双凭证）
                </h2>
                <p style={{ margin: 0, color: '#939db0', fontSize: 13 }}>
                  每个账号同时拥有「账号+密码」和「专属 Key」，成员用任意一种方式均可登录，项目与台账按账号自动隔离。
                </p>
              </div>

              <form
                onSubmit={handleCreateAccount}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
                  gap: 12,
                  background: '#1b202c',
                  padding: 16,
                  borderRadius: 14,
                  marginBottom: 16,
                }}
              >
                <label style={styles.label}>
                  登录账号 (Username)
                  <input
                    style={styles.input}
                    value={newAccUser}
                    onChange={(e) => setNewAccUser(e.target.value)}
                    placeholder="如：writer03"
                  />
                </label>
                <label style={styles.label}>
                  成员显示名称
                  <input
                    style={styles.input}
                    value={newAccName}
                    onChange={(e) => setNewAccName(e.target.value)}
                    placeholder="如：主笔编剧小陈"
                  />
                </label>
                <label style={styles.label}>
                  初始登录密码
                  <input
                    style={styles.input}
                    value={newAccPass}
                    onChange={(e) => setNewAccPass(e.target.value)}
                    placeholder="设置登录密码"
                  />
                </label>
                <label style={styles.label}>
                  角色权限
                  <select
                    style={styles.input}
                    value={newAccRole}
                    onChange={(e) => setNewAccRole(e.target.value as AccountRole)}
                  >
                    <option value="creator">✒️ 编剧创作者</option>
                    <option value="reviewer">🔍 审稿验收人</option>
                    <option value="admin">🛡️ 管理员</option>
                  </select>
                </label>
                <label style={styles.label}>
                  预算额度上限 ($ USD)
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    style={styles.input}
                    value={newAccBudget}
                    onChange={(e) => setNewAccBudget(e.target.value)}
                  />
                </label>
                <label style={styles.label}>
                  职责备注
                  <input
                    style={styles.input}
                    value={newAccNote}
                    onChange={(e) => setNewAccNote(e.target.value)}
                    placeholder="负责哪条短剧线"
                  />
                </label>
                <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="submit" disabled={busy} style={styles.primaryBtn}>
                    ＋ 创建成员账号（自动配发专属 Key）
                  </button>
                </div>
              </form>

              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>账号 / 成员名称</th>
                      <th style={styles.th}>角色</th>
                      <th style={styles.th}>登录密码</th>
                      <th style={styles.th}>专属登录 Key</th>
                      <th style={styles.th}>已用额度 / 上限</th>
                      <th style={styles.th}>名下项目</th>
                      <th style={styles.th}>状态</th>
                      <th style={styles.th}>操作与一键分发</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((acc) => (
                      <tr key={acc.id}>
                        <td style={styles.td}>
                          <strong>{acc.displayName}</strong>
                          <div style={{ fontSize: 12, color: '#7cc0ff' }}>@{acc.username}</div>
                          {acc.note && <div style={{ fontSize: 11, color: '#939db0' }}>{acc.note}</div>}
                        </td>
                        <td style={styles.td}>
                          <select
                            style={{ ...styles.input, padding: '6px 8px', width: 145 }}
                            value={acc.role}
                            disabled={acc.username === 'ayin'}
                            onChange={(e) =>
                              adminAction(
                                'update_account',
                                { id: acc.id, role: e.target.value },
                                `已更新 ${acc.username} 的角色`
                              )
                            }
                          >
                            <option value="admin">🛡️ 管理员</option>
                            <option value="creator">✒️ 编剧创作者</option>
                            <option value="reviewer">🔍 审稿验收人</option>
                          </select>
                        </td>
                        <td style={styles.td}>
                          {editingPassId === acc.id ? (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <input
                                style={{ ...styles.input, padding: '5px 8px', width: 100 }}
                                value={editingPassVal}
                                onChange={(e) => setEditingPassVal(e.target.value)}
                                placeholder="新密码"
                              />
                              <button
                                type="button"
                                style={styles.smallPrimaryBtn}
                                onClick={async () => {
                                  if (editingPassVal.trim()) {
                                    await adminAction(
                                      'update_account',
                                      { id: acc.id, password: editingPassVal.trim() },
                                      `已修改 ${acc.username} 的密码`
                                    );
                                  }
                                  setEditingPassId(null);
                                }}
                              >
                                保存
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
                              <span
                                style={{
                                  fontSize: 11,
                                  padding: '2px 8px',
                                  borderRadius: 999,
                                  background: (acc as any).passwordHashed ? 'rgba(48,209,88,0.14)' : 'rgba(255,159,10,0.14)',
                                  color: (acc as any).passwordHashed ? '#30d158' : '#ff9f0a',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {(acc as any).passwordHashed ? '🔒 已加密' : '🔐 待登录升级'}
                              </span>
                              <button
                                type="button"
                                style={styles.smallSecondaryBtn}
                                onClick={() => {
                                  setEditingPassId(acc.id);
                                  setEditingPassVal('');
                                }}
                              >
                                改密
                              </button>
                            </div>
                          )}
                        </td>
                        <td style={styles.td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <code style={styles.codeBadge}>{acc.accessKey}</code>
                            <button
                              type="button"
                              style={styles.smallSecondaryBtn}
                              title="重新生成专属 Key（旧 Key 立即失效）"
                              onClick={() =>
                                adminAction('regenerate_key', { id: acc.id }, `已为 ${acc.username} 重置专属 Key`)
                              }
                            >
                              重置Key
                            </button>
                          </div>
                        </td>
                        <td style={styles.td}>
                          <div style={{ fontSize: 12 }}>
                            <strong>${acc.budgetUsedUsd.toFixed(2)}</strong> / ${acc.budgetCapUsd.toFixed(2)}
                          </div>
                          <div style={{ fontSize: 11, color: '#939db0' }}>
                            {(acc.tokensUsed || 0).toLocaleString()} tokens
                          </div>
                          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                            <button
                              type="button"
                              style={styles.smallSecondaryBtn}
                              onClick={() => {
                                const nextCap = window.prompt(
                                  `修改 ${acc.displayName} 的预算上限（美元）：`,
                                  String(acc.budgetCapUsd)
                                );
                                if (nextCap !== null && !Number.isNaN(Number(nextCap))) {
                                  adminAction(
                                    'update_account',
                                    { id: acc.id, budgetCapUsd: Number(nextCap) },
                                    '已更新预算上限'
                                  );
                                }
                              }}
                            >
                              改额度
                            </button>
                            <button
                              type="button"
                              style={styles.smallSecondaryBtn}
                              onClick={() =>
                                adminAction('update_account', { id: acc.id, resetUsage: true }, '已清零已用额度')
                              }
                            >
                              清零
                            </button>
                          </div>
                        </td>
                        <td style={styles.td}>
                          <strong>{acc.projectCount || 0}</strong> 个项目
                        </td>
                        <td style={styles.td}>
                          <span
                            style={{
                              padding: '3px 8px',
                              borderRadius: 999,
                              fontSize: 11,
                              background: acc.status === 'active' ? 'rgba(48,209,88,0.15)' : 'rgba(255,69,58,0.15)',
                              color: acc.status === 'active' ? '#30d158' : '#ff453a',
                            }}
                          >
                            {acc.status === 'active' ? '● 正常' : '已停用'}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              style={styles.smallPrimaryBtn}
                              onClick={() => copyAccountCard(acc)}
                            >
                              📋 复制完整登录卡
                            </button>
                            {acc.username !== 'ayin' && (
                              <>
                                <button
                                  type="button"
                                  style={styles.smallSecondaryBtn}
                                  onClick={() =>
                                    adminAction(
                                      'update_account',
                                      { id: acc.id, status: acc.status === 'active' ? 'disabled' : 'active' },
                                      `已${acc.status === 'active' ? '停用' : '启用'}账号 ${acc.username}`
                                    )
                                  }
                                >
                                  {acc.status === 'active' ? '停用' : '启用'}
                                </button>
                                <button
                                  type="button"
                                  style={styles.smallDangerBtn}
                                  onClick={() =>
                                    adminAction('delete_account', { id: acc.id }, `已删除账号 ${acc.username}`)
                                  }
                                >
                                  删除
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* TAB 2: Multi-Provider API Pool */}
        {activeTab === 'providers' && systemConfig && (
          <div style={{ display: 'grid', gap: 20 }}>
            <section style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                <div>
                  <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>
                    🔌 API 中转接口池配置（1 个主接口 + 2 个备用接口 · 全工位使用 GPT / Gemini）
                  </h2>
                  <p style={{ margin: 0, color: '#939db0', fontSize: 13 }}>
                    全部采用 API 中转接口（已全面弃用 Claude，由 Gemini 与 GPT 承担全流程工位）。支持配置 **1 个主中转接口地址 + 2 个备用中转接口地址**，主接口异常时自动切入备用接口 1 → 备用接口 2。
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" style={styles.primaryBtn} onClick={() => addPresetProvider('primary_relay')}>
                    ＋ 新增主 API 中转接口 (1主+2备地址)
                  </button>
                  <button type="button" style={styles.secondaryBtn} onClick={() => addPresetProvider('backup_relay_1')}>
                    ＋ 新增备用中转接口 1
                  </button>
                  <button type="button" style={styles.secondaryBtn} onClick={() => addPresetProvider('backup_relay_2')}>
                    ＋ 新增备用中转接口 2
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 16 }}>
                {systemConfig.providers.map((prov) => (
                  <div
                    key={prov.id}
                    style={{
                      background: '#1b202c',
                      border: '1px solid rgba(255,255,255,0.09)',
                      borderRadius: 16,
                      padding: 18,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <input
                          type="checkbox"
                          checked={prov.enabled}
                          onChange={(e) => updateLocalProvider(prov.id, { enabled: e.target.checked })}
                          style={{ width: 16, height: 16 }}
                        />
                        <strong style={{ fontSize: 16 }}>{prov.name}</strong>
                        <code style={styles.codeBadge}>ID: {prov.id}</code>
                        <span
                          style={{
                            fontSize: 11,
                            padding: '3px 9px',
                            borderRadius: 999,
                            background:
                              prov.lastTestStatus === 'ok'
                                ? 'rgba(48,209,88,0.16)'
                                : prov.lastTestStatus === 'error'
                                ? 'rgba(255,69,58,0.16)'
                                : 'rgba(255,255,255,0.07)',
                            color:
                              prov.lastTestStatus === 'ok'
                                ? '#30d158'
                                : prov.lastTestStatus === 'error'
                                ? '#ff453a'
                                : '#939db0',
                          }}
                        >
                          {prov.lastTestStatus === 'ok'
                            ? `✓ 连通正常 (${prov.lastLatencyMs || 0} ms)`
                            : prov.lastTestStatus === 'error'
                            ? `⚠ 连接异常`
                            : '○ 待测速'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          disabled={busy}
                          style={styles.smallPrimaryBtn}
                          onClick={async () => {
                            await adminAction(
                              'save_provider',
                              { provider: prov },
                              `✓ 已保存渠道「${prov.name}」`
                            );
                            setModelDrafts((prev) => {
                              const next = { ...prev };
                              delete next[prov.id];
                              return next;
                            });
                          }}
                        >
                          💾 保存此渠道
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          style={styles.smallSecondaryBtn}
                          onClick={async () => {
                            await adminAction('save_provider', { provider: prov });
                            setProviderTestMsg((prev) => ({
                              ...prev,
                              [prov.id]: '◐ 正在从中转站 /v1/models 拉取真实支持的模型列表…',
                            }));
                            const res = await adminAction('fetch_provider_models', { id: prov.id });
                            if (res?.fetchModelsResult) {
                              const fm = res.fetchModelsResult;
                              if (fm.ok) {
                                setModelDrafts((prev) => ({
                                  ...prev,
                                  [prov.id]: (fm.models || []).join(', '),
                                }));
                                setProviderTestMsg((prev) => ({
                                  ...prev,
                                  [prov.id]: `✓ 已自动拉取到该 Key 下的 ${fm.count} 个可用模型：${(fm.models || []).slice(0, 8).join(', ')}`,
                                }));
                              } else {
                                setProviderTestMsg((prev) => ({
                                  ...prev,
                                  [prov.id]: `⚠ 拉取模型列表提示：${fm.error}`,
                                }));
                              }
                            }
                          }}
                        >
                          🔍 自动拉取可用模型
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          style={styles.smallSecondaryBtn}
                          onClick={async () => {
                            await adminAction('save_provider', { provider: prov });
                            setProviderTestMsg((prev) => ({ ...prev, [prov.id]: '◐ 正在从服务端发起真实请求测速…' }));
                            const res = await adminAction('test_provider', {
                              id: prov.id,
                              model: prov.models[0],
                            });
                            if (res?.testResult) {
                              const tr = res.testResult;
                              setProviderTestMsg((prev) => ({
                                ...prev,
                                [prov.id]: tr.ok
                                  ? `✓ 测速成功（耗时 ${tr.latencyMs} ms · 实际连通模型 ${tr.model}）：${tr.reply}`
                                  : `⚠ 测速失败：${tr.error}`,
                              }));
                            }
                          }}
                        >
                          ⚡ 服务端连通性测速
                        </button>
                        {systemConfig.providers.length > 1 && (
                          <button
                            type="button"
                            disabled={busy}
                            style={styles.smallDangerBtn}
                            onClick={() =>
                              adminAction('delete_provider', { id: prov.id }, `已移除渠道「${prov.name}」`)
                            }
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                      <label style={styles.label}>
                        中转渠道名称
                        <input
                          style={styles.input}
                          value={prov.name}
                          onChange={(e) => updateLocalProvider(prov.id, { name: e.target.value })}
                        />
                      </label>
                      <label style={styles.label}>
                        备注说明
                        <input
                          style={styles.input}
                          value={prov.note || ''}
                          onChange={(e) => updateLocalProvider(prov.id, { note: e.target.value })}
                        />
                      </label>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 12 }}>
                      <label style={styles.label}>
                        1. 主中转接口地址 (Primary Base URL · 必填)
                        <input
                          style={styles.input}
                          value={prov.baseUrl}
                          onChange={(e) => updateLocalProvider(prov.id, { baseUrl: e.target.value })}
                          placeholder="https://主中转站域名/v1"
                        />
                      </label>
                      <label style={styles.label}>
                        2. 备用中转接口地址 1 (Backup Base URL 1 · 主地址超时自动切换)
                        <input
                          style={styles.input}
                          value={prov.backupBaseUrl1 || ''}
                          onChange={(e) => updateLocalProvider(prov.id, { backupBaseUrl1: e.target.value })}
                          placeholder="https://备用中转站1域名/v1（可选）"
                        />
                      </label>
                      <label style={styles.label}>
                        3. 备用中转接口地址 2 (Backup Base URL 2 · 二级兜底地址)
                        <input
                          style={styles.input}
                          value={prov.backupBaseUrl2 || ''}
                          onChange={(e) => updateLocalProvider(prov.id, { backupBaseUrl2: e.target.value })}
                          placeholder="https://备用中转站2域名/v1（可选）"
                        />
                      </label>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 12 }}>
                      <label style={styles.label}>
                        中转 API Key 列表（支持填入多个 Key，每行一个，服务端自动轮询容灾）
                        <textarea
                          rows={3}
                          style={{ ...styles.input, fontFamily: 'monospace' }}
                          value={
                            keyDrafts[prov.id] !== undefined
                              ? keyDrafts[prov.id]
                              : Array.isArray(prov.apiKeys)
                              ? prov.apiKeys.join('\n')
                              : ''
                          }
                          onChange={(e) => {
                            const raw = e.target.value;
                            setKeyDrafts((prev) => ({ ...prev, [prov.id]: raw }));
                            updateLocalProvider(prov.id, {
                              apiKeys: raw
                                .split(/[\n,，;；]+/)
                                .map((s) => s.trim())
                                .filter(Boolean),
                            });
                          }}
                          placeholder="sk-xxxxxxxxxxxx&#10;sk-yyyyyyyyyyyy (可选多个中转Key自动轮询)"
                        />
                      </label>
                      <label style={styles.label}>
                        该中转站已启用的 GPT / Gemini 模型列表（可在下方可视化点选，也可手动编辑）
                        <textarea
                          rows={3}
                          style={{ ...styles.input, fontFamily: 'monospace' }}
                          value={
                            modelDrafts[prov.id] !== undefined
                              ? modelDrafts[prov.id]
                              : Array.isArray(prov.models)
                              ? prov.models.join(', ')
                              : ''
                          }
                          onChange={(e) => {
                            const raw = e.target.value;
                            setModelDrafts((prev) => ({ ...prev, [prov.id]: raw }));
                            updateLocalProvider(prov.id, {
                              models: raw
                                .split(/[\n,，、;；]+/)
                                .map((s) => s.trim())
                                .filter(Boolean),
                            });
                          }}
                          placeholder="gpt-6.1-sol, gpt-6.2-sol, gemini-4-hydrogen, gemini-4-argon, gemini-3.7-flash"
                        />
                      </label>
                    </div>

                    {/* Interactive Step 1 & Step 2: Select LLM Families -> Auto-Fetch from Relay -> Click to Pick Models */}
                    <div
                      style={{
                        marginTop: 14,
                        padding: 14,
                        borderRadius: 12,
                        background: 'rgba(10, 132, 255, 0.07)',
                        border: '1px solid rgba(10, 132, 255, 0.25)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 13, color: '#7cc0ff' }}>
                            步骤 1 · 先勾选你要从中转站拉取的大模型系列：
                          </strong>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#f3f5f8', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={selectedFamilies[prov.id]?.gemini ?? true}
                              onChange={(e) =>
                                setSelectedFamilies((prev) => ({
                                  ...prev,
                                  [prov.id]: {
                                    gemini: e.target.checked,
                                    gpt: prev[prov.id]?.gpt ?? true,
                                  },
                                }))
                              }
                            />
                            ✨ Gemini 大模型系列
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#f3f5f8', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={selectedFamilies[prov.id]?.gpt ?? true}
                              onChange={(e) =>
                                setSelectedFamilies((prev) => ({
                                  ...prev,
                                  [prov.id]: {
                                    gemini: prev[prov.id]?.gemini ?? true,
                                    gpt: e.target.checked,
                                  },
                                }))
                              }
                            />
                            🤖 GPT 大模型系列
                          </label>
                        </div>

                        <button
                          type="button"
                          disabled={busy}
                          style={styles.primaryBtn}
                          onClick={async () => {
                            const famCfg = selectedFamilies[prov.id] || { gemini: true, gpt: true };
                            const families: string[] = [];
                            if (famCfg.gemini) families.push('gemini');
                            if (famCfg.gpt) families.push('gpt');
                            if (families.length === 0) {
                              setErrorMsg('请至少勾选一个大模型系列（Gemini 或 GPT）');
                              return;
                            }
                            await adminAction('save_provider', { provider: prov });
                            setProviderTestMsg((prev) => ({
                              ...prev,
                              [prov.id]: `◐ 正在从中转站 (${prov.baseUrl}) 拉取 ${families.join(' + ').toUpperCase()} 全量模型库…`,
                            }));
                            const res = await adminAction('fetch_provider_models', {
                              id: prov.id,
                              families,
                            });
                            if (res?.fetchModelsResult) {
                              const fm = res.fetchModelsResult;
                              if (fm.ok) {
                                setDiscoveredCatalog((prev) => ({
                                  ...prev,
                                  [prov.id]: {
                                    geminiModels: fm.geminiModels || [],
                                    gptModels: fm.gptModels || [],
                                    keySupportedModels: fm.keySupportedModels || [],
                                  },
                                }));
                                setModelDrafts((prev) => ({
                                  ...prev,
                                  [prov.id]: (fm.models || []).join(', '),
                                }));
                                setProviderTestMsg((prev) => ({
                                  ...prev,
                                  [prov.id]: `✓ 成功拉取到中转站 ${fm.geminiModels?.length || 0} 个 Gemini 模型与 ${fm.gptModels?.length || 0} 个 GPT 模型！请在下方点击选择你要用的模型，并在下方表格分配给六大编剧工位。`,
                                }));
                              } else {
                                setProviderTestMsg((prev) => ({
                                  ...prev,
                                  [prov.id]: `⚠ 拉取提示：${fm.error}`,
                                }));
                              }
                            }
                          }}
                        >
                          🔍 按所选系列从中转站自动拉取模型
                        </button>
                      </div>

                      {(() => {
                        const cat = discoveredCatalog[prov.id];
                        const geminiList =
                          cat?.geminiModels ||
                          (Array.isArray(prov.models) ? prov.models.filter((m) => /gemini/i.test(m)) : []);
                        const gptList =
                          cat?.gptModels ||
                          (Array.isArray(prov.models) ? prov.models.filter((m) => !/gemini/i.test(m)) : []);

                        if (geminiList.length === 0 && gptList.length === 0) return null;

                        const toggleModelInProvider = (modelName: string) => {
                          const current = Array.isArray(prov.models) ? prov.models : [];
                          const exists = current.includes(modelName);
                          const next = exists ? current.filter((m) => m !== modelName) : [...current, modelName];
                          updateLocalProvider(prov.id, { models: next });
                          setModelDrafts((prev) => ({ ...prev, [prov.id]: next.join(', ') }));
                        };

                        return (
                          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                            <div style={{ fontSize: 12, color: '#939db0' }}>
                              步骤 2 · 点击下方模型胶囊即可<strong>勾选启用 / 取消</strong>（蓝色高亮代表已加入你的可用模型池）：
                            </div>
                            {geminiList.length > 0 && (
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#30d158', marginBottom: 6 }}>
                                  ✨ Gemini 系列模型（共 {geminiList.length} 个）：
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {geminiList.map((m) => {
                                    const active = prov.models.includes(m);
                                    return (
                                      <button
                                        key={m}
                                        type="button"
                                        onClick={() => toggleModelInProvider(m)}
                                        style={{
                                          padding: '5px 10px',
                                          borderRadius: 999,
                                          fontSize: 12,
                                          fontFamily: 'monospace',
                                          cursor: 'pointer',
                                          border: active
                                            ? '1px solid #30d158'
                                            : '1px solid rgba(255,255,255,0.12)',
                                          background: active
                                            ? 'rgba(48, 209, 88, 0.2)'
                                            : 'rgba(255,255,255,0.04)',
                                          color: active ? '#30d158' : '#939db0',
                                        }}
                                      >
                                        {active ? '✓ ' : '＋ '}
                                        {m}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {gptList.length > 0 && (
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#7cc0ff', marginBottom: 6 }}>
                                  🤖 GPT 系列模型（共 {gptList.length} 个）：
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {gptList.map((m) => {
                                    const active = prov.models.includes(m);
                                    return (
                                      <button
                                        key={m}
                                        type="button"
                                        onClick={() => toggleModelInProvider(m)}
                                        style={{
                                          padding: '5px 10px',
                                          borderRadius: 999,
                                          fontSize: 12,
                                          fontFamily: 'monospace',
                                          cursor: 'pointer',
                                          border: active
                                            ? '1px solid #0a84ff'
                                            : '1px solid rgba(255,255,255,0.12)',
                                          background: active
                                            ? 'rgba(10, 132, 255, 0.22)'
                                            : 'rgba(255,255,255,0.04)',
                                          color: active ? '#7cc0ff' : '#939db0',
                                        }}
                                      >
                                        {active ? '✓ ' : '＋ '}
                                        {m}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {(providerTestMsg[prov.id] || prov.lastErrorMsg) && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: '8px 12px',
                          borderRadius: 8,
                          fontSize: 12,
                          background: 'rgba(255,255,255,0.05)',
                          color: providerTestMsg[prov.id]?.startsWith('✓') ? '#30d158' : '#ff9f0a',
                        }}
                      >
                        {providerTestMsg[prov.id] || `最近错误：${prov.lastErrorMsg}`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Step 3 directly on the same page: Assign which AI Writer Station uses which Gemini / GPT Model */}
            <section style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
                <div>
                  <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>
                    🎭 步骤 3 · 规定六大 AI 编剧工位分别使用哪个模型（从上方已拉取的 Gemini / GPT 模型中直接下拉选择）
                  </h2>
                  <p style={{ margin: 0, color: '#939db0', fontSize: 13 }}>
                    直接在此为 6 个编剧角色指定主用模型与备用模型（下拉框已自动归类为「✨ Gemini 系列」与「🤖 GPT 系列」）。
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  style={styles.primaryBtn}
                  onClick={() =>
                    adminAction(
                      'save_routes',
                      { routes: systemConfig.routes },
                      '✓ 已保存六大 AI 编剧工位的模型分配方案！'
                    )
                  }
                >
                  💾 一键保存六大编剧模型分配
                </button>
              </div>

              {(() => {
                const allModelsPool = Array.from(
                  new Set(systemConfig.providers.flatMap((p) => p.models || []))
                );
                const geminiPool = allModelsPool.filter((m) => /gemini/i.test(m));
                const gptPool = allModelsPool.filter((m) => !/gemini/i.test(m));

                return (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>AI 编剧工位角色</th>
                          <th style={styles.th}>主用中转接口</th>
                          <th style={styles.th}>主用大模型（下拉选择 Gemini 或 GPT）</th>
                          <th style={styles.th}>备用大模型（主模型超时自动切换）</th>
                          <th style={styles.th}>测试该编剧工位</th>
                        </tr>
                      </thead>
                      <tbody>
                        {STATION_ORDER.map((roleKey) => {
                          const route = systemConfig.routes[roleKey];
                          if (!route) return null;
                          return (
                            <tr key={roleKey}>
                              <td style={styles.td}>
                                <strong>{route.title}</strong>
                                <div style={{ fontSize: 11, color: '#939db0', marginTop: 2 }}>
                                  {route.description.slice(0, 42)}…
                                </div>
                              </td>
                              <td style={styles.td}>
                                <select
                                  style={styles.input}
                                  value={route.primaryProviderId}
                                  onChange={(e) =>
                                    updateLocalRoute(roleKey, { primaryProviderId: e.target.value })
                                  }
                                >
                                  {systemConfig.providers.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td style={styles.td}>
                                <select
                                  style={{ ...styles.input, fontFamily: 'monospace', color: '#7cc0ff', fontWeight: 600 }}
                                  value={route.primaryModel}
                                  onChange={(e) =>
                                    updateLocalRoute(roleKey, { primaryModel: e.target.value })
                                  }
                                >
                                  {!allModelsPool.includes(route.primaryModel) && (
                                    <option value={route.primaryModel}>{route.primaryModel}</option>
                                  )}
                                  {geminiPool.length > 0 && (
                                    <optgroup label="✨ Gemini 系列模型">
                                      {geminiPool.map((m) => (
                                        <option key={m} value={m}>
                                          ✨ {m}
                                        </option>
                                      ))}
                                    </optgroup>
                                  )}
                                  {gptPool.length > 0 && (
                                    <optgroup label="🤖 GPT 系列模型">
                                      {gptPool.map((m) => (
                                        <option key={m} value={m}>
                                          🤖 {m}
                                        </option>
                                      ))}
                                    </optgroup>
                                  )}
                                </select>
                              </td>
                              <td style={styles.td}>
                                <select
                                  style={{ ...styles.input, fontFamily: 'monospace' }}
                                  value={route.fallbackModel}
                                  onChange={(e) =>
                                    updateLocalRoute(roleKey, { fallbackModel: e.target.value })
                                  }
                                >
                                  {!allModelsPool.includes(route.fallbackModel) && (
                                    <option value={route.fallbackModel}>{route.fallbackModel}</option>
                                  )}
                                  {geminiPool.length > 0 && (
                                    <optgroup label="✨ Gemini 系列模型">
                                      {geminiPool.map((m) => (
                                        <option key={m} value={m}>
                                          ✨ {m}
                                        </option>
                                      ))}
                                    </optgroup>
                                  )}
                                  {gptPool.length > 0 && (
                                    <optgroup label="🤖 GPT 系列模型">
                                      {gptPool.map((m) => (
                                        <option key={m} value={m}>
                                          🤖 {m}
                                        </option>
                                      ))}
                                    </optgroup>
                                  )}
                                </select>
                              </td>
                              <td style={styles.td}>
                                <button
                                  type="button"
                                  disabled={busy}
                                  style={styles.smallSecondaryBtn}
                                  onClick={async () => {
                                    await adminAction('save_routes', { routes: systemConfig.routes });
                                    setStationTestMsg((prev) => ({ ...prev, [roleKey]: '◐ 正在试跑…' }));
                                    const res = await adminAction('test_station', { station: roleKey });
                                    if (res?.stationTestResult) {
                                      const st = res.stationTestResult;
                                      setStationTestMsg((prev) => ({
                                        ...prev,
                                        [roleKey]: st.ok
                                          ? `✓ 试跑成功 (${route.primaryModel})：${st.reply}`
                                          : `⚠ 失败：${st.error}`,
                                      }));
                                    }
                                  }}
                                >
                                  ⚡ 试跑此工位
                                </button>
                                {stationTestMsg[roleKey] && (
                                  <div
                                    style={{
                                      fontSize: 11,
                                      marginTop: 4,
                                      color: stationTestMsg[roleKey].startsWith('✓') ? '#30d158' : '#ff9f0a',
                                    }}
                                  >
                                    {stationTestMsg[roleKey]}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </section>
          </div>
        )}

        {/* TAB 3: 6-Station AI Agent Routing & System Prompts */}
        {activeTab === 'routes' && systemConfig && (
          <div style={{ display: 'grid', gap: 20 }}>
            <section style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>
                    🎭 六大 AI 编剧工位模型路由与 System Prompt 配置中心
                  </h2>
                  <p style={{ margin: 0, color: '#939db0', fontSize: 13 }}>
                    API 渠道配置完成后，在此直接通过下拉框为每个编剧工位选择「主用模型」、「备用模型 1」、「备用模型 2」（已按 ✨ Gemini 系列 与 🤖 GPT 系列分组）。
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    disabled={busy}
                    style={styles.secondaryBtn}
                    onClick={async () => {
                      const p0 = systemConfig.providers[0];
                      if (!p0) return;
                      const res = await adminAction(
                        'fetch_provider_models',
                        { id: p0.id, families: ['gemini', 'gpt'] },
                        '✓ 已从主中转站同步最新 Gemini / GPT 模型列表到下拉框！'
                      );
                      if (res?.fetchModelsResult?.ok) {
                        setDiscoveredCatalog((prev) => ({
                          ...prev,
                          [p0.id]: {
                            geminiModels: res.fetchModelsResult.geminiModels || [],
                            gptModels: res.fetchModelsResult.gptModels || [],
                            keySupportedModels: res.fetchModelsResult.keySupportedModels || [],
                          },
                        }));
                      }
                    }}
                  >
                    🔄 同步中转站最新模型至下拉框
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    style={styles.primaryBtn}
                    onClick={() =>
                      adminAction(
                        'save_routes',
                        { routes: systemConfig.routes },
                        '✓ 已保存全部六大工位的模型路由与提示词配置'
                      )
                    }
                  >
                    💾 一键保存全部六大工位配置
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 16 }}>
                {STATION_ORDER.map((roleKey) => {
                  const route = systemConfig.routes[roleKey];
                  if (!route) return null;
                  const primaryProv = systemConfig.providers.find((p) => p.id === route.primaryProviderId);
                  const fallbackProv = systemConfig.providers.find((p) => p.id === route.fallbackProviderId);
                  const fallbackProv2 = systemConfig.providers.find((p) => p.id === route.fallbackProvider2Id);

                  // Build model options from selected provider (falling back to all providers' models)
                  const allGlobalModels = Array.from(
                    new Set(systemConfig.providers.flatMap((p) => p.models || []))
                  );
                  const buildGroupedOptions = (provModels: string[] | undefined, currentVal: string) => {
                    const pool = Array.from(
                      new Set([...(provModels && provModels.length ? provModels : []), ...allGlobalModels])
                    );
                    const geminiList = pool.filter((m) => /gemini/i.test(m));
                    const gptList = pool.filter((m) => !/gemini/i.test(m));
                    return (
                      <>
                        {currentVal && !pool.includes(currentVal) && (
                          <option value={currentVal}>{currentVal}（当前已存）</option>
                        )}
                        {geminiList.length > 0 && (
                          <optgroup label="✨ Gemini 系列模型">
                            {geminiList.map((m) => (
                              <option key={m} value={m}>
                                ✨ {m}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {gptList.length > 0 && (
                          <optgroup label="🤖 GPT 系列模型">
                            {gptList.map((m) => (
                              <option key={m} value={m}>
                                🤖 {m}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </>
                    );
                  };

                  return (
                    <div
                      key={roleKey}
                      style={{
                        background: '#1b202c',
                        border: '1px solid rgba(255,255,255,0.09)',
                        borderRadius: 16,
                        padding: 18,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <strong style={{ fontSize: 16 }}>{route.title}</strong>
                          <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, background: 'rgba(10,132,255,0.18)', color: '#7cc0ff' }}>
                            {route.badge}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            disabled={busy}
                            style={styles.smallSecondaryBtn}
                            onClick={async () => {
                              await adminAction('save_routes', { routes: systemConfig.routes });
                              setStationTestMsg((prev) => ({ ...prev, [roleKey]: '◐ 正在试跑该工位…' }));
                              const res = await adminAction('test_station', { station: roleKey });
                              if (res?.stationTestResult) {
                                const st = res.stationTestResult;
                                setStationTestMsg((prev) => ({
                                  ...prev,
                                  [roleKey]: st.ok
                                    ? `✓ 工位试跑成功 (${route.primaryModel})：${st.reply}`
                                    : `⚠ 工位试跑失败：${st.error}（请确认绑定渠道已填有效 API Key）`,
                                }));
                              }
                            }}
                          >
                            ⚡ 试跑此工位
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            style={styles.smallPrimaryBtn}
                            onClick={() =>
                              adminAction(
                                'save_routes',
                                { routes: systemConfig.routes },
                                `✓ 已保存「${route.title}」路由配置`
                              )
                            }
                          >
                            💾 保存
                          </button>
                        </div>
                      </div>

                      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: '#939db0' }}>{route.description}</p>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
                        <label style={styles.label}>
                          1. 主用 API 中转接口 (Primary Relay)
                          <select
                            style={styles.input}
                            value={route.primaryProviderId}
                            onChange={(e) => {
                              const nextProv = systemConfig.providers.find((p) => p.id === e.target.value);
                              updateLocalRoute(roleKey, {
                                primaryProviderId: e.target.value,
                                primaryModel: nextProv?.models[0] || route.primaryModel,
                              });
                            }}
                          >
                            {systemConfig.providers.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({p.apiKeys.length} Keys)
                              </option>
                            ))}
                          </select>
                        </label>

                        <label style={styles.label}>
                          2. 主用模型选择 (直接下拉选择 Gemini / GPT)
                          <select
                            style={{ ...styles.input, fontFamily: 'monospace', color: '#7cc0ff', fontWeight: 600 }}
                            value={route.primaryModel}
                            onChange={(e) => updateLocalRoute(roleKey, { primaryModel: e.target.value })}
                          >
                            {buildGroupedOptions(primaryProv?.models, route.primaryModel)}
                          </select>
                        </label>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <label style={styles.label}>
                            温度 (Temp)
                            <input
                              type="number"
                              step="0.05"
                              min={0}
                              max={1.5}
                              style={styles.input}
                              value={route.temperature}
                              onChange={(e) => updateLocalRoute(roleKey, { temperature: Number(e.target.value) })}
                            />
                          </label>
                          <label style={styles.label}>
                            最大输出 Token
                            <input
                              type="number"
                              step={512}
                              min={256}
                              max={32768}
                              style={styles.input}
                              value={route.maxTokens}
                              onChange={(e) => updateLocalRoute(roleKey, { maxTokens: Number(e.target.value) })}
                            />
                          </label>
                        </div>

                        <label style={styles.label}>
                          3. 备用中转接口 1 (Fallback Relay 1)
                          <select
                            style={styles.input}
                            value={route.fallbackProviderId}
                            onChange={(e) => {
                              const nextProv = systemConfig.providers.find((p) => p.id === e.target.value);
                              updateLocalRoute(roleKey, {
                                fallbackProviderId: e.target.value,
                                fallbackModel: nextProv?.models[0] || route.fallbackModel,
                              });
                            }}
                          >
                            <option value="">不启用备用接口 1</option>
                            {systemConfig.providers.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label style={styles.label}>
                          4. 备用接口 1 模型选择 (下拉选择 Gemini / GPT)
                          <select
                            style={{ ...styles.input, fontFamily: 'monospace' }}
                            value={route.fallbackModel}
                            onChange={(e) => updateLocalRoute(roleKey, { fallbackModel: e.target.value })}
                          >
                            {buildGroupedOptions(fallbackProv?.models, route.fallbackModel)}
                          </select>
                        </label>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <label style={styles.label}>
                            5. 备用中转接口 2 (Fallback Relay 2)
                            <select
                              style={styles.input}
                              value={route.fallbackProvider2Id || ''}
                              onChange={(e) => {
                                const nextProv = systemConfig.providers.find((p) => p.id === e.target.value);
                                updateLocalRoute(roleKey, {
                                  fallbackProvider2Id: e.target.value,
                                  fallbackModel2: nextProv?.models[0] || route.fallbackModel2 || 'gpt-6.1-sol',
                                });
                              }}
                            >
                              <option value="">不启用备用接口 2</option>
                              {systemConfig.providers.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label style={styles.label}>
                            6. 备用接口 2 模型选择
                            <select
                              style={{ ...styles.input, fontFamily: 'monospace' }}
                              value={route.fallbackModel2 || ''}
                              onChange={(e) => updateLocalRoute(roleKey, { fallbackModel2: e.target.value })}
                            >
                              {buildGroupedOptions(fallbackProv2?.models, route.fallbackModel2 || '')}
                            </select>
                          </label>
                        </div>
                      </div>

                      <label style={{ ...styles.label, marginTop: 12 }}>
                        7. 工位专属系统提示词 (System Prompt · 仅服务端可见，前台严格保密)
                        <textarea
                          rows={2}
                          style={styles.input}
                          value={route.systemPrompt}
                          onChange={(e) => updateLocalRoute(roleKey, { systemPrompt: e.target.value })}
                        />
                      </label>

                      {stationTestMsg[roleKey] && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: '8px 12px',
                            borderRadius: 8,
                            fontSize: 12,
                            background: 'rgba(255,255,255,0.05)',
                            color: stationTestMsg[roleKey].startsWith('✓') ? '#30d158' : '#ff9f0a',
                          }}
                        >
                          {stationTestMsg[roleKey]}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {/* TAB 4: Global Security, Projects Monitor & Audit Ledger */}
        {activeTab === 'monitor' && systemConfig && (
          <div style={{ display: 'grid', gap: 20 }}>
            {/* Global System & Security Config */}
            <section style={styles.card}>
              <h2 style={{ margin: '0 0 12px', fontSize: 17 }}>⚙️ 全局登录安全策略与独立生产后端对接</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
                <label style={styles.label}>
                  运行模式
                  <select
                    style={styles.input}
                    value={systemConfig.mode}
                    onChange={(e) =>
                      setSystemConfig({ ...systemConfig, mode: e.target.value as any })
                    }
                  >
                    <option value="direct_llm">🔌 模式 1：服务端直连多渠道大模型池（推荐）</option>
                    <option value="custom_backend">🖥️ 模式 2：转发至外部独立后端 (STUDIO_BACKEND_URL)</option>
                    <option value="hybrid">⚡ 模式 3：混合模式（优先外部后端，兜底直连模型池）</option>
                  </select>
                </label>

                <label style={styles.label}>
                  外部生产后端地址 (STUDIO_BACKEND_URL · 可选)
                  <input
                    style={styles.input}
                    value={systemConfig.backendUrl}
                    onChange={(e) => setSystemConfig({ ...systemConfig, backendUrl: e.target.value })}
                    placeholder="https://your-backend.example.com"
                  />
                </label>

                <label style={styles.label}>
                  外部生产后端 Token (STUDIO_BACKEND_TOKEN · 可选)
                  <input
                    type="password"
                    style={styles.input}
                    value={systemConfig.backendToken}
                    onChange={(e) => setSystemConfig({ ...systemConfig, backendToken: e.target.value })}
                    placeholder="Bearer Token..."
                  />
                </label>
              </div>

              <div style={{ display: 'flex', gap: 24, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#f3f5f8', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={systemConfig.requireAuthOnFrontend}
                    onChange={(e) =>
                      setSystemConfig({ ...systemConfig, requireAuthOnFrontend: e.target.checked })
                    }
                  />
                  强制创作者前台 (/) 必须凭「专属 Key 或 账号密码」登录后才能使用
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#f3f5f8', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={systemConfig.allowInviteRegistration}
                    onChange={(e) =>
                      setSystemConfig({ ...systemConfig, allowInviteRegistration: e.target.checked })
                    }
                  />
                  允许团队成员使用邀请码自助注册个人账号与密码
                </label>

                <button
                  type="button"
                  disabled={busy}
                  style={styles.primaryBtn}
                  onClick={() =>
                    adminAction('save_system_config', systemConfig, '✓ 全局安全策略与后端配置已保存')
                  }
                >
                  💾 保存全局设置
                </button>
              </div>
            </section>

            {/* Cross-Account Projects Table */}
            <section style={styles.card}>
              <h2 style={{ margin: '0 0 12px', fontSize: 17 }}>
                📁 全站跨账号短剧项目总览 ({projectsSummary.length})
              </h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>项目名称</th>
                      <th style={styles.th}>所属账号</th>
                      <th style={styles.th}>流程类型</th>
                      <th style={styles.th}>集数与锁集保护</th>
                      <th style={styles.th}>当前停点/阶段</th>
                      <th style={styles.th}>素材 / 台账数</th>
                      <th style={styles.th}>最近更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectsSummary.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: '#939db0' }}>
                          暂无已创建的短剧项目
                        </td>
                      </tr>
                    ) : (
                      projectsSummary.map((p: any) => (
                        <tr key={p.id}>
                          <td style={styles.td}>
                            <strong>{p.title}</strong>
                            {p.archived && <span style={{ marginLeft: 6, fontSize: 11, color: '#ff9f0a' }}>[回收站]</span>}
                          </td>
                          <td style={styles.td}>
                            <code style={styles.codeBadge}>@{p.owner}</code>
                          </td>
                          <td style={styles.td}>{p.kind}</td>
                          <td style={styles.td}>
                            {p.total ? `${p.total} 集` : '待定'}
                            {p.lockedEpisodes ? `（锁前 ${p.lockedEpisodes} 集）` : ''}
                          </td>
                          <td style={styles.td}>{p.stageTitle}</td>
                          <td style={styles.td}>
                            {p.attachmentsCount} 份素材 / {p.requirementsCount} 条要求
                          </td>
                          <td style={styles.td}>{new Date(p.updatedAt).toLocaleString('zh-CN')}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* API Call Audit Logs */}
            <section style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 17 }}>
                  📜 服务端 API 调用与费用审计日志 ({auditLogs.length})
                </h2>
                {auditLogs.length > 0 && (
                  <button
                    type="button"
                    style={styles.smallSecondaryBtn}
                    onClick={() => adminAction('clear_audit_logs', {}, '已清空审计日志')}
                  >
                    清空日志
                  </button>
                )}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>时间</th>
                      <th style={styles.th}>触发账号</th>
                      <th style={styles.th}>AI 编剧工位</th>
                      <th style={styles.th}>实际调用渠道 & 模型</th>
                      <th style={styles.th}>耗时</th>
                      <th style={styles.th}>Tokens & 估算费用</th>
                      <th style={styles.th}>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: '#939db0' }}>
                          暂无 API 调用记录（可在「渠道池」或「六大工位」点击测速/试跑生成记录）
                        </td>
                      </tr>
                    ) : (
                      auditLogs.map((log) => (
                        <tr key={log.id}>
                          <td style={styles.td}>{new Date(log.time).toLocaleTimeString('zh-CN')}</td>
                          <td style={styles.td}>@{log.username}</td>
                          <td style={styles.td}>{log.stationTitle}</td>
                          <td style={styles.td}>
                            <strong>{log.providerName}</strong> · <code>{log.model}</code>
                          </td>
                          <td style={styles.td}>{log.latencyMs} ms</td>
                          <td style={styles.td}>
                            {log.usageStatus === 'unknown' ? '用量及费用待确认' : `${log.tokens} tokens (估算 $${log.estimatedCostUsd.toFixed(4)})`}
                          </td>
                          <td style={styles.td}>
                            <span
                              style={{
                                color:
                                  log.status === 'success'
                                    ? '#30d158'
                                    : log.status === 'fallback'
                                    ? '#ff9f0a'
                                    : '#ff453a',
                              }}
                            >
                              {log.status === 'success'
                                ? '✓ 主线成功'
                                : log.status === 'fallback'
                                ? '↺ 备用容灾成功'
                                : `✕ 失败: ${log.error || ''}`}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* TAB 5: Skill Plugins (Prompts) Management */}
        {activeTab === 'skills' && systemConfig && (
          <div style={{ display: 'grid', gap: 20 }}>
            {/* Section 5A: Upload / Add New Skill Plugin (.md / .txt) */}
            <section style={styles.card}>
              <h2 style={{ margin: '0 0 6px', fontSize: 17 }}>
                🧩 上传 / 新增提示词插件 (.md / .txt)
              </h2>
              <p style={{ margin: '0 0 14px', color: '#939db0', fontSize: 13 }}>
                按创作流程与主/副槽位上传 Markdown (.md) 或文本 (.txt) 提示词插件。同一槽位支持保存多份供创作者切换；未配置或停用时自动回退系统内置规则。创作者端仅可见「名称」与「简短说明」，正文仅服务端注入模型调用链路。
              </p>

              <form
                onSubmit={handleUploadSkillPlugin}
                style={{
                  display: 'grid',
                  gap: 12,
                  background: '#1b202c',
                  padding: 16,
                  borderRadius: 14,
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  <label style={styles.label}>
                    所属创作流程
                    <select
                      style={styles.input}
                      value={skillKind}
                      onChange={(e) => {
                        const k = e.target.value as Kind;
                        setSkillKind(k);
                        if (k === 'transcribe') setSkillSlot('primary');
                      }}
                    >
                      <option value="foreign">国外迭代国外 (foreign · 主/副 2 槽位)</option>
                      <option value="domestic">国内迭代国外 (domestic · 主/副 2 槽位)</option>
                      <option value="transcribe">扒剧 (transcribe · 仅 1 个槽位)</option>
                      <option value="original">原创 (original · 主/副 2 槽位)</option>
                    </select>
                  </label>
                  <label style={styles.label}>
                    目标槽位
                    <select
                      style={styles.input}
                      value={skillKind === 'transcribe' ? 'primary' : skillSlot}
                      disabled={skillKind === 'transcribe'}
                      onChange={(e) => setSkillSlot(e.target.value as PromptSlotKey)}
                    >
                      <option value="primary">主提示词槽位 (primary)</option>
                      {skillKind !== 'transcribe' && (
                        <option value="secondary">副提示词槽位 (secondary)</option>
                      )}
                    </select>
                  </label>
                  <label style={styles.label}>
                    提示词名称 (创作者可见)
                    <input
                      style={styles.input}
                      value={skillName}
                      onChange={(e) => setSkillName(e.target.value)}
                      maxLength={80}
                      placeholder="如：北美豪门强节奏模板 v2"
                    />
                  </label>
                  <label style={styles.label}>
                    简短说明 (创作者可见，≤120 字)
                    <input
                      style={styles.input}
                      value={skillDesc}
                      onChange={(e) => setSkillDesc(e.target.value)}
                      maxLength={120}
                      placeholder="仅展示名称与简短说明，正文绝对不暴露给创作者"
                    />
                  </label>
                </div>

                <label style={styles.label}>
                  上传 .md / .txt 文件（推荐）
                  <input
                    ref={skillFileInputRef}
                    type="file"
                    accept=".md,.txt,text/markdown,text/plain"
                    style={styles.input}
                    onChange={async (e) => {
                      const f = e.target.files?.[0] || null;
                      setSkillFile(f);
                      if (f) {
                        setSkillFileName(f.name);
                        if (!skillName.trim()) {
                          setSkillName(f.name.replace(/\.(md|txt)$/i, '').slice(0, 80));
                        }
                        try {
                          const txt = await f.text();
                          setSkillContent(txt.replace(/^\uFEFF/, ''));
                        } catch {}
                      }
                    }}
                  />
                </label>

                <label style={styles.label}>
                  或直接粘贴 / 编辑提示词正文（仅服务端与管理员后台可见）
                  <textarea
                    rows={5}
                    style={{ ...styles.input, fontFamily: 'monospace', lineHeight: 1.55 }}
                    value={skillContent}
                    onChange={(e) => {
                      setSkillContent(e.target.value);
                      if (skillFile) setSkillFile(null);
                    }}
                    placeholder="支持 Markdown (.md) 或纯文本 (.txt)。上传文件后可在此预览，若修改文本将按编辑后内容保存。"
                  />
                </label>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#d0d7e2', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={skillIsDefault}
                      onChange={(e) => setSkillIsDefault(e.target.checked)}
                    />
                    设为该槽位默认插件（自动取消同槽位其他插件的默认状态）
                  </label>
                  <button type="submit" disabled={busy} style={styles.primaryBtn}>
                    {busy ? '正在保存…' : '✨ 上传并保存提示词插件'}
                  </button>
                </div>
              </form>
            </section>

            {/* Section 5B: 4-Workflow Slot Topology & Fallback Status */}
            <section style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                <div>
                  <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>
                    🗂️ 四流程槽位与插件库管理 · 自动回退状态一览
                  </h2>
                  <p style={{ margin: 0, color: '#939db0', fontSize: 12.5 }}>
                    扒剧固定 1 个槽位；国内迭代国外、国外迭代国外与原创各支持主 / 副 2 个槽位。停用或取消默认后自动回退内置规则。
                  </p>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(
                    [
                      { key: 'all', label: '全部流程' },
                      { key: 'transcribe', label: '扒剧' },
                      { key: 'domestic', label: '国内迭代国外' },
                      { key: 'foreign', label: '国外迭代国外' },
                      { key: 'original', label: '原创' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setSkillFilterKind(item.key)}
                      style={skillFilterKind === item.key ? styles.tabActive : styles.tabBtn}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gap: 16 }}>
                {WORKFLOW_SKILL_META.filter((wf) => skillFilterKind === 'all' || wf.kind === skillFilterKind).map((wf) => (
                  <div
                    key={wf.kind}
                    style={{
                      background: '#1b202c',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 16,
                      padding: 16,
                      display: 'grid',
                      gap: 14,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <strong style={{ fontSize: 15 }}>{wf.title}</strong>
                      <span style={styles.codeBadge}>{wf.badge}</span>
                    </div>

                    <div style={{ display: 'grid', gap: 12 }}>
                      {wf.slots.map((slotCfg) => {
                        const slotPlugins = allSkillPlugins.filter(
                          (p) => p.kind === wf.kind && p.slot === slotCfg.slot
                        );
                        const activeDefault = slotPlugins.find((p) => p.enabled && p.isDefault);
                        return (
                          <div
                            key={slotCfg.slot}
                            style={{
                              background: '#11151e',
                              border: '1px solid rgba(255,255,255,0.07)',
                              borderRadius: 12,
                              padding: 14,
                              display: 'grid',
                              gap: 10,
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{slotCfg.label}</div>
                                <small style={{ color: '#939db0', fontSize: 11.5 }}>{slotCfg.hint}</small>
                              </div>
                              <span style={{ fontSize: 12, color: '#939db0' }}>
                                共 {slotPlugins.length} 份插件
                              </span>
                            </div>

                            {/* Fallback Status Banner */}
                            {activeDefault ? (
                              <div
                                style={{
                                  padding: '8px 12px',
                                  borderRadius: 9,
                                  background: 'rgba(48, 209, 88, 0.1)',
                                  border: '1px solid rgba(48, 209, 88, 0.3)',
                                  color: '#30d158',
                                  fontSize: 12,
                                }}
                              >
                                ✓ 槽位默认生效：<strong>{activeDefault.name}</strong>（创作者选择「跟随系统默认」时使用；禁用或删除后回退系统内置规则）
                              </div>
                            ) : (
                              <div
                                style={{
                                  padding: '8px 12px',
                                  borderRadius: 9,
                                  background: 'rgba(255, 159, 10, 0.1)',
                                  border: '1px solid rgba(255, 159, 10, 0.28)',
                                  color: '#ff9f0a',
                                  fontSize: 12,
                                }}
                              >
                                ↺ 当前回退内置规则：该槽位暂无启用的默认插件，未指定时自动使用系统内置工位规则
                              </div>
                            )}

                            {slotPlugins.length === 0 ? (
                              <div style={{ fontSize: 12.5, color: '#939db0', padding: '6px 2px' }}>
                                该槽位尚未上传插件（当前 100% 使用系统内置规则）
                              </div>
                            ) : (
                              <div style={{ display: 'grid', gap: 10 }}>
                                {slotPlugins.map((plugin) => (
                                  <div
                                    key={plugin.id}
                                    style={{
                                      background: '#171c27',
                                      border: plugin.isDefault && plugin.enabled
                                        ? '1px solid rgba(10, 132, 255, 0.45)'
                                        : '1px solid rgba(255,255,255,0.08)',
                                      borderRadius: 11,
                                      padding: 12,
                                      display: 'grid',
                                      gap: 10,
                                    }}
                                  >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                                      <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                                          <strong style={{ fontSize: 13.5 }}>{plugin.name}</strong>
                                          <span style={styles.codeBadge}>.{plugin.fileExt.toUpperCase()}</span>
                                          <span style={{ fontSize: 11.5, color: '#939db0' }}>{plugin.fileName}</span>
                                          <span
                                            style={{
                                              fontSize: 11,
                                              padding: '2px 8px',
                                              borderRadius: 999,
                                              background: plugin.enabled ? 'rgba(48,209,88,0.14)' : 'rgba(147,157,176,0.16)',
                                              color: plugin.enabled ? '#30d158' : '#939db0',
                                            }}
                                          >
                                            {plugin.enabled ? '● 已启用' : '○ 已停用'}
                                          </span>
                                          {plugin.isDefault && (
                                            <span
                                              style={{
                                                fontSize: 11,
                                                padding: '2px 8px',
                                                borderRadius: 999,
                                                background: 'rgba(10,132,255,0.18)',
                                                color: '#7cc0ff',
                                              }}
                                            >
                                              ★ 槽位默认
                                            </span>
                                          )}
                                        </div>
                                        <div style={{ fontSize: 12, color: '#b7c0d0' }}>
                                          {plugin.description || '无简短说明'}
                                        </div>
                                        <small style={{ fontSize: 11, color: '#78849a' }}>
                                          更新于 {new Date(plugin.updatedAt).toLocaleString('zh-CN')} · 正文 {plugin.content.length} 字符
                                        </small>
                                      </div>

                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        <button
                                          type="button"
                                          disabled={busy}
                                          style={styles.smallSecondaryBtn}
                                          onClick={() =>
                                            adminAction(
                                              'toggle_skill_plugin',
                                              { id: plugin.id, enabled: !plugin.enabled },
                                              plugin.enabled ? `已停用「${plugin.name}」` : `✓ 已启用「${plugin.name}」`
                                            )
                                          }
                                        >
                                          {plugin.enabled ? '停用' : '启用'}
                                        </button>
                                        <button
                                          type="button"
                                          disabled={busy || (!plugin.isDefault && !plugin.enabled)}
                                          style={plugin.isDefault ? styles.smallPrimaryBtn : styles.smallSecondaryBtn}
                                          title={!plugin.isDefault && !plugin.enabled ? '请先启用后再设为默认' : undefined}
                                          onClick={() =>
                                            adminAction(
                                              'set_default_skill_plugin',
                                              { id: plugin.id, isDefault: !plugin.isDefault },
                                              plugin.isDefault
                                                ? `已取消「${plugin.name}」的槽位默认`
                                                : `✓ 已将「${plugin.name}」设为槽位默认`
                                            )
                                          }
                                        >
                                          {plugin.isDefault ? '取消默认' : '设为默认'}
                                        </button>
                                        <button
                                          type="button"
                                          disabled={busy}
                                          style={styles.smallSecondaryBtn}
                                          onClick={() => {
                                            if (editingSkillId === plugin.id) setEditingSkillId(null);
                                            else startEditSkill(plugin);
                                          }}
                                        >
                                          {editingSkillId === plugin.id ? '收起编辑' : '替换 / 编辑'}
                                        </button>
                                        <button
                                          type="button"
                                          style={styles.smallSecondaryBtn}
                                          onClick={() =>
                                            setPreviewSkillId(previewSkillId === plugin.id ? null : plugin.id)
                                          }
                                        >
                                          {previewSkillId === plugin.id ? '收起原文' : '查看原文'}
                                        </button>
                                        <button
                                          type="button"
                                          disabled={busy}
                                          style={styles.smallDangerBtn}
                                          onClick={() =>
                                            adminAction(
                                              'delete_skill_plugin',
                                              { id: plugin.id },
                                              `已删除提示词插件「${plugin.name}」`
                                            )
                                          }
                                        >
                                          删除
                                        </button>
                                      </div>
                                    </div>

                                    {previewSkillId === plugin.id && (
                                      <pre
                                        style={{
                                          margin: 0,
                                          padding: 12,
                                          borderRadius: 10,
                                          background: '#0c0e14',
                                          border: '1px solid rgba(255,255,255,0.08)',
                                          color: '#d8e0ee',
                                          fontSize: 12,
                                          lineHeight: 1.55,
                                          whiteSpace: 'pre-wrap',
                                          overflowWrap: 'anywhere',
                                          maxHeight: 260,
                                          overflowY: 'auto',
                                        }}
                                      >
                                        {plugin.content}
                                      </pre>
                                    )}

                                    {editingSkillId === plugin.id && (
                                      <div
                                        style={{
                                          padding: 12,
                                          borderRadius: 10,
                                          background: '#10141d',
                                          border: '1px solid rgba(10, 132, 255, 0.35)',
                                          display: 'grid',
                                          gap: 10,
                                        }}
                                      >
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                                          <label style={styles.label}>
                                            提示词名称
                                            <input
                                              style={styles.input}
                                              value={editSkillName}
                                              onChange={(e) => setEditSkillName(e.target.value)}
                                              maxLength={80}
                                            />
                                          </label>
                                          <label style={styles.label}>
                                            简短说明 (≤120 字)
                                            <input
                                              style={styles.input}
                                              value={editSkillDesc}
                                              onChange={(e) => setEditSkillDesc(e.target.value)}
                                              maxLength={120}
                                            />
                                          </label>
                                        </div>
                                        <label style={styles.label}>
                                          上传新文件替换 (.md / .txt，可选)
                                          <input
                                            type="file"
                                            accept=".md,.txt,text/markdown,text/plain"
                                            style={styles.input}
                                            onChange={async (e) => {
                                              const f = e.target.files?.[0] || null;
                                              setEditSkillFile(f);
                                              if (f) {
                                                setEditSkillFileName(f.name);
                                                try {
                                                  const txt = await f.text();
                                                  setEditSkillContent(txt.replace(/^\uFEFF/, ''));
                                                } catch {}
                                              }
                                            }}
                                          />
                                        </label>
                                        <label style={styles.label}>
                                          或直接修改提示词正文
                                          <textarea
                                            rows={5}
                                            style={{ ...styles.input, fontFamily: 'monospace', lineHeight: 1.5 }}
                                            value={editSkillContent}
                                            onChange={(e) => {
                                              setEditSkillContent(e.target.value);
                                              if (editSkillFile) setEditSkillFile(null);
                                            }}
                                          />
                                        </label>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                          <button
                                            type="button"
                                            disabled={busy}
                                            style={styles.smallPrimaryBtn}
                                            onClick={() => handleReplaceSkillPlugin(plugin.id)}
                                          >
                                            💾 保存替换
                                          </button>
                                          <button
                                            type="button"
                                            style={styles.smallSecondaryBtn}
                                            onClick={() => {
                                              setEditingSkillId(null);
                                              setEditSkillFile(null);
                                            }}
                                          >
                                            取消
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* TAB 6: Creation Tiers (前台脱敏档位与工位/模型映射) */}
        {activeTab === 'tiers' && systemConfig && (
          <div style={{ display: 'grid', gap: 20 }}>
            <section style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
                <div>
                  <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>🎛️ 创作档位配置（前台脱敏映射）</h2>
                  <p style={{ margin: 0, color: '#939db0', fontSize: 13 }}>
                    前台创作者仅可见脱敏后的档位名称与消耗倍率，底层中转通道、模型名与路由完全在此隔离配置。
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  style={styles.primaryBtn}
                  onClick={async () => {
                    await adminAction(
                      'save_creation_tiers',
                      { creationTiers: systemConfig.creationTiers || [] },
                      '创作档位映射已保存，前台下拉列表已即时同步'
                    );
                  }}
                >
                  💾 保存全部创作档位
                </button>
              </div>
              <div style={{ display: 'grid', gap: 14 }}>
                {(systemConfig.creationTiers || []).map((tier, idx) => (
                  <div key={tier.id} style={{ padding: 16, borderRadius: 12, background: 'rgba(15,23,42,0.45)', border: '1px solid #263147', display: 'grid', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                      <label style={styles.label}>
                        前台显示名称
                        <input
                          style={styles.input}
                          value={tier.name}
                          onChange={(e) => {
                            const next = [...(systemConfig.creationTiers || [])];
                            next[idx] = { ...tier, name: e.target.value };
                            setSystemConfig((prev) => (prev ? { ...prev, creationTiers: next } : prev));
                          }}
                        />
                      </label>
                      <label style={styles.label}>
                        消耗倍率提示
                        <input
                          style={styles.input}
                          value={tier.costHint}
                          onChange={(e) => {
                            const next = [...(systemConfig.creationTiers || [])];
                            next[idx] = { ...tier, costHint: e.target.value };
                            setSystemConfig((prev) => (prev ? { ...prev, creationTiers: next } : prev));
                          }}
                        />
                      </label>
                      <label style={styles.label}>
                        绑定中转渠道 ID
                        <select
                          style={styles.input}
                          value={tier.providerId || ''}
                          onChange={(e) => {
                            const next = [...(systemConfig.creationTiers || [])];
                            next[idx] = { ...tier, providerId: e.target.value };
                            setSystemConfig((prev) => (prev ? { ...prev, creationTiers: next } : prev));
                          }}
                        >
                          <option value="">跟随工位默认渠道</option>
                          {(systemConfig.providers || []).map((pr) => (
                            <option key={pr.id} value={pr.id}>{pr.name}</option>
                          ))}
                        </select>
                      </label>
                      <label style={styles.label}>
                        绑定底层模型（仅后台可见）
                        <input
                          style={styles.input}
                          value={tier.model || ''}
                          placeholder="留空则跟随工位模型"
                          onChange={(e) => {
                            const next = [...(systemConfig.creationTiers || [])];
                            next[idx] = { ...tier, model: e.target.value };
                            setSystemConfig((prev) => (prev ? { ...prev, creationTiers: next } : prev));
                          }}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'plans' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <section style={styles.card}>
              <h2 style={styles.sectionTitle}>7. 套餐与价格额度配置（save_plans）</h2>
              {billingErr ? (
                <div style={{ color: '#b91c1c', background: '#fef2f2', padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
                  {billingErr}
                </div>
              ) : null}
              {billingMsg ? (
                <div style={{ color: '#15803d', background: '#f0fdf4', padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
                  {billingMsg}
                </div>
              ) : null}

              <form onSubmit={handleSavePlan} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>套餐名称（planName）*</label>
                  <input
                    type="text"
                    value={planForm.planName}
                    onChange={(e) => setPlanForm({ ...planForm, planName: e.target.value })}
                    placeholder="如：专业月卡"
                    style={styles.input}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>标价 USD（priceUsd）*</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={planForm.priceUsd}
                    onChange={(e) => setPlanForm({ ...planForm, priceUsd: e.target.value })}
                    placeholder="如：19.90"
                    style={styles.input}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>发放额度 USD（creditUsd）*</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={planForm.creditUsd}
                    onChange={(e) => setPlanForm({ ...planForm, creditUsd: e.target.value })}
                    placeholder="如：25.00"
                    style={styles.input}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>周期（period）</label>
                  <select
                    value={planForm.period}
                    onChange={(e) => setPlanForm({ ...planForm, period: e.target.value })}
                    style={styles.input}
                  >
                    <option value="monthly">monthly（月度）</option>
                    <option value="quarterly">quarterly（季度）</option>
                    <option value="yearly">yearly（年度）</option>
                    <option value="one_time">one_time（单次额度）</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>状态（status）</label>
                  <select
                    value={planForm.status}
                    onChange={(e) => setPlanForm({ ...planForm, status: e.target.value })}
                    style={styles.input}
                  >
                    <option value="active">active（上架）</option>
                    <option value="disabled">disabled（下架）</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>备注说明</label>
                  <input
                    type="text"
                    value={planForm.description}
                    onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                    placeholder="可选说明"
                    style={styles.input}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                  <button type="submit" disabled={billingBusy} style={styles.primaryBtn}>
                    {planForm.id ? '更新套餐' : '新增套餐'}
                  </button>
                  {planForm.id ? (
                    <button
                      type="button"
                      onClick={() =>
                        setPlanForm({
                          id: '',
                          planName: '',
                          priceUsd: '',
                          creditUsd: '',
                          period: 'monthly',
                          status: 'active',
                          description: '',
                        })
                      }
                      style={styles.secondaryBtn}
                    >
                      取消编辑
                    </button>
                  ) : null}
                </div>
              </form>

              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>套餐 ID</th>
                      <th style={styles.th}>planName</th>
                      <th style={styles.th}>priceUsd</th>
                      <th style={styles.th}>creditUsd</th>
                      <th style={styles.th}>period</th>
                      <th style={styles.th}>status</th>
                      <th style={styles.th}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plansList.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: '#78716c' }}>
                          暂无套餐配置
                        </td>
                      </tr>
                    ) : (
                      plansList.map((p) => (
                        <tr key={p.id}>
                          <td style={styles.td}>{p.id}</td>
                          <td style={styles.td}>{p.planName}</td>
                          <td style={styles.td}>${Number(p.priceUsd || 0).toFixed(2)}</td>
                          <td style={styles.td}>${Number(p.creditUsd || 0).toFixed(2)}</td>
                          <td style={styles.td}>{p.period}</td>
                          <td style={styles.td}>{p.status}</td>
                          <td style={styles.td}>
                            <button
                              type="button"
                              onClick={() =>
                                setPlanForm({
                                  id: p.id,
                                  planName: p.planName || '',
                                  priceUsd: String(p.priceUsd ?? ''),
                                  creditUsd: String(p.creditUsd ?? ''),
                                  period: p.period || 'monthly',
                                  status: p.status || 'active',
                                  description: p.description || '',
                                })
                              }
                              style={styles.secondaryBtn}
                            >
                              编辑
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'orders' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <section style={styles.card}>
              <h2 style={styles.sectionTitle}>8. 订单审核入账（confirm_order）</h2>
              {billingErr ? (
                <div style={{ color: '#b91c1c', background: '#fef2f2', padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
                  {billingErr}
                </div>
              ) : null}
              {billingMsg ? (
                <div style={{ color: '#15803d', background: '#f0fdf4', padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
                  {billingMsg}
                </div>
              ) : null}

              <div style={{ fontSize: 13, color: '#78716c', marginBottom: 14 }}>
                当前活跃订阅总数：{subscriptionsList.filter((s) => s.status === 'active').length} / 全部订阅记录：{subscriptionsList.length}
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>订单 ID</th>
                      <th style={styles.th}>用户</th>
                      <th style={styles.th}>planName</th>
                      <th style={styles.th}>priceUsd</th>
                      <th style={styles.th}>creditUsd</th>
                      <th style={styles.th}>period</th>
                      <th style={styles.th}>渠道槽</th>
                      <th style={styles.th}>status</th>
                      <th style={styles.th}>审核操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordersList.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ ...styles.td, textAlign: 'center', color: '#78716c' }}>
                          暂无订单记录
                        </td>
                      </tr>
                    ) : (
                      ordersList.map((ord) => {
                        const isPending = ord.status === 'pending';
                        return (
                          <tr key={ord.id}>
                            <td style={styles.td}>{ord.id}</td>
                            <td style={styles.td}>{ord.username || ord.accountId || '-'}</td>
                            <td style={styles.td}>{ord.planName}</td>
                            <td style={styles.td}>${Number(ord.priceUsd || 0).toFixed(2)}</td>
                            <td style={styles.td}>${Number(ord.creditUsd || 0).toFixed(2)}</td>
                            <td style={styles.td}>{ord.period}</td>
                            <td style={styles.td}>
                              {ord.paymentChannel === 'test'
                                ? '沙盒测试'
                                : ord.paymentChannel === 'pending_gateway'
                                  ? '外部收银台扩展槽'
                                  : '人工核验入账'}
                            </td>
                            <td style={styles.td}>
                              {isPending ? 'pending（待管理员确认入账）' : `${ord.status}（已入账）`}
                            </td>
                            <td style={styles.td}>
                              {isPending ? (
                                <button
                                  type="button"
                                  disabled={billingBusy}
                                  onClick={() => handleConfirmOrder(ord)}
                                  style={styles.primaryBtn}
                                >
                                  确认入账
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleConfirmOrder(ord)}
                                  style={styles.secondaryBtn}
                                >
                                  已入账
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: '100vh',
    background: 'radial-gradient(circle at 15% 0%, rgba(10, 132, 255, 0.14), transparent 38%), #0c0e12',
    color: '#f3f5f8',
    padding: '28px 22px 64px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", sans-serif',
  },
  topbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 14,
    background: '#141821',
    padding: '16px 22px',
    borderRadius: 18,
    border: '1px solid rgba(255,255,255,0.09)',
  },
  badgeIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    background: 'linear-gradient(135deg, #0a84ff, #30d158)',
    display: 'grid',
    placeItems: 'center',
    fontSize: 20,
  },
  kpiCard: {
    background: '#141821',
    border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 16,
    padding: '15px 18px',
  },
  card: {
    background: '#141821',
    border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 20,
    padding: 22,
  },
  tabBtn: {
    padding: '10px 16px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.1)',
    background: '#141821',
    color: '#939db0',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  tabActive: {
    padding: '10px 16px',
    borderRadius: 999,
    border: '1px solid #0a84ff',
    background: 'rgba(10, 132, 255, 0.2)',
    color: '#7cc0ff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  label: {
    display: 'grid',
    gap: 6,
    fontSize: 12,
    color: '#939db0',
  },
  input: {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.12)',
    background: '#0e121a',
    color: '#f3f5f8',
    fontSize: 13,
  },
  primaryBtn: {
    padding: '10px 18px',
    borderRadius: 999,
    border: 0,
    background: '#0a84ff',
    color: '#fff',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '9px 15px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.14)',
    background: '#1b202c',
    color: '#f3f5f8',
    fontSize: 12.5,
    cursor: 'pointer',
  },
  smallPrimaryBtn: {
    padding: '5px 11px',
    borderRadius: 999,
    border: 0,
    background: '#0a84ff',
    color: '#fff',
    fontSize: 11.5,
    fontWeight: 600,
    cursor: 'pointer',
  },
  smallSecondaryBtn: {
    padding: '5px 10px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.14)',
    background: '#141821',
    color: '#d0d7e2',
    fontSize: 11.5,
    cursor: 'pointer',
  },
  smallDangerBtn: {
    padding: '5px 10px',
    borderRadius: 999,
    border: '1px solid rgba(255,69,58,0.35)',
    background: 'rgba(255,69,58,0.12)',
    color: '#ff6961',
    fontSize: 11.5,
    cursor: 'pointer',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.09)',
    color: '#939db0',
    fontSize: 11.5,
    fontWeight: 600,
  },
  td: {
    padding: '11px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    verticalAlign: 'middle',
  },
  codeBadge: {
    background: 'rgba(255,255,255,0.08)',
    padding: '3px 7px',
    borderRadius: 6,
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#7cc0ff',
  },
  toastBox: {
    padding: '12px 16px',
    borderRadius: 12,
    background: 'rgba(48, 209, 88, 0.15)',
    border: '1px solid rgba(48, 209, 88, 0.4)',
    color: '#30d158',
    fontSize: 13,
    fontWeight: 600,
  },
  errorBox: {
    padding: '12px 16px',
    borderRadius: 12,
    background: 'rgba(255, 69, 58, 0.15)',
    border: '1px solid rgba(255, 69, 58, 0.4)',
    color: '#ff6961',
    fontSize: 13,
  },
};
