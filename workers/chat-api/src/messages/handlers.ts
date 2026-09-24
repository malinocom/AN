import type { Env, SessionAuth } from '../types';
import { ROOM_ID } from '../types';
import { base64UrlToBytes, bytesToBase64Url } from '../utils/crypto';
import { errorJson, json, readJson } from '../utils/http';
import { getSession } from '../auth/session';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Cursor = { t: number; id: string };
type MessageRow = {
  id: string; sender_id: string; sender_name: 'Amir' | 'Nazi'; room_id: string; text: string | null;
  message_type: 'text' | 'image' | 'video'; media_id: string | null; reply_to_id: string | null;
  client_message_id: string; status: 'sent' | 'deleted'; created_at: number; updated_at: number | null; deleted_at: number | null;
  reply_text: string | null; reply_type: string | null; reply_sender_name: string | null;
  media_kind: string | null; media_mime: string | null; media_size: number | null; has_thumb: number | null;
  read_by_peer: number; heart_by_me: number; heart_by_peer: number;
};

function encodeCursor(cursor: Cursor): string {
  return bytesToBase64Url(encoder.encode(JSON.stringify(cursor)));
}

function decodeCursor(value: string | null): Cursor | null {
  if (!value || value.length > 256) return null;
  try {
    const parsed = JSON.parse(decoder.decode(base64UrlToBytes(value))) as Cursor;
    if (!Number.isFinite(parsed.t) || typeof parsed.id !== 'string' || parsed.id.length > 64) return null;
    return parsed;
  } catch { return null; }
}

function messageSelect(auth: SessionAuth): string {
  return `SELECT m.id,m.sender_id,u.username AS sender_name,m.room_id,m.text,m.message_type,m.media_id,m.reply_to_id,
    m.client_message_id,m.status,m.created_at,m.updated_at,m.deleted_at,
    rm.text AS reply_text,rm.message_type AS reply_type,ru.username AS reply_sender_name,
    mf.media_kind,mf.detected_mime_type AS media_mime,mf.size AS media_size,mf.thumbnail_uploaded AS has_thumb,
    EXISTS(SELECT 1 FROM message_reads mr WHERE mr.message_id=m.id AND mr.user_id<>m.sender_id) AS read_by_peer,
    EXISTS(SELECT 1 FROM message_reactions r1 WHERE r1.message_id=m.id AND r1.user_id='${auth.user.id.replaceAll("'", "''")}') AS heart_by_me,
    EXISTS(SELECT 1 FROM message_reactions r2 WHERE r2.message_id=m.id AND r2.user_id<>'${auth.user.id.replaceAll("'", "''")}') AS heart_by_peer
    FROM messages m
    JOIN users u ON u.id=m.sender_id
    LEFT JOIN messages rm ON rm.id=m.reply_to_id
    LEFT JOIN users ru ON ru.id=rm.sender_id
    LEFT JOIN media_files mf ON mf.id=m.media_id`;
}

function serialize(row: MessageRow) {
  return {
    id: row.id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    text: row.deleted_at ? null : row.text,
    messageType: row.message_type,
    mediaId: row.deleted_at ? null : row.media_id,
    media: row.deleted_at || !row.media_id ? null : {
      id: row.media_id, kind: row.media_kind, mimeType: row.media_mime, size: row.media_size, hasThumbnail: Boolean(row.has_thumb),
    },
    replyTo: row.reply_to_id ? {
      id: row.reply_to_id, text: row.reply_text, messageType: row.reply_type, senderName: row.reply_sender_name,
    } : null,
    clientMessageId: row.client_message_id,
    status: row.deleted_at ? 'deleted' : row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    readByPeer: Boolean(row.read_by_peer),
    heartByMe: Boolean(row.heart_by_me),
    heartByPeer: Boolean(row.heart_by_peer),
  };
}

async function getMessage(env: Env, auth: SessionAuth, id: string) {
  const row = await env.DB.prepare(`${messageSelect(auth)} WHERE m.id=? AND m.room_id=? LIMIT 1`)
    .bind(id, ROOM_ID).first<MessageRow>();
  return row ? serialize(row) : null;
}

async function broadcast(env: Env, event: unknown): Promise<void> {
  const id = env.CHAT_ROOM.idFromName(ROOM_ID);
  const stub = env.CHAT_ROOM.get(id);
  await stub.fetch('https://chat-room.internal/broadcast', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event),
  });
}

export async function listMessages(request: Request, env: Env): Promise<Response> {
  const auth = await getSession(request, env);
  if (!auth) return errorJson('نشست معتبر نیست.', 401, 'unauthorized');
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get('limit') || '100');
  const limit = Math.min(100, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 100));
  const before = decodeCursor(url.searchParams.get('before'));
  const after = decodeCursor(url.searchParams.get('after'));
  if (url.searchParams.has('before') && !before) return errorJson('Cursor نامعتبر است.', 400, 'invalid_cursor');
  if (url.searchParams.has('after') && !after) return errorJson('Cursor نامعتبر است.', 400, 'invalid_cursor');
  if (before && after) return errorJson('before و after هم‌زمان مجاز نیستند.', 400, 'invalid_cursor');

  let sql = messageSelect(auth);
  const binds: unknown[] = [ROOM_ID];
  if (before) {
    sql += ' WHERE m.room_id=? AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?)) ORDER BY m.created_at DESC,m.id DESC LIMIT ?';
    binds.push(before.t, before.t, before.id, limit + 1);
  } else if (after) {
    sql += ' WHERE m.room_id=? AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?)) ORDER BY m.created_at ASC,m.id ASC LIMIT ?';
    binds.push(after.t, after.t, after.id, limit + 1);
  } else {
    sql += ' WHERE m.room_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT ?';
    binds.push(limit + 1);
  }

  const result = await env.DB.prepare(sql).bind(...binds).all<MessageRow>();
  let rows = result.results || [];
  const hasMore = rows.length > limit;
  if (hasMore) rows = rows.slice(0, limit);
  if (!after) rows.reverse();
  const messages = rows.map(serialize);
  const first = rows[0];
  const last = rows[rows.length - 1];
  return json({
    messages,
    hasMoreBefore: !after ? hasMore : false,
    hasMoreAfter: after ? hasMore : false,
    oldestCursor: first ? encodeCursor({ t: first.created_at, id: first.id }) : null,
    newestCursor: last ? encodeCursor({ t: last.created_at, id: last.id }) : null,
  });
}

type CreateBody = { text?: string | null; clientMessageId?: string; replyToId?: string | null; mediaId?: string | null; messageType?: string };

export async function createMessage(request: Request, env: Env): Promise<Response> {
  const auth = await getSession(request, env);
  if (!auth) return errorJson('نشست معتبر نیست.', 401, 'unauthorized');
  const body = await readJson<CreateBody>(request);
  const clientId = body?.clientMessageId?.trim();
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const mediaId = body?.mediaId || null;
  const type = body?.messageType || (mediaId ? 'image' : 'text');
  if (!clientId || clientId.length > 100) return errorJson('شناسه پیام نامعتبر است.', 400, 'invalid_client_id');
  if (!['text', 'image', 'video'].includes(type)) return errorJson('نوع پیام نامعتبر است.', 400, 'invalid_type');
  if (text.length > 5000) return errorJson('متن پیام بیش از حد طولانی است.', 413, 'text_too_long');
  if (type === 'text' && !text) return errorJson('پیام خالی است.', 400, 'empty_message');

  const duplicate = await env.DB.prepare('SELECT id FROM messages WHERE sender_id=? AND client_message_id=? LIMIT 1')
    .bind(auth.user.id, clientId).first<{ id: string }>();
  if (duplicate) return json({ message: await getMessage(env, auth, duplicate.id), duplicate: true });

  if (body?.replyToId) {
    const reply = await env.DB.prepare('SELECT id FROM messages WHERE id=? AND room_id=? LIMIT 1').bind(body.replyToId, ROOM_ID).first();
    if (!reply) return errorJson('پیام مرجع یافت نشد.', 404, 'reply_not_found');
  }

  if (type !== 'text') {
    if (!mediaId) return errorJson('رسانه الزامی است.', 400, 'media_required');
    const media = await env.DB.prepare(
      'SELECT id,media_kind,original_uploaded,linked_message_id FROM media_files WHERE id=? AND owner_id=? AND room_id=? LIMIT 1',
    ).bind(mediaId, auth.user.id, ROOM_ID).first<{ id: string; media_kind: string; original_uploaded: number; linked_message_id: string | null }>();
    if (!media || !media.original_uploaded || media.linked_message_id) return errorJson('رسانه آماده یا قابل استفاده نیست.', 409, 'media_not_ready');
    if (media.media_kind !== type) return errorJson('نوع رسانه با پیام سازگار نیست.', 400, 'media_type_mismatch');
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO messages (id,sender_id,room_id,text,message_type,media_id,reply_to_id,client_message_id,status,created_at)
         VALUES (?,?,?,?,?,?,?,?, 'sent', ?)`,
      ).bind(id, auth.user.id, ROOM_ID, text || null, type, mediaId, body?.replyToId || null, clientId, now),
      ...(mediaId ? [env.DB.prepare('UPDATE media_files SET linked_message_id=? WHERE id=? AND owner_id=? AND linked_message_id IS NULL')
        .bind(id, mediaId, auth.user.id)] : []),
    ]);
  } catch {
    const existing = await env.DB.prepare('SELECT id FROM messages WHERE sender_id=? AND client_message_id=? LIMIT 1')
      .bind(auth.user.id, clientId).first<{ id: string }>();
    if (existing) return json({ message: await getMessage(env, auth, existing.id), duplicate: true });
    return errorJson('ثبت پیام انجام نشد.', 409, 'message_conflict');
  }

  const message = await getMessage(env, auth, id);
  await broadcast(env, { type: 'message.created', messageId: id });
  return json({ message, duplicate: false }, 201);
}

type EditBody = { text?: string };
export async function editMessage(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await getSession(request, env);
  if (!auth) return errorJson('نشست معتبر نیست.', 401, 'unauthorized');
  const body = await readJson<EditBody>(request);
  const text = body?.text?.trim();
  if (!text || text.length > 5000) return errorJson('متن ویرایش‌شده نامعتبر است.', 400, 'invalid_text');
  const result = await env.DB.prepare(
    'UPDATE messages SET text=?,updated_at=? WHERE id=? AND sender_id=? AND room_id=? AND deleted_at IS NULL',
  ).bind(text, Date.now(), id, auth.user.id, ROOM_ID).run();
  if (!result.meta.changes) return errorJson('پیام قابل ویرایش نیست.', 404, 'not_found');
  const message = await getMessage(env, auth, id);
  await broadcast(env, { type: 'message.updated', messageId: id });
  return json({ message });
}

export async function deleteMessage(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await getSession(request, env);
  if (!auth) return errorJson('نشست معتبر نیست.', 401, 'unauthorized');
  const media = await env.DB.prepare('SELECT media_id FROM messages WHERE id=? AND sender_id=? AND room_id=? AND deleted_at IS NULL')
    .bind(id, auth.user.id, ROOM_ID).first<{ media_id: string | null }>();
  if (!media) return errorJson('پیام قابل حذف نیست.', 404, 'not_found');
  const now = Date.now();
  await env.DB.prepare("UPDATE messages SET text=NULL,status='deleted',deleted_at=?,updated_at=? WHERE id=? AND sender_id=?")
    .bind(now, now, id, auth.user.id).run();
  if (media.media_id) {
    const file = await env.DB.prepare('SELECT r2_key,thumb_r2_key FROM media_files WHERE id=?').bind(media.media_id)
      .first<{ r2_key: string; thumb_r2_key: string | null }>();
    if (file) {
      await Promise.all([env.MEDIA_BUCKET.delete(file.r2_key), file.thumb_r2_key ? env.MEDIA_BUCKET.delete(file.thumb_r2_key) : Promise.resolve()]);
      await env.DB.prepare('DELETE FROM media_files WHERE id=?').bind(media.media_id).run();
    }
  }
  const message = await getMessage(env, auth, id);
  await broadcast(env, { type: 'message.deleted', messageId: id });
  return json({ message });
}

export async function markRead(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await getSession(request, env);
  if (!auth) return errorJson('نشست معتبر نیست.', 401, 'unauthorized');
  const message = await env.DB.prepare('SELECT sender_id FROM messages WHERE id=? AND room_id=? LIMIT 1').bind(id, ROOM_ID)
    .first<{ sender_id: string }>();
  if (!message) return errorJson('پیام یافت نشد.', 404, 'not_found');
  if (message.sender_id === auth.user.id) return json({ ok: true });
  const readAt = Date.now();
  await env.DB.prepare('INSERT OR IGNORE INTO message_reads (message_id,user_id,read_at) VALUES (?,?,?)')
    .bind(id, auth.user.id, readAt).run();
  await broadcast(env, { type: 'message.read', messageId: id, userId: auth.user.id, readAt });
  return json({ ok: true, readAt });
}

export async function toggleReaction(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await getSession(request, env);
  if (!auth) return errorJson('نشست معتبر نیست.', 401, 'unauthorized');
  const exists = await env.DB.prepare('SELECT 1 AS ok FROM messages WHERE id=? AND room_id=? AND deleted_at IS NULL').bind(id, ROOM_ID).first();
  if (!exists) return errorJson('پیام یافت نشد.', 404, 'not_found');
  const current = await env.DB.prepare('SELECT 1 AS ok FROM message_reactions WHERE message_id=? AND user_id=?')
    .bind(id, auth.user.id).first();
  if (current) await env.DB.prepare('DELETE FROM message_reactions WHERE message_id=? AND user_id=?').bind(id, auth.user.id).run();
  else await env.DB.prepare("INSERT INTO message_reactions (message_id,user_id,reaction,created_at) VALUES (?,?,'heart',?)")
    .bind(id, auth.user.id, Date.now()).run();
  const message = await getMessage(env, auth, id);
  await broadcast(env, { type: 'message.reaction', messageId: id });
  return json({ message });
}

export async function getMessageById(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await getSession(request, env);
  if (!auth) return errorJson('نشست معتبر نیست.', 401, 'unauthorized');
  const message = await getMessage(env, auth, id);
  if (!message) return errorJson('پیام یافت نشد.', 404, 'not_found');
  return json({ message });
}

export async function searchMessages(request: Request, env: Env): Promise<Response> {
  const auth = await getSession(request, env);
  if (!auth) return errorJson('نشست معتبر نیست.', 401, 'unauthorized');
  const q = new URL(request.url).searchParams.get('q')?.trim() || '';
  if (q.length < 2 || q.length > 100) return json({ messages: [] });
  let statement: D1PreparedStatement;
  if (q.length >= 3) {
    const phrase = `"${q.replace(/"/g, '""')}"`;
    statement = env.DB.prepare(
      `${messageSelect(auth)} JOIN message_search ON message_search.message_id=m.id
       WHERE m.room_id=? AND m.deleted_at IS NULL AND message_search MATCH ?
       ORDER BY m.created_at DESC LIMIT 50`,
    ).bind(ROOM_ID, phrase);
  } else {
    const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
    statement = env.DB.prepare(
      `${messageSelect(auth)} WHERE m.room_id=? AND m.deleted_at IS NULL AND m.text LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC LIMIT 50`,
    ).bind(ROOM_ID, `%${escaped}%`);
  }
  const result = await statement.all<MessageRow>();
  return json({ messages: (result.results || []).map(serialize) });
}
