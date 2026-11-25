import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const DEFAULT_ADMIN_HOSTS = 'admin.cryptoayin.cn,admin.localhost';
const DEFAULT_MAIN_HOSTS = 'cryptoayin.cn,www.cryptoayin.cn';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function stripPort(host: string): string {
  if (!host) return '';
  if (host.startsWith('[')) {
    const endBracket = host.indexOf(']');
    return endBracket !== -1 ? host.slice(0, endBracket + 1) : host;
  }
  const firstColon = host.indexOf(':');
  if (firstColon !== -1 && host.indexOf(':', firstColon + 1) === -1) {
    return host.slice(0, firstColon);
  }
  return host;
}

function parseHostList(rawEnv: string | undefined, fallback: string): Set<string> {
  const source = rawEnv && rawEnv.trim() ? rawEnv : fallback;
  const set = new Set<string>();
  for (const part of source.split(',')) {
    const cleaned = stripPort(part.trim().toLowerCase()).replace(/\.+$/, '');
    if (cleaned) set.add(cleaned);
  }
  return set;
}

function resolveRequestHost(request: NextRequest): string {
  const raw =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    request.nextUrl.host ||
    '';
  const first = raw.split(',')[0]?.trim().toLowerCase() || '';
  return stripPort(first).replace(/\.+$/, '');
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isNextInternalOrMetadata(pathname: string): boolean {
  return (
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml'
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isNextInternalOrMetadata(pathname)) {
    return NextResponse.next();
  }

  const host = resolveRequestHost(request);
  const adminHosts = parseHostList(process.env.STUDIO_ADMIN_HOSTS, DEFAULT_ADMIN_HOSTS);
  const mainHosts = parseHostList(process.env.STUDIO_MAIN_HOSTS, DEFAULT_MAIN_HOSTS);
  const strictIsolation = process.env.STUDIO_STRICT_HOST_ISOLATION === '1';

  if (adminHosts.has(host)) {
    if (pathname === '/') {
      const rewriteUrl = request.nextUrl.clone();
      if (rewriteUrl.hostname === 'localhost') {
        rewriteUrl.protocol = 'http:';
      }
      rewriteUrl.pathname = '/admin';
      const requestHeaders = new Headers(request.headers);
      const forwardedHost = request.headers.get('x-forwarded-host');
      if (forwardedHost) {
        const firstForwarded = forwardedHost.split(',')[0]?.trim();
        if (firstForwarded) {
          requestHeaders.set('host', firstForwarded);
        }
      }
      return NextResponse.rewrite(rewriteUrl, {
        request: { headers: requestHeaders },
      });
    }
    if (
      matchesPrefix(pathname, '/admin') ||
      matchesPrefix(pathname, '/api/admin') ||
      matchesPrefix(pathname, '/api/auth') ||
      matchesPrefix(pathname, '/api/profile')
    ) {
      return NextResponse.next();
    }
    if (matchesPrefix(pathname.toLowerCase(), '/api')) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    return new NextResponse('Not Found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const shouldBlockAdmin = mainHosts.has(host) || strictIsolation || !LOOPBACK_HOSTS.has(host);
  if (shouldBlockAdmin) {
    const lowerPath = pathname.toLowerCase();
    if (matchesPrefix(lowerPath, '/api/admin')) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    if (matchesPrefix(lowerPath, '/admin')) {
      return new NextResponse('Not Found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
