'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, postJson } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState<'Amir' | 'Nazi'>('Amir');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api('/auth/session').then(() => router.replace('/chat')).catch(() => undefined); }, [router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await postJson('/auth/login', { username, password });
      router.replace('/chat');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ورود انجام نشد.');
    } finally { setBusy(false); }
  }

  return <main className="auth-page">
    <section className="auth-card" aria-labelledby="login-title">
      <div className="brand-mark" aria-hidden="true">♥</div>
      <p className="eyebrow">گفت‌وگوی خصوصی</p>
      <h1 id="login-title">Amir <span>&amp;</span> Nazi</h1>
      <p className="muted">فضایی خصوصی، آرام و فقط برای شما دو نفر.</p>
      <form onSubmit={submit} className="auth-form">
        <label>حساب کاربری
          <select value={username} onChange={(e) => setUsername(e.target.value as 'Amir' | 'Nazi')}>
            <option value="Amir">Amir</option><option value="Nazi">Nazi</option>
          </select>
        </label>
        <label>رمز عبور
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={128} />
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary-button" disabled={busy}>{busy ? 'در حال ورود…' : 'ورود به گفتگو'}</button>
      </form>
      <div className="privacy-note">نشست ورود با Cookie امن و HttpOnly نگهداری می‌شود.</div>
    </section>
  </main>;
}
