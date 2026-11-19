'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Gift, KeyRound, Sparkles } from 'lucide-react';
import WarmShell from '../../components/WarmShell';
import type { PublicAccountProfile } from '../../lib/types';

interface BoundInviteItem {
  id: string;
  codeMasked: string;
  role: string;
  budgetCapUsd: number;
  note: string;
  status: string;
  createdAt: string;
}

export default function RedeemPage() {
  const router = useRouter();
  const [account, setAccount] = useState<PublicAccountProfile | null>(null);
  const [boundInvites, setBoundInvites] = useState<BoundInviteItem[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  async function loadInfo() {
    try {
      const res = await fetch('/api/redeem');
      if (res.ok) {
        const json = await res.json();
        setAccount(json.account || null);
        setBoundInvites(json.boundInvites || []);
      }
    } catch {}
  }

  useEffect(() => {
    loadInfo();
  }, []);

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch('/api/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || json.error || '兑换或切换失败');
      }
      setAccount(json.account || null);
      setCode('');
      setSuccessMsg(
        json.mode === 'switched'
          ? `已切换至工作空间：${json.account?.displayName || ''}（@${json.account?.username || ''}）`
          : `邀请码激活成功！已自动登录为「${json.account?.displayName || ''}」`
      );
      await loadInfo();
    } catch (err: any) {
      setError(err.message || '兑换失败，请核对后重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <WarmShell
      activeNav="redeem"
      title="兑换 / 邀请码"
      subtitle="输入管理员分发的专属 Key 或团队邀请码，一键切换工作空间或激活新成员账号"
      account={account}
      authenticated={Boolean(account)}
    >
      <div style={{ width: '100%', maxWidth: 760, margin: '0 auto', padding: '28px 20px 56px' }}>
        <div
          style={{
            background: 'var(--warm-card, #fff)',
            border: '1px solid var(--warm-border, #e6dfd3)',
            borderRadius: 18,
            padding: 28,
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Gift size={22} color="#8C3B2B" />
            <h2 style={{ margin: 0, fontFamily: 'serif', fontSize: 22 }}>专属 Key / 邀请码兑换</h2>
          </div>
          <p style={{ margin: '0 0 20px', fontSize: 14, opacity: 0.75, lineHeight: 1.6 }}>
            输入专属 Key 可直接切换到对应的独立创作空间；输入团队邀请码可立即激活新成员账号并分配对应创作额度。
          </p>

          <form onSubmit={handleRedeem} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
              专属 Key 或邀请码
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 240, position: 'relative' }}>
                  <KeyRound
                    size={16}
                    style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}
                  />
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="例如：AYIN-KEY-XXXX-XXXX 或 AYIN-INV-XXXX-XXXX"
                    style={{
                      width: '100%',
                      padding: '11px 14px 11px 36px',
                      borderRadius: 10,
                      border: '1px solid var(--warm-border, #d8cfc0)',
                      background: 'var(--warm-surface, #faf7f2)',
                      fontSize: 14,
                    }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy || !code.trim()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '11px 22px',
                    borderRadius: 10,
                    background: '#8C3B2B',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 700,
                    cursor: busy ? 'wait' : 'pointer',
                    fontSize: 14,
                  }}
                >
                  <Sparkles size={15} /> {busy ? '处理中…' : '立即兑换 / 切换'}
                </button>
              </div>
            </label>
          </form>

          {error && (
            <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: '#fee2e2', color: '#991b1b', fontSize: 13 }}>
              {error}
            </div>
          )}

          {successMsg && (
            <div
              style={{
                marginTop: 14,
                padding: '12px 14px',
                borderRadius: 10,
                background: 'rgba(22,163,74,0.1)',
                color: '#15803d',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                <CheckCircle2 size={16} /> {successMsg}
              </span>
              <button
                type="button"
                onClick={() => router.push('/studio')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '6px 12px',
                  borderRadius: 8,
                  background: '#15803d',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                进入创作台 <ArrowRight size={13} />
              </button>
            </div>
          )}
        </div>

        {account && (
          <div
            style={{
              background: 'var(--warm-card, #fff)',
              border: '1px solid var(--warm-border, #e6dfd3)',
              borderRadius: 16,
              padding: 22,
            }}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>当前登录空间与兑换记录</h3>
            <div style={{ fontSize: 13, opacity: 0.82, marginBottom: 14 }}>
              当前账号：<strong>{account.displayName}</strong> (@{account.username}) · 剩余额度：
              <strong>${Math.max(0, account.budgetCapUsd - account.budgetUsedUsd).toFixed(2)}</strong> / ${account.budgetCapUsd.toFixed(2)}
            </div>
            {boundInvites.length === 0 ? (
              <p style={{ fontSize: 13, opacity: 0.6, margin: 0 }}>当前账号暂无通过邀请码绑定的历史记录。</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {boundInvites.map((inv) => (
                  <div
                    key={inv.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: 'var(--warm-surface, #faf7f2)',
                      border: '1px solid var(--warm-border, #e6dfd3)',
                      fontSize: 13,
                    }}
                  >
                    <span>
                      <code>{inv.codeMasked}</code> · {inv.note || '团队邀请码'}
                    </span>
                    <span style={{ opacity: 0.7 }}>额度上限 ${inv.budgetCapUsd}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </WarmShell>
  );
}
