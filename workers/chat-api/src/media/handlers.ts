import type { Env } from '../types';
import { MEDIA_TICKET_TTL_MS, ROOM_ID, UPLOAD_TICKET_TTL_MS } from '../types';
import { getSession } from '../auth/session';
import { errorJson, json, readJson } from '../utils/http';
import { randomToken, signPayload, verifyPayload } from '../utils/crypto';

type UploadRequest = { mimeType?: string; size?: number; kind?: 'image' | 'video'; hasThumbnail?: boolean };
type UploadTicket = { typ: 'upload'; uid: string; mediaId: string; part: 'original' | 'thumb'; exp: number; nonce: string };
type MediaTicket = { typ: 'media'; uid: string; sid: string; mediaId: string; part: 'original' | 'thumb'; exp: number; nonce: string };

const IMAGE_MAX = 10 * 1024 * 1024;
const VIDEO_MAX = 50 * 1024 * 1024;
const THUMB_MAX = 1024 * 1024;

function detectMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 12) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.slice(0, 8).every((v, i) => v === [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a][i])) return 'image/png';
    const ascii = new TextDecoder('ascii').decode(bytes.slice(0, 16));
    if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif';
    if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
    if (ascii.slice(4, 8) === 'ftyp') {
      const brand = ascii.slice(8, 12);
      if (['heic','heix','hevc','hevx','mif1','msf1'].includes(brand)) return 'image/heic';
      if (brand === 'qt  ') return 'video/quicktime';
      return 'video/mp4';
    }
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
  }
  return null;
}

async function peekStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < 64) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); total += value.byteLength; }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(total, 64));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, out.byteLength - offset);
    out.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= out.byteLength) break;
  }
  return out;
}

export async function createUploadUrl(request: Request, env: Env): Promise<Response> {
  const auth = await getSession(request, env);
  if (!auth) return errorJson('نشست معتبر نیست.', 401, 'unauthorized');
  const body = await readJson<UploadRequest>(request);
  const size = Number(body?.size || 0);
  const kind = body?.kind;
  const mime = body?.mimeType?.toLowerCase().slice(0, 100) || 'application/octet-stream';
  if (!kind || !Number.isFinite(size) || size <= 0) return errorJson('مشخصات فایل نامعتبر است.', 400, 'invalid_media');
  const max = kind === 'image' ? IMAGE_MAX : VIDEO_MAX;
  if (size > max) return errorJson(kind === 'image' ? 'حداکثر حجم عکس ۱۰ مگابایت است.' : 'حداکثر حجم ویدیو ۵۰ مگابایت است.', 413, 'media_too_large');

  const mediaId = crypto.randomUUID();
  const r2Key = `private/${ROOM_ID}/${mediaId}/original`;
  const thumbKey = body?.hasThumbnail ? `private/${ROOM_ID}/${mediaId}/thumb` : null;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO media_files (id,owner_id,room_id,r2_key,thumb_r2_key,declared_mime_type,size,media_kind,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(mediaId, auth.user.id, ROOM_ID, r2Key, thumbKey, mime, size, kind, now).run();

  const origin = new URL(request.url).origin;
  const exp = now + UPLOAD_TICKET_TTL_MS;
  const originalTicket = await signPayload<UploadTicket>({ typ: 'upload', uid: auth.user.id, mediaId, part: 'original', exp, nonce: randomToken(10) }, env.SESSION_SECRET);
  const response: Record<string, unknown> = {
    mediaId,
    uploadUrl: `${origin}/media/upload/${encodeURIComponent(originalTicket)}`,
    expiresAt: exp,
  };
  if (thumbKey) {
    const thumbTicket = await signPayload<UploadTicket>({ typ: 'upload', uid: auth.user.id, mediaId, part: 'thumb', exp, nonce: randomToken(10) }, env.SESSION_SECRET);
    response.thumbnailUploadUrl = `${origin}/media/upload/${encodeURIComponent(thumbTicket)}`;
  }
  return json(response, 201);
}

export async function uploadMedia(request: Request, env: Env, ticketString: string): Promise<Response> {
  const ticket = await verifyPayload<UploadTicket>(decodeURIComponent(ticketString), env.SESSION_SECRET);
  if (!ticket || ticket.typ !== 'upload' || ticket.exp < Date.now()) return errorJson('مجوز آپلود منقضی یا نامعتبر است.', 401, 'invalid_upload_ticket');
  if (!request.body) return errorJson('فایل ارسال نشده است.', 400, 'empty_upload');

  const media = await env.DB.prepare(
    'SELECT id,owner_id,r2_key,thumb_r2_key,size,media_kind,original_uploaded,thumbnail_uploaded FROM media_files WHERE id=? AND owner_id=? LIMIT 1',
  ).bind(ticket.mediaId, ticket.uid).first<{
    id: string; owner_id: string; r2_key: string; thumb_r2_key: string | null; size: number; media_kind: 'image' | 'video'; original_uploaded: number; thumbnail_uploaded: number;
  }>();
  if (!media) return errorJson('رسانه یافت نشد.', 404, 'not_found');
  if (ticket.part === 'original' && media.original_uploaded) return errorJson('فایل قبلاً آپلود شده است.', 409, 'already_uploaded');
  if (ticket.part === 'thumb' && media.thumbnail_uploaded) return errorJson('بندانگشتی قبلاً آپلود شده است.', 409, 'already_uploaded');

  const contentLength = Number(request.headers.get('content-length') || '0');
  const expectedMax = ticket.part === 'thumb' ? THUMB_MAX : media.size;
  if (!contentLength || contentLength > expectedMax || (ticket.part === 'original' && contentLength !== media.size)) {
    return errorJson('اندازه فایل با مجوز آپلود سازگار نیست.', 413, 'size_mismatch');
  }

  const [inspectStream, uploadStream] = request.body.tee();
  const head = await peekStream(inspectStream);
  const detected = detectMime(head);
  if (!detected) return errorJson('نوع واقعی فایل پشتیبانی نمی‌شود.', 415, 'unsupported_media');
  if (ticket.part === 'thumb' && !detected.startsWith('image/')) return errorJson('بندانگشتی باید تصویر معتبر باشد.', 415, 'invalid_thumbnail');
  if (ticket.part === 'original' && !detected.startsWith(`${media.media_kind}/`)) return errorJson('نوع واقعی فایل با نوع انتخاب‌شده سازگار نیست.', 415, 'mime_mismatch');

  const key = ticket.part === 'thumb' ? media.thumb_r2_key : media.r2_key;
  if (!key) return errorJson('بندانگشتی برای این فایل فعال نشده است.', 400, 'thumbnail_not_expected');
  await env.MEDIA_BUCKET.put(key, uploadStream, {
    httpMetadata: { contentType: detected, cacheControl: 'private, no-store' },
    customMetadata: { mediaId: media.id, ownerId: media.owner_id, part: ticket.part },
  });
  const now = Date.now();
  if (ticket.part === 'original') {
    await env.DB.prepare('UPDATE media_files SET original_uploaded=1,detected_mime_type=?,uploaded_at=? WHERE id=?')
      .bind(detected, now, media.id).run();
  } else {
    await env.DB.prepare('UPDATE media_files SET thumbnail_uploaded=1 WHERE id=?').bind(media.id).run();
  }
  return json({ ok: true, detectedMimeType: detected });
}

export async function createMediaAccess(request: Request, env: Env, mediaId: string): Promise<Response> {
  const auth = await getSession(request, env);
  if (!auth) return errorJson('نشست معتبر نیست.', 401, 'unauthorized');
  const url = new URL(request.url);
  const part = url.searchParams.get('part') === 'thumb' ? 'thumb' : 'original';
  const media = await env.DB.prepare(
    `SELECT mf.id,mf.thumbnail_uploaded FROM media_files mf
     JOIN messages m ON m.media_id=mf.id
     WHERE mf.id=? AND mf.room_id=? AND m.room_id=? AND m.deleted_at IS NULL LIMIT 1`,
  ).bind(mediaId, ROOM_ID, ROOM_ID).first<{ id: string; thumbnail_uploaded: number }>();
  if (!media) return errorJson('رسانه یافت نشد.', 404, 'not_found');
  if (part === 'thumb' && !media.thumbnail_uploaded) return errorJson('بندانگشتی موجود نیست.', 404, 'not_found');
  const exp = Date.now() + MEDIA_TICKET_TTL_MS;
  const ticket = await signPayload<MediaTicket>({ typ: 'media', uid: auth.user.id, sid: auth.sessionId, mediaId, part, exp, nonce: randomToken(10) }, env.SESSION_SECRET);
  const origin = new URL(request.url).origin;
  return json({ url: `${origin}/media/${encodeURIComponent(mediaId)}?part=${part}&ticket=${encodeURIComponent(ticket)}`, expiresAt: exp });
}

export async function getMedia(request: Request, env: Env, mediaId: string): Promise<Response> {
  const url = new URL(request.url);
  const part = url.searchParams.get('part') === 'thumb' ? 'thumb' : 'original';
  let authorized = false;
  const auth = await getSession(request, env);
  if (auth) authorized = true;
  if (!authorized) {
    const raw = url.searchParams.get('ticket');
    const ticket = raw ? await verifyPayload<MediaTicket>(raw, env.SESSION_SECRET) : null;
    if (ticket && ticket.typ === 'media' && ticket.exp >= Date.now() && ticket.mediaId === mediaId && ticket.part === part) {
      const session = await env.DB.prepare('SELECT 1 AS ok FROM sessions WHERE id=? AND user_id=? AND expires_at>? LIMIT 1')
        .bind(ticket.sid, ticket.uid, Date.now()).first();
      authorized = Boolean(session);
    }
  }
  if (!authorized) return errorJson('دسترسی مجاز نیست.', 401, 'unauthorized');

  const media = await env.DB.prepare(
    `SELECT mf.r2_key,mf.thumb_r2_key,mf.detected_mime_type,mf.thumbnail_uploaded
     FROM media_files mf JOIN messages m ON m.media_id=mf.id
     WHERE mf.id=? AND mf.room_id=? AND m.room_id=? AND m.deleted_at IS NULL LIMIT 1`,
  ).bind(mediaId, ROOM_ID, ROOM_ID).first<{ r2_key: string; thumb_r2_key: string | null; detected_mime_type: string | null; thumbnail_uploaded: number }>();
  if (!media) return errorJson('رسانه یافت نشد.', 404, 'not_found');
  const key = part === 'thumb' ? media.thumb_r2_key : media.r2_key;
  if (!key || (part === 'thumb' && !media.thumbnail_uploaded)) return errorJson('رسانه یافت نشد.', 404, 'not_found');

  const range = request.headers.get('range');
  const object = await env.MEDIA_BUCKET.get(key, range ? { range: request.headers } : undefined);
  if (!object || !('body' in object)) return errorJson('فایل یافت نشد.', 404, 'not_found');
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'private, no-store');
  headers.set('content-security-policy', "default-src 'none'; sandbox");
  headers.set('x-content-type-options', 'nosniff');
  let status = 200;
  if (range && object.range) {
    status = 206;
    const offset = 'offset' in object.range ? object.range.offset : 0;
    const length = 'length' in object.range ? object.range.length : object.size;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('content-length', String(length));
  } else {
    headers.set('content-length', String(object.size));
  }
  return new Response(object.body, { status, headers });
}

export async function cleanupOrphanMedia(env: Env): Promise<void> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const rows = await env.DB.prepare(
    `SELECT id,r2_key,thumb_r2_key FROM media_files
     WHERE created_at<? AND (linked_message_id IS NULL OR original_uploaded=0) LIMIT 100`,
  ).bind(cutoff).all<{ id: string; r2_key: string; thumb_r2_key: string | null }>();
  for (const row of rows.results || []) {
    await Promise.all([env.MEDIA_BUCKET.delete(row.r2_key), row.thumb_r2_key ? env.MEDIA_BUCKET.delete(row.thumb_r2_key) : Promise.resolve()]);
    await env.DB.prepare('DELETE FROM media_files WHERE id=?').bind(row.id).run();
  }
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()).run();
}
