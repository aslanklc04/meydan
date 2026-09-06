import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Sunucu sürümünü sızdırmayalım.
  poweredByHeader: false,

  // Not: tam güvenlik başlığı seti (CSP + nonce, HSTS, Permissions-Policy)
  // Faz 17'de middleware üzerinden eklenir. Buradakiler nonce gerektirmeyen,
  // baştan uygulanabilir olanlardır.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
