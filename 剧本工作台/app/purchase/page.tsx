'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  CreditCard,
  Layers,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import WarmShell from '../../components/WarmShell';
import type { PublicAccountProfile } from '../../lib/types';

interface PlanItem {
  id: string;
  name?: string;
  planName?: string;
  displayName: string;
  priceUsd: number;
  creditUsd: number;
  period: string;
  status: string;
  description?: string;
  kind?: string;
  paymentChannelSlot?: string;
  order?: number;
}

const CHANNEL_OPTIONS = [
  {
    value: 'manual_admin',
    label: '人工核验入账',
    desc: '提交订单后联系管理员完成转账核验，核验通过后发放额度',
  },
  {
    value: 'test',
    label: '沙盒测试通道',
    desc: '用于内部流程联调，生成待审核订单记录',
  },
  {
    value: 'pending_gateway',
    label: '外部收银台扩展槽',
    desc: '预留外部支付网关接入槽位，当前统一走待管理员确认入账流程',
  },
];

function formatChannelLabel(channel?: string): string {
  const matched = CHANNEL_OPTIONS.find((item) => item.value === channel);
  return matched ? matched.label : channel || '人工核验入账';
}

function formatOrderStatusLabel(status?: string): string {
  if (status === 'pending') return '待管理员确认入账';
  if (status === 'paid' || status === 'confirmed' || status === 'completed') return '已确认入账';
  if (status === 'cancelled' || status === 'canceled') return '已取消';
  return status || '待处理';
}

export default function PurchasePage() {
  const [account, setAccount] = useState<PublicAccountProfile | null>(null);
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [paymentChannel, setPaymentChannel] = useState('manual_admin');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [createdOrder, setCreatedOrder] = useState<{
    id: string;
    planName: string;
    priceUsd: number;
    creditUsd: number;
    status: string;
    paymentChannel: string;
  } | null>(null);

  async function loadPlans() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/purchase');
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || json.error || '加载套餐列表失败');
      }
      setAccount(json.account || null);
      const rawList = Array.isArray(json.plans) ? json.plans : [];
      const list: PlanItem[] = rawList.map((plan: any) => {
        const displayName = String(plan.planName || plan.name || '').trim() || '未命名套餐';
        const status = plan.status ? String(plan.status) : 'active';
        return {
          ...plan,
          displayName,
          status,
        };
      });
      setPlans(list);
      const firstActive = list.find((p) => p.status === 'active') || list[0];
      if (firstActive && !selectedPlanId) {
        setSelectedPlanId(firstActive.id);
      }
    } catch (err: any) {
      setError(err.message || '加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPlans();
  }, []);

  async function handleCreateOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPlanId || submitting) return;
    setSubmitting(true);
    setError('');
    setCreatedOrder(null);
    try {
      const res = await fetch('/api/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: selectedPlanId,
          paymentChannel,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || json.error || '提交订单失败');
      }
      const order = json.order || {};
      const matchedPlan = plans.find((p) => p.id === selectedPlanId);
      setCreatedOrder({
        id: order.id || json.orderId || '',
        planName: order.planName || matchedPlan?.displayName || '所选套餐',
        priceUsd: Number(order.priceUsd ?? matchedPlan?.priceUsd ?? 0),
        creditUsd: Number(order.creditUsd ?? matchedPlan?.creditUsd ?? 0),
        status: order.status || 'pending',
        paymentChannel: order.paymentChannel || paymentChannel,
      });
    } catch (err: any) {
      setError(err.message || '创建订单失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }

  function formatPeriod(period: string) {
    if (period === 'monthly') return '月度订阅';
    if (period === 'quarterly') return '季度订阅';
    if (period === 'yearly') return '年度订阅';
    if (period === 'one_time' || period === 'once') return '单次额度充值';
    return period || '标准周期';
  }

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) || null;

  return (
    <WarmShell
      activeNav="purchase"
      title="充值 / 会员"
      subtitle="选择额度包或周期会员套餐创建订单，提交后待管理员确认入账"
      account={account}
      authenticated={Boolean(account)}
    >
      <div style={{ width: '100%', maxWidth: 920, margin: '0 auto', padding: '28px 20px 64px' }}>
        {/* 入账说明提示条 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 14,
            padding: '14px 18px',
            marginBottom: 22,
            color: '#92400e',
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          <ShieldAlert size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>入账流程说明：</strong>
            当前系统采用人工审核入账机制。提交订单后订单状态为「待管理员确认入账（pending）」，管理员在后台核验并确认入账后，对应套餐额度与订阅周期才会正式生效。
          </div>
        </div>

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

        {createdOrder ? (
          <div
            style={{
              background: '#f0fdf4',
              border: '1px solid #86efac',
              borderRadius: 16,
              padding: 22,
              marginBottom: 24,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <Clock size={20} style={{ color: '#15803d' }} />
              <div style={{ fontSize: 16, fontWeight: 700, color: '#14532d' }}>
                订单已创建，状态：待管理员确认入账
              </div>
            </div>
            <div style={{ fontSize: 13, color: '#166534', lineHeight: 1.7, marginBottom: 14 }}>
              <div>订单编号：{createdOrder.id || '已生成'}</div>
              <div>
                选购套餐：{createdOrder.planName}（应付金额 ${createdOrder.priceUsd.toFixed(2)}，到账额度 $
                {createdOrder.creditUsd.toFixed(2)}）
              </div>
              <div>支付渠道：{formatChannelLabel(createdOrder.paymentChannel)}</div>
              <div>当前状态：{formatOrderStatusLabel(createdOrder.status)}</div>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link
                href="/orders"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '9px 16px',
                  borderRadius: 10,
                  background: '#15803d',
                  color: '#fff',
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <span>前往「我的订单」查看进度</span>
                <ArrowRight size={15} />
              </Link>
              <Link
                href="/subscriptions"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '9px 16px',
                  borderRadius: 10,
                  border: '1px solid #86efac',
                  background: '#fff',
                  color: '#15803d',
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <span>查看我的订阅</span>
              </Link>
            </div>
          </div>
        ) : null}

        <form onSubmit={handleCreateOrder}>
          {/* 第一步：选择套餐 */}
          <div
            style={{
              background: 'var(--warm-card, #fff)',
              border: '1px solid var(--warm-border, #e6dfd3)',
              borderRadius: 18,
              padding: 28,
              marginBottom: 22,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <Sparkles size={20} style={{ color: '#d97706' }} />
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#292524' }}>
                1. 选择套餐与额度档位
              </h2>
            </div>

            {loading ? (
              <div style={{ padding: '20px 0', color: '#78716c', fontSize: 14 }}>
                正在加载可用套餐...
              </div>
            ) : plans.length === 0 ? (
              <div style={{ padding: '20px 0', color: '#78716c', fontSize: 14 }}>
                管理员暂未配置可购买套餐，请联系管理员在后台添加套餐。
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                  gap: 16,
                }}
              >
                {plans.map((plan) => {
                  const isSelected = plan.id === selectedPlanId;
                  const isDisabled = plan.status !== 'active';
                  return (
                    <div
                      key={plan.id}
                      onClick={() => {
                        if (!isDisabled) setSelectedPlanId(plan.id);
                      }}
                      style={{
                        border: isSelected ? '2px solid #d97706' : '1px solid #e6dfd3',
                        background: isSelected ? '#fffbeb' : isDisabled ? '#f5f5f4' : '#fdfbf7',
                        borderRadius: 14,
                        padding: 20,
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                        opacity: isDisabled ? 0.65 : 1,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 8,
                        }}
                      >
                        <span style={{ fontSize: 16, fontWeight: 700, color: '#1c1917' }}>
                          {plan.displayName}
                        </span>
                        {isSelected ? (
                          <CheckCircle2 size={18} style={{ color: '#d97706' }} />
                        ) : null}
                      </div>

                      <div style={{ fontSize: 12, color: '#78716c', marginBottom: 12 }}>
                        周期：{formatPeriod(plan.period)} · 状态：
                        {plan.status === 'active' ? '可选购' : '已下架'}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 26, fontWeight: 800, color: '#b45309' }}>
                          ${Number(plan.priceUsd || 0).toFixed(2)}
                        </span>
                        <span style={{ fontSize: 12, color: '#78716c' }}>应付金额</span>
                      </div>

                      <div
                        style={{
                          padding: '6px 10px',
                          borderRadius: 8,
                          background: '#f5efe6',
                          color: '#57534e',
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        包含可用额度：${Number(plan.creditUsd || 0).toFixed(2)}
                      </div>

                      {plan.description ? (
                        <div style={{ marginTop: 10, fontSize: 12, color: '#78716c' }}>
                          {plan.description}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 第二步：支付渠道扩展槽 */}
          <div
            style={{
              background: 'var(--warm-card, #fff)',
              border: '1px solid var(--warm-border, #e6dfd3)',
              borderRadius: 18,
              padding: 28,
              marginBottom: 22,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <Layers size={20} style={{ color: '#d97706' }} />
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#292524' }}>
                2. 支付渠道扩展槽（paymentChannel）
              </h2>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {CHANNEL_OPTIONS.map((ch) => {
                const active = paymentChannel === ch.value;
                return (
                  <label
                    key={ch.value}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '14px 16px',
                      borderRadius: 12,
                      border: active ? '1.5px solid #d97706' : '1px solid #e6dfd3',
                      background: active ? '#fffbeb' : '#faf8f5',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="paymentChannel"
                      value={ch.value}
                      checked={active}
                      onChange={() => setPaymentChannel(ch.value)}
                      style={{ marginTop: 3 }}
                    />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1c1917' }}>
                        {ch.label}
                      </div>
                      <div style={{ fontSize: 12, color: '#78716c', marginTop: 2 }}>{ch.desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* 底部结算提交 */}
          <div
            style={{
              background: 'var(--warm-card, #fff)',
              border: '1px solid var(--warm-border, #e6dfd3)',
              borderRadius: 18,
              padding: '20px 28px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 13, color: '#78716c' }}>
                已选套餐：
                <strong style={{ color: '#1c1917' }}>
                  {selectedPlan ? selectedPlan.displayName : '未选择'}
                </strong>
              </div>
              <div style={{ fontSize: 14, color: '#44403c', marginTop: 4 }}>
                订单金额：
                <strong style={{ fontSize: 18, color: '#b45309' }}>
                  ${selectedPlan ? Number(selectedPlan.priceUsd || 0).toFixed(2) : '0.00'}
                </strong>
                <span style={{ marginLeft: 10, fontSize: 12, color: '#78716c' }}>
                  （确认入账后获得 ${selectedPlan ? Number(selectedPlan.creditUsd || 0).toFixed(2) : '0.00'} 额度）
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={!selectedPlan || submitting}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 24px',
                borderRadius: 12,
                border: 'none',
                background: !selectedPlan || submitting ? '#d6cfc2' : '#d97706',
                color: '#fff',
                fontSize: 15,
                fontWeight: 700,
                cursor: !selectedPlan || submitting ? 'not-allowed' : 'pointer',
              }}
            >
              <CreditCard size={18} />
              <span>{submitting ? '正在提交订单...' : '提交订单（待管理员确认入账）'}</span>
            </button>
          </div>
        </form>
      </div>
    </WarmShell>
  );
}