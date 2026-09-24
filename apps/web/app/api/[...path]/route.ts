import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COOKIE = process.env.SESSION_COOKIE_NAME || 'an_session';

function workerBase(): string {
  const value = process.env.CHAT_WORKER_URL;
  if (!value) throw new Error('CHAT_WORKER_URL is not configured');
  return value.replace(/\/$/, '');
}

function internalSecret(): string {
  const value = process.env.CHAT_WORKER_INTERNAL_SECRET;
  if (!value) throw new Error('CHAT_WORKER_INTERNAL_SECRET is not configured');
  return value;
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const method = request.method.toUpperCase();
  if (!['GET', 'HEAD'].includes(method) && !sameOrigin(request)) {
    return NextResponse.json({ error: 'Origin نامعتبر است.', code: 'forbidden_origin' }, { status: 403 });
  }

  const { path } = await context.params;
  const pathname = `/${path.map(encodeURIComponent).join('/')}`;
  const incomingUrl = new URL(request.url);
  const target = new URL(`${workerBase()}${pathname}`);
  target.search = incomingUrl.search;

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(COOKIE)?.value;
  const headers = new Headers();
  headers.set('x-internal-secret', internalSecret());
  if (sessionToken) headers.set('x-session-token', sessionToken);
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const range = request.headers.get('range');
  if (range) headers.set('range', range);
  const userAgent = request.headers.get('user-agent');
  if (userAgent) headers.set('user-agent', userAgent);
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwardedFor) headers.set('x-client-ip', forwardedFor);

  const body = ['GET', 'HEAD'].includes(method) ? undefined : await request.arrayBuffer();
  const upstream = await fetch(target, { method, headers, body, cache: 'no-store', redirect: 'manual' });

  if (pathname === '/auth/login') {
    const data = await upstream.json() as { sessionToken?: string; [key: string]: unknown };
    const response = NextResponse.json(
      Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'sessionToken')),
      { status: upstream.status },
    );
    if (upstream.ok && typeof data.sessionToken === 'string') {
      response.cookies.set(COOKIE, data.sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 30 * 24 * 60 * 60,
      });
    }
    response.headers.set('cache-control', 'no-store, private');
    return response;
  }

  if (pathname === '/auth/logout') {
    const response = NextResponse.json({ ok: true }, { status: upstream.ok ? 200 : upstream.status });
    response.cookies.set(COOKIE, '', { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 0 });
    return response;
  }

  const responseHeaders = new Headers();
  for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag']) {
    const value = upstream.headers.get(key);
    if (value) responseHeaders.set(key, value);
  }
  responseHeaders.set('cache-control', 'no-store, private');
  responseHeaders.set('x-content-type-options', 'nosniff');
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
