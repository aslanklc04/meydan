import type { Metadata } from 'next';
import Link from 'next/link';
import { brand } from '@/config';

export const metadata: Metadata = { title: 'Sayfa bulunamadı', robots: { index: false } };

/**
 * 404 — kullanıcı diliyle, çıkışı gösteren.
 * "404" sayısı kullanıcıya bir şey anlatmaz; ne yapabileceği anlatır.
 */
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-12 text-center">
      <p aria-hidden="true" className="text-4xl">
        🔍
      </p>
      <h1 className="text-ink mt-3 text-xl font-bold">Aradığın sayfa yok.</h1>
      <p className="text-muted mt-2 text-sm">
        Bağlantı eskimiş ya da etkinlik kaldırılmış olabilir.
      </p>
      <div className="mt-6 grid gap-2">
        <Link
          href="/app/feed"
          className="bg-brand text-brand-fg flex min-h-12 w-full items-center justify-center rounded-lg text-base font-semibold"
        >
          {brand.nav.feed}
        </Link>
        <Link
          href="/"
          className="border-border text-ink flex min-h-12 w-full items-center justify-center rounded-lg border text-base font-semibold"
        >
          Ana sayfa
        </Link>
      </div>
    </main>
  );
}
