import type { Env, SessionAuth, User } from '../types';
import { SESSION_TTL_MS } from '../types';
import { getCookie } from '../utils/cookies';
import { randomToken, sha256 } from '../utils/crypto';
import { isTrustedInternal } from '../utils/http';

export async function createSession(request: Request, env: Env, user: User): Promise<{ token: string; id: string }> {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const id = crypto.randomUUID();
  const now = Date.now();
  const ip = (isTrustedInternal(request, env) ? request.headers.get('x-client-ip') : null) || request.headers.get('cf-connecting-ip') || '';
  const ua = request.headers.get('user-agent') || '';
  const [ipHash, uaHash] = await Promise.all([ip ? sha256(ip) : null, ua ? sha256(ua) : null]);
  await env.DB.prepare(
    `INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at,last_used_at,ip_hash,user_agent_hash)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(id, user.id, tokenHash, now + SESSION_TTL_MS, now, now, ipHash, uaHash).run();
  return { token, id };
}

export async function getSession(request: Request, env: Env): Promise<SessionAuth | null> {
  let token: string | null = null;
  if (isTrustedInternal(request, env)) token = request.headers.get('x-session-token');
  if (!token) token = getCookie(request, 'an_session');
  if (!token || token.length > 256) return null;

  const tokenHash = await sha256(token);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.username
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=? AND s.expires_at>? LIMIT 1`,
  ).bind(tokenHash, now).first<{ session_id: string; expires_at: number; user_id: string; username: 'Amir' | 'Nazi' }>();
  if (!row) return null;

  // Keep writes bounded: touch at most once per five minutes.
  env.DB.prepare('UPDATE sessions SET last_used_at=? WHERE id=? AND last_used_at<?')
    .bind(now, row.session_id, now - 5 * 60 * 1000).run().catch(() => undefined);
  env.DB.prepare('UPDATE users SET last_seen_at=? WHERE id=? AND (last_seen_at IS NULL OR last_seen_at<?)')
    .bind(now, row.user_id, now - 60 * 1000).run().catch(() => undefined);

  return { user: { id: row.user_id, username: row.username }, sessionId: row.session_id, token };
}

export async function deleteSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(sessionId).run();
}
