import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentActor } from '@/server/auth';
import { detectiveService } from '@/server/modules/detective/service';
import { VakaKarti } from '@/features/detective/components/VakaKarti';
import { brand } from '@/config';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  /*
   * Başlık üretilirken viewerId VERİLMEZ (null). Böylece çözüm metni bu
   * kod yolunda hiç okunmaz ve yanlışlıkla açıklamaya sızma ihtimali kalmaz.
   */
  const vaka = await detectiveService.bySlug(slug, null);
  if (!vaka) return { title: 'Vaka bulunamadı' };

  const title = vaka.title;
  // Açıklamada SORU var, cevap yok — paylaşılan bağlantı merak uyandırmalı,
  // cevabı ele vermemeli.
  const description = `${vaka.question} ${brand.appName} · Kısa Dedektif`;

  return {
    title,
    description,
    alternates: { canonical: `/dedektif/${vaka.slug}` },
    openGraph: {
      type: 'article',
      title,
      description,
      url: `/dedektif/${vaka.slug}`,
      siteName: brand.appName,
      locale: 'tr_TR',
    },
    twitter: { card: 'summary', title, description },
  };
}

export default async function VakaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await currentActor();
  const vaka = await detectiveService.bySlug(slug, actor?.id ?? null);
  if (!vaka) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <p className="mb-4">
        <Link href="/dedektif" className="text-muted text-sm">
          ← Kısa Dedektif
        </Link>
      </p>

      {actor ? (
        <VakaKarti vaka={vaka} />
      ) : (
        <>
          <VakaKarti vaka={vaka} />
          {/*
            Giriş yapmamış ziyaretçi vakayı OKUYABİLİR ama cevaplayamaz.
            Okumayı da engellemek, ürünün kayıt olmadan değer gösterebildiği
            tek yeri kapatmak olurdu.
          */}
          <div className="border-brand bg-surface mt-4 rounded-xl border p-4 text-center">
            <p className="text-ink text-base font-semibold">Cevaplamak için hesap gerekir.</p>
            <p className="text-muted mt-1 text-sm">
              Cevabın karnene yazılır ve sonradan değiştirilemez.
            </p>
            <Link
              href="/register"
              className="bg-brand text-brand-fg focus-visible:outline-ink mt-3 inline-flex min-h-12 items-center rounded-lg px-4 text-base font-bold focus-visible:outline-2"
            >
              Hesap oluştur
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
