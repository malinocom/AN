interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  CHAT_ROOM: DurableObjectNamespace;
  SESSION_SECRET: string;
  INTERNAL_API_SECRET: string;
  ALLOWED_ORIGIN: string;
  COOKIE_SAME_SITE?: string;
}
