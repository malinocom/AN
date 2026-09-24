import type { NextConfig } from 'next';

const connectSrc = process.env.NODE_ENV === 'production' ? "connect-src 'self' https: wss:;" : "connect-src 'self' https: wss: http: ws:;";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' blob: data: https:; media-src 'self' blob: https:; ${connectSrc} frame-ancestors 'none'; base-uri 'self'; form-action 'self'` },
      ],
    }];
  },
};
export default nextConfig;
