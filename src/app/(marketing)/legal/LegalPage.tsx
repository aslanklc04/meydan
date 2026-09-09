import Link from 'next/link';
import { brand } from '@/config';

/**
 * Yasal sayfaların ortak kabuğu.
 *
 * NEDEN ORTAK BİLEŞEN: iki sayfanın da aynı sürüm bilgisini, aynı avukat
 * incelemesi uyarısını ve aynı yapıyı taşıması gerekiyor. Kopyalanan yasal
 * metin, biri güncellendiğinde diğerinin sessizce eskimesi demektir.
 */
export function LegalPage({
  title,
  updated,
  version,
  children,
}: {
  readonly title: string;
  readonly updated: string;
  readonly version: string;
  readonly children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="text-ink text-2xl font-bold">{title}</h1>
      <p className="text-muted mt-2 text-sm">
        Sürüm {version} · Son güncelleme {updated}
      </p>

      {/*
        DÜRÜSTLÜK NOTU — kaldırılmamalı.

        Bu metinler ürünün GERÇEKTE ne yaptığını anlatır ve bir avukat
        tarafından incelenmemiştir. Kullanıcıya "hukuki bakımdan onaylanmıştır"
        izlenimi vermek, vermediğimiz bir güvenceyi vermek olurdu.
      */}
      <aside
        role="note"
        className="bg-warning-bg border-brand mt-6 rounded-md border-l-4 px-4 py-3 text-sm"
      >
        Bu metin {brand.appName}&apos;ın nasıl çalıştığını açık dille anlatır ve henüz bir hukuk
        danışmanı tarafından incelenmemiştir. Kamuya açık beta öncesinde incelenecektir.
      </aside>

      <div className="mt-8 space-y-8">{children}</div>

      <p className="text-muted mt-10 text-sm">
        <Link href="/legal/terms" className="text-brand underline">
          Kullanım Koşulları
        </Link>{' '}
        ·{' '}
        <Link href="/legal/privacy" className="text-brand underline">
          Gizlilik Politikası
        </Link>{' '}
        ·{' '}
        <Link href="/" className="text-brand underline">
          Ana sayfa
        </Link>
      </p>
    </main>
  );
}

export function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-ink text-lg font-bold">{title}</h2>
      <div className="text-foreground mt-2 space-y-3 text-base leading-relaxed">{children}</div>
    </section>
  );
}
