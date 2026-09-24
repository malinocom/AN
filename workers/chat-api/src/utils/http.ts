import type { Env } from '../types';
import { safeEqual } from './crypto';

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store, private');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(data), { status, headers });
}

export function errorJson(message: string, status = 400, code = 'bad_request'): Response {
  return json({ error: message, code }, status);
}

export function isTrustedInternal(request: Request, env: Env): boolean {
  const supplied = request.headers.get('x-internal-secret');
  return Boolean(supplied && safeEqual(supplied, env.INTERNAL_API_SECRET));
}

export function isAllowedOrigin(request: Request, env: Env): boolean {
  if (isTrustedInternal(request, env)) return true;
  const origin = request.headers.get('origin');
  return origin === env.ALLOWED_ORIGIN;
}

export function withCors(request: Request, env: Env, response: Response): Response {
  const origin = request.headers.get('origin');
  if (!origin || origin !== env.ALLOWED_ORIGIN) return response;
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-credentials', 'true');
  headers.set('vary', 'Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function preflight(request: Request, env: Env): Response {
  const origin = request.headers.get('origin');
  if (origin !== env.ALLOWED_ORIGIN) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,PUT,OPTIONS',
      'access-control-allow-headers': 'content-type,x-session-token,x-internal-secret,range',
      'access-control-max-age': '86400',
      vary: 'Origin',
    },
  });
}

export async function readJson<T>(request: Request): Promise<T | null> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return null;
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
