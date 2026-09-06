import { NextResponse, type NextRequest } from 'next/server';

/**
 * Korumalı bölgeler için ilk savunma katmanı.
 *
 * Next.js 16'da bu dosya `middleware.ts` yerine `proxy.ts` adını taşır.
 *
 * Middleware yalnızca oturum ÇEREZİNİN varlığına bakar — token'ı burada
 * doğrulamaz, çünkü Edge runtime'da veritabanı erişimi yoktur. Gerçek yetki
 * kontrolü her zaman sayfa/action içinde `requireActor()` / `requireRole()` ile
 * yapılır (Spesifikasyon Bölüm 10.2 — defense in depth).
 */
const PROTECTED = ['/app', '/admin'];

const SESSION_COOKIES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) return NextResponse.next();

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/app/:path*', '/admin/:path*'],
};
