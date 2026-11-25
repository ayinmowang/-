'use client';

import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import LoginView from '../components/LoginView';

const CREATOR_UI_REDLINE_MESSAGES = {
  PROMPT_LABEL: '提示词',
  BUDGET_EXCEEDED: '当前账号可用创作额度已用尽，请联系管理员调整额度后重试。',
  SLOT_NOT_ALLOWED: '该创作流程不支持此提示词槽位（扒剧仅支持 1 个主槽位）。',
  ACCOUNT_DISABLED: '当前账号已被停用，请联系管理员确认账号状态。',
  DISABLED_PROMPT_FALLBACK: '已停用或已移除的提示词（自动回退默认/内置）',
} as const;

void CREATOR_UI_REDLINE_MESSAGES;

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    fetch('/api/auth', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        if (data.authenticated) {
          router.replace('/studio');
        }
      })
      .catch(() => {
        // stay on login page
      });
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg-canvas, #f6f2ea)' }} />}>
      <LoginView />
    </Suspense>
  );
}
