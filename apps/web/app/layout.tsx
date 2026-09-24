import '@fontsource-variable/vazirmatn';
import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME || 'Amir & Nazi',
  description: 'گفت‌وگوی خصوصی دونفره',
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0c0a0b',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fa" dir="rtl" suppressHydrationWarning><body>{children}</body></html>;
}
