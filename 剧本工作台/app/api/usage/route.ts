import {
  failure,
  getStore,
  resolveUserAccount,
  sanitizeForClient,
  toPublicProfile,
} from '../../../lib/server';
import type { ApiAuditLog } from '../../../lib/types';

function escapeCsvCell(val: unknown): string {
  const s = String(val ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toDayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return String(iso || '').slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  try {
    const acc = resolveUserAccount(request);
    if (!acc) {
      return Response.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const store = getStore();
    const url = new URL(request.url);
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 7) || 7));
    const scope = acc.role === 'admin' && url.searchParams.get('scope') === 'all' ? 'all' : 'self';
    const format = String(url.searchParams.get('format') || url.searchParams.get('export') || '').trim().toLowerCase();

    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    const windowKeys: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86_400_000);
      windowKeys.push(d.toISOString().slice(0, 10));
    }
    const windowSet = new Set(windowKeys);

    const scopedLogs: ApiAuditLog[] = (store.auditLogs || []).filter((log) =>
      scope === 'all' ? true : log.accountId === acc.id || log.username === acc.username
    );
    const windowLogs = scopedLogs.filter((log) => windowSet.has(toDayKey(log.time)));

    const totalRequests = scopedLogs.length;
    let todayRequests = 0;
    let todaySpentUsd = 0;
    let windowSpentUsd = 0;
    let successCount = 0;
    let fallbackCount = 0;
    let failedCount = 0;
    let latencySum = 0;
    let latencyCount = 0;

    for (const log of scopedLogs) {
      const cost = Number(log.estimatedCostUsd || 0);
      if (toDayKey(log.time) === todayKey) {
        todayRequests += 1;
        todaySpentUsd += cost;
      }
      if (log.status === 'success') successCount += 1;
      else if (log.status === 'fallback') fallbackCount += 1;
      else failedCount += 1;
      if (typeof log.latencyMs === 'number' && log.latencyMs > 0) {
        latencySum += log.latencyMs;
        latencyCount += 1;
      }
    }

    for (const log of windowLogs) {
      windowSpentUsd += Number(log.estimatedCostUsd || 0);
    }

    const budgetCapUsd = Number((acc.budgetCapUsd || 0).toFixed(4));
    const budgetUsedUsd = Number((acc.budgetUsedUsd || 0).toFixed(4));
    const remainingBudgetUsd = Number(Math.max(0, (acc.budgetCapUsd || 0) - (acc.budgetUsedUsd || 0)).toFixed(4));
    const quotaUsagePct =
      acc.budgetCapUsd > 0 ? Math.min(100, Number(((acc.budgetUsedUsd / acc.budgetCapUsd) * 100).toFixed(1))) : 0;

    const activeKeysCount = (store.systemConfig.providers || []).reduce((sum, prov) => {
      if (!prov?.enabled || !Array.isArray(prov.apiKeys)) return sum;
      return sum + prov.apiKeys.filter((k) => typeof k === 'string' && k.trim().length > 0).length;
    }, 0);

    const kpis = {
      budgetCapUsd,
      budgetUsedUsd,
      remainingBudgetUsd,
      quotaUsagePct,
      totalRequests,
      todayRequests,
      todaySpentUsd: Number(todaySpentUsd.toFixed(5)),
      windowSpentUsd: Number(windowSpentUsd.toFixed(5)),
      successCount,
      fallbackCount,
      failedCount,
      avgLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0,
      usageUnits: Number(acc.tokensUsed || 0),
      activeKeysCount,
    };

    // Build daily trend buckets
    const dayMap = new Map<
      string,
      {
        requests: number;
        successCount: number;
        failedCount: number;
        spentUsd: number;
        usageUnits: number;
        latencySum: number;
        latencyCount: number;
      }
    >();
    for (const key of windowKeys) {
      dayMap.set(key, {
        requests: 0,
        successCount: 0,
        failedCount: 0,
        spentUsd: 0,
        usageUnits: 0,
        latencySum: 0,
        latencyCount: 0,
      });
    }
    for (const log of windowLogs) {
      const dk = toDayKey(log.time);
      const bucket = dayMap.get(dk);
      if (!bucket) continue;
      bucket.requests += 1;
      if (log.status === 'failed') bucket.failedCount += 1;
      else bucket.successCount += 1;
      bucket.spentUsd += Number(log.estimatedCostUsd || 0);
      bucket.usageUnits += Number(log.tokens || 0);
      if (typeof log.latencyMs === 'number' && log.latencyMs > 0) {
        bucket.latencySum += log.latencyMs;
        bucket.latencyCount += 1;
      }
    }

    const trend = windowKeys.map((date) => {
      const b = dayMap.get(date)!;
      return {
        date,
        label: date.slice(5),
        requests: b.requests,
        successCount: b.successCount,
        failedCount: b.failedCount,
        spentUsd: Number(b.spentUsd.toFixed(5)),
        usageUnits: b.usageUnits,
        avgLatencyMs: b.latencyCount > 0 ? Math.round(b.latencySum / b.latencyCount) : 0,
      };
    });

    // Desensitized tierBreakdown & stationBreakdown
    const tierGroups = new Map<
      string,
      {
        tierId: string;
        tierName: string;
        station: string;
        stationLabel: string;
        requests: number;
        successCount: number;
        failedCount: number;
        spentUsd: number;
        latencySum: number;
        latencyCount: number;
      }
    >();
    const stationGroups = new Map<
      string,
      {
        station: string;
        stationLabel: string;
        requests: number;
        successCount: number;
        failedCount: number;
        spentUsd: number;
        latencySum: number;
        latencyCount: number;
      }
    >();

    for (const log of windowLogs) {
      const tierId = log.tierId || 'standard';
      const tierName = sanitizeForClient(log.tierName || '标准档');
      const stationLabel = sanitizeForClient(log.stationTitle || log.station);
      const tGroup = tierGroups.get(tierId) || {
        tierId,
        tierName,
        station: log.station,
        stationLabel,
        requests: 0,
        successCount: 0,
        failedCount: 0,
        spentUsd: 0,
        latencySum: 0,
        latencyCount: 0,
      };
      tGroup.requests += 1;
      if (log.status === 'failed') tGroup.failedCount += 1;
      else tGroup.successCount += 1;
      tGroup.spentUsd += Number(log.estimatedCostUsd || 0);
      if (typeof log.latencyMs === 'number' && log.latencyMs > 0) {
        tGroup.latencySum += log.latencyMs;
        tGroup.latencyCount += 1;
      }
      tierGroups.set(tierId, tGroup);

      const sGroup = stationGroups.get(log.station) || {
        station: log.station,
        stationLabel,
        requests: 0,
        successCount: 0,
        failedCount: 0,
        spentUsd: 0,
        latencySum: 0,
        latencyCount: 0,
      };
      sGroup.requests += 1;
      if (log.status === 'failed') sGroup.failedCount += 1;
      else sGroup.successCount += 1;
      sGroup.spentUsd += Number(log.estimatedCostUsd || 0);
      if (typeof log.latencyMs === 'number' && log.latencyMs > 0) {
        sGroup.latencySum += log.latencyMs;
        sGroup.latencyCount += 1;
      }
      stationGroups.set(log.station, sGroup);
    }

    const tierBreakdown = Array.from(tierGroups.values()).map((g) => ({
      tierId: g.tierId,
      tierName: sanitizeForClient(g.tierName),
      station: g.station,
      stationLabel: sanitizeForClient(g.stationLabel),
      status: g.requests > 0 && g.failedCount === g.requests ? 'degraded' : 'active',
      requests: g.requests,
      successCount: g.successCount,
      failedCount: g.failedCount,
      spentUsd: Number(g.spentUsd.toFixed(5)),
      avgLatencyMs: g.latencyCount > 0 ? Math.round(g.latencySum / g.latencyCount) : 0,
    }));

    const stationBreakdown = Array.from(stationGroups.values()).map((g) => ({
      station: g.station,
      stationLabel: sanitizeForClient(g.stationLabel),
      status: g.requests > 0 && g.failedCount === g.requests ? 'degraded' : 'active',
      requests: g.requests,
      successCount: g.successCount,
      failedCount: g.failedCount,
      spentUsd: Number(g.spentUsd.toFixed(5)),
      avgLatencyMs: g.latencyCount > 0 ? Math.round(g.latencySum / g.latencyCount) : 0,
    }));

    const logs = scopedLogs.slice(0, 100).map((log) => ({
      id: log.id,
      time: log.time,
      projectId: log.projectId || null,
      station: log.station,
      stationLabel: sanitizeForClient(log.stationTitle || log.station),
      tierId: log.tierId || null,
      tierName: log.tierName ? sanitizeForClient(log.tierName) : null,
      latencyMs: log.latencyMs,
      usageUnits: Number(log.tokens || 0),
      estimatedCostUsd: Number((log.estimatedCostUsd || 0).toFixed(5)),
      usageStatus: log.usageStatus || 'known',
      status: log.status,
      ...(log.error ? { error: sanitizeForClient(log.error) } : {}),
    }));

    const payload = {
      ok: true,
      scope,
      days,
      account: sanitizeForClient(toPublicProfile(acc)),
      kpis,
      trend,
      tierBreakdown,
      stationBreakdown,
      logs,
    };

    if (format === 'csv') {
      const header = 'id,time,station,stationLabel,tierId,tierName,status,latencyMs,usageUnits,estimatedCostUsd,error';
      const rows = logs.map((l) =>
        [
          escapeCsvCell(l.id),
          escapeCsvCell(l.time),
          escapeCsvCell(l.station),
          escapeCsvCell(l.stationLabel),
          escapeCsvCell(l.tierId || ''),
          escapeCsvCell(l.tierName || ''),
          escapeCsvCell(l.status),
          escapeCsvCell(l.latencyMs),
          escapeCsvCell(l.usageUnits),
          escapeCsvCell(l.estimatedCostUsd),
          escapeCsvCell(l.error || ''),
        ].join(',')
      );
      const csvText = '\uFEFF' + [header, ...rows].join('\r\n');
      return new Response(csvText, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="usage-report.csv"',
        },
      });
    }

    if (format === 'json') {
      return new Response(JSON.stringify(payload, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="usage-report.json"',
        },
      });
    }

    return Response.json(payload);
  } catch (e) {
    return failure(e);
  }
}
