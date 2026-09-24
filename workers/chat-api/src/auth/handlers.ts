import type { Env, User } from '../types';
import { ROOM_ID, WS_TICKET_TTL_MS } from '../types';
import { clearSessionCookie, sessionCookie } from '../utils/cookies';
import { pbkdf2, randomToken, safeEqual, sha256, signPayload } from '../utils/crypto';
import { errorJson, isTrustedInternal, json, readJson } from '../utils/http';
import { createSession, deleteSession, getSession } from './session';

type LoginBody = { username?: string; password?: string };
type ChangePasswordBody = { currentPassword?: string; newPassword?: string };

type PasswordRow = {
  id?: string;
  username: 'Amir' | 'Nazi';
  password_hash: string;
  password_salt: string;
  password_iterations: number;
};

const LEGACY_INITIAL_PASSWORD = '1391';
const LEGACY_INITIAL_HASHES: Record<'Amir' | 'Nazi', string> = {
  Amir: 'TSmM28t9mI4kYm74ejVJQMvZM5sbOXVXy8wxb11aKQ0',
  Nazi: '3w9cLQV4ZfHMsWqNJbLshGDL0iV_U7WS2zI4WDnyBio',
};

async function fastPasswordHash(password: string, salt: string): Promise<string> {
  return sha256(`${salt}:${password}`);
}

async function verifyPassword(password: string, row: PasswordRow): Promise<{ valid: boolean; upgradedHash?: string }> {
  // iteration=0 is the lightweight password format used on Workers Free.
  if (row.password_iterations === 0) {
    const derived = await fastPasswordHash(password, row.password_salt);
    return { valid: safeEqual(derived, row.password_hash) };
  }

  // Older installs were seeded with PBKDF2/600k, which is too expensive for
  // Workers Free. Recognize only the untouched initial credential and migrate
  // it after the first successful login without running the expensive KDF.
  if (row.password_iterations > 100000) {
    const isUntouchedInitial =
      password === LEGACY_INITIAL_PASSWORD &&
      safeEqual(row.password_hash, LEGACY_INITIAL_HASHES[row.username]);
    if (!isUntouchedInitial) return { valid: false };
    return { valid: true, upgradedHash: await fastPasswordHash(password, row.password_salt) };
  }

  // Keep compatibility with databases already manually migrated to a smaller
  // PBKDF2 iteration count.
  const derived = await pbkdf2(password, row.password_salt, row.password_iterations);
  return { valid: safeEqual(derived, row.password_hash) };
}

async function audit(env: Env, userId: string | null, eventType: string, metadataCode?: string) {
  await env.DB.prepare('INSERT INTO audit_events (id,user_id,event_type,created_at,metadata_code) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), userId, eventType, Date.now(), metadataCode || null).run();
}

async function rateKey(request: Request, env: Env, username: string): Promise<string> {
  const ip = (isTrustedInternal(request, env) ? request.headers.get('x-client-ip') : null) || request.headers.get('cf-connecting-ip') || 'unknown';
  return sha256(`${ip}|${username.toLowerCase()}`);
}

async function checkLoginLimit(env: Env, key: string): Promise<number | null> {
  const now = Date.now();
  const row = await env.DB.prepare('SELECT failures, first_failure_at, blocked_until FROM login_attempts WHERE key_hash=?')
    .bind(key).first<{ failures: number; first_failure_at: number; blocked_until: number | null }>();
  if (!row) return null;
  if (row.blocked_until && row.blocked_until > now) return row.blocked_until;
  if (row.first_failure_at < now - 30 * 60 * 1000) {
    await env.DB.prepare('DELETE FROM login_attempts WHERE key_hash=?').bind(key).run();
  }
  return null;
}

async function recordLoginFailure(env: Env, key: string): Promise<void> {
  const now = Date.now();
  const existing = await env.DB.prepare('SELECT failures, first_failure_at FROM login_attempts WHERE key_hash=?')
    .bind(key).first<{ failures: number; first_failure_at: number }>();
  const freshWindow = !existing || existing.first_failure_at < now - 30 * 60 * 1000;
  const failures = freshWindow ? 1 : existing.failures + 1;
  const first = freshWindow ? now : existing.first_failure_at;
  const blockMinutes = failures >= 8 ? 60 : failures >= 5 ? 15 : 0;
  const blockedUntil = blockMinutes ? now + blockMinutes * 60 * 1000 : null;
  await env.DB.prepare(
    `INSERT INTO login_attempts (key_hash,failures,first_failure_at,blocked_until) VALUES (?,?,?,?)
     ON CONFLICT(key_hash) DO UPDATE SET failures=excluded.failures,first_failure_at=excluded.first_failure_at,blocked_until=excluded.blocked_until`,
  ).bind(key, failures, first, blockedUntil).run();
}

export async function login(request: Request, env: Env): Promise<Response> {
  const body = await readJson<LoginBody>(request);
  const username = body?.username?.trim();
  const password = body?.password;
  if (!username || !password || password.length > 256) return errorJson('اطلاعات ورود نامعتبر است.', 400, 'invalid_login');
  if (username !== 'Amir' && username !== 'Nazi') return errorJson('نام کاربری یا رمز عبور نادرست است.', 401, 'invalid_credentials');

  const key = await rateKey(request, env, username);
  const blockedUntil = await checkLoginLimit(env, key);
  if (blockedUntil) return json({ error: 'تلاش‌های ورود بیش از حد است. کمی بعد دوباره تلاش کنید.', code: 'rate_limited', retryAfter: blockedUntil }, 429);

  const row = await env.DB.prepare(
    'SELECT id,username,password_hash,password_salt,password_iterations FROM users WHERE username=? LIMIT 1',
  ).bind(username).first<PasswordRow & { id: string }>();
  if (!row) return errorJson('نام کاربری یا رمز عبور نادرست است.', 401, 'invalid_credentials');

  const verification = await verifyPassword(password, row);
  if (!verification.valid) {
    await recordLoginFailure(env, key);
    await audit(env, row.id, 'login_failed', 'bad_password');
    return errorJson('نام کاربری یا رمز عبور نادرست است.', 401, 'invalid_credentials');
  }

  if (verification.upgradedHash) {
    await env.DB.prepare('UPDATE users SET password_hash=?,password_iterations=0,updated_at=? WHERE id=?')
      .bind(verification.upgradedHash, Date.now(), row.id).run();
  }

  await env.DB.prepare('DELETE FROM login_attempts WHERE key_hash=?').bind(key).run();
  const user: User = { id: row.id, username: row.username };
  const session = await createSession(request, env, user);
  await audit(env, user.id, 'login_success');

  const payload: Record<string, unknown> = { user };
  // Only the trusted Vercel BFF may receive the opaque session token in a response body.
  if (isTrustedInternal(request, env)) payload.sessionToken = session.token;
  return json(payload, 200, { 'set-cookie': sessionCookie(session.token, env) });
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const auth = await getSession(request, env);
  if (auth) {
    await deleteSession(env, auth.sessionId);
    const room = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(ROOM_ID));
    await room.fetch('https://chat-room.internal/disconnect', { method: 'POST', headers: { 'x-session-id': auth.sessionId } });
    await audit(env, auth.user.id, 'logout');
  }
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(env) });
}

export async function sessionInfo(request: Request, env: Env): Promise<Response> {
  const auth = await getSession(request, env);
  if (!auth) return errorJson('نشست معتبر نیست.', 401, 'unauthorized');
  const other = await env.DB.prepare('SELECT username,last_seen_at FROM users WHERE id<>? LIMIT 1')
    .bind(auth.user.id).first<{ username: 'Amir' | 'Nazi'; last_seen_at: number | null }>();
  return json({ user: auth.user, peer: other || null });
}

export async function changePassword(request: Request, env: Env): Promise<Response> {
  const auth = await getSession(request, env);
  if (!auth) return errorJson('نشست معتبر نیست.', 401, 'unauthorized');
  const body = await readJson<ChangePasswordBody>(request);
  const current = body?.currentPassword;
  const next = body?.newPassword;
  if (!current || !next || next.length < 4 || next.length > 128) {
    return errorJson('رمز جدید باید بین ۴ تا ۱۲۸ نویسه باشد.', 400, 'invalid_password');
  }
  const row = await env.DB.prepare('SELECT username,password_hash,password_salt,password_iterations FROM users WHERE id=?')
    .bind(auth.user.id).first<PasswordRow>();
  if (!row) return errorJson('کاربر یافت نشد.', 404, 'not_found');
  const verification = await verifyPassword(current, row);
  if (!verification.valid) return errorJson('رمز فعلی نادرست است.', 403, 'wrong_password');

  const salt = randomToken(16);
  const iterations = 0;
  const hash = await fastPasswordHash(next, salt);
  const now = Date.now();
  const otherSessions = await env.DB.prepare('SELECT id FROM sessions WHERE user_id=? AND id<>? LIMIT 20')
    .bind(auth.user.id, auth.sessionId).all<{ id: string }>();
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash=?,password_salt=?,password_iterations=?,updated_at=? WHERE id=?')
      .bind(hash, salt, iterations, now, auth.user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND id<>?').bind(auth.user.id, auth.sessionId),
  ]);
  const room = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(ROOM_ID));
  for (const session of otherSessions.results || []) {
    await room.fetch('https://chat-room.internal/disconnect', { method: 'POST', headers: { 'x-session-id': session.id } });
  }
  await audit(env, auth.user.id, 'password_changed');
  return json({ ok: true });
}

export async function createWsTicket(request: Request, env: Env): Promise<Response> {
  const auth = await getSession(request, env);
  if (!auth) return errorJson('نشست معتبر نیست.', 401, 'unauthorized');
  const expiresAt = Date.now() + WS_TICKET_TTL_MS;
  const ticket = await signPayload({
    typ: 'ws', uid: auth.user.id, username: auth.user.username, sid: auth.sessionId,
    room: ROOM_ID, exp: expiresAt, nonce: randomToken(12),
  }, env.SESSION_SECRET);
  return json({ ticket, expiresAt });
}
