'use client';

import { memo, useState } from 'react';
import type { ChatMessage } from '@/lib/types';
import MediaMessage from './MediaMessage';

const timeFormatter = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' });
function time(value: number) { return timeFormatter.format(value); }

function MessageBubble({ message, own, onReply, onEdit, onDelete, onHeart, onRetry }: {
  message: ChatMessage; own: boolean;
  onReply: (m: ChatMessage) => void; onEdit: (m: ChatMessage) => void; onDelete: (m: ChatMessage) => void;
  onHeart: (m: ChatMessage) => void; onRetry: (m: ChatMessage) => void;
}) {
  const [menu, setMenu] = useState(false);
  const deleted = message.status === 'deleted' || Boolean(message.deletedAt);
  return <article className={`message-row ${own ? 'own' : 'peer'}`} data-message-id={message.id}>
    <div className={`message-bubble ${message.status === 'failed' ? 'failed' : ''}`}>
      {message.replyTo && !deleted && <div className="reply-quote"><strong>{message.replyTo.senderName}</strong><span>{message.replyTo.text || (message.replyTo.messageType === 'image' ? 'تصویر' : 'ویدیو')}</span></div>}
      {deleted ? <p className="deleted-text">این پیام حذف شده است.</p> : <>
        {message.media && <MediaMessage message={message} />}
        {message.text && <p className="message-text">{message.text}</p>}
      </>}
      <div className="message-meta">
        <span>{time(message.createdAt)}</span>
        {message.updatedAt && !deleted && <span>ویرایش‌شده</span>}
        {own && <span title={message.readByPeer ? 'دیده‌شده' : message.status === 'sending' ? 'در حال ارسال' : 'ارسال‌شده'}>{message.status === 'sending' ? '◷' : message.readByPeer ? '✓✓' : '✓'}</span>}
        {(message.heartByMe || message.heartByPeer) && <span className="heart-reaction">♥</span>}
      </div>
      {!deleted && message.status !== 'sending' && <button className="message-menu-button" aria-label="گزینه‌های پیام" onClick={() => setMenu(!menu)}>•••</button>}
      {menu && <div className="message-menu" onMouseLeave={() => setMenu(false)}>
        <button onClick={() => { onReply(message); setMenu(false); }}>پاسخ</button>
        {message.text && <button onClick={() => { navigator.clipboard.writeText(message.text || ''); setMenu(false); }}>کپی</button>}
        <button onClick={() => { onHeart(message); setMenu(false); }}>{message.heartByMe ? 'حذف قلب' : 'واکنش قلب'}</button>
        {own && message.text && <button onClick={() => { onEdit(message); setMenu(false); }}>ویرایش</button>}
        {own && <button className="danger-text" onClick={() => { onDelete(message); setMenu(false); }}>حذف</button>}
      </div>}
      {message.status === 'failed' && <div className="failed-actions"><span>{message.localError || 'ارسال ناموفق بود.'}</span><button onClick={() => onRetry(message)}>تلاش مجدد</button></div>}
    </div>
  </article>;
}

export default memo(MessageBubble, (previous, next) =>
  previous.message === next.message && previous.own === next.own
);
