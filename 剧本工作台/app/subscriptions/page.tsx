'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  History,
  RefreshCw,
  Repeat,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import WarmShell from '../../components/WarmShell';
import type { PublicAccountProfile } from '../../lib/types';

interface PlanItem {
  id: string;
  name?: string;
  planName?: string;
  priceUsd: number;
  creditUsd: number;
  period: string;
  status?: string;
  enabled?: boolean;
  description?: string;
}

interface SubscriptionItem {
  id: string;
  planId: string;
  planName: string;
  priceUsd: number;
  creditUsd: number;
  period: string;
  status: string;
  renewEnabled: boolean;
  currentPeriodEnd: string;
  createdAt?: string;
}

export default function SubscriptionsPage() {
  const [account, setAccount] = useState<PublicAccountProfile | null>(null);
  const [current, setCurrent] = useState<SubscriptionItem | null>(null);
  const [history, setHistory] = useState<SubscriptionItem[]>([]);
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/subscriptions');
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || json.error || '加载订阅信息失败');
      }
      setAccount(json.account || null);
      setCurrent(json.current || null);
      const subList = Array.isArray(json.subscriptions)
        ? json.subscriptions
        : Array.isArray(json.history)
          ? json.history
          : [];
      setHistory(subList);
      setPlans(Array.isArray(json.plans) ? json.plans : []);
    } catch (err: any) {
      setError(err.message || '加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleToggleRenew(action: 'cancel' | 'renew', subscriptionId: string) {
    if (!subscriptionId || busyId) return;
    setBusyId(subscriptionId);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, subscriptionId }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || json.error || '操作失败');
      }
      if (action === 'cancel') {
        setNotice(json.alreadyCancelled ? '该订阅此前已终止' : '已终止当前订阅周期');
      } else {
        setNotice(
          json.order?.id
            ? `已创建续费订单 ${json.order.id}，请前往订单记录页查看或等待管理员确认入账`
            : '已提交续期申请'
        );
      }
      await loadData();
    } catch (err: any) {
      setError(err.message || '请求失败，请稍后重试');
    } finally {
      setBusyId('');
    }
  }

  function formatPeriod(period: string) {
    if (period === 'monthly') return '月度周期';
    if (period === 'quarterly') return '季度周期';
    if (period === 'yearly') return '年度周期';
    if (period === 'one_time' || period === 'once') return '单次额度包';
    return period || '标准周期';
  }

  function formatStatus(status: string) {
    if (status === 'active') return { text: '生效中', color: '#15803d', bg: '#dcfce7' };
    if (status === 'expired') return { text: '已到期', color: '#6b7280', bg: '#f3f4f6' };
    if (status === 'canceled' || status === 'cancelled') {
      return { text: '已终止', color: '#b91c1c', bg: '#fee2e2' };
    }
    return { text: status || '未知状态', color: '#92400e', bg: '#fef3c7' };
  }

  function formatPlanStatus(plan: PlanItem) {
    if (plan.enabled === false) {
      return '暂未开放';
    }
    if (!plan.status || plan.status === 'active' || plan.status === 'enabled' || plan.enabled === true) {
      return '开放申请';
    }
    if (plan.status === 'disabled' || plan.status === 'inactive') {
      return '暂未开放';
    }
    return plan.status;
  }

  return (
    <WarmShell
      activeNav="subscriptions"
      title="我的订阅"
      subtitle="查看当前生效的会员周期、额度发放状态与历史订阅记录"
      account={account}
      authenticated={Boolean(account)}
    >
      <div style={{ width: '100%', maxWidth: 920, margin: '0 auto', padding: '28px 20px 64px' }}>
        {error ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              borderRadius: 12,
              padding: '12px 16px',
              marginBottom: 18,
              fontSize: 14,
            }}
          >
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        ) : null}

        {notice ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              color: '#15803d',
              borderRadius: 12,
              padding: '12px 16px',
              marginBottom: 18,
              fontSize: 14,
            }}
          >
            <CheckCircle2 size={18} />
            <span>{notice}</span>
          </div>
        ) : null}

        {/* 当前订阅卡片 */}
        <div
          style={{
            background: 'var(--warm-card, #fff)',
            border: '1px solid var(--warm-border, #e6dfd3)',
            borderRadius: 18,
            padding: 28,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Repeat size={20} style={{ color: '#b45309' }} />
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#292524' }}>
                当前生效订阅
              </h2>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={loadData}
                disabled={loading}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  borderRadius: 10,
                  border: '1px solid #e6dfd3',
                  background: '#faf8f5',
                  color: '#44403c',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={14} />
                <span>刷新</span>
              </button>
              <Link
                href="/purchase"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 16px',
                  borderRadius: 10,
                  background: '#d97706',
                  color: '#fff',
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <CreditCard size={14} />
                <span>前往充值 / 选购套餐</span>
              </Link>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: '24px 0', color: '#78716c', fontSize: 14 }}>
              正在读取订阅状态...
            </div>
          ) : current ? (
            <div
              style={{
                background: '#fdfbf7',
                border: '1px solid #efe7da',
                borderRadius: 14,
                padding: 22,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: 16,
                  marginBottom: 18,
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: '#1c1917' }}>
                      {current.planName}
                    </span>
                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                        background: formatStatus(current.status).bg,
                        color: formatStatus(current.status).color,
                      }}
                    >
                      {formatStatus(current.status).text}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#78716c' }}>
                    周期类型：{formatPeriod(current.period)}
                    {Number(current.priceUsd || 0) > 0
                      ? ` · 套餐标价 $${Number(current.priceUsd).toFixed(2)}`
                      : ''}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: '#78716c', marginBottom: 2 }}>
                    单期包含额度
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#b45309' }}>
                    ${Number(current.creditUsd || 0).toFixed(2)}
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                  gap: 14,
                  padding: '14px 0',
                  borderTop: '1px solid #efe7da',
                  borderBottom: '1px solid #efe7da',
                  marginBottom: 18,
                  fontSize: 13,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#44403c' }}>
                  <Calendar size={16} style={{ color: '#a8a29e' }} />
                  <span>
                    当前周期截止：
                    <strong>
                      {current.currentPeriodEnd
                        ? new Date(current.currentPeriodEnd).toLocaleString()
                        : '长期有效'}
                    </strong>
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#44403c' }}>
                  <ShieldCheck size={16} style={{ color: '#a8a29e' }} />
                  <span>
                    续期状态：
                    <strong>{current.renewEnabled ? '已开启到期续期' : '已关闭自动续期'}</strong>
                  </span>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <span style={{ fontSize: 12, color: '#78716c' }}>
                  提示：新订单提交后需待管理员确认入账，入账后自动顺延或激活周期。
                </span>
                {current.renewEnabled ? (
                  <button
                    type="button"
                    disabled={busyId === current.id}
                    onClick={() => handleToggleRenew('cancel', current.id)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 14px',
                      borderRadius: 10,
                      border: '1px solid #fecaca',
                      background: '#fff',
                      color: '#b91c1c',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    <XCircle size={15} />
                    <span>{busyId === current.id ? '处理中...' : '取消自动续期'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === current.id}
                    onClick={() => handleToggleRenew('renew', current.id)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 14px',
                      borderRadius: 10,
                      border: '1px solid #fde68a',
                      background: '#fef3c7',
                      color: '#92400e',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <Repeat size={15} />
                    <span>{busyId === current.id ? '处理中...' : '恢复自动续期'}</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div
              style={{
                textAlign: 'center',
                padding: '32px 16px',
                background: '#faf8f5',
                borderRadius: 14,
                border: '1px dashed #d6cfc2',
              }}
            >
              <Sparkles size={26} style={{ color: '#d97706', marginBottom: 8 }} />
              <div style={{ fontSize: 15, fontWeight: 600, color: '#292524', marginBottom: 6 }}>
                暂无生效中的订阅周期
              </div>
              <div style={{ fontSize: 13, color: '#78716c', marginBottom: 16 }}>
                您可以前往「充值 / 会员」选购适合的套餐并提交订单
              </div>
              <Link
                href="/purchase"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '9px 18px',
                  borderRadius: 10,
                  background: '#d97706',
                  color: '#fff',
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <span>立即查看套餐</span>
              </Link>
            </div>
          )}
        </div>

        {/* 可选套餐概览 */}
        {plans.length > 0 ? (
          <div
            style={{
              background: 'var(--warm-card, #fff)',
              border: '1px solid var(--warm-border, #e6dfd3)',
              borderRadius: 18,
              padding: 28,
              marginBottom: 24,
            }}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: '#292524' }}>
              可订阅套餐一览
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 14,
              }}
            >
              {plans.map((plan) => {
                const displayName = plan.planName || plan.name || '未命名套餐';
                return (
                  <div
                    key={plan.id}
                    style={{
                      border: '1px solid #e6dfd3',
                      borderRadius: 14,
                      padding: 18,
                      background: '#fdfbf7',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#1c1917', marginBottom: 4 }}>
                        {displayName}
                      </div>
                      <div style={{ fontSize: 12, color: '#78716c', marginBottom: 10 }}>
                        {formatPeriod(plan.period)} · 状态：{formatPlanStatus(plan)}
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#b45309' }}>
                        ${Number(plan.priceUsd || 0).toFixed(2)}
                        <span style={{ fontSize: 12, fontWeight: 400, color: '#78716c', marginLeft: 6 }}>
                          含 ${Number(plan.creditUsd || 0).toFixed(2)} 额度
                        </span>
                      </div>
                    </div>
                    <Link
                      href="/purchase"
                      style={{
                        display: 'inline-flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        padding: '8px 12px',
                        borderRadius: 9,
                        border: '1px solid #d97706',
                        color: '#b45309',
                        textDecoration: 'none',
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      选择此套餐
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* 历史订阅记录 */}
        <div
          style={{
            background: 'var(--warm-card, #fff)',
            border: '1px solid var(--warm-border, #e6dfd3)',
            borderRadius: 18,
            padding: 28,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <History size={18} style={{ color: '#78716c' }} />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#292524' }}>
              历史订阅记录 ({history.length})
            </h3>
          </div>

          {history.length === 0 ? (
            <div style={{ fontSize: 13, color: '#78716c', padding: '12px 0' }}>
              暂无历史订阅记录。
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {history.map((item) => {
                const st = formatStatus(item.status);
                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 12,
                      padding: '14px 16px',
                      borderRadius: 12,
                      border: '1px solid #ede7dd',
                      background: '#faf8f5',
                      fontSize: 13,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: '#1c1917', marginBottom: 4 }}>
                        {item.planName}（{formatPeriod(item.period)}）
                      </div>
                      <div style={{ color: '#78716c', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Clock size={13} />
                        <span>
                          截止时间：
                          {item.currentPeriodEnd
                            ? new Date(item.currentPeriodEnd).toLocaleString()
                            : '-'}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontWeight: 600, color: '#44403c' }}>
                        额度 ${Number(item.creditUsd || 0).toFixed(2)}
                      </span>
                      <span
                        style={{
                          padding: '3px 10px',
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 600,
                          background: st.bg,
                          color: st.color,
                        }}
                      >
                        {st.text}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </WarmShell>
  );
}