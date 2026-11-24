import {
  failure,
  flushPersistentStore,
  hashPassword,
  resolveUserAccount,
  sanitizeForClient,
  toPublicProfile,
  verifyPassword,
} from '../../../lib/server';

async function handleProfileUpdate(request: Request): Promise<Response> {
  try {
    const acc = resolveUserAccount(request);
    if (!acc) {
      return Response.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const body: any = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('INVALID_INPUT');
    }

    if (body.displayName !== undefined) {
      if (typeof body.displayName !== 'string') throw new Error('INVALID_INPUT');
      const nextName = body.displayName.trim();
      if (!nextName || nextName.length > 50) throw new Error('INVALID_INPUT');
      acc.displayName = nextName;
    }

    if (body.themePreference !== undefined) {
      if (body.themePreference !== 'light' && body.themePreference !== 'dark') {
        throw new Error('INVALID_INPUT');
      }
      acc.themePreference = body.themePreference;
    }

    if (body.globalRules !== undefined) {
      if (typeof body.globalRules !== 'string') throw new Error('INVALID_INPUT');
      acc.globalRules = body.globalRules.replace(/\r\n?/g, '\n').slice(0, 20000);
    }

    const nextPasswordRaw = body.newPassword !== undefined ? body.newPassword : body.password;
    if (nextPasswordRaw !== undefined) {
      if (typeof body.currentPassword !== 'string' || !verifyPassword(body.currentPassword, acc.password).ok) {
        return Response.json(
          { error: 'INVALID_CURRENT_PASSWORD', message: '当前密码不正确' },
          { status: 400 }
        );
      }
      if (typeof nextPasswordRaw !== 'string' || nextPasswordRaw.length < 4) {
        return Response.json(
          { error: 'PASSWORD_TOO_SHORT', message: '新密码长度至少 4 位' },
          { status: 400 }
        );
      }
      acc.password = hashPassword(nextPasswordRaw);
    }

    flushPersistentStore();

    return Response.json({
      ok: true,
      account: sanitizeForClient(toPublicProfile(acc)),
      globalRules: typeof acc.globalRules === 'string' ? acc.globalRules : '',
      themePreference: acc.themePreference === 'dark' ? 'dark' : 'light',
    });
  } catch (e) {
    return failure(e);
  }
}

export async function GET(request: Request) {
  try {
    const acc = resolveUserAccount(request);
    if (!acc) {
      return Response.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }
    return Response.json({
      ok: true,
      account: sanitizeForClient(toPublicProfile(acc)),
      globalRules: typeof acc.globalRules === 'string' ? acc.globalRules : '',
      themePreference: acc.themePreference === 'dark' ? 'dark' : 'light',
    });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: Request) {
  return handleProfileUpdate(request);
}

export async function PATCH(request: Request) {
  return handleProfileUpdate(request);
}
