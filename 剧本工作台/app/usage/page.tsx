'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  BarChart3,
  Clock,
  Download,
  Droplets,
  Flame,
  Layers,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import WarmShell from '../../components/WarmShell';
import type { PublicAccountProfile } from '../../lib/types';

interface UsageData {
  ok: boolean;
  days: number;
  account: PublicAccountProfile;
  kpis: {
    budgetCapUsd: number;
    budgetUsedUsd: number;
    remainingBudgetUsd: number;
    quotaUsagePct: number;
    totalRequests: number;
    todayRequests: number;
    todaySpentUsd: number;
    windowSpentUsd: number;
    successCount: number;
    fallbackCount: number;
    failedCount: number;
    avgLatencyMs: number;
    usageUnits: number;
  };
  trend: Array<{
    date: string;
    requests: number;
    spentUsd: number;
    usageUnits: number;
  }>;
  tierBreakdown: Array<{
    tierId: string;
    tierName: string;
    requests: number;
    spentUsd: number;
    avgLatencyMs: number;
  }>;
  stationBreakdown: Array<{
    station: string;
    stationLabel: string;
    requests: number;
    spentUsd: number;
    avgLatencyMs: number;
  }>;
  logs: Array<{
    id: string;
    time: string;
    stationLabel: string;
    tierName: string | null;
    latencyMs: number;
    usageUnits: number;
    estimatedCostUsd: number;
    usageStatus?: 'known' | 'unknown';
    status: string;
    error?: string;
  }>;
}

export default function UsagePage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState('');

  async function loadUsage(nextDays = days) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/usage?days=${nextDays}`);
      if (res.status === 401) {
        setAuthRequired(true);
        setData(null);
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '加载失败');
      setAuthRequired(false);
      setData(json);
    } catch (e: any) {
      setError(e.message || '用量数据加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsage(days);
  }, [days]);

  const maxReq = Math.max(1, ...(data?.trend || []).map((t) => t.requests));

  return (
    <WarmShell
      activeNav="usage"
      title="用量与额度"
      subtitle="实时查看当前创作空间的可用额度、调用趋势与工位明细"
      account={data?.account || null}
      authenticated={!authRequired && Boolean(data?.account)}
    >
      <div style={{ width: '100%', maxWidth: 1180, margin: '0 auto', padding: '24px 20px 48px' }}>
        {authRequired ? (
          <div
            style={{
              background: 'var(--warm-card, #fff)',
              border: '1px solid var(--warm-border, #e6dfd3)',
              borderRadius: 16,
              padding: 36,
              textAlign: 'center',
            }}
          >
            <h2 style={{ fontFamily: 'serif', marginBottom: 8 }}>请先登录查看用量与额度</h2>
            <p style={{ opacity: 0.75, marginBottom: 20 }}>登录后可实时掌握个人创作额度与近期调用记录。</p>
            <Link
              href="/login"
              style={{
                display: 'inline-block',
                padding: '10px 22px',
                borderRadius: 10,
                background: '#8C3B2B',
                color: '#fff',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              前往登录
            </Link>
          </div>
        ) : (
          <>
            {/* Dark Ink Overview Hero Banner */}
            <div
              style={{
                background: 'linear-gradient(120deg, #2C2420 0%, #3E2A23 55%, #5C3327 100%)',
                color: '#FAF7F2',
                borderRadius: 18,
                padding: '24px 28px',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                marginBottom: 20,
              }}
            >
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'serif', letterSpacing: 1 }}>
                  创作额度与消耗概览
                </div>
                <div style={{ fontSize: 13, opacity: 0.82, marginTop: 6 }}>
                  实时监控 · 工位消耗透明 · 高效管理创作预算
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <select
                  aria-label="统计周期"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.14)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.22)',
                    fontSize: 13,
                  }}
                >
                  <option value={7} style={{ color: '#222' }}>近 7 天</option>
                  <option value={14} style={{ color: '#222' }}>近 14 天</option>
                  <option value={30} style={{ color: '#222' }}>近 30 天</option>
                </select>
                <button
                  type="button"
                  onClick={() => loadUsage(days)}
                  disabled={loading}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.14)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.22)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  <RefreshCw size={14} /> 刷新
                </button>
                <a
                  href={`/api/usage?days=${days}&format=csv`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    borderRadius: 10,
                    background: '#D49B54',
                    color: '#2C2420',
                    fontWeight: 700,
                    textDecoration: 'none',
                    fontSize: 13,
                  }}
                >
                  <Download size={14} /> 导出 CSV
                </a>
              </div>
            </div>

            {error && (
              <div style={{ padding: 12, borderRadius: 10, background: '#fee2e2', color: '#991b1b', marginBottom: 16 }}>
                {error}
              </div>
            )}

            {/* Primary 3 KPIs */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 14,
                marginBottom: 14,
              }}
            >
              <div style={{ background: 'var(--warm-card, #fff)', border: '1px solid var(--warm-border, #e6dfd3)', borderRadius: 14, padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, opacity: 0.72 }}>
                  <Droplets size={16} color="#16a34a" /> 剩余可用额度
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, marginTop: 8 }}>
                  ${(data?.kpis.remainingBudgetUsd ?? 0).toFixed(2)}
                </div>
                <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>
                  总额度 ${(data?.kpis.budgetCapUsd ?? 0).toFixed(2)} · 已用 {data?.kpis.quotaUsagePct ?? 0}%
                </div>
              </div>

              <div style={{ background: 'var(--warm-card, #fff)', border: '1px solid var(--warm-border, #e6dfd3)', borderRadius: 14, padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, opacity: 0.72 }}>
                  <Activity size={16} color="#0284c7" /> 今日创作请求
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, marginTop: 8 }}>
                  {data?.kpis.todayRequests ?? 0}
                </div>
                <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>
                  累计 {data?.kpis.totalRequests ?? 0} 次请求
                </div>
              </div>

              <div style={{ background: 'var(--warm-card, #fff)', border: '1px solid var(--warm-border, #e6dfd3)', borderRadius: 14, padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, opacity: 0.72 }}>
                  <Flame size={16} color="#d97706" /> 今日消耗
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, marginTop: 8 }}>
                  ${(data?.kpis.todaySpentUsd ?? 0).toFixed(4)}
                </div>
                <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>
                  近 {days} 天累计 ${(data?.kpis.windowSpentUsd ?? 0).toFixed(4)}
                </div>
              </div>
            </div>

            {/* Secondary 4 KPIs */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 14,
                marginBottom: 20,
              }}
            >
              <div style={{ background: 'var(--warm-card, #fff)', border: '1px solid var(--warm-border, #e6dfd3)', borderRadius: 14, padding: 16 }}>
                <div style={{ fontSize: 12, opacity: 0.7, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldCheck size={14} color="#16a34a" /> 成功 / 容灾切换
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>
                  {data?.kpis.successCount ?? 0} / {data?.kpis.fallbackCount ?? 0}
                </div>
              </div>
              <div style={{ background: 'var(--warm-card, #fff)', border: '1px solid var(--warm-border, #e6dfd3)', borderRadius: 14, padding: 16 }}>
                <div style={{ fontSize: 12, opacity: 0.7, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Clock size={14} color="#8C3B2B" /> 平均响应耗时
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>
                  {data?.kpis.avgLatencyMs ?? 0} ms
                </div>
              </div>
              <div style={{ background: 'var(--warm-card, #fff)', border: '1px solid var(--warm-border, #e6dfd3)', borderRadius: 14, padding: 16 }}>
                <div style={{ fontSize: 12, opacity: 0.7, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Layers size={14} color="#7c3aed" /> 累计创作计量
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>
                  {(data?.kpis.usageUnits ?? 0).toLocaleString()}
                </div>
              </div>
              <div style={{ background: 'var(--warm-card, #fff)', border: '1px solid var(--warm-border, #e6dfd3)', borderRadius: 14, padding: 16 }}>
                <div style={{ fontSize: 12, opacity: 0.7, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <BarChart3 size={14} color="#D49B54" /> 失败次数
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>
                  {data?.kpis.failedCount ?? 0}
                </div>
              </div>
            </div>

            {/* Trend & Breakdown */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                gap: 16,
                marginBottom: 20,
              }}
            >
              <div style={{ background: 'var(--warm-card, #fff)', border: '1px solid var(--warm-border, #e6dfd3)', borderRadius: 16, padding: 20 }}>
                <h3 style={{ margin: '0 0 14px', fontSize: 15 }}>近 {days} 天请求趋势</h3>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 150, paddingTop: 12 }}>
                  {(data?.trend || []).map((item) => {
                    const pct = Math.max(6, Math.round((item.requests / maxReq) * 100));
                    return (
                      <div key={item.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, opacity: 0.7 }}>{item.requests}</span>
                        <div
                          style={{
                            width: '100%',
                            maxWidth: 34,
                            height: `${pct}%`,
                            minHeight: 6,
                            borderRadius: 6,
                            background: item.requests > 0 ? '#8C3B2B' : 'rgba(140,59,43,0.16)',
                          }}
                        />
                        <span style={{ fontSize: 10, opacity: 0.6 }}>{item.date.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ background: 'var(--warm-card, #fff)', border: '1px solid var(--warm-border, #e6dfd3)', borderRadius: 16, padding: 20 }}>
                <h3 style={{ margin: '0 0 14px', fontSize: 15 }}>工位与档位分布</h3>
                {(data?.stationBreakdown || []).length === 0 ? (
                  <p style={{ opacity: 0.6, fontSize: 13 }}>暂无调用记录，开始创作后将自动统计。</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(data?.stationBreakdown || []).map((st) => (
                      <div
                        key={st.station}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px 12px',
                          borderRadius: 10,
                          background: 'var(--warm-surface, #faf7f2)',
                          border: '1px solid var(--warm-border, #e6dfd3)',
                          fontSize: 13,
                        }}
                      >
                        <strong>{st.stationLabel}</strong>
                        <span style={{ opacity: 0.78 }}>
                          {st.requests} 次 · ${st.spentUsd.toFixed(4)} · {st.avgLatencyMs}ms
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Recent Logs Table */}
            <div style={{ background: 'var(--warm-card, #fff)', border: '1px solid var(--warm-border, #e6dfd3)', borderRadius: 16, padding: 20, overflowX: 'auto' }}>
              <h3 style={{ margin: '0 0 14px', fontSize: 15 }}>近期调用记录（共 {data?.logs.length ?? 0} 条）</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--warm-border, #e6dfd3)', textAlign: 'left', opacity: 0.72 }}>
                    <th style={{ padding: '8px 10px' }}>时间</th>
                    <th style={{ padding: '8px 10px' }}>执行工位</th>
                    <th style={{ padding: '8px 10px' }}>创作档位</th>
                    <th style={{ padding: '8px 10px' }}>状态</th>
                    <th style={{ padding: '8px 10px' }}>耗时</th>
                    <th style={{ padding: '8px 10px' }}>预估费用</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.logs || []).length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 24, textAlign: 'center', opacity: 0.6 }}>
                        暂无调用记录
                      </td>
                    </tr>
                  ) : (
                    (data?.logs || []).map((log) => (
                      <tr key={log.id} style={{ borderBottom: '1px solid rgba(230,223,211,0.5)' }}>
                        <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                          {new Date(log.time).toLocaleString('zh-CN')}
                        </td>
                        <td style={{ padding: '9px 10px' }}>{log.stationLabel}</td>
                        <td style={{ padding: '9px 10px' }}>{log.tierName || '默认档位'}</td>
                        <td style={{ padding: '9px 10px' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 600,
                              background:
                                log.status === 'success'
                                  ? 'rgba(22,163,74,0.12)'
                                  : log.status === 'fallback'
                                  ? 'rgba(217,119,6,0.14)'
                                  : 'rgba(220,38,38,0.12)',
                              color:
                                log.status === 'success'
                                  ? '#15803d'
                                  : log.status === 'fallback'
                                  ? '#b45309'
                                  : '#b91c1c',
                            }}
                          >
                            {log.status === 'success' ? '成功' : log.status === 'fallback' ? '容灾成功' : '异常'}
                          </span>
                        </td>
                        <td style={{ padding: '9px 10px' }}>{log.latencyMs} ms</td>
                        <td style={{ padding: '9px 10px' }}>{log.usageStatus === 'unknown' ? '用量及费用待确认' : `估算 $${log.estimatedCostUsd.toFixed(5)}`}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </WarmShell>
  );
}
