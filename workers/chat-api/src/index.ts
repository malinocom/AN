import type { Env } from './types';
import { ROOM_ID } from './types';
import { ChatRoom } from './durable';
import { changePassword, createWsTicket, login, logout, sessionInfo } from './auth/handlers';
import { getSession } from './auth/session';
import { createMessage, deleteMessage, editMessage, getMessageById, listMessages, markRead, searchMessages, toggleReaction } from './messages/handlers';
import { cleanupOrphanMedia, createMediaAccess, createUploadUrl, getMedia, uploadMedia } from './media/handlers';
import { errorJson, isAllowedOrigin, json, preflight, withCors } from './utils/http';
import { verifyPayload } from './utils/crypto';

type WsTicket = { typ: 'ws'; uid: string; username: 'Amir' | 'Nazi'; sid: string; room: string; exp: number; nonce: string };

function secureHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store, private');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function websocket(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('origin') !== env.ALLOWED_ORIGIN) return new Response('Forbidden origin', { status: 403 });
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
  const protocols = (request.headers.get('sec-websocket-protocol') || '').split(',').map((v) => v.trim());
  const ticketProtocol = protocols.find((v) => v.startsWith('ticket.'));
  const ticketString = ticketProtocol?.slice('ticket.'.length);
  if (!ticketString || !protocols.includes('an-chat')) return new Response('Missing ticket', { status: 401 });
  const ticket = await verifyPayload<WsTicket>(ticketString, env.SESSION_SECRET);
  if (!ticket || ticket.typ !== 'ws' || ticket.room !== ROOM_ID || ticket.exp < Date.now()) return new Response('Invalid ticket', { status: 401 });
  const validSession = await env.DB.prepare(
    'SELECT 1 AS ok FROM sessions WHERE id=? AND user_id=? AND expires_at>? LIMIT 1',
  ).bind(ticket.sid, ticket.uid, Date.now()).first();
  if (!validSession) return new Response('Expired session', { status: 401 });
  const id = env.CHAT_ROOM.idFromName(ROOM_ID);
  return env.CHAT_ROOM.get(id).fetch('https://chat-room.internal/connect', {
    headers: {
      Upgrade: 'websocket',
      'x-user-id': ticket.uid,
      'x-username': ticket.username,
      'x-session-id': ticket.sid,
      'sec-websocket-protocol': 'an-chat',
    },
  });
}

async function router(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') return preflight(request, env);
  if (path === '/health' && method === 'GET') return json({ ok: true });
  if (path === '/ws/chat' && method === 'GET') return websocket(request, env);

  // Upload URLs are capability URLs; still require the configured browser origin.
  const uploadMatch = path.match(/^\/media\/upload\/(.+)$/);
  if (uploadMatch && method === 'PUT') {
    if (!isAllowedOrigin(request, env)) return errorJson('Origin مجاز نیست.', 403, 'forbidden_origin');
    return uploadMedia(request, env, uploadMatch[1]);
  }

  // Media GET may use an authenticated session or a short-lived signed access ticket.
  const mediaGet = path.match(/^\/media\/([^/]+)$/);
  if (mediaGet && method === 'GET') return getMedia(request, env, mediaGet[1]);

  if (!['GET', 'HEAD'].includes(method) && !isAllowedOrigin(request, env)) {
    return errorJson('Origin مجاز نیست.', 403, 'forbidden_origin');
  }

  if (path === '/auth/login' && method === 'POST') return login(request, env);
  if (path === '/auth/logout' && method === 'POST') return logout(request, env);
  if (path === '/auth/session' && method === 'GET') return sessionInfo(request, env);
  if (path === '/auth/change-password' && method === 'POST') return changePassword(request, env);
  if (path === '/auth/ws-ticket' && method === 'POST') return createWsTicket(request, env);

  if (path === '/messages' && method === 'GET') return listMessages(request, env);
  if (path === '/messages' && method === 'POST') return createMessage(request, env);
  if (path === '/messages/search' && method === 'GET') return searchMessages(request, env);

  const messageMatch = path.match(/^\/messages\/([^/]+)$/);
  if (messageMatch && method === 'GET') return getMessageById(request, env, messageMatch[1]);
  if (messageMatch && method === 'PATCH') return editMessage(request, env, messageMatch[1]);
  if (messageMatch && method === 'DELETE') return deleteMessage(request, env, messageMatch[1]);
  const readMatch = path.match(/^\/messages\/([^/]+)\/read$/);
  if (readMatch && method === 'POST') return markRead(request, env, readMatch[1]);
  const reactionMatch = path.match(/^\/messages\/([^/]+)\/reaction$/);
  if (reactionMatch && method === 'POST') return toggleReaction(request, env, reactionMatch[1]);

  if (path === '/media/upload-url' && method === 'POST') return createUploadUrl(request, env);
  const mediaAccess = path.match(/^\/media\/([^/]+)\/access$/);
  if (mediaAccess && method === 'POST') return createMediaAccess(request, env, mediaAccess[1]);

  return errorJson('مسیر یافت نشد.', 404, 'not_found');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const response = await router(request, env);
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return response;
      return secureHeaders(withCors(request, env, response));
    } catch (error) {
      // Deliberately do not log request bodies, message text, passwords, cookies, or session tokens.
      const code = error instanceof Error ? error.name : 'unknown_error';
      console.error('request_failed', { code, path: new URL(request.url).pathname });
      return secureHeaders(withCors(request, env, errorJson('خطای داخلی سرور رخ داد.', 500, 'internal_error')));
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(cleanupOrphanMedia(env));
  },
} satisfies ExportedHandler<Env>;

export { ChatRoom };
