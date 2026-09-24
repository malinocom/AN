'use client';

import { ChangeEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, postJson } from '@/lib/api';
import { createThumbnail, xhrUpload } from '@/lib/media';
import type { ChatMessage, MessagePage, SessionResponse } from '@/lib/types';
import MessageBubble from './MessageBubble';

type Connection = 'connecting' | 'online' | 'reconnecting' | 'offline';
type PendingFile = { file: File; url: string; kind: 'image' | 'video'; progress: number; error?: string };

const WS_URL = process.env.NEXT_PUBLIC_CHAT_WS_URL || '';
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 50 * 1024 * 1024;

function dayKey(ms: number) { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function dayLabel(ms: number) { return new Intl.DateTimeFormat('fa-IR', { weekday: 'long', day: 'numeric', month: 'long' }).format(ms); }
function lastSeen(ms?: number | null) { return ms ? `آخرین بازدید ${new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' }).format(ms)}` : 'آخرین بازدید نامشخص'; }

export default function ChatApp() {
  const router = useRouter();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState('');
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState<ChatMessage | null>(null);
  const [edit, setEdit] = useState<ChatMessage | null>(null);
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const [oldestCursor, setOldestCursor] = useState<string | null>(null);
  const [newestCursor, setNewestCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [uploading, setUploading] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempt = useRef(0);
  const connectingRef = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingSent = useRef(false);
  const abortUpload = useRef<AbortController | null>(null);
  const newestCursorRef = useRef<string | null>(null);
  const sessionRef = useRef<SessionResponse | null>(null);

  useEffect(() => { newestCursorRef.current = newestCursor; }, [newestCursor]);
  useEffect(() => { sessionRef.current = session; }, [session]);

  const upsert = useCallback((incoming: ChatMessage[]) => {
    setMessages((current) => {
      const map = new Map(current.map((m) => [m.id, m]));
      const optimisticByClientId = new Map(
        current
          .filter((m) => m.id.startsWith('local:'))
          .map((m) => [m.clientMessageId, m.id]),
      );
      for (const message of incoming) {
        const optimisticId = optimisticByClientId.get(message.clientMessageId);
        if (optimisticId) map.delete(optimisticId);
        map.set(message.id, { ...map.get(message.id), ...message });
      }
      return [...map.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    });
  }, []);

  const syncNew = useCallback(async () => {
    if (!sessionRef.current) return;
    let cursor = newestCursorRef.current;
    let appended = 0;
    for (let page = 0; page < 50; page++) {
      const data = await api<MessagePage>(cursor ? `/messages?limit=100&after=${encodeURIComponent(cursor)}` : '/messages?limit=100');
      if (data.messages.length) {
        upsert(data.messages); appended += data.messages.length;
        cursor = data.newestCursor; setNewestCursor(cursor);
        if (!oldestCursor) setOldestCursor(data.oldestCursor);
      }
      if (!data.hasMoreAfter || !data.newestCursor) break;
    }
    if (appended) {
      if (atBottomRef.current) requestAnimationFrame(() => scrollToBottom(false));
      else setNewCount((n) => n + appended);
    }
  }, [oldestCursor, upsert]);

  const refreshMessage = useCallback(async (id: string) => {
    try { const data = await api<{ message: ChatMessage }>(`/messages/${encodeURIComponent(id)}`); upsert([data.message]); } catch { /* deleted/unavailable */ }
  }, [upsert]);

  const connect = useCallback(async () => {
    if (!sessionRef.current || connectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) return;
    if (!navigator.onLine) { setConnection('offline'); return; }
    if (!WS_URL) { setFatal('آدرس WebSocket در تنظیمات Vercel تعریف نشده است.'); return; }
    connectingRef.current = true;
    setConnection(reconnectAttempt.current ? 'reconnecting' : 'connecting');
    try {
      const { ticket } = await postJson<{ ticket: string }>('/auth/ws-ticket');
      const ws = new WebSocket(WS_URL, ['an-chat', `ticket.${ticket}`]);
      wsRef.current = ws;
      ws.onopen = () => { connectingRef.current = false; reconnectAttempt.current = 0; setConnection('online'); syncNew().catch(() => undefined); };
      ws.onmessage = (event) => {
        if (event.data === 'pong') return;
        let data: { type?: string; messageId?: string; userId?: string; online?: boolean; lastSeenAt?: number };
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'message.created') syncNew().catch(() => undefined);
        if (['message.updated', 'message.deleted', 'message.reaction'].includes(data.type || '') && data.messageId) refreshMessage(data.messageId);
        if (data.type === 'message.read' && data.messageId) setMessages((list) => list.map((m) => m.id === data.messageId ? { ...m, readByPeer: true } : m));
        if (data.type === 'typing.start' && data.userId !== sessionRef.current?.user.id) setPeerTyping(true);
        if (data.type === 'typing.stop' && data.userId !== sessionRef.current?.user.id) setPeerTyping(false);
        if (data.type === 'presence.update' && data.userId !== sessionRef.current?.user.id) {
          setPeerOnline(Boolean(data.online));
          if (data.lastSeenAt) setSession((s) => s?.peer ? { ...s, peer: { ...s.peer, last_seen_at: data.lastSeenAt || null } } : s);
        }
      };
      ws.onclose = () => { wsRef.current = null; connectingRef.current = false; setPeerTyping(false); scheduleReconnect(); };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    } catch {
      connectingRef.current = false; scheduleReconnect();
    }
  }, [refreshMessage, syncNew]);

  function scheduleReconnect() {
    if (!sessionRef.current || reconnectTimer.current) return;
    if (!navigator.onLine) { setConnection('offline'); return; }
    setConnection('reconnecting');
    const delays = [1000, 2000, 4000, 8000, 15000, 30000];
    const delay = delays[Math.min(reconnectAttempt.current++, delays.length - 1)];
    reconnectTimer.current = setTimeout(() => { reconnectTimer.current = null; connect(); }, delay);
  }

  useEffect(() => {
    let active = true;
    const savedTheme = localStorage.getItem('an_theme') === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = savedTheme;
    (async () => {
      try {
        const s = await api<SessionResponse>('/auth/session');
        if (!active) return;
        setSession(s); sessionRef.current = s;
        setDraft(localStorage.getItem(`an_draft_${s.user.id}`) || '');
        const page = await api<MessagePage>('/messages?limit=100');
        if (!active) return;
        setMessages(page.messages); setHasMoreBefore(page.hasMoreBefore); setOldestCursor(page.oldestCursor); setNewestCursor(page.newestCursor);
        newestCursorRef.current = page.newestCursor;
        setLoading(false);
        requestAnimationFrame(() => scrollToBottom(false));
      } catch {
        router.replace('/login');
      }
    })();
    return () => { active = false; };
  }, [router]);

  useEffect(() => { if (session) connect(); return () => { wsRef.current?.close(1000, 'Page closed'); if (reconnectTimer.current) clearTimeout(reconnectTimer.current); }; }, [session, connect]);

  useEffect(() => {
    const resume = () => { if (document.visibilityState === 'visible') { connect(); syncNew().catch(() => undefined); } };
    const online = () => { setConnection('reconnecting'); connect(); syncNew().catch(() => undefined); };
    const offline = () => setConnection('offline');
    const pageshow = () => { connect(); syncNew().catch(() => undefined); };
    document.addEventListener('visibilitychange', resume); window.addEventListener('online', online); window.addEventListener('offline', offline); window.addEventListener('pageshow', pageshow);
    return () => { document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', online); window.removeEventListener('offline', offline); window.removeEventListener('pageshow', pageshow); };
  }, [connect, syncNew]);

  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => document.documentElement.style.setProperty('--app-height', `${vv?.height || window.innerHeight}px`);
    update(); vv?.addEventListener('resize', update); window.addEventListener('resize', update);
    return () => { vv?.removeEventListener('resize', update); window.removeEventListener('resize', update); };
  }, []);

  useEffect(() => { if (session) localStorage.setItem(`an_draft_${session.user.id}`, draft); }, [draft, session]);

  useEffect(() => {
    if (!session || !atBottomRef.current) return;
    const unread = messages.filter((m) => m.senderId !== session.user.id && !m.deletedAt).slice(-20);
    for (const m of unread) postJson(`/messages/${encodeURIComponent(m.id)}/read`).catch(() => undefined);
  }, [messages, session]);

  function scrollToBottom(smooth = true) {
    const el = scrollRef.current; if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    atBottomRef.current = true; setNewCount(0);
  }

  function onScroll() {
    const el = scrollRef.current; if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (atBottomRef.current) setNewCount(0);
  }

  async function loadOlder() {
    if (!oldestCursor || loadingOlder) return;
    const el = scrollRef.current; const oldHeight = el?.scrollHeight || 0;
    setLoadingOlder(true);
    try {
      const page = await api<MessagePage>(`/messages?limit=100&before=${encodeURIComponent(oldestCursor)}`);
      setMessages((current) => {
        const ids = new Set(current.map((m) => m.id));
        return [...page.messages.filter((m) => !ids.has(m.id)), ...current];
      });
      setOldestCursor(page.oldestCursor); setHasMoreBefore(page.hasMoreBefore);
      requestAnimationFrame(() => { if (el) el.scrollTop += el.scrollHeight - oldHeight; });
    } finally { setLoadingOlder(false); }
  }

  function sendTyping(active: boolean) {
    const ws = wsRef.current; if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (active && !typingSent.current) { ws.send(JSON.stringify({ type: 'typing.start' })); typingSent.current = true; }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'typing.stop' })); typingSent.current = false; }, 1400);
  }

  async function sendText(text: string, clientId: string = crypto.randomUUID(), replyId = reply?.id || null, existingLocalId?: string) {
    const clean = text.trim(); if (!clean || !session) return;
    const localId = existingLocalId || `local:${clientId}`;
    if (!existingLocalId) {
      upsert([{ id: localId, senderId: session.user.id, senderName: session.user.username, text: clean, messageType: 'text', mediaId: null, media: null,
        replyTo: reply ? { id: reply.id, text: reply.text, messageType: reply.messageType, senderName: reply.senderName } : null,
        clientMessageId: clientId, status: 'sending', createdAt: Date.now(), updatedAt: null, deletedAt: null, readByPeer: false, heartByMe: false, heartByPeer: false }]);
      setDraft(''); setReply(null); requestAnimationFrame(() => scrollToBottom());
    } else setMessages((list) => list.map((m) => m.id === existingLocalId ? { ...m, status: 'sending', localError: undefined } : m));
    try {
      const data = await postJson<{ message: ChatMessage }>('/messages', { text: clean, clientMessageId: clientId, replyToId: replyId, messageType: 'text' });
      upsert([data.message]);
      setMessages((list) => list.filter((m) => m.id !== localId));
      syncNew().catch(() => undefined);
    } catch (e) {
      setMessages((list) => list.map((m) => m.id === localId ? { ...m, status: 'failed', localError: e instanceof Error ? e.message : 'ارسال ناموفق بود.' } : m));
    }
  }

  async function submit() {
    if (edit) {
      const text = draft.trim(); if (!text) return;
      try { const data = await api<{ message: ChatMessage }>(`/messages/${encodeURIComponent(edit.id)}`, { method: 'PATCH', body: JSON.stringify({ text }) }); upsert([data.message]); setEdit(null); setDraft(''); }
      catch (e) { setFatal(e instanceof Error ? e.message : 'ویرایش انجام نشد.'); }
      return;
    }
    if (pendingFile) { await sendMedia(); return; }
    await sendText(draft);
  }

  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const kind: 'image' | 'video' = file.type.startsWith('video/') ? 'video' : 'image';
    const max = kind === 'image' ? MAX_IMAGE : MAX_VIDEO;
    if (file.size > max) { setFatal(kind === 'image' ? 'حداکثر حجم عکس ۱۰ مگابایت است.' : 'حداکثر حجم ویدیو ۵۰ مگابایت است.'); return; }
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) { setFatal('فقط عکس یا ویدیو قابل ارسال است.'); return; }
    if (pendingFile) URL.revokeObjectURL(pendingFile.url);
    setPendingFile({ file, url: URL.createObjectURL(file), kind, progress: 0 }); setFatal('');
  }

  function cancelFile() {
    abortUpload.current?.abort();
    if (pendingFile) URL.revokeObjectURL(pendingFile.url);
    setPendingFile(null); setUploading(false);
  }

  async function sendMedia() {
    if (!pendingFile || uploading || !session) return;
    setUploading(true); setPendingFile((p) => p ? { ...p, error: undefined, progress: 0 } : p);
    const controller = new AbortController(); abortUpload.current = controller;
    try {
      const thumb = await createThumbnail(pendingFile.file);
      const permit = await postJson<{ mediaId: string; uploadUrl: string; thumbnailUploadUrl?: string }>('/media/upload-url', {
        mimeType: pendingFile.file.type, size: pendingFile.file.size, kind: pendingFile.kind, hasThumbnail: Boolean(thumb),
      });
      await xhrUpload(permit.uploadUrl, pendingFile.file, (p) => setPendingFile((x) => x ? { ...x, progress: thumb ? Math.round(p * .85) : p } : x), controller.signal);
      if (thumb && permit.thumbnailUploadUrl) await xhrUpload(permit.thumbnailUploadUrl, thumb, (p) => setPendingFile((x) => x ? { ...x, progress: 85 + Math.round(p * .15) } : x), controller.signal);
      const clientMessageId = crypto.randomUUID();
      const data = await postJson<{ message: ChatMessage }>('/messages', {
        text: draft.trim() || null, clientMessageId, replyToId: reply?.id || null, mediaId: permit.mediaId, messageType: pendingFile.kind,
      });
      upsert([data.message]);
      URL.revokeObjectURL(pendingFile.url); setPendingFile(null); setDraft(''); setReply(null); setUploading(false); scrollToBottom();
      syncNew().catch(() => undefined);
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') setPendingFile((p) => p ? { ...p, error: 'آپلود ناموفق بود؛ دوباره تلاش کنید.' } : p);
      setUploading(false);
    }
  }

  async function heart(message: ChatMessage) { try { const data = await postJson<{ message: ChatMessage }>(`/messages/${message.id}/reaction`); upsert([data.message]); } catch { /* keep UI stable */ } }
  async function remove(message: ChatMessage) { if (!confirm('این پیام حذف شود؟')) return; try { const data = await api<{ message: ChatMessage }>(`/messages/${message.id}`, { method: 'DELETE' }); upsert([data.message]); } catch (e) { setFatal(e instanceof Error ? e.message : 'حذف انجام نشد.'); } }
  function startEdit(message: ChatMessage) { setEdit(message); setReply(null); setDraft(message.text || ''); }
  function retry(message: ChatMessage) { if (message.messageType === 'text' && message.text) sendText(message.text, message.clientMessageId, message.replyTo?.id || null, message.id); }

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!searchOpen || searchQuery.trim().length < 2) { setSearchResults([]); return; }
      try { const data = await api<{ messages: ChatMessage[] }>(`/messages/search?q=${encodeURIComponent(searchQuery.trim())}`); setSearchResults(data.messages); } catch { setSearchResults([]); }
    }, 250);
    return () => clearTimeout(timer);
  }, [searchOpen, searchQuery]);

  async function logout() { try { await postJson('/auth/logout'); } finally { wsRef.current?.close(); router.replace('/login'); } }
  function toggleTheme() { const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = next; localStorage.setItem('an_theme', next); }

  const grouped = useMemo(() => messages.map((message, index) => ({ message, showDate: index === 0 || dayKey(messages[index - 1].createdAt) !== dayKey(message.createdAt) })), [messages]);

  if (loading) return <main className="chat-shell"><div className="center-state"><div className="loader"/><p>در حال بازکردن گفت‌وگو…</p></div></main>;
  if (!session) return null;
  const peerName = session.peer?.username || (session.user.username === 'Amir' ? 'Nazi' : 'Amir');

  return <main className="chat-shell">
    <section className="chat-card">
      <header className="chat-header">
        <div className="peer-identity"><div className="avatar">{peerName.slice(0, 1)}</div><div><h1>{peerName}</h1><p>{peerTyping ? 'در حال نوشتن…' : peerOnline ? 'آنلاین' : lastSeen(session.peer?.last_seen_at)}</p></div></div>
        <div className="header-actions">
          <span className={`connection-pill ${connection}`}>{connection === 'online' ? 'متصل' : connection === 'offline' ? 'آفلاین' : connection === 'reconnecting' ? 'اتصال مجدد…' : 'در حال اتصال…'}</span>
          <button className="icon-button" onClick={() => setSearchOpen(!searchOpen)} aria-label="جست‌وجو">⌕</button>
          <button className="icon-button" onClick={toggleTheme} aria-label="تغییر تم">◐</button>
          <button className="icon-button" onClick={() => router.push('/settings')} aria-label="تنظیمات">⚙</button>
        </div>
      </header>

      {searchOpen && <aside className="search-panel"><div className="search-head"><input autoFocus placeholder="جست‌وجو در پیام‌ها…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /><button onClick={() => setSearchOpen(false)}>بستن</button></div><div className="search-results">{searchQuery.length >= 2 && searchResults.length === 0 && <p className="muted">نتیجه‌ای پیدا نشد.</p>}{searchResults.map((m) => <button key={m.id} onClick={() => { upsert([m]); setSearchOpen(false); requestAnimationFrame(() => document.querySelector(`[data-message-id="${m.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })); }}><strong>{m.senderName}</strong><span>{m.text || (m.messageType === 'image' ? 'تصویر' : 'ویدیو')}</span></button>)}</div></aside>}

      <div className="status-stack" aria-live="polite">
        {fatal && <div className="error-banner"><span>{fatal}</span><button onClick={() => setFatal('')}>×</button></div>}
        {connection === 'offline' && <div className="offline-banner">اتصال اینترنت قطع است؛ پیش‌نویس شما حفظ می‌شود.</div>}
      </div>

      <div className="messages-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="messages-inner">
          {hasMoreBefore && <button className="older-button" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? 'در حال دریافت…' : 'نمایش پیام‌های قدیمی‌تر'}</button>}
          {!messages.length && <div className="empty-chat"><div>♡</div><h2>گفت‌وگو هنوز خالی است</h2><p>اولین پیام را بنویسید.</p></div>}
          {grouped.map(({ message, showDate }) => <div className="message-item" key={message.id}>{showDate && <div className="date-separator"><span>{dayLabel(message.createdAt)}</span></div>}<MessageBubble message={message} own={message.senderId === session.user.id} onReply={(m) => { setReply(m); setEdit(null); }} onEdit={startEdit} onDelete={remove} onHeart={heart} onRetry={retry} /></div>)}
        </div>
      </div>

      {newCount > 0 && <button className="new-messages-button" onClick={() => scrollToBottom()}>↓ {newCount.toLocaleString('fa-IR')} پیام جدید</button>}

      <footer className="composer-wrap">
        {(reply || edit) && <div className="composer-context"><div><strong>{edit ? 'ویرایش پیام' : `پاسخ به ${reply?.senderName}`}</strong><span>{edit?.text || reply?.text || 'رسانه'}</span></div><button onClick={() => { setReply(null); if (edit) { setEdit(null); setDraft(''); } }}>×</button></div>}
        {pendingFile && <div className="upload-preview"><div className="preview-media">{pendingFile.kind === 'image' ? <img src={pendingFile.url} alt="پیش‌نمایش"/> : <video src={pendingFile.url} controls preload="metadata" />}</div><div className="upload-info"><strong>{pendingFile.kind === 'image' ? 'عکس' : 'ویدیو'}</strong><span>{(pendingFile.file.size / 1024 / 1024).toFixed(1)} MB</span>{uploading && <div className="progress"><i style={{ width: `${pendingFile.progress}%` }}/><span>{pendingFile.progress.toLocaleString('fa-IR')}٪</span></div>}{pendingFile.error && <span className="danger-text">{pendingFile.error}</span>}</div><button className="icon-button" onClick={cancelFile} aria-label="لغو فایل">×</button></div>}
        <div className="composer">
          <label className="attach-button" title="عکس یا ویدیو">＋<input type="file" accept="image/*,video/*" onChange={selectFile} disabled={uploading}/></label>
          <label className="camera-button" title="دوربین">◉<input type="file" accept="image/*" capture="environment" onChange={selectFile} disabled={uploading}/></label>
          <textarea value={draft} onChange={(e) => { setDraft(e.target.value); sendTyping(Boolean(e.target.value)); }} onKeyDown={keyDown} rows={1} maxLength={5000} placeholder={edit ? 'متن ویرایش‌شده…' : 'پیام…'} aria-label="متن پیام" />
          <button className="send-button" onClick={submit} disabled={uploading || (!draft.trim() && !pendingFile)}>{uploading ? '…' : '↑'}</button>
        </div>
        <div className="composer-hint"><span>Enter ارسال · Shift + Enter خط جدید</span><button onClick={logout}>خروج از حساب</button></div>
      </footer>
    </section>
  </main>;
}
