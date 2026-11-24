import {
  cancelSubscription,
  getSubscriptions,
  listPlansForCreator,
  renewSubscription,
} from '../../../lib/commerce';
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

    const data = getSubscriptions(account.id);
    const plans = listPlansForCreator();
    return Response.json({
      account: toPublicProfile(account),
      current: data.current,
      subscriptions: data.subscriptions,
      history: data.subscriptions,
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
    const action = String(body.action || body.operation || '').trim();

    if (action === 'cancel') {
      const subscriptionId =
        typeof body.subscriptionId === 'string' ? body.subscriptionId.trim() : undefined;
      try {
        const result = cancelSubscription({
          accountId: account.id,
          subscriptionId,
        });
        const latest = getSubscriptions(account.id);
        return Response.json({
          account: toPublicProfile(account),
          subscription: result.subscription,
          alreadyCancelled: result.alreadyCancelled,
          current: latest.current,
          subscriptions: latest.subscriptions,
          budgetCapUsd: account.budgetCapUsd,
          budgetUsedUsd: account.budgetUsedUsd,
        });
      } catch (err: any) {
        const code = String(err?.message || 'CANCEL_SUBSCRIPTION_FAILED');
        const status =
          code === 'SUBSCRIPTION_NOT_FOUND'
            ? 404
            : code === 'FORBIDDEN_SUBSCRIPTION_ACCESS'
              ? 403
              : 400;
        return Response.json({ error: code }, { status });
      }
    }

    if (action === 'renew') {
      const subscriptionId =
        typeof body.subscriptionId === 'string' ? body.subscriptionId.trim() : undefined;
      const planId = typeof body.planId === 'string' ? body.planId.trim() : undefined;
      const paymentChannel =
        typeof body.paymentChannel === 'string' ? body.paymentChannel.trim() : undefined;
      const idempotencyKey =
        typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;

      try {
        const result = renewSubscription({
          accountId: account.id,
          subscriptionId,
          planId,
          paymentChannel,
          idempotencyKey,
        });
        return Response.json({
          account: toPublicProfile(account),
          order: result.order,
          idempotentReplay: result.idempotentReplay,
          sourceSubscriptionId: result.sourceSubscriptionId,
        });
      } catch (err: any) {
        const code = String(err?.message || 'RENEW_SUBSCRIPTION_FAILED');
        const status =
          code === 'SUBSCRIPTION_NOT_FOUND'
            ? 404
            : code === 'FORBIDDEN_SUBSCRIPTION_ACCESS'
              ? 403
              : 400;
        return Response.json({ error: code }, { status });
      }
    }

    return Response.json({ error: 'INVALID_ACTION' }, { status: 400 });
  } catch (e) {
    return failure(e);
  }
}
