import {
  checkAuthRateLimit,
  clearAuthRateLimit,
  createSessionForAccount,
  failure,
  flushPersistentStore,
  generateRandomCode,
  getStore,
  hashPassword,
  maskSecret,
  recordAuthFailure,
  resolveAccountFromRequest,
  sanitizeForClient,
  toPublicProfile,
} from '../../../lib/server';
import type { StudioAccount } from '../../../lib/types';

function buildRedeemSessionResponse(payload: unknown, token?: string): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Set-Cookie'] = `studio_session=${encodeURIComponent(token)}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax; HttpOnly`;
  }
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

export async function GET(request: Request) {
  try {
    const acc = resolveAccountFromRequest(request);
    if (!acc) {
      return Response.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }
    const store = getStore();
    const boundInvites = (store.invites || [])
      .filter((inv) => Array.isArray(inv.boundAccountIds) && inv.boundAccountIds.includes(acc.id))
      .map((inv) => ({
        id: inv.id,
        codeMasked: maskSecret(inv.code),
        role: inv.role,
        budgetCapUsd: inv.budgetCapUsd,
        note: sanitizeForClient(inv.note || ''),
        status: inv.status,
        createdAt: inv.createdAt,
      }));

    return Response.json({
      ok: true,
      account: sanitizeForClient(toPublicProfile(acc)),
      allowInviteRegistration: Boolean(store.systemConfig.allowInviteRegistration),
      boundInvites,
    });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: Request) {
  try {
    const store = getStore();
    const body: any = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'INVALID_INPUT', message: '请求体格式错误' }, { status: 400 });
    }

    const rl = checkAuthRateLimit(request, 'redeem_code');
    if (!rl.allowed) {
      return Response.json(
        { error: 'RATE_LIMITED', message: `兑换尝试过于频繁，请 ${rl.retryAfterSec} 秒后再试` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }
    const code = String(body.code ?? body.key ?? body.inviteCode ?? '').trim();
    if (!code) {
      return Response.json({ error: 'INVALID_INPUT', message: '请输入专属 Key 或邀请码' }, { status: 400 });
    }

    const currentAcc = resolveAccountFromRequest(request);

    // Branch A: Exclusive Access Key -> switch workspace
    const targetAcc = store.accounts.find(
      (a) => a.accessKey.toLowerCase() === code.toLowerCase()
    );
    if (targetAcc) {
      if (targetAcc.status === 'disabled') {
        throw new Error('ACCOUNT_DISABLED');
      }
      clearAuthRateLimit(request, 'redeem_code');
      const token = createSessionForAccount(targetAcc);
      return buildRedeemSessionResponse(
        {
          ok: true,
          mode: 'switched',
          token,
          account: sanitizeForClient(toPublicProfile(targetAcc)),
        },
        token
      );
    }

    // Branch B: Admin Invite Code
    if (!store.systemConfig.allowInviteRegistration) {
      return Response.json(
        { error: 'INVITE_REGISTRATION_DISABLED', message: '管理员当前已暂停邀请码自助激活' },
        { status: 403 }
      );
    }
    const invite = store.invites.find((inv) => inv.code.toLowerCase() === code.toLowerCase());
    if (!invite || invite.status === 'revoked') {
      recordAuthFailure(request, 'redeem_code');
      return Response.json(
        { error: 'INVALID_INVITE_CODE', message: '无效的专属 Key 或邀请码' },
        { status: 400 }
      );
    }
    if (invite.status === 'exhausted' || invite.usedCount >= invite.maxUses) {
      return Response.json(
        { error: 'INVITE_CODE_USED', message: '该邀请码已被使用或已达使用上限' },
        { status: 400 }
      );
    }
    if (currentAcc && Array.isArray(invite.boundAccountIds) && invite.boundAccountIds.includes(currentAcc.id)) {
      return Response.json(
        { error: 'INVITE_ALREADY_REDEEMED', message: '当前账号已兑换过该邀请码' },
        { status: 400 }
      );
    }

    const seq = invite.usedCount + 1;
    const suffix = invite.code.split('-').pop()?.toLowerCase() || String(Date.now()).slice(-4);
    const autoUsername = `member_${suffix}_${seq}`;
    const now = new Date().toISOString();
    const newAcc: StudioAccount = {
      id: 'acc-' + crypto.randomUUID(),
      username: autoUsername,
      displayName: invite.note ? `${invite.note.slice(0, 12)} #${seq}` : `受邀成员 #${seq}`,
      role: invite.role,
      password: hashPassword(generateRandomCode('PWD').slice(-8)),
      accessKey: invite.maxUses === 1 ? invite.code : generateRandomCode('AYIN-KEY'),
      status: 'active',
      budgetCapUsd: invite.budgetCapUsd,
      budgetUsedUsd: 0,
      tokensUsed: 0,
      allowedFlows: invite.allowedFlows,
      note: `通过兑换码 ${invite.code} 激活`,
      createdAt: now,
      lastLoginAt: now,
      globalRules: '',
      themePreference: 'light',
    };

    store.accounts.push(newAcc);
    invite.usedCount += 1;
    invite.boundAccountIds.push(newAcc.id);
    invite.boundUsernames.push(newAcc.username);
    if (invite.usedCount >= invite.maxUses) {
      invite.status = 'exhausted';
    }
    flushPersistentStore();

    const token = createSessionForAccount(newAcc);
    return buildRedeemSessionResponse(
      {
        ok: true,
        mode: 'activated',
        token,
        account: sanitizeForClient(toPublicProfile(newAcc)),
        accessKeyMasked: maskSecret(newAcc.accessKey),
      },
      token
    );
  } catch (e) {
    return failure(e);
  }
}
