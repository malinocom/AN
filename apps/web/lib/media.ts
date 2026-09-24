import { postJson } from './api';

type Access = { url: string; expiresAt: number };
const cache = new Map<string, Access>();

export async function mediaUrl(mediaId: string, part: 'original' | 'thumb' = 'original'): Promise<string> {
  const key = `${mediaId}:${part}`;
  const current = cache.get(key);
  if (current && current.expiresAt > Date.now() + 30_000) return current.url;
  const access = await postJson<Access>(`/media/${encodeURIComponent(mediaId)}/access?part=${part}`);
  cache.set(key, access);
  return access.url;
}

export async function createThumbnail(file: File): Promise<Blob | null> {
  try {
    if (file.type.startsWith('image/')) {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      return await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.72));
    }
    if (file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file);
      try {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.src = url;
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error('video preview failed'));
        });
        video.currentTime = Math.min(0.2, Number.isFinite(video.duration) ? video.duration / 10 : 0);
        await new Promise<void>((resolve) => { video.onseeked = () => resolve(); setTimeout(resolve, 400); });
        const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        return await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.7));
      } finally { URL.revokeObjectURL(url); }
    }
  } catch { return null; }
  return null;
}

export function xhrUpload(url: string, file: Blob, onProgress: (percent: number) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('upload_failed'));
    xhr.onerror = () => reject(new Error('upload_failed'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
