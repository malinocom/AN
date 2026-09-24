'use client';

import { useEffect, useState } from 'react';
import { mediaUrl } from '@/lib/media';
import type { ChatMessage } from '@/lib/types';

export default function MediaMessage({ message }: { message: ChatMessage }) {
  const [src, setSrc] = useState('');
  const [full, setFull] = useState(false);
  const [fullSrc, setFullSrc] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!message.mediaId || !message.media) return;
    const part = message.media.kind === 'image' && message.media.hasThumbnail ? 'thumb' : 'original';
    mediaUrl(message.mediaId, part).then((url) => alive && setSrc(url)).catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [message.mediaId, message.media]);

  if (!message.media || !message.mediaId) return null;
  if (error) return <div className="media-error">رسانه در دسترس نیست.</div>;
  if (!src) return <div className="media-skeleton" aria-label="در حال بارگذاری رسانه" />;

  if (message.media.kind === 'video') {
    return <video className="chat-video" src={src} controls preload="metadata" playsInline />;
  }

  async function openFull() {
    if (!message.mediaId) return;
    try { setFullSrc(await mediaUrl(message.mediaId, 'original')); setFull(true); } catch { setError(true); }
  }

  return <>
    <button className="image-button" onClick={openFull} aria-label="نمایش تصویر در اندازه بزرگ"><img src={src} alt="تصویر ارسال‌شده" loading="lazy" /></button>
    {full && <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setFull(false)}><button className="lightbox-close" onClick={() => setFull(false)}>×</button><img src={fullSrc} alt="تصویر در اندازه بزرگ" /></div>}
  </>;
}
