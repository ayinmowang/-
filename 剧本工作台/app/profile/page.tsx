'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BookOpen, CheckCircle2, Lock, Moon, Save, Sun, Upload, User } from 'lucide-react';
import WarmShell from '../../components/WarmShell';
import type { PublicAccountProfile } from '../../lib/types';

export default function ProfilePage() {
  const [account, setAccount] = useState<PublicAccountProfile | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [themePreference, setThemePreference] = useState<'light' | 'dark'>('light');
  const [globalRules, setGlobalRules] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const rulesFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/profile');
        if (res.status === 401) {
          setAuthRequired(true);
          return;
        }
        const json = await res.json();
        if (res.ok) {
          setAccount(json.account || null);
          setDisplayName(json.account?.displayName || '');
          setThemePreference(json.themePreference === 'dark' ? 'dark' : 'light');
          setGlobalRules(json.globalRules || '');
        }
      } catch {}
    })();
  }, []);

  async function saveProfile(payload: Record<string, any>, successLabel: string) {
    setSaving(true);
    setMsg('');
    setError('');
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || json.error || '保存失败');
      setAccount(json.account || null);
      if (json.themePreference) {
        setThemePreference(json.themePreference);
        document.documentElement.setAttribute('data-theme', json.themePreference);
        document.documentElement.classList.toggle('dark', json.themePreference === 'dark');
        try {
          localStorage.setItem('studio_theme', json.themePreference);
        } catch {}
      }
      if (typeof json.globalRules === 'string') setGlobalRules(json.globalRules);
      setMsg(successLabel);
    } catch (e: any) {
      setError(e.message || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  async function importRulesFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const cleaned = text.replace(/^\uFEFF/, '').trim();
    if (cleaned) {
      setGlobalRules((prev) => (prev.trim() ? `${prev.trim()}\n\n${cleaned}` : cleaned));
      setMsg(`已导入「${file.name}」，点击保存即可全剧生效`);
    }
  }

  return (
    <WarmShell
      activeNav="profile"
      title="个人资料"
      subtitle="管理个人显示名称、密码安全、界面主题与全作品通用的全局创作规矩"
      account={account}
      authenticated={!authRequired && Boolean(account)}
    >
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '24px 20px 56px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {authRequired ? (
          <div style={{ background: 'var(--warm-card, #fff)', border: '1px solid var(--warm-border, #e6dfd3)', borderRadius: 16, padding: 36, textAlign: 'center' }}>
            <h2 style={{ fontFamily: 'serif', marginBottom: 8 }}>请先登录管理个人资料</h2>
            <Link
              href="/login"
              style={{ display: 'inline-block', padding: '10px 22px', borderRadius: 10, background: '#8C3B2B', color: '#fff', textDecoration: 'none', fontWeight: 600 }}
            >
              前往登录
            </Link>
          </div>
        ) : (
          <>
            {msg && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(22,163,74,0.1)', color: '#15803d', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={15} /> {msg}
              </div>
            )}
            {error && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: '#fee2e2', color: '#991b1b', fontSize: 13 }}>
                {error}
              </div>
            )}

            {/* Basic Profile & Theme */}
            <section style={{ background: 'var(--warm-card, #fff)', border: '1px solid var(--warm-border, #e6dfd3)', borderRadius: 16, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <User size={18} color="#8C3B2B" />
                <h3 style={{ margin: 0, fontSize: 16 }}>基本信息与书房主题</h3>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  账号名（不可修改）
                  <input
                    disabled
                    value={account?.username || ''}
                    style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--warm-border, #e6dfd3)', opacity: 0.7 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  显示昵称
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="输入你的编剧昵称"
                    style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--warm-border, #d8cfc0)', background: 'var(--warm-surface, #faf7f2)' }}
                  />
                </label>
              </div>
              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setThemePreference('light')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 14px',
                      borderRadius: 10,
                      border: themePreference === 'light' ? '2px solid #8C3B2B' : '1px solid var(--warm-border, #d8cfc0)',
                      background: themePreference === 'light' ? 'rgba(140,59,43,0.08)' : 'transparent',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    <Sun size={14} /> 暖宣纸浅色
                  </button>
                  <button
                    type="button"
                    onClick={() => setThemePreference('dark')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 14px',
                      borderRadius: 10,
                      border: themePreference === 'dark' ? '2px solid #D49B54' : '1px solid var(--warm-border, #d8cfc0)',
                      background: themePreference === 'dark' ? 'rgba(212,155,84,0.14)' : 'transparent',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    <Moon size={14} /> 墨韵暗色书房
                  </button>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveProfile({ displayName, themePreference }, '基本信息与主题偏好已保存')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '9px 18px',
                    borderRadius: 10,
                    background: '#8C3B2B',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  <Save size={14} /> 保存资料与主题
                </button>
              </div>
            </section>

            {/* Global Rules */}
            <section style={{ background: 'var(--warm-card, #fff)', border: '1px solid var(--warm-border, #e6dfd3)', borderRadius: 16, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <BookOpen size={18} color="#8C3B2B" />
                  <h3 style={{ margin: 0, fontSize: 16 }}>全局创作规矩（所有作品通用）</h3>
                </div>
                <button
                  type="button"
                  onClick={() => rulesFileRef.current?.click()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--warm-border, #d8cfc0)',
                    background: 'var(--warm-surface, #faf7f2)',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  <Upload size={13} /> 导入 txt / md
                </button>
                <input
                  ref={rulesFileRef}
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    importRulesFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>
              <p style={{ margin: '0 0 12px', fontSize: 13, opacity: 0.72 }}>
                这里配置的规矩会自动注入所有作品的创作上下文（例如：黄金前 3 秒必出冲突、禁止说教腔、每集尾留钩子）。
              </p>
              <textarea
                rows={5}
                value={globalRules}
                onChange={(e) => setGlobalRules(e.target.value)}
                placeholder="例如：文风克制凌厉、前 3 秒直接切入高能冲突、禁止站桩纯聊、每集结尾必留强钩子…"
                style={{
                  width: '100%',
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid var(--warm-border, #d8cfc0)',
                  background: 'var(--warm-surface, #faf7f2)',
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              />
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveProfile({ globalRules }, '全局创作规矩已保存，将对所有作品生效')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '9px 18px',
                    borderRadius: 10,
                    background: '#8C3B2B',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  <Save size={14} /> 保存全局规矩
                </button>
              </div>
            </section>

            {/* Change Password */}
            <section style={{ background: 'var(--warm-card, #fff)', border: '1px solid var(--warm-border, #e6dfd3)', borderRadius: 16, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Lock size={18} color="#8C3B2B" />
                <h3 style={{ margin: 0, fontSize: 16 }}>修改登录密码</h3>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  当前密码
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="输入当前登录密码"
                    style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--warm-border, #d8cfc0)', background: 'var(--warm-surface, #faf7f2)' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  新密码（至少 4 位）
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="设置新密码"
                    style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--warm-border, #d8cfc0)', background: 'var(--warm-surface, #faf7f2)' }}
                  />
                </label>
              </div>
              <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  disabled={saving || !currentPassword || newPassword.length < 4}
                  onClick={async () => {
                    await saveProfile({ currentPassword, newPassword }, '登录密码已更新');
                    setCurrentPassword('');
                    setNewPassword('');
                  }}
                  style={{
                    padding: '9px 18px',
                    borderRadius: 10,
                    background: '#2C2420',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  更新密码
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </WarmShell>
  );
}
