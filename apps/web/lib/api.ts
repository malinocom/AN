const API = process.env.NEXT_PUBLIC_CHAT_API_URL || '/api';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${API}${path}`, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new ApiError(response.status, String(data.code || 'request_failed'), String(data.error || 'درخواست انجام نشد.'));
  return data as T;
}

export function postJson<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
}
