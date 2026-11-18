'use client';

import React, { useEffect, useState } from 'react';
import type {
  AccountRole,
  AdminSystemConfig,
  ApiAuditLog,
  ApiProviderConfig,
  InviteKeyRecord,
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

export default function AdminConsolePage() {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<'accounts' | 'providers' | 'routes' | 'monitor'>('accounts');
  const [toast, setToast] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Admin Login Gate state
  const [loginMode, setLoginMode] = useState<'key' | 'password'>('key');
  const [loginKey, setLoginKey] = useState('AYIN-ADMIN-8888-KEY');
  const [loginUser, setLoginUser] = useState('ayin');
  const [loginPass, setLoginPass] = useState('ayin888');

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
  const [newAccPass, setNewAccPass] = useState('writer123');
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
  const [editingPassId, setEditingPassId] = useState<string | null>(null);
  const [editingPassVal, setEditingPassVal] = useState('');

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
      `方式二（账号 + 密码登录）：账号 ${acc.username} ｜ 密码 ${acc.password}`,
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

  function addPresetProvider(preset: 'openai' | 'openrouter' | 'gemini' | 'deepseek' | 'custom') {
    if (!systemConfig) return;
    const templates: Record<string, Partial<ApiProviderConfig>> = {
      openai: {
        name: 'OpenAI 官方 / 兼容线路',
        vendor: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-4o', 'gpt-4o-mini'],
        note: '支持多 Key 自动轮询',
      },
      openrouter: {
        name: 'OpenRouter 聚合渠道 (Claude/GPT)',
        vendor: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        models: ['anthropic/claude-3.5-sonnet', 'anthropic/claude-3.7-sonnet', 'openai/gpt-4o'],
        note: '推荐用于分集编剧与北美本土化精修',
      },
      gemini: {
        name: 'Google Gemini 视觉专线',
        vendor: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
        note: '推荐用于扒剧小能手视频/字幕还原',
      },
      deepseek: {
        name: 'DeepSeek 官方渠道',
        vendor: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        models: ['deepseek-chat', 'deepseek-reasoner'],
        note: '高性价比主力或容灾备用线路',
      },
      custom: {
        name: '自建 API 中转站 / OneAPI / NewAPI',
        vendor: 'custom',
        baseUrl: 'https://your-relay-api.example.com/v1',
        models: ['gpt-4o', 'claude-3-5-sonnet-latest', 'gemini-2.5-pro'],
        note: '兼容一切标准 OpenAI /v1/chat/completions 中转接口',
      },
    };
    const tpl = templates[preset];
    const newProv: ApiProviderConfig = {
      id: 'prov-' + Date.now(),
      name: tpl.name || '新 API 渠道',
      vendor: (tpl.vendor as any) || 'custom',
      baseUrl: tpl.baseUrl || 'https://api.openai.com/v1',
      apiKeys: [],
      models: tpl.models || ['gpt-4o'],
      enabled: true,
      priority: systemConfig.providers.length + 1,
      lastTestStatus: 'untested',
      note: tpl.note || '',
    };
    setSystemConfig({
      ...systemConfig,
      providers: [...systemConfig.providers, newProv],
    });
    showToast(`已添加「${newProv.name}」卡片，请填写 API Key 后点击保存`);
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
                    placeholder="输入 AYIN-ADMIN-8888-KEY"
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
                      placeholder="ayin"
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
                <button
                  type="button"
                  style={styles.secondaryBtn}
                  onClick={() => {
                    setLoginMode('key');
                    setLoginKey('AYIN-ADMIN-8888-KEY');
                    setLoginUser('ayin');
                    setLoginPass('ayin888');
                  }}
                >
                  ⚡ 一键填入默认凭证
                </button>
              </div>
            </form>

            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#939db0' }}>
              <span>默认管理员：ayin / ayin888</span>
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
              ● 当前管理员：{adminProfile?.displayName || 'ayin'}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <code>{acc.password}</code>
                              <button
                                type="button"
                                style={styles.smallSecondaryBtn}
                                onClick={() => {
                                  setEditingPassId(acc.id);
                                  setEditingPassVal(acc.password);
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
                    🔌 多渠道 API 供应商池（支持多 Key 负载均衡轮询与主备容灾）
                  </h2>
                  <p style={{ margin: 0, color: '#939db0', fontSize: 13 }}>
                    所有 API Key 均加密保存在服务端（`.data/studio-store.json`），创作者前台完全不可见。同一渠道可填写多个 Key（每行一个）实现自动轮询。
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" style={styles.secondaryBtn} onClick={() => addPresetProvider('openai')}>
                    ＋ 新增 OpenAI 渠道
                  </button>
                  <button type="button" style={styles.secondaryBtn} onClick={() => addPresetProvider('openrouter')}>
                    ＋ 新增 Claude / OpenRouter
                  </button>
                  <button type="button" style={styles.secondaryBtn} onClick={() => addPresetProvider('gemini')}>
                    ＋ 新增 Gemini 视觉渠道
                  </button>
                  <button type="button" style={styles.secondaryBtn} onClick={() => addPresetProvider('deepseek')}>
                    ＋ 新增 DeepSeek
                  </button>
                  <button type="button" style={styles.primaryBtn} onClick={() => addPresetProvider('custom')}>
                    ＋ 新增自定义中转站
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

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          disabled={busy}
                          style={styles.smallPrimaryBtn}
                          onClick={() =>
                            adminAction(
                              'save_provider',
                              { provider: prov },
                              `✓ 已保存渠道「${prov.name}」`
                            )
                          }
                        >
                          💾 保存此渠道
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
                                  ? `✓ 测速成功（耗时 ${tr.latencyMs} ms · 模型 ${tr.model}）：${tr.reply}`
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

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
                      <label style={styles.label}>
                        渠道名称
                        <input
                          style={styles.input}
                          value={prov.name}
                          onChange={(e) => updateLocalProvider(prov.id, { name: e.target.value })}
                        />
                      </label>
                      <label style={styles.label}>
                        接口地址 (API Base URL · 兼容 /v1/chat/completions)
                        <input
                          style={styles.input}
                          value={prov.baseUrl}
                          onChange={(e) => updateLocalProvider(prov.id, { baseUrl: e.target.value })}
                          placeholder="https://api.openai.com/v1"
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

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 12 }}>
                      <label style={styles.label}>
                        API Key 列表（支持填入多个 Key，每行一个，服务端自动轮询容灾）
                        <textarea
                          rows={3}
                          style={{ ...styles.input, fontFamily: 'monospace' }}
                          value={Array.isArray(prov.apiKeys) ? prov.apiKeys.join('\n') : ''}
                          onChange={(e) =>
                            updateLocalProvider(prov.id, {
                              apiKeys: e.target.value
                                .split('\n')
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="sk-proj-xxxxxxxxxxxx&#10;sk-proj-yyyyyyyyyyyy (可选第2个Key轮询)"
                        />
                      </label>
                      <label style={styles.label}>
                        该渠道支持的模型列表（逗号或换行分隔，供六大工位下拉选择）
                        <textarea
                          rows={3}
                          style={{ ...styles.input, fontFamily: 'monospace' }}
                          value={Array.isArray(prov.models) ? prov.models.join(', ') : ''}
                          onChange={(e) =>
                            updateLocalProvider(prov.id, {
                              models: e.target.value
                                .split(/[\n,]/)
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="gpt-4o, claude-3-5-sonnet-latest, gemini-2.5-pro"
                        />
                      </label>
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
                    为每个短剧编剧工位单独指定「主用渠道+模型」、「备用容灾渠道+模型」、温度参数及系统提示词。前台创作者调用时自动按此路由执行。
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
                      '✓ 已保存全部六大工位的模型路由与提示词配置'
                    )
                  }
                >
                  💾 一键保存全部六大工位配置
                </button>
              </div>

              <div style={{ display: 'grid', gap: 16 }}>
                {STATION_ORDER.map((roleKey) => {
                  const route = systemConfig.routes[roleKey];
                  if (!route) return null;
                  const primaryProv = systemConfig.providers.find((p) => p.id === route.primaryProviderId);
                  const fallbackProv = systemConfig.providers.find((p) => p.id === route.fallbackProviderId);

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
                                    ? `✓ 工位试跑成功：${st.reply}`
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
                          1. 主用 API 渠道 (Primary Provider)
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
                          2. 主用模型名称 (Primary Model)
                          <input
                            style={styles.input}
                            list={`models-primary-${roleKey}`}
                            value={route.primaryModel}
                            onChange={(e) => updateLocalRoute(roleKey, { primaryModel: e.target.value })}
                          />
                          <datalist id={`models-primary-${roleKey}`}>
                            {(primaryProv?.models || []).map((m) => (
                              <option key={m} value={m} />
                            ))}
                          </datalist>
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
                          3. 备用容灾渠道 (Fallback Provider)
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
                            <option value="">不启用备用渠道</option>
                            {systemConfig.providers.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label style={styles.label}>
                          4. 备用容灾模型 (Fallback Model)
                          <input
                            style={styles.input}
                            list={`models-fallback-${roleKey}`}
                            value={route.fallbackModel}
                            onChange={(e) => updateLocalRoute(roleKey, { fallbackModel: e.target.value })}
                          />
                          <datalist id={`models-fallback-${roleKey}`}>
                            {(fallbackProv?.models || []).map((m) => (
                              <option key={m} value={m} />
                            ))}
                          </datalist>
                        </label>
                      </div>

                      <label style={{ ...styles.label, marginTop: 12 }}>
                        5. 工位专属系统提示词 (System Prompt · 仅服务端可见，前台严格保密)
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
                            {log.tokens} tokens (${log.estimatedCostUsd.toFixed(4)})
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
