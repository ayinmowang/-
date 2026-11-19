'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Loader2,
  Moon,
  Sparkles,
  Sun,
  Ticket,
  User,
} from 'lucide-react';
import type { PublicAccountProfile } from '../lib/types';

type LoginMode = 'key' | 'password' | 'register';

function mapAuthError(code?: string, fallback?: string): string {
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return '账号、密码或专属 Key 不正确，请核对后重试';
    case 'ACCOUNT_DISABLED':
      return '该账号已被停用，请联系管理员';
    case 'INVALID_INVITE_CODE':
      return '邀请码无效、已吊销或已用完';
    case 'USERNAME_EXISTS':
      return '该登录账号已被占用，请更换';
    case 'INVITE_REGISTRATION_DISABLED':
      return '当前工作区已关闭自助注册，请联系管理员分发专属 Key';
    case 'INVALID_INPUT':
      return '请完整填写必填项（账号至少 2 位，密码至少 4 位）';
    default:
      return fallback || '登录请求未完成，请稍后重试';
  }
}

export default function LoginView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get('next') || '';
  const redirectTarget =
    nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/studio';

  const [mode, setMode] = useState<LoginMode>('key');
  const [allowInviteRegistration, setAllowInviteRegistration] = useState(true);
  const [currentSession, setCurrentSession] = useState<{
    authenticated: boolean;
    account: PublicAccountProfile | null;
  }>({ authenticated: false, account: null });

  const [accessKey, setAccessKey] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regDisplayName, setRegDisplayName] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('studio_theme');
      const docTheme = document.documentElement.getAttribute('data-theme');
      setTheme(saved === 'dark' || docTheme === 'dark' ? 'dark' : 'light');
    } catch {
      // ignore
    }

    let active = true;
    fetch('/api/auth', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setAllowInviteRegistration(data.allowInviteRegistration !== false);
        setCurrentSession({
          authenticated: Boolean(data.authenticated),
          account: data.account ?? null,
        });
      })
      .catch(() => {
        // ignore initial auth probe errors
      });
    return () => {
      active = false;
    };
  }, []);

  const toggleTheme = () => {
    const next: 'light' | 'dark' = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem('studio_theme', next);
    } catch {
      // ignore
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');

    if (mode === 'key' && !accessKey.trim()) {
      setError('请输入专属 Key 或管理员邀请码');
      return;
    }
    if (mode === 'password' && (!username.trim() || !password)) {
      setError('请输入登录账号和密码');
      return;
    }
    if (mode === 'register') {
      if (!allowInviteRegistration) {
        setError('当前已关闭邀请码自助注册，请联系管理员分发专属 Key');
        return;
      }
      if (!inviteCode.trim() || regUsername.trim().length < 2 || regPassword.length < 4) {
        setError('请完整填写必填项（账号至少 2 位，密码至少 4 位）');
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload =
        mode === 'key'
          ? { action: 'login_key', key: accessKey.trim() }
          : mode === 'password'
          ? { action: 'login_password', username: username.trim(), password }
          : {
              action: 'register_with_invite',
              inviteCode: inviteCode.trim(),
              username: regUsername.trim(),
              displayName: regDisplayName.trim() || regUsername.trim(),
              password: regPassword,
            };

      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(mapAuthError(data.error, data.message));
        return;
      }

      if (data.account) {
        window.dispatchEvent(
          new CustomEvent('studio:account-updated', { detail: { account: data.account } })
        );
      }
      router.push(redirectTarget);
      router.refresh();
    } catch {
      setError('网络连接异常，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="warm-login-page">
      <header className="warm-login-topbar">
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="warm-brand-mark">剧</span>
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <strong style={{ fontFamily: 'var(--font-serif)', fontSize: 16 }}>剧本工作台</strong>
            <small style={{ fontSize: 11, color: 'var(--text-muted)' }}>专业短剧创作工作台</small>
          </span>
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className="warm-icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? '切换浅色主题' : '切换暗色主题'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <Link href="/studio" className="warm-cta-outline" style={{ minHeight: 36 }}>
            <span>进入工作台</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      <main className="warm-login-body">
        <section className="warm-login-hero" aria-label="东方书房美学导览">
          <div className="warm-login-hero-copy">
            <h1>
              用文字
              <span>书写另一个世界</span>
            </h1>
            <p>在这里，每一个故事都有无限可能</p>
            <div className="warm-login-hero-rule" />
            <div className="warm-login-hero-tags">创作 · 协力 · 迭代 · 交付</div>
          </div>

          <div className="warm-login-artwork" aria-hidden="true">
            <svg
              viewBox="0 0 640 240"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ width: '100%', height: 'auto', display: 'block' }}
            >
              {/* Warm Cinnabar Sun */}
              <circle cx="508" cy="64" r="34" fill="#8C3B2B" fillOpacity="0.82" />
              <circle cx="508" cy="64" r="48" fill="#D49B54" fillOpacity="0.16" />

              {/* Distant Ink Peaks */}
              <path
                d="M0 190 L98 118 L184 156 L290 92 L404 154 L512 108 L640 168 L640 240 L0 240 Z"
                fill="#D49B54"
                fillOpacity="0.22"
              />
              <path
                d="M0 205 L126 142 L238 182 L352 124 L476 176 L584 136 L640 162 L640 240 L0 240 Z"
                fill="#5B4F47"
                fillOpacity="0.22"
              />
              <path
                d="M0 222 Q160 198 320 216 T640 206 L640 240 L0 240 Z"
                fill="#2C2420"
                fillOpacity="0.18"
              />

              {/* Pine Silhouette Left */}
              <path
                d="M52 215 L52 138 M52 156 L30 144 M52 146 L74 134 M52 172 L26 164 M52 166 L78 158"
                stroke="#2C2420"
                strokeOpacity="0.55"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <ellipse cx="32" cy="142" rx="18" ry="7" fill="#2C2420" fillOpacity="0.35" />
              <ellipse cx="74" cy="132" rx="16" ry="6" fill="#2C2420" fillOpacity="0.35" />

              {/* Small Boat & Mist */}
              <path
                d="M366 206 Q398 214 432 206 L422 214 L376 214 Z"
                fill="#8C3B2B"
                fillOpacity="0.65"
              />
              <path
                d="M140 194 Q240 186 340 196"
                stroke="#F9F6F0"
                strokeOpacity="0.7"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <path
                d="M448 188 Q520 182 600 190"
                stroke="#F9F6F0"
                strokeOpacity="0.55"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </section>

        <section className="warm-login-card" aria-label="登录与激活表单">
          <div className="warm-login-card-head">
            <div className="warm-login-emblem">墨</div>
            <h2>剧本工作台</h2>
            <p>欢迎回来 · 登录您的账户以继续</p>
          </div>

          {currentSession.authenticated && currentSession.account && (
            <div
              className="warm-alert info"
              style={{
                marginBottom: 16,
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>
                当前已登录：<strong>{currentSession.account.displayName}</strong>
              </span>
              <Link
                href={redirectTarget}
                style={{
                  color: 'var(--accent-cinnabar)',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}
              >
                直接进入工作台 →
              </Link>
            </div>
          )}

          <div className="warm-login-tabs" role="tablist" aria-label="登录方式切换">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'key'}
              className={`warm-login-tab${mode === 'key' ? ' active' : ''}`}
              onClick={() => {
                setMode('key');
                setError('');
              }}
            >
              专属 Key / 邀请码
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'password'}
              className={`warm-login-tab${mode === 'password' ? ' active' : ''}`}
              onClick={() => {
                setMode('password');
                setError('');
              }}
            >
              账号密码
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              className={`warm-login-tab${mode === 'register' ? ' active' : ''}`}
              onClick={() => {
                setMode('register');
                setError('');
              }}
            >
              邀请码注册
            </button>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            {mode === 'key' && (
              <div className="warm-field">
                <label htmlFor="login-key-input">专属 Key 或管理员邀请码</label>
                <div className="warm-login-input-wrap">
                  <KeyRound size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <input
                    id="login-key-input"
                    type="text"
                    value={accessKey}
                    onChange={(e) => setAccessKey(e.target.value)}
                    placeholder="输入专属 Key 或管理员邀请码"
                    autoComplete="off"
                  />
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  输入管理员分发的专属 Key 或一次性邀请码，即可快速进入您的创作空间。
                </p>
              </div>
            )}

            {mode === 'password' && (
              <>
                <div className="warm-field">
                  <label htmlFor="login-username-input">登录账号</label>
                  <div className="warm-login-input-wrap">
                    <User size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <input
                      id="login-username-input"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="请输入用户名"
                      autoComplete="username"
                    />
                  </div>
                </div>

                <div className="warm-field">
                  <label htmlFor="login-password-input">登录密码</label>
                  <div className="warm-login-input-wrap">
                    <Lock size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <input
                      id="login-password-input"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="请输入密码"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                      style={{ color: 'var(--text-muted)', padding: 4 }}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {mode === 'register' && (
              <>
                {!allowInviteRegistration && (
                  <div className="warm-alert info" style={{ marginBottom: 14 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>当前已关闭邀请码自助注册，请联系管理员分发专属 Key。</span>
                  </div>
                )}

                <div className="warm-field">
                  <label htmlFor="reg-invite-input">管理员邀请码</label>
                  <div className="warm-login-input-wrap">
                    <Ticket size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <input
                      id="reg-invite-input"
                      type="text"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      placeholder="例如：AYIN-INV-..."
                      disabled={!allowInviteRegistration}
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className="warm-field">
                  <label htmlFor="reg-username-input">设置登录账号（至少 2 位）</label>
                  <div className="warm-login-input-wrap">
                    <User size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <input
                      id="reg-username-input"
                      type="text"
                      value={regUsername}
                      onChange={(e) => setRegUsername(e.target.value)}
                      placeholder="英文/数字用户名"
                      disabled={!allowInviteRegistration}
                      autoComplete="username"
                    />
                  </div>
                </div>

                <div className="warm-field">
                  <label htmlFor="reg-display-input">创作者昵称（选填）</label>
                  <div className="warm-login-input-wrap">
                    <Sparkles size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <input
                      id="reg-display-input"
                      type="text"
                      value={regDisplayName}
                      onChange={(e) => setRegDisplayName(e.target.value)}
                      placeholder="如：林编剧"
                      disabled={!allowInviteRegistration}
                    />
                  </div>
                </div>

                <div className="warm-field">
                  <label htmlFor="reg-password-input">设置登录密码（至少 4 位）</label>
                  <div className="warm-login-input-wrap">
                    <Lock size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <input
                      id="reg-password-input"
                      type={showPassword ? 'text' : 'password'}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="至少 4 位字符"
                      minLength={4}
                      disabled={!allowInviteRegistration}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                      style={{ color: 'var(--text-muted)', padding: 4 }}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {error && (
              <div className="warm-alert error" role="alert" style={{ marginBottom: 14 }}>
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              className="warm-cta-cinnabar"
              disabled={submitting || (mode === 'register' && !allowInviteRegistration)}
              style={{ width: '100%', marginTop: 4 }}
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="spin" />
                  <span>正在验证...</span>
                </>
              ) : (
                <span>
                  {mode === 'register' ? '激活并注册进入工作台' : '登录进入工作台'}
                </span>
              )}
            </button>
          </form>

          <div
            style={{
              marginTop: 18,
              paddingTop: 14,
              borderTop: '1px solid var(--border-warm)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 12,
              color: 'var(--text-muted)',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span>收到团队激活码？</span>
            <Link href="/redeem" style={{ color: 'var(--accent-cinnabar)', fontWeight: 600 }}>
              前往兑换 / 邀请码页面 →
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
