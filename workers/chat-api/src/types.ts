export interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  CHAT_ROOM: DurableObjectNamespace;
  SESSION_SECRET: string;
  INTERNAL_API_SECRET: string;
  ALLOWED_ORIGIN: string;
  COOKIE_SAME_SITE?: string;
}

export type User = {
  id: string;
  username: 'Amir' | 'Nazi';
};

export type SessionAuth = {
  user: User;
  sessionId: string;
  token: string;
};

export const ROOM_ID = 'private-main';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const WS_TICKET_TTL_MS = 60 * 1000;
export const UPLOAD_TICKET_TTL_MS = 10 * 60 * 1000;
export const MEDIA_TICKET_TTL_MS = 5 * 60 * 1000;
