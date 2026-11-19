import { createOrder, listPlansForCreator } from '../../../lib/commerce';
import {
  failure,
  resolveAccountFromRequest,
  toPublicProfile,
} from '../../../lib/server';

export async function GET(request: Request) {
  try {
    const account = resolveAccountFromRequest(request);
    if (!account) {
      return Response.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const plans = listPlansForCreator();
    return Response.json({
      account: toPublicProfile(account),
      plans,
      budgetCapUsd: account.budgetCapUsd,
      budgetUsedUsd: account.budgetUsedUsd,
    });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: Request) {
  try {
    const account = resolveAccountFromRequest(request);
    if (!account) {
      return Response.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const raw = await request.json().catch(() => ({}));
    const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const planId = typeof body.planId === 'string' ? body.planId.trim() : '';
    const paymentChannel =
      typeof body.paymentChannel === 'string' ? body.paymentChannel.trim() : undefined;
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;

    if (!planId) {
      return Response.json({ error: 'INVALID_INPUT' }, { status: 400 });
    }

    try {
      const result = createOrder({
        accountId: account.id,
        planId,
        paymentChannel,
        idempotencyKey,
      });
      return Response.json({
        account: toPublicProfile(account),
        order: result.order,
        idempotentReplay: result.idempotentReplay,
      });
    } catch (err: any) {
      const code = String(err?.message || 'CREATE_ORDER_FAILED');
      const status = code === 'PLAN_NOT_AVAILABLE' ? 404 : 400;
      return Response.json({ error: code }, { status });
    }
  } catch (e) {
    return failure(e);
  }
}
