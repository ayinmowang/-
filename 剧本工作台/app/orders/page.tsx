'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  PlusCircle,
  Receipt,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react';
import WarmShell from '../../components/WarmShell';
import type { PublicAccountProfile } from '../../lib/types';

interface OrderItem {
  id: string;
  planId: string;
  planName: string;
  priceUsd: number;
  creditUsd: number;
  period: string;
  status: string;
  paymentChannel?: string;
  createdAt?: string;
  confirmedAt?: string;
  note?: string;
}

const STATUS_FILTERS = [
  { key: '', label: '全部订单' },
  { key: 'pending', label: '待管理员确认入账' },
  { key: 'paid', label: '已确认入账' },
  { key: 'cancelled', label: '已取消' },
];

export default function OrdersPage() {
  const [account, setAccount] = useState<PublicAccountProfile | null>(null);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [detailOrder, setDetailOrder] = useState<OrderItem | null>(null);

  async function loadOrders(filter = statusFilter) {
    setLoading(true);
    setError('');
    try {
      const query = filter ? `?status=${encodeURIComponent(filter)}` : '';
      const res = await fetch(`/api/orders${query}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || json.error || '加载订单列表失败');
      }
      setAccount(json.account || null);
      setOrders(Array.isArray(json.orders) ? json.orders : []);
    } catch (err: any) {
      setOrders([]);
      setError(err.message || '加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrders(statusFilter);
  }, [statusFilter]);

  async function handleOrderAction(action: 'detail' | 'cancel', orderId: string) {
    if (!orderId || busyId) return;
    setBusyId(orderId);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, orderId }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || json.error || '操作失败');
      }
      if (action === 'detail') {
        setDetailOrder(json.order || orders.find((o) => o.id === orderId) || null);
      } else if (action === 'cancel') {
        setNotice(`订单 ${orderId} 已取消`);
        if (detailOrder?.id === orderId) {
          setDetailOrder(null);
        }
        await loadOrders(statusFilter);
      }
    } catch (err: any) {
      setError(err.message || '请求失败，请重试');
    } finally {
      setBusyId('');
    }
  }

  function renderStatusBadge(status: string) {
    if (status === 'pending') {
      return {
        label: '待管理员确认入账',
        bg: '#fef3c7',
        color: '#92400e',
      };
    }
    if (status === 'confirmed' || status === 'paid' || status === 'completed') {
      return {
        label: '已确认入账',
        bg: '#dcfce7',
        color: '#15803d',
      };
    }
    if (status === 'canceled' || status === 'cancelled') {
      return {
        label: '已取消',
        bg: '#f3f4f6',
        color: '#6b7280',
      };
    }
    return {
      label: status || '未知状态',
      bg: '#f3f4f6',
      color: '#374151',
    };
  }

  function formatPeriod(period: string) {
    if (period === 'monthly') return '月度订阅';
    if (period === 'quarterly') return '季度订阅';
    if (period === 'yearly') return '年度订阅';
    if (period === 'one_time' || period === 'once') return '单次额度';
    return period || '标准';
  }

  return (
    <WarmShell
      activeNav="orders"
      title="我的订单"
      subtitle="跟踪套餐充值与会员订阅订单的审核入账进度"
      account={account}
      authenticated={Boolean(account)}
    >
      <div style={{ width: '100%', maxWidth: 960, margin: '0 auto', padding: '28px 20px 64px' }}>
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

        {/* 顶部筛选与操作栏 */}
        <div
          style={{
            background: 'var(--warm-card, #fff)',
            border: '1px solid var(--warm-border, #e6dfd3)',
            borderRadius: 18,
            padding: '18px 22px',
            marginBottom: 20,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {STATUS_FILTERS.map((item) => {
              const active = statusFilter === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setStatusFilter(item.key)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 999,
                    border: active ? '1px solid #d97706' : '1px solid #e6dfd3',
                    background: active ? '#fef3c7' : '#faf8f5',
                    color: active ? '#92400e' : '#57534e',
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    cursor: 'pointer',
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={() => loadOrders(statusFilter)}
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
              <PlusCircle size={14} />
              <span>新建充值订单</span>
            </Link>
          </div>
        </div>

        {/* 订单列表 */}
        <div
          style={{
            background: 'var(--warm-card, #fff)',
            border: '1px solid var(--warm-border, #e6dfd3)',
            borderRadius: 18,
            padding: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Receipt size={18} style={{ color: '#d97706' }} />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#292524' }}>
              订单记录 ({orders.length})
            </h2>
          </div>

          {loading ? (
            <div style={{ padding: '24px 0', color: '#78716c', fontSize: 14 }}>
              正在读取订单列表...
            </div>
          ) : orders.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '36px 16px',
                background: '#faf8f5',
                borderRadius: 14,
                border: '1px dashed #d6cfc2',
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, color: '#292524', marginBottom: 6 }}>
                当前筛选条件下暂无订单
              </div>
              <div style={{ fontSize: 13, color: '#78716c', marginBottom: 16 }}>
                提交订单后将在此处显示，等待管理员确认入账
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
                <span>前往充值 / 会员</span>
              </Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {orders.map((order) => {
                const badge = renderStatusBadge(order.status);
                const isPending = order.status === 'pending';
                return (
                  <div
                    key={order.id}
                    style={{
                      border: '1px solid #ede7dd',
                      borderRadius: 14,
                      padding: '16px 18px',
                      background: '#fdfbf7',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 14,
                    }}
                  >
                    <div style={{ minWidth: 240 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#1c1917' }}>
                          {order.planName}
                        </span>
                        <span
                          style={{
                            padding: '2px 10px',
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 600,
                            background: badge.bg,
                            color: badge.color,
                          }}
                        >
                          {badge.label}
                        </span>
                      </div>

                      <div style={{ fontSize: 12, color: '#78716c', lineHeight: 1.6 }}>
                        <div>订单号：{order.id}</div>
                        <div>
                          周期：{formatPeriod(order.period)} · 渠道槽：
                          {order.paymentChannel || 'manual_admin'}
                        </div>
                        {order.createdAt ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={12} />
                            <span>创建时间：{new Date(order.createdAt).toLocaleString()}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 16,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#b45309' }}>
                          ${Number(order.priceUsd || 0).toFixed(2)}
                        </div>
                        <div style={{ fontSize: 12, color: '#78716c' }}>
                          额度 ${Number(order.creditUsd || 0).toFixed(2)}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          disabled={busyId === order.id}
                          onClick={() => handleOrderAction('detail', order.id)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '7px 12px',
                            borderRadius: 9,
                            border: '1px solid #d6cfc2',
                            background: '#fff',
                            color: '#44403c',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          <Eye size={14} />
                          <span>详情</span>
                        </button>

                        {isPending ? (
                          <button
                            type="button"
                            disabled={busyId === order.id}
                            onClick={() => handleOrderAction('cancel', order.id)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '7px 12px',
                              borderRadius: 9,
                              border: '1px solid #fecaca',
                              background: '#fff',
                              color: '#b91c1c',
                              fontSize: 12,
                              cursor: 'pointer',
                            }}
                          >
                            <XCircle size={14} />
                            <span>{busyId === order.id ? '处理中...' : '取消订单'}</span>
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 订单详情弹窗卡片 */}
        {detailOrder ? (
          <div
            style={{
              marginTop: 20,
              background: '#fff',
              border: '1.5px solid #d97706',
              borderRadius: 16,
              padding: 22,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 14,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1c1917' }}>
                订单详情：{detailOrder.id}
              </h3>
              <button
                type="button"
                onClick={() => setDetailOrder(null)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#78716c',
                  cursor: 'pointer',
                  padding: 4,
                }}
              >
                <X size={18} />
              </button>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 12,
                fontSize: 13,
                color: '#44403c',
              }}
            >
              <div>
                <strong>套餐名称：</strong>
                {detailOrder.planName}
              </div>
              <div>
                <strong>订单状态：</strong>
                {renderStatusBadge(detailOrder.status).label}（{detailOrder.status}）
              </div>
              <div>
                <strong>应付金额：</strong>${Number(detailOrder.priceUsd || 0).toFixed(2)}
              </div>
              <div>
                <strong>包含额度：</strong>${Number(detailOrder.creditUsd || 0).toFixed(2)}
              </div>
              <div>
                <strong>订阅周期：</strong>
                {formatPeriod(detailOrder.period)}
              </div>
              <div>
                <strong>支付渠道槽：</strong>
                {detailOrder.paymentChannel || 'manual_admin'}
              </div>
              <div>
                <strong>创建时间：</strong>
                {detailOrder.createdAt ? new Date(detailOrder.createdAt).toLocaleString() : '-'}
              </div>
              <div>
                <strong>确认入账时间：</strong>
                {detailOrder.confirmedAt
                  ? new Date(detailOrder.confirmedAt).toLocaleString()
                  : '待管理员确认入账'}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </WarmShell>
  );
}
