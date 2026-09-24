'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, postJson } from '@/lib/api';

export default function SettingsPage() {
  const router = useRouter();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    api('/auth/session').catch(() => router.replace('/login'));
    const saved = localStorage.getItem('an_theme') === 'light' ? 'light' : 'dark';
    setTheme(saved); document.documentElement.dataset.theme = saved;
  }, [router]);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next); localStorage.setItem('an_theme', next); document.documentElement.dataset.theme = next;
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault(); setStatus('');
    if (newPassword !== confirm) { setStatus('تکرار رمز جدید یکسان نیست.'); return; }
    try {
      await postJson('/auth/change-password', { currentPassword, newPassword });
      setCurrent(''); setNext(''); setConfirm(''); setStatus('رمز عبور با موفقیت تغییر کرد.');
    } catch (err) { setStatus(err instanceof Error ? err.message : 'تغییر رمز انجام نشد.'); }
  }

  return <main className="settings-page"><section className="settings-card">
    <div className="settings-head"><button className="icon-button" onClick={() => router.push('/chat')} aria-label="بازگشت">←</button><div><p className="eyebrow">Amir &amp; Nazi</p><h1>تنظیمات</h1></div></div>
    <div className="setting-row"><div><strong>ظاهر برنامه</strong><p className="muted">تم تیره یا روشن</p></div><button className="soft-button" onClick={toggleTheme}>{theme === 'dark' ? 'تم روشن' : 'تم تیره'}</button></div>
    <form className="auth-form" onSubmit={changePassword}>
      <h2>تغییر رمز عبور</h2>
      <label>رمز فعلی<input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required /></label>
      <label>رمز جدید<input type="password" autoComplete="new-password" minLength={4} maxLength={128} value={newPassword} onChange={(e) => setNext(e.target.value)} required /></label>
      <label>تکرار رمز جدید<input type="password" autoComplete="new-password" minLength={4} maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></label>
      {status && <div className="form-status">{status}</div>}
      <button className="primary-button">ذخیره رمز جدید</button>
    </form>
  </section></main>;
}
