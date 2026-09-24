import type { Env } from '../types';
import { SESSION_TTL_MS } from '../types';

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function sessionCookie(token: string, env: Env): string {
  const sameSite = env.COOKIE_SAME_SITE === 'Strict' || env.COOKIE_SAME_SITE === 'Lax' ? env.COOKIE_SAME_SITE : 'None';
  return `an_session=${encodeURIComponent(token)}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/; HttpOnly; Secure; SameSite=${sameSite}`;
}

export function clearSessionCookie(env: Env): string {
  const sameSite = env.COOKIE_SAME_SITE === 'Strict' || env.COOKIE_SAME_SITE === 'Lax' ? env.COOKIE_SAME_SITE : 'None';
  return `an_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=${sameSite}`;
}
