import { flushPersistentStore, getStore } from './server';
import type {
  CommerceOrder,
  CommerceOrderStatus,
  CommercePlan,
  CommercePlanKind,
  CommercePlanPeriod,
  CommerceSubscription,
  CreatorPlanSummary,
} from './types';

const DEFAULT_COMMERCE_PLANS: Array<{
  id: string;
  name: string;
  description: string;
  kind: CommercePlanKind;
  period: CommercePlanPeriod;
  priceUsd: number;
  creditUsd: number;
  paymentChannelSlot: string;
  order: number;
}> = [
  {
    id: 'plan_monthly_pro',
    name: '月度创作会员',
    description: '适合高频短剧迭代与原创起盘，含月度创作额度包与全流程工作台权限。',
    kind: 'subscription',
    period: 'monthly',
    priceUsd: 29,
    creditUsd: 35,
    paymentChannelSlot: 'manual_admin',
    order: 1,
  },
  {
    id: 'plan_yearly_studio',
    name: '年度工作室会员',
    description: '长周期剧集矩阵首选，享更高额度配比与全年持续创作支持。',
    kind: 'subscription',
    period: 'yearly',
    priceUsd: 290,
    creditUsd: 380,
    paymentChannelSlot: 'manual_admin',
    order: 2,
  },
  {
    id: 'plan_topup_pack',
    name: '单次灵感加油包',
    description: '按需补充创作预算额度，长期有效，不影响现有会员周期。',
    kind: 'topup',
    period: 'once',
    priceUsd: 15,
    creditUsd: 16.5,
    paymentChannelSlot: 'manual_admin',
    order: 3,
  },
];

const ALLOWED_PAYMENT_CHANNELS = new Set(['manual_admin', 'test', 'pending_gateway']);

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function roundUsd(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function computePeriodEndIso(startIso: string, period: CommercePlanPeriod): string | undefined {
  if (period === 'once') return undefined;
  const base = new Date(startIso);
  if (Number.isNaN(base.getTime())) return undefined;
  if (period === 'yearly') {
    base.setFullYear(base.getFullYear() + 1);
  } else {
    base.setMonth(base.getMonth() + 1);
  }
  return base.toISOString();
}

function sanitizePaymentChannel(raw: unknown, fallback = 'manual_admin'): string {
  const candidate = typeof raw === 'string' ? raw.trim() : '';
  if (!candidate) return fallback;
  if (ALLOWED_PAYMENT_CHANNELS.has(candidate)) return candidate;
  if (/^[a-z0-9_-]{2,32}$/i.test(candidate)) return candidate;
  return fallback;
}

function createSeedPlans(nowIso: string): CommercePlan[] {
  return DEFAULT_COMMERCE_PLANS.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    kind: item.kind,
    period: item.period,
    priceUsd: item.priceUsd,
    creditUsd: item.creditUsd,
    paymentChannelSlot: item.paymentChannelSlot,
    enabled: true,
    order: item.order,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
}

export function applyCommerceMigration(
  store: {
    plans?: CommercePlan[];
    subscriptions?: CommerceSubscription[];
    orders?: CommerceOrder[];
  },
  nowIso: string = new Date().toISOString()
): boolean {  let mutated = false;

  if (!Array.isArray(store.plans)) {
    store.plans = createSeedPlans(nowIso);
    mutated = true;
  } else if (store.plans.length === 0) {
    store.plans = createSeedPlans(nowIso);
    mutated = true;
  }

  if (!Array.isArray(store.subscriptions)) {
    store.subscriptions = [];
    mutated = true;
  }

  if (!Array.isArray(store.orders)) {
    store.orders = [];
    mutated = true;
  }

  return mutated;
}

export function ensureCommerceStore(): {
  plans: CommercePlan[];
  subscriptions: CommerceSubscription[];
  orders: CommerceOrder[];
} {
  const store = getStore();
  const mutated = applyCommerceMigration(store);

  if (mutated) {
    flushPersistentStore();
  }

  return {
    plans: store.plans!,
    subscriptions: store.subscriptions!,
    orders: store.orders!,
  };
}


function toCreatorPlanSummary(plan: CommercePlan): CreatorPlanSummary {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    kind: plan.kind,
    period: plan.period,
    priceUsd: plan.priceUsd,
    creditUsd: plan.creditUsd,
    paymentChannelSlot: plan.paymentChannelSlot || 'manual_admin',
    order: plan.order,
  };
}

function sanitizeOrderForCreator(order: CommerceOrder): Omit<CommerceOrder, 'confirmedByAccountId'> {
  return {
    id: order.id,
    accountId: order.accountId,
    planId: order.planId,
    planName: order.planName,
    kind: order.kind,
    period: order.period,
    status: order.status,
    priceUsd: order.priceUsd,
    creditUsd: order.creditUsd,
    paymentChannel: order.paymentChannel,
    createdAt: order.createdAt,
    ...(order.paidAt ? { paidAt: order.paidAt } : {}),
    ...(order.cancelledAt ? { cancelledAt: order.cancelledAt } : {}),
    ...(order.idempotencyKey ? { idempotencyKey: order.idempotencyKey } : {}),
  };
}

export function listPlansForCreator(): CreatorPlanSummary[] {
  const { plans } = ensureCommerceStore();
  return plans
    .filter((p) => p.enabled && isFinitePositiveNumber(p.priceUsd) && isFinitePositiveNumber(p.creditUsd))
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(toCreatorPlanSummary);
}

export function createOrder(params: {
  accountId: string;
  planId: string;
  paymentChannel?: string;
  idempotencyKey?: string;
}) {
  const { plans, orders } = ensureCommerceStore();
  const accountId = String(params.accountId || '').trim();
  const planId = String(params.planId || '').trim();
  if (!accountId || !planId) {
    throw new Error('INVALID_INPUT');
  }

  const idemKey = typeof params.idempotencyKey === 'string' ? params.idempotencyKey.trim() : '';
  if (idemKey) {
    const existingByIdem = orders.find(
      (o) => o.accountId === accountId && o.idempotencyKey === idemKey
    );
    if (existingByIdem) {
      return {
        order: sanitizeOrderForCreator(existingByIdem),
        idempotentReplay: true,
      };
    }
  }

  const plan = plans.find((p) => p.id === planId);
  if (!plan || !plan.enabled) {
    throw new Error('PLAN_NOT_AVAILABLE');
  }
  if (!isFinitePositiveNumber(plan.priceUsd) || !isFinitePositiveNumber(plan.creditUsd)) {
    throw new Error('INVALID_PLAN_AMOUNT');
  }

  const nowIso = new Date().toISOString();
  const order: CommerceOrder = {
    id: 'ord_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16),
    accountId,
    planId: plan.id,
    planName: plan.name,
    kind: plan.kind,
    period: plan.period,
    status: 'pending',
    priceUsd: roundUsd(plan.priceUsd),
    creditUsd: roundUsd(plan.creditUsd),
    paymentChannel: sanitizePaymentChannel(
      params.paymentChannel,
      plan.paymentChannelSlot || 'manual_admin'
    ),
    createdAt: nowIso,
    ...(idemKey ? { idempotencyKey: idemKey } : {}),
  };

  orders.unshift(order);
  flushPersistentStore();

  return {
    order: sanitizeOrderForCreator(order),
    idempotentReplay: false,
  };
}

export function listOrders(params: { accountId: string; status?: string }) {
  const { orders } = ensureCommerceStore();
  const accountId = String(params.accountId || '').trim();
  const statusFilter = typeof params.status === 'string' ? params.status.trim() : '';

  if (
    statusFilter &&
    statusFilter !== 'all' &&
    statusFilter !== 'pending' &&
    statusFilter !== 'paid' &&
    statusFilter !== 'cancelled'
  ) {
    throw new Error('INVALID_STATUS_FILTER');
  }

  return orders
    .filter((o) => {
      if (o.accountId !== accountId) return false;
      if (statusFilter && statusFilter !== 'all' && o.status !== statusFilter) return false;
      return true;
    })
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(sanitizeOrderForCreator);
}

export function getOrder(params: { accountId: string; orderId: string }) {
  const { orders } = ensureCommerceStore();
  const accountId = String(params.accountId || '').trim();
  const orderId = String(params.orderId || '').trim();
  if (!accountId || !orderId) {
    throw new Error('INVALID_INPUT');
  }

  const order = orders.find((o) => o.id === orderId);
  if (!order) {
    throw new Error('ORDER_NOT_FOUND');
  }
  if (order.accountId !== accountId) {
    throw new Error('FORBIDDEN_ORDER_ACCESS');
  }

  return sanitizeOrderForCreator(order);
}

export function cancelOrder(params: { accountId: string; orderId: string }) {
  const { orders } = ensureCommerceStore();
  const accountId = String(params.accountId || '').trim();
  const orderId = String(params.orderId || '').trim();
  if (!accountId || !orderId) {
    throw new Error('INVALID_INPUT');
  }

  const order = orders.find((o) => o.id === orderId);
  if (!order) {
    throw new Error('ORDER_NOT_FOUND');
  }
  if (order.accountId !== accountId) {
    throw new Error('FORBIDDEN_ORDER_ACCESS');
  }
  if (order.status === 'paid') {
    throw new Error('PAID_ORDER_CANNOT_CANCEL');
  }
  if (order.status === 'cancelled') {
    return {
      order: sanitizeOrderForCreator(order),
      alreadyCancelled: true,
    };
  }
  if (order.status !== 'pending') {
    throw new Error('ORDER_STATE_NOT_CANCELLABLE');
  }

  order.status = 'cancelled';
  order.cancelledAt = new Date().toISOString();
  flushPersistentStore();

  return {
    order: sanitizeOrderForCreator(order),
    alreadyCancelled: false,
  };
}

function syncExpiredSubscriptions(subscriptions: CommerceSubscription[]): boolean {
  const nowMs = Date.now();
  let changed = false;
  for (const sub of subscriptions) {
    if (sub.status === 'active' && sub.currentPeriodEnd) {
      const endMs = Date.parse(sub.currentPeriodEnd);
      if (!Number.isNaN(endMs) && endMs <= nowMs) {
        sub.status = 'expired';
        sub.renewEnabled = false;
        changed = true;
      }
    }
  }
  return changed;
}

export function getSubscriptions(accountId: string) {
  const { subscriptions } = ensureCommerceStore();
  const cleanAccountId = String(accountId || '').trim();
  if (syncExpiredSubscriptions(subscriptions)) {
    flushPersistentStore();
  }

  const mine = subscriptions
    .filter((s) => s.accountId === cleanAccountId)
    .slice()
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

  const current = mine.find((s) => s.status === 'active') || null;
  return {
    current,
    subscriptions: mine,
  };
}

export function cancelSubscription(params: { accountId: string; subscriptionId?: string }) {
  const { subscriptions } = ensureCommerceStore();
  const accountId = String(params.accountId || '').trim();
  const subscriptionId = typeof params.subscriptionId === 'string' ? params.subscriptionId.trim() : '';
  if (!accountId) {
    throw new Error('INVALID_INPUT');
  }

  syncExpiredSubscriptions(subscriptions);

  const mine = subscriptions.filter((s) => s.accountId === accountId);
  const target = subscriptionId
    ? mine.find((s) => s.id === subscriptionId)
    : mine.find((s) => s.status === 'active');

  if (!target) {
    throw new Error('SUBSCRIPTION_NOT_FOUND');
  }
  if (target.status === 'cancelled') {
    return {
      subscription: target,
      alreadyCancelled: true,
    };
  }
  if (target.status !== 'active') {
    throw new Error('SUBSCRIPTION_NOT_ACTIVE');
  }

  target.status = 'cancelled';
  target.renewEnabled = false;
  target.cancelledAt = new Date().toISOString();
  flushPersistentStore();

  return {
    subscription: target,
    alreadyCancelled: false,
  };
}

export function renewSubscription(params: {
  accountId: string;
  subscriptionId?: string;
  planId?: string;
  paymentChannel?: string;
  idempotencyKey?: string;
}) {
  const { plans, subscriptions } = ensureCommerceStore();
  const accountId = String(params.accountId || '').trim();
  if (!accountId) {
    throw new Error('INVALID_INPUT');
  }

  const subscriptionId = typeof params.subscriptionId === 'string' ? params.subscriptionId.trim() : '';
  const explicitPlanId = typeof params.planId === 'string' ? params.planId.trim() : '';

  let targetPlanId = explicitPlanId;
  let sourceSubscription: CommerceSubscription | undefined;

  if (subscriptionId) {
    sourceSubscription = subscriptions.find((s) => s.id === subscriptionId);
    if (!sourceSubscription) {
      throw new Error('SUBSCRIPTION_NOT_FOUND');
    }
    if (sourceSubscription.accountId !== accountId) {
      throw new Error('FORBIDDEN_SUBSCRIPTION_ACCESS');
    }
    if (!targetPlanId) {
      targetPlanId = sourceSubscription.planId;
    }
  } else if (!targetPlanId) {
    sourceSubscription = subscriptions
      .filter((s) => s.accountId === accountId)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
    if (sourceSubscription) {
      targetPlanId = sourceSubscription.planId;
    }
  }

  if (!targetPlanId) {
    const defaultSubPlan = plans
      .filter((p) => p.enabled && p.kind === 'subscription')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
    if (!defaultSubPlan) {
      throw new Error('PLAN_NOT_AVAILABLE');
    }
    targetPlanId = defaultSubPlan.id;
  }

  const targetPlan = plans.find((p) => p.id === targetPlanId);
  if (!targetPlan || !targetPlan.enabled || targetPlan.kind !== 'subscription') {
    throw new Error('PLAN_NOT_AVAILABLE');
  }

  const created = createOrder({
    accountId,
    planId: targetPlan.id,
    paymentChannel: params.paymentChannel,
    idempotencyKey: params.idempotencyKey,
  });

  return {
    order: created.order,
    idempotentReplay: created.idempotentReplay,
    sourceSubscriptionId: sourceSubscription?.id || null,
  };
}

export function adminSavePlan(input: Record<string, unknown>): CommercePlan {
  const { plans } = ensureCommerceStore();
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('INVALID_INPUT');
  }

  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const kindRaw = typeof input.kind === 'string' ? input.kind.trim() : '';
  const periodRaw = typeof input.period === 'string' ? input.period.trim() : '';
  const priceUsd = Number(input.priceUsd);
  const creditUsd = Number(input.creditUsd);

  if (!name || name.length > 80) {
    throw new Error('INVALID_PLAN_NAME');
  }
  if (kindRaw !== 'subscription' && kindRaw !== 'topup') {
    throw new Error('INVALID_PLAN_KIND');
  }
  if (periodRaw !== 'monthly' && periodRaw !== 'yearly' && periodRaw !== 'once') {
    throw new Error('INVALID_PLAN_PERIOD');
  }
  if (kindRaw === 'topup' && periodRaw !== 'once') {
    throw new Error('INVALID_PLAN_PERIOD');
  }
  if (kindRaw === 'subscription' && periodRaw === 'once') {
    throw new Error('INVALID_PLAN_PERIOD');
  }
  if (!isFinitePositiveNumber(priceUsd) || !isFinitePositiveNumber(creditUsd)) {
    throw new Error('INVALID_PLAN_AMOUNT');
  }

  const enabled = typeof input.enabled === 'boolean' ? input.enabled : true;
  const order =
    input.order !== undefined && Number.isFinite(Number(input.order))
      ? Math.trunc(Number(input.order))
      : plans.length + 1;
  const paymentChannelSlot = sanitizePaymentChannel(input.paymentChannelSlot, 'manual_admin');
  const nowIso = new Date().toISOString();

  if (id) {
    const existing = plans.find((p) => p.id === id);
    if (existing) {
      existing.name = name;
      existing.description = description;
      existing.kind = kindRaw;
      existing.period = periodRaw;
      existing.priceUsd = roundUsd(priceUsd);
      existing.creditUsd = roundUsd(creditUsd);
      existing.paymentChannelSlot = paymentChannelSlot;
      existing.enabled = enabled;
      existing.order = order;
      existing.updatedAt = nowIso;
      flushPersistentStore();
      return existing;
    }
  }

  const created: CommercePlan = {
    id: id || 'plan_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
    name,
    description,
    kind: kindRaw,
    period: periodRaw,
    priceUsd: roundUsd(priceUsd),
    creditUsd: roundUsd(creditUsd),
    paymentChannelSlot,
    enabled,
    order,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  plans.push(created);
  flushPersistentStore();
  return created;
}

const confirmOrderLocks = new Map<string, Promise<unknown>>();

function runWithOrderLock<T>(orderId: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = confirmOrderLocks.get(orderId) || Promise.resolve();
  const next = prev.then(() => fn());
  const cleanup = next.then(
    () => undefined,
    () => undefined
  );
  confirmOrderLocks.set(orderId, cleanup);
  cleanup.finally(() => {
    if (confirmOrderLocks.get(orderId) === cleanup) {
      confirmOrderLocks.delete(orderId);
    }
  });
  return next;
}

export async function adminConfirmOrder(params: {
  orderId: string;
  adminAccountId: string;
}): Promise<{
  order: CommerceOrder;
  subscription: CommerceSubscription | null;
  alreadyPaid: boolean;
  accountBudgetCapUsd: number;
}> {
  const orderId = String(params.orderId || '').trim();
  const adminAccountId = String(params.adminAccountId || '').trim();
  if (!orderId || !adminAccountId) {
    throw new Error('INVALID_INPUT');
  }

  return runWithOrderLock(orderId, () => {
    const store = getStore();
    const { orders, subscriptions, plans } = ensureCommerceStore();

    const order = orders.find((o) => o.id === orderId);
    if (!order) {
      throw new Error('ORDER_NOT_FOUND');
    }

    const account = store.accounts.find((a) => a.id === order.accountId);
    if (!account) {
      throw new Error('ACCOUNT_NOT_FOUND');
    }

    if (order.status === 'paid') {
      const existingSub =
        subscriptions.find((s) => s.orderId === order.id) ||
        subscriptions.find((s) => s.accountId === order.accountId && s.status === 'active') ||
        null;
      return {
        order,
        subscription: existingSub,
        alreadyPaid: true,
        accountBudgetCapUsd: account.budgetCapUsd,
      };
    }

    if (order.status !== 'pending') {
      throw new Error('ORDER_STATUS_NOT_CONFIRMABLE');
    }

    if (!isFinitePositiveNumber(order.priceUsd) || !isFinitePositiveNumber(order.creditUsd)) {
      throw new Error('INVALID_ORDER_AMOUNT');
    }

    const nowIso = new Date().toISOString();
    const currentCap = Number.isFinite(account.budgetCapUsd) ? account.budgetCapUsd : 0;
    account.budgetCapUsd = roundUsd(currentCap + order.creditUsd);

    order.status = 'paid';
    order.paidAt = nowIso;
    order.confirmedByAccountId = adminAccountId;

    let createdOrUpdatedSub: CommerceSubscription | null = null;
    const plan = plans.find((p) => p.id === order.planId);
    const effectivePeriod: CommercePlanPeriod =
      order.period || plan?.period || (order.kind === 'subscription' ? 'monthly' : 'once');

    if (order.kind === 'subscription') {
      syncExpiredSubscriptions(subscriptions);
      const activeSub = subscriptions.find(
        (s) => s.accountId === order.accountId && s.status === 'active'
      );
      if (activeSub && activeSub.planId === order.planId && activeSub.currentPeriodEnd) {
        const currentEndMs = Date.parse(activeSub.currentPeriodEnd);
        const baseIso =
          !Number.isNaN(currentEndMs) && currentEndMs > Date.now()
            ? activeSub.currentPeriodEnd
            : nowIso;
        activeSub.currentPeriodEnd = computePeriodEndIso(baseIso, effectivePeriod);
        activeSub.creditUsd = roundUsd(activeSub.creditUsd + order.creditUsd);
        activeSub.renewEnabled = true;
        activeSub.orderId = order.id;
        createdOrUpdatedSub = activeSub;
      } else {
        if (activeSub) {
          activeSub.status = 'expired';
          activeSub.renewEnabled = false;
        }
        const sub: CommerceSubscription = {
          id: 'sub_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16),
          accountId: order.accountId,
          planId: order.planId,
          planName: order.planName,
          status: 'active',
          period: effectivePeriod,
          creditUsd: roundUsd(order.creditUsd),
          startedAt: nowIso,
          currentPeriodEnd: computePeriodEndIso(nowIso, effectivePeriod),
          renewEnabled: true,
          orderId: order.id,
        };
        subscriptions.unshift(sub);
        createdOrUpdatedSub = sub;
      }
    }

    flushPersistentStore();

    return {
      order,
      subscription: createdOrUpdatedSub,
      alreadyPaid: false,
      accountBudgetCapUsd: account.budgetCapUsd,
    };
  });
}

export function listAllCommerceForAdmin(): {
  plans: CommercePlan[];
  orders: Array<CommerceOrder & { username: string; displayName: string }>;
  subscriptions: Array<CommerceSubscription & { username: string; displayName: string }>;
} {
  const store = getStore();
  const { plans, orders, subscriptions } = ensureCommerceStore();
  if (syncExpiredSubscriptions(subscriptions)) {
    flushPersistentStore();
  }

  const accountMap = new Map(store.accounts.map((a) => [a.id, a]));

  const enrichedOrders = orders
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((o) => {
      const acc = accountMap.get(o.accountId);
      return {
        ...o,
        username: acc?.username || 'unknown',
        displayName: acc?.displayName || acc?.username || '未知账号',
      };
    });

  const enrichedSubscriptions = subscriptions
    .slice()
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .map((s) => {
      const acc = accountMap.get(s.accountId);
      return {
        ...s,
        username: acc?.username || 'unknown',
        displayName: acc?.displayName || acc?.username || '未知账号',
      };
    });

  return {
    plans: plans.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    orders: enrichedOrders,
    subscriptions: enrichedSubscriptions,
  };
}