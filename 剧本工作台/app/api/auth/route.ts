import {
  createSessionForAccount,
  failure,
  flushPersistentStore,
  generateRandomCode,
  getActiveAccountOrDefault,
  getStore,
  parseSessionTokenFromRequest,
  resolveAccountFromRequest,
  toPublicProfile,
} from '../../../lib/server';
import type { StudioAccount } from '../../../lib/types';

function buildSessionResponse(payload: any, token?: string, clearCookie = false): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (clearCookie) {
    headers['Set-Cookie'] = 'studio_session=; Path=/; Max-Age=0; SameSite=Lax';
  } else if (token) {
    headers['Set-Cookie'] = `studio_session=${encodeURIComponent(token)}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`;
  }
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

export async function GET(request: Request) {
  try {
    const store = getStore();
    const resolved = resolveAccountFromRequest(request);
    const activeAcc =
      resolved || (store.systemConfig.requireAuthOnFrontend ? null : getActiveAccountOrDefault(request));
    return Response.json({
      authenticated: Boolean(resolved),
      requireAuthOnFrontend: store.systemConfig.requireAuthOnFrontend,
      allowInviteRegistration: store.systemConfig.allowInviteRegistration,
      account: activeAcc ? toPublicProfile(activeAcc) : null,
    });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: Request) {
  try {
    const store = getStore();
    const body: any = await request.json().catch(() => ({}));
    const action = String(body.action || '');

    // 1. Login with Username + Password
    if (action === 'login_password') {
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!username || !password) throw new Error('INVALID_CREDENTIALS');

      const acc = store.accounts.find(
        (a) => a.username.toLowerCase() === username && a.password === password
      );
      if (!acc) throw new Error('INVALID_CREDENTIALS');
      if (acc.status === 'disabled') throw new Error('ACCOUNT_DISABLED');

      const token = createSessionForAccount(acc);
      return buildSessionResponse(
        {
          ok: true,
          token,
          account: toPublicProfile(acc),
        },
        token
      );
    }

    // 2. Login with Exclusive Access Key OR Admin-generated Invite Code
    if (action === 'login_key') {
      const rawKey = String(body.key || '').trim();
      if (!rawKey) throw new Error('INVALID_CREDENTIALS');

      // 2a. Check if it matches an existing account's exclusive accessKey
      const byAccessKey = store.accounts.find(
        (a) => a.accessKey.toLowerCase() === rawKey.toLowerCase()
      );
      if (byAccessKey) {
        if (byAccessKey.status === 'disabled') throw new Error('ACCOUNT_DISABLED');
        const token = createSessionForAccount(byAccessKey);
        return buildSessionResponse(
          {
            ok: true,
            token,
            account: toPublicProfile(byAccessKey),
          },
          token
        );
      }

      // 2b. Check if it matches an Admin-generated Invite Code
      const invite = store.invites.find((inv) => inv.code.toLowerCase() === rawKey.toLowerCase());
      if (!invite || invite.status === 'revoked') {
        throw new Error('INVALID_INVITE_CODE');
      }

      // If this single-use invite was already bound to an account, log into that bound account
      if (invite.maxUses === 1 && invite.boundAccountIds.length === 1) {
        const boundAcc = store.accounts.find((a) => a.id === invite.boundAccountIds[0]);
        if (boundAcc) {
          if (boundAcc.status === 'disabled') throw new Error('ACCOUNT_DISABLED');
          const token = createSessionForAccount(boundAcc);
          return buildSessionResponse(
            {
              ok: true,
              token,
              account: toPublicProfile(boundAcc),
            },
            token
          );
        }
      }

      if (invite.usedCount >= invite.maxUses) {
        throw new Error('INVALID_INVITE_CODE');
      }

      // Auto-provision a member account from this invite key for instant 1-step login
      const seq = invite.usedCount + 1;
      const suffix = invite.code.split('-').pop()?.toLowerCase() || String(Date.now()).slice(-4);
      const autoUsername = `member_${suffix}_${seq}`;
      const now = new Date().toISOString();
      const newAcc: StudioAccount = {
        id: 'acc-' + crypto.randomUUID(),
        username: autoUsername,
        displayName: invite.note ? `${invite.note.slice(0, 12)} #${seq}` : `受邀成员 #${seq}`,
        role: invite.role,
        password: generateRandomCode('PWD').slice(-8),
        accessKey: invite.maxUses === 1 ? invite.code : generateRandomCode('AYIN-KEY'),
        status: 'active',
        budgetCapUsd: invite.budgetCapUsd,
        budgetUsedUsd: 0,
        tokensUsed: 0,
        allowedFlows: invite.allowedFlows,
        note: `通过邀请码 ${invite.code} 快捷激活`,
        createdAt: now,
        lastLoginAt: now,
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
      return buildSessionResponse(
        {
          ok: true,
          token,
          account: toPublicProfile(newAcc),
          autoProvisioned: {
            username: newAcc.username,
            password: newAcc.password,
            accessKey: newAcc.accessKey,
          },
        },
        token
      );
    }

    // 3. Register / Activate personal Username + Password using an Admin Invite Code
    if (action === 'register_with_invite') {
      const inviteCode = String(body.inviteCode || '').trim();
      const username = String(body.username || '').trim().toLowerCase();
      const displayName = String(body.displayName || username).trim();
      const password = String(body.password || '').trim();

      if (!inviteCode || !username || username.length < 2 || password.length < 4) {
        throw new Error('INVALID_INPUT');
      }
      if (store.accounts.some((a) => a.username.toLowerCase() === username)) {
        throw new Error('USERNAME_EXISTS');
      }

      const invite = store.invites.find((inv) => inv.code.toLowerCase() === inviteCode.toLowerCase());
      if (!invite || invite.status !== 'active' || invite.usedCount >= invite.maxUses) {
        throw new Error('INVALID_INVITE_CODE');
      }

      const now = new Date().toISOString();
      const newAcc: StudioAccount = {
        id: 'acc-' + crypto.randomUUID(),
        username,
        displayName: displayName.slice(0, 40),
        role: invite.role,
        password,
        accessKey: generateRandomCode('AYIN-KEY'),
        status: 'active',
        budgetCapUsd: invite.budgetCapUsd,
        budgetUsedUsd: 0,
        tokensUsed: 0,
        allowedFlows: invite.allowedFlows,
        note: `使用邀请码 ${invite.code} 注册激活`,
        createdAt: now,
        lastLoginAt: now,
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
      return buildSessionResponse(
        {
          ok: true,
          token,
          account: toPublicProfile(newAcc),
          exclusiveKey: newAcc.accessKey,
        },
        token
      );
    }

    // 4. Logout
    if (action === 'logout') {
      const token = parseSessionTokenFromRequest(request);
      if (token && store.sessions[token]) {
        delete store.sessions[token];
        flushPersistentStore();
      }
      return buildSessionResponse({ ok: true }, undefined, true);
    }

    throw new Error('INVALID_INPUT');
  } catch (e) {
    return failure(e);
  }
}
