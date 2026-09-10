import type { Metadata } from 'next';
import Link from 'next/link';
import { brand } from '@/config';
import { catalogService } from '@/server/modules/catalog/service';
import { ResultRow } from '@/features/results/components/ResultRow';
import { formatCount } from '@/lib/utils';

/**
 * SONUÇLAR — herkese açık, son yedi gün.
 *
 * ── NEDEN BU SAYFA VAR ─────────────────────────────────────────────────────
 * Kullanıcının canlıda sorduğu soru şuydu: "akışa giren maçların sonuçları
 * maçlar bitince neden gözükmüyor". Sonuçlar hesaplanıyordu — maç bitiyor,
 * bakım işi skoru okuyor, etkinlik sonuçlanıyordu — ama görülecekleri tek
 * yer o etkinliğin kendi sayfasıydı. Yani ürün sözünü tutuyor, tuttuğunu
 * kimseye gösteremiyordu.
 *
 * ── NEDEN GİRİŞ İSTEMİYOR ──────────────────────────────────────────────────
 * Sonuç, bu ürünün tek dış kanıtıdır. "Burada tahmin ediliyor" cümlesine
 * inanmayan ziyaretçiye gösterilecek şey, dün ne olduğunu bilen bir
 * listedir. Kanıtı kayıt duvarının arkasına koymak, en pahalı adımı en başa
 * koymaktır — ana sayfada verdiğimiz kararın aynısı.
 *
 * ── NEDEN YEDİ GÜN ─────────────────────────────────────────────────────────
 * Sonsuz arşiv ürünün canlı olduğunu değil eskidiğini gösterir; çok kısa bir
 * pencere ise dünkü maçı bile kaçırır. Yedi gün "bu hafta ne oldu"yu
 * kapsar.
 */

const DAYS = 7;

export const metadata: Metadata = {
  title: 'Sonuçlar',
  description: `Son ${DAYS} günde sonuçlanan meydanlar ve kaç kişinin bildiği.`,
  alternates: { canonical: '/sonuclar' },
};

/* Sonuç listesi her istekte üretilir: dünkü liste, bugünkü sonuçları saklar. */
export const dynamic = 'force-dynamic';

export default async function ResultsPage() {
  const rows = await catalogService.resultsBoard(DAYS, 40);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-ink text-2xl font-bold">
        <span aria-hidden="true">🏁 </span>Sonuçlar
      </h1>
      <p className="text-muted mt-2 text-sm">
        Son {DAYS} günde sonuçlanan meydanlar. Kimin bildiği değil, kaç kişinin bildiği yazar.
      </p>

      {rows.length === 0 ? (
        /*
         * BOŞ DURUM SAHTE İÇERİKLE DOLDURULMAZ.
         *
         * Burada eski sonuçları göstermek ya da örnek satır uydurmak, sayfayı
         * dolu gösterirdi. Boş liste dürüsttür ve ziyaretçiye yapabileceği
         * bir şey söyler: açık olanlara bak.
         */
        <div className="border-border mt-6 rounded-xl border p-6 text-center">
          <p className="text-ink text-base font-semibold">Bu hafta henüz sonuçlanan yok.</p>
          <p className="text-muted mt-2 text-sm">
            Sonuçlar maçlar bitince kendiliğinden buraya düşer. O zamana kadar açık olanlara
            bakabilirsin.
          </p>
          <Link
            href="/"
            className="bg-brand text-brand-fg focus-visible:outline-ink mt-4 inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Açık meydanlara bak
          </Link>
        </div>
      ) : (
        <>
          <p className="text-muted mt-1 text-xs">{formatCount(rows.length)} sonuç</p>
          <ul className="mt-4 space-y-2">
            {rows.map((r) => (
              <ResultRow key={r.id} data={r} />
            ))}
          </ul>
        </>
      )}

      <div className="border-border mt-10 border-t pt-6">
        <p className="text-ink text-base font-semibold">Sıradakini sen bil.</p>
        <p className="text-muted mt-1 text-sm">
          Açık meydanlarda tarafını seç; sonucu birlikte göreceğiz.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/register"
            className="bg-brand text-brand-fg focus-visible:outline-ink flex min-h-13 flex-1 items-center justify-center rounded-lg text-base font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Hesap oluştur
          </Link>
          <Link
            href="/"
            className="border-border text-ink focus-visible:outline-ink flex min-h-13 flex-1 items-center justify-center rounded-lg border text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Açık meydanlar
          </Link>
        </div>
      </div>

      <p className="text-muted mt-8 text-sm leading-relaxed">
        {brand.currencyName} tamamen sanal, oyun içi bir puandır. Gerçek para değildir; nakde
        çevrilemez, çekilemez, gerçek para ile satın alınamaz.
      </p>
    </main>
  );
}
