import { cancelOrder, getOrder, listOrders } from '../../../lib/commerce';
import {
  failure,
  resolveUserAccount,
  toPublicProfile,
} from '../../../lib/server';

export async function GET(request: Request) {
  try {
    const account = resolveUserAccount(request);
    if (!account) {
      return Response.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const url = new URL(request.url);
    const orderId = (url.searchParams.get('orderId') || url.searchParams.get('id') || '').trim();
    const status = (url.searchParams.get('status') || '').trim();

    if (orderId) {
      try {
        const order = getOrder({ accountId: account.id, orderId });
        return Response.json({
          account: toPublicProfile(account),
          order,
        });
      } catch (err: any) {
        const code = String(err?.message || 'GET_ORDER_FAILED');
        const httpStatus =
          code === 'ORDER_NOT_FOUND' ? 404 : code === 'FORBIDDEN_ORDER_ACCESS' ? 403 : 400;
        return Response.json({ error: code }, { status: httpStatus });
      }
    }

    try {
      const orders = listOrders({ accountId: account.id, status: status || undefined });
      return Response.json({
        account: toPublicProfile(account),
        orders,
      });
    } catch (err: any) {
      const code = String(err?.message || 'LIST_ORDERS_FAILED');
      return Response.json({ error: code }, { status: 400 });
    }
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: Request) {
  try {
    const account = resolveUserAccount(request);
    if (!account) {
      return Response.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const raw = await request.json().catch(() => ({}));
    const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const action = String(body.action || body.operation || '').trim();
    const orderId = String(body.orderId || body.id || '').trim();

    if (!orderId) {
      return Response.json({ error: 'INVALID_INPUT' }, { status: 400 });
    }

    if (action === 'detail' || action === 'get') {
      try {
        const order = getOrder({ accountId: account.id, orderId });
        return Response.json({
          account: toPublicProfile(account),
          order,
        });
      } catch (err: any) {
        const code = String(err?.message || 'GET_ORDER_FAILED');
        const httpStatus =
          code === 'ORDER_NOT_FOUND' ? 404 : code === 'FORBIDDEN_ORDER_ACCESS' ? 403 : 400;
        return Response.json({ error: code }, { status: httpStatus });
      }
    }

    if (action === 'cancel') {
      try {
        const result = cancelOrder({ accountId: account.id, orderId });
        return Response.json({
          account: toPublicProfile(account),
          order: result.order,
          alreadyCancelled: result.alreadyCancelled,
        });
      } catch (err: any) {
        const code = String(err?.message || 'CANCEL_ORDER_FAILED');
        const httpStatus =
          code === 'ORDER_NOT_FOUND'
            ? 404
            : code === 'FORBIDDEN_ORDER_ACCESS'
              ? 403
              : code === 'PAID_ORDER_CANNOT_CANCEL'
                ? 409
                : 400;
        return Response.json({ error: code }, { status: httpStatus });
      }
    }

    return Response.json({ error: 'INVALID_ACTION' }, { status: 400 });
  } catch (e) {
    return failure(e);
  }
}
