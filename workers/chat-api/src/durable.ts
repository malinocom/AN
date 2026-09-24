import { DurableObject } from 'cloudflare:workers';
import type { Env } from './types';

type Attachment = { userId: string; username: 'Amir' | 'Nazi'; sessionId: string; connectedAt: number };

export class ChatRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/connect') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      const userId = request.headers.get('x-user-id');
      const username = request.headers.get('x-username');
      const sessionId = request.headers.get('x-session-id');
      if (!userId || !sessionId || (username !== 'Amir' && username !== 'Nazi')) return new Response('Unauthorized', { status: 401 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [`user:${userId}`, `session:${sessionId}`]);
      server.serializeAttachment({ userId, username, sessionId, connectedAt: Date.now() } satisfies Attachment);
      for (const peer of this.ctx.getWebSockets()) {
        if (peer === server || peer.readyState !== WebSocket.OPEN) continue;
        const peerState = peer.deserializeAttachment() as Attachment | null;
        if (peerState && peerState.userId !== userId) {
          server.send(JSON.stringify({ type: 'presence.update', userId: peerState.userId, username: peerState.username, online: true }));
          break;
        }
      }
      this.broadcast({ type: 'presence.update', userId, username, online: true }, server);
      server.send(JSON.stringify({ type: 'connection.ready', userId, serverTime: Date.now() }));
      return new Response(null, { status: 101, webSocket: client, headers: { 'sec-websocket-protocol': 'an-chat' } });
    }

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const event = await request.json();
      this.broadcast(event);
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/disconnect' && request.method === 'POST') {
      const sessionId = request.headers.get('x-session-id');
      if (sessionId) {
        for (const ws of this.ctx.getWebSockets(`session:${sessionId}`)) ws.close(1000, 'Session ended');
      }
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/presence') {
      const userId = url.searchParams.get('userId');
      const online = userId ? this.ctx.getWebSockets(`user:${userId}`).some((ws) => ws.readyState === WebSocket.OPEN) : false;
      return Response.json({ online });
    }
    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > 1024) return;
    let event: { type?: string };
    try { event = JSON.parse(raw) as { type?: string }; } catch { return; }
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;
    if (event.type === 'typing.start' || event.type === 'typing.stop') {
      this.broadcast({ type: event.type, userId: attachment.userId, username: attachment.username, at: Date.now() }, ws);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;
    const stillOnline = this.ctx.getWebSockets(`user:${attachment.userId}`).some((candidate) => candidate !== ws && candidate.readyState === WebSocket.OPEN);
    if (!stillOnline) this.broadcast({ type: 'presence.update', userId: attachment.userId, username: attachment.username, online: false, lastSeenAt: Date.now() }, ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try { ws.close(1011, 'Connection error'); } catch { /* noop */ }
  }

  private broadcast(event: unknown, except?: WebSocket) {
    const payload = JSON.stringify(event);
    for (const client of this.ctx.getWebSockets()) {
      if (client === except || client.readyState !== WebSocket.OPEN) continue;
      try { client.send(payload); } catch { /* stale socket */ }
    }
  }
}
