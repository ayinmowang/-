'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Bell,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Clapperboard,
  CreditCard,
  Droplets,
  Gift,
  LogIn,
  LogOut,
  Menu,
  Moon,
  PenTool,
  Receipt,
  RefreshCw,
  Repeat,
  Shield,
  Sun,
  User,
  X,
} from 'lucide-react';
import type { PublicAccountProfile } from '../lib/types';

export type WarmNavKey =
  | 'studio'
  | 'breakdown'
  | 'usage'
  | 'subscriptions'
  | 'purchase'
  | 'orders'
  | 'redeem'
  | 'profile'
  | 'admin';
export interface WarmNotificationItem {
  id: string;
  title: string;
  detail?: string;
  time?: string;
}

export interface WarmShellProps {
  activeNav: WarmNavKey;
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  editableTitle?: string;
  onRenameTitle?: (nextTitle: string) => void | Promise<void>;
  account?: PublicAccountProfile | null;
  authenticated?: boolean;
  notifications?: WarmNotificationItem[];
  headerExtra?: ReactNode;
  fullBleed?: boolean;
  children: ReactNode;
}

const NAV_ITEMS: Array<{
  key: WarmNavKey;
  label: string;
  href: string;
  icon: typeof PenTool;
  adminOnly?: boolean;
}> = [
  { key: 'studio', label: '创作台', href: '/studio', icon: PenTool },
  { key: 'breakdown', label: '拆书 · 扒剧', href: '/breakdown', icon: Clapperboard },
  { key: 'usage', label: '用量与额度', href: '/usage', icon: BarChart3 },
  { key: 'subscriptions', label: '我的订阅', href: '/subscriptions', icon: Repeat },
  { key: 'purchase', label: '充值 / 会员', href: '/purchase', icon: CreditCard },
  { key: 'orders', label: '我的订单', href: '/orders', icon: Receipt },
  { key: 'redeem', label: '兑换 / 邀请码', href: '/redeem', icon: Gift },
  { key: 'profile', label: '个人资料', href: '/profile', icon: User },
  { key: 'admin', label: '管理后台', href: '/admin', icon: Shield, adminOnly: true },
];

function roleLabel(role?: string): string {
  if (role === 'admin') return '管理员';
  if (role === 'reviewer') return '审稿';
  return '编剧';
}

function applyDocumentTheme(nextTheme: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', nextTheme);
  document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  try {
    localStorage.setItem('studio_theme', nextTheme);
  } catch {
    // ignore storage quota errors
  }
}

export default function WarmShell({
  activeNav,
  title,
  subtitle,
  backHref,
  backLabel = '返回剧架',
  editableTitle,
  onRenameTitle,
  account: accountProp,
  authenticated: authenticatedProp,
  notifications = [],
  headerExtra,
  fullBleed = false,
  children,
}: WarmShellProps) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(editableTitle ?? '');
  const [authState, setAuthState] = useState<{
    loaded: boolean;
    authenticated: boolean;
    requireAuthOnFrontend: boolean;
    account: PublicAccountProfile | null;
  }>({
    loaded: accountProp !== undefined,
    authenticated: Boolean(authenticatedProp),
    requireAuthOnFrontend: false,
    account: accountProp ?? null,
  });

  const notifRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEditingTitle(editableTitle ?? '');
  }, [editableTitle]);

  useEffect(() => {
    if (accountProp !== undefined) {
      setAuthState((prev) => ({
        ...prev,
        loaded: true,
        authenticated: authenticatedProp !== undefined ? authenticatedProp : Boolean(accountProp),
        account: accountProp ?? null,
      }));
    }
  }, [accountProp, authenticatedProp]);

  useEffect(() => {
    try {
      const savedCollapsed = localStorage.getItem('warm_sidebar_collapsed');
      if (savedCollapsed === '1') setCollapsed(true);
      const docTheme = document.documentElement.getAttribute('data-theme');
      const savedTheme = localStorage.getItem('studio_theme');
      const resolvedTheme = docTheme === 'dark' || savedTheme === 'dark' ? 'dark' : 'light';
      setTheme(resolvedTheme);
      applyDocumentTheme(resolvedTheme);
    } catch {
      // ignore client storage unavailability
    }
  }, []);

  useEffect(() => {
    if (accountProp !== undefined) return;
    let active = true;
    fetch('/api/auth', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setAuthState({
          loaded: true,
          authenticated: Boolean(data.authenticated),
          requireAuthOnFrontend: Boolean(data.requireAuthOnFrontend),
          account: data.account ?? null,
        });
        if (data.authenticated && (data.account?.themePreference === 'dark' || data.account?.themePreference === 'light')) {
          const hasLocal = (() => {
            try {
              return Boolean(localStorage.getItem('studio_theme'));
            } catch {
              return false;
            }
          })();
          if (!hasLocal) {
            setTheme(data.account.themePreference);
            applyDocumentTheme(data.account.themePreference);
          }
        }
      })
      .catch(() => {
        if (active) setAuthState((prev) => ({ ...prev, loaded: true }));
      });
    return () => {
      active = false;
    };
  }, [accountProp]);

  useEffect(() => {
    const onThemeChange = (ev: Event) => {
      const custom = ev as CustomEvent<{ theme?: 'light' | 'dark' }>;
      const next = custom.detail?.theme;
      if (next === 'dark' || next === 'light') {
        setTheme(next);
        applyDocumentTheme(next);
      }
    };
    const onAccountUpdated = (ev: Event) => {
      const custom = ev as CustomEvent<{ account?: PublicAccountProfile | null }>;
      if (custom.detail && 'account' in custom.detail) {
        const nextAcc = custom.detail.account ?? null;
        setAuthState((prev) => ({
          ...prev,
          loaded: true,
          authenticated: Boolean(nextAcc),
          account: nextAcc,
        }));
      }
    };
    window.addEventListener('studio:theme-change', onThemeChange);
    window.addEventListener('studio:account-updated', onAccountUpdated);
    return () => {
      window.removeEventListener('studio:theme-change', onThemeChange);
      window.removeEventListener('studio:account-updated', onAccountUpdated);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
        setNotifOpen(false);
        setUserMenuOpen(false);
      }
    };
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (notifRef.current && !notifRef.current.contains(target)) {
        setNotifOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setUserMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, []);

  const activeAccount = accountProp !== undefined ? accountProp : authState.account;
  const isAuthenticated =
    authenticatedProp !== undefined ? authenticatedProp : authState.authenticated;

  const remainingQuota = activeAccount
    ? Math.max(0, Number(activeAccount.budgetCapUsd || 0) - Number(activeAccount.budgetUsedUsd || 0))
    : 0;

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem('warm_sidebar_collapsed', next ? '1' : '0');
    } catch {
      // ignore
    }
  };

  const handleToggleTheme = () => {
    const nextTheme: 'light' | 'dark' = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    applyDocumentTheme(nextTheme);
    window.dispatchEvent(new CustomEvent('studio:theme-change', { detail: { theme: nextTheme } }));
    if (isAuthenticated) {
      fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themePreference: nextTheme }),
      }).catch(() => {
        // non-fatal preference sync
      });
    }
  };

  const handleLogout = async () => {
    setUserMenuOpen(false);
    try {
      await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
      });
    } catch {
      // ignore network failures on logout
    }
    setAuthState((prev) => ({
      ...prev,
      authenticated: false,
      account: null,
    }));
    window.dispatchEvent(new CustomEvent('studio:account-updated', { detail: { account: null } }));
    router.push('/login');
    router.refresh();
  };

  const commitTitleRename = () => {
    if (editableTitle === undefined || !onRenameTitle) return;
    const trimmed = editingTitle.trim();
    if (!trimmed) {
      setEditingTitle(editableTitle);
      return;
    }
    if (trimmed !== editableTitle) {
      void onRenameTitle(trimmed);
    }
  };

  const visibleNavItems = NAV_ITEMS.filter(
    (item) => !item.adminOnly || activeAccount?.role === 'admin'
  );

  const mergedNotifications: WarmNotificationItem[] =
    notifications.length > 0
      ? notifications
      : [
          {
            id: 'sys-ready',
            title: '工作台运行正常',
            detail: activeAccount
              ? `当前工作空间：${activeAccount.displayName}，剩余额度 $${remainingQuota.toFixed(2)}`
              : '登录或使用邀请码即可解锁个人创作记录与额度统计。',
            time: '刚刚',
          },
        ];

  return (
    <div className="warm-shell">
      {drawerOpen && (
        <div
          className="warm-scrim"
          aria-hidden="true"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <aside
        className={`warm-sidebar${collapsed ? ' collapsed' : ''}${drawerOpen ? ' open' : ''}`}
        aria-label="主导航栏"
      >
        <div className="warm-brand">
          <Link href="/studio" className="warm-brand-mark" aria-label="剧本工作台首页">
            剧
          </Link>
          <div className="warm-brand-text">
            <strong>剧本工作台</strong>
            <small>暖纸墨韵创作室</small>
          </div>
          {drawerOpen && (
            <button
              type="button"
              className="warm-icon-btn"
              style={{ marginLeft: 'auto' }}
              aria-label="关闭侧边导航"
              onClick={() => setDrawerOpen(false)}
            >
              <X size={16} />
            </button>
          )}
        </div>

        <nav className="warm-nav" aria-label="一级板块导航">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.key;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`warm-nav-item${isActive ? ' active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                title={collapsed ? item.label : undefined}
                onClick={() => setDrawerOpen(false)}
              >
                <Icon size={17} strokeWidth={2} />
                <span className="warm-nav-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="warm-sidebar-footer">
          <button
            type="button"
            className="warm-collapse-btn"
            onClick={toggleCollapse}
            aria-label={collapsed ? '展开导航栏' : '收起导航栏'}
            title={collapsed ? '展开导航栏' : '收起导航栏'}
          >
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            <span className="warm-collapse-label">收起导航</span>
          </button>
        </div>
      </aside>

      <div className="warm-main">
        <header className="warm-topbar">
          <div className="warm-topbar-left">
            <button
              type="button"
              className="warm-mobile-menu"
              aria-label="打开导航菜单"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen((v) => !v)}
            >
              <Menu size={18} />
            </button>

            {backHref && (
              <Link href={backHref} className="warm-back-pill">
                <ArrowLeft size={14} />
                <span>{backLabel}</span>
              </Link>
            )}

            {editableTitle !== undefined ? (
              <input
                type="text"
                className="warm-title-edit"
                aria-label="编辑当前作品名称"
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={commitTitleRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <div className="warm-topbar-titles">
                <h1>{title}</h1>
                {subtitle && <p>{subtitle}</p>}
              </div>
            )}
          </div>

          <div className="warm-topbar-right">
            {headerExtra}

            <div className="warm-popover-wrap" ref={notifRef}>
              <button
                type="button"
                className="warm-icon-btn"
                aria-label="查看消息通知"
                aria-expanded={notifOpen}
                onClick={() => {
                  setNotifOpen((v) => !v);
                  setUserMenuOpen(false);
                }}
              >
                <Bell size={16} />
                {mergedNotifications.length > 0 && <span className="warm-notif-dot" />}
              </button>

              {notifOpen && (
                <div className="warm-popover" role="dialog" aria-label="系统通知">
                  <div className="warm-popover-header">
                    <strong>工作台通知</strong>
                    <small>创作状态与额度动态</small>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {mergedNotifications.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 10,
                          background: 'var(--bg-surface-warm)',
                          border: '1px solid var(--border-warm)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 12.5,
                            fontWeight: 600,
                          }}
                        >
                          <span>{item.title}</span>
                          {item.time && (
                            <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                              {item.time}
                            </span>
                          )}
                        </div>
                        {item.detail && (
                          <p
                            style={{
                              margin: '4px 0 0',
                              fontSize: 11.5,
                              color: 'var(--text-secondary)',
                              lineHeight: 1.5,
                            }}
                          >
                            {item.detail}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              className="warm-icon-btn"
              onClick={handleToggleTheme}
              aria-label={theme === 'dark' ? '切换为暖宣纸浅色主题' : '切换为深墨书房暗色主题'}
              title={theme === 'dark' ? '切换浅色主题' : '切换暗色主题'}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {activeAccount && (!authState.requireAuthOnFrontend || isAuthenticated) ? (
              <Link
                href="/usage"
                className="warm-quota-pill"
                aria-label="查看用量与额度"
                title="点击查看详细用量与额度"
              >
                <Droplets size={14} />
                <span>${remainingQuota.toFixed(2)} 可用</span>
              </Link>
            ) : (
              <Link href="/login" className="warm-quota-pill">
                <LogIn size={14} />
                <span>未登录 · 去登录</span>
              </Link>
            )}

            <div className="warm-popover-wrap" ref={userMenuRef}>
              {activeAccount ? (
                <button
                  type="button"
                  className="warm-user-pill"
                  aria-label="账号菜单"
                  aria-expanded={userMenuOpen}
                  onClick={() => {
                    setUserMenuOpen((v) => !v);
                    setNotifOpen(false);
                  }}
                >
                  <span className="warm-avatar-btn">
                    {(activeAccount.displayName || activeAccount.username || '创')
                      .slice(0, 1)
                      .toUpperCase()}
                  </span>
                  <span className="warm-user-meta">
                    <strong>{activeAccount.displayName || activeAccount.username}</strong>
                    <small>{roleLabel(activeAccount.role)}</small>
                  </span>
                  <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
                </button>
              ) : (
                <Link href="/login" className="warm-cta-cinnabar" style={{ minHeight: 36, padding: '7px 14px', fontSize: 12.5 }}>
                  <LogIn size={14} />
                  <span>登录</span>
                </Link>
              )}

              {userMenuOpen && activeAccount && (
                <div className="warm-popover" role="menu" aria-label="个人账号操作">
                  <div className="warm-popover-header">
                    <strong>{activeAccount.displayName}</strong>
                    <small>
                      @{activeAccount.username} · {roleLabel(activeAccount.role)}
                    </small>
                  </div>
                  <Link
                    href="/profile"
                    className="warm-popover-item"
                    role="menuitem"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <User size={15} />
                    <span>个人资料与全局规矩</span>
                  </Link>
                  <Link
                    href="/usage"
                    className="warm-popover-item"
                    role="menuitem"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <BarChart3 size={15} />
                    <span>用量与额度</span>
                  </Link>
                  <Link
                    href="/redeem"
                    className="warm-popover-item"
                    role="menuitem"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <Gift size={15} />
                    <span>兑换 / 邀请码</span>
                  </Link>
                  <Link
                    href="/login"
                    className="warm-popover-item"
                    role="menuitem"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <RefreshCw size={15} />
                    <span>切换账号</span>
                  </Link>
                  <button
                    type="button"
                    className="warm-popover-item danger"
                    role="menuitem"
                    onClick={handleLogout}
                  >
                    <LogOut size={15} />
                    <span>退出登录</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {fullBleed ? (
          children
        ) : (
          <main className="warm-content">{children}</main>
        )}
      </div>
    </div>
  );
}
