import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { after } from 'next/server';
import { currentActor } from '@/server/auth';
import { gazetteService } from '@/server/modules/gazette/service';
import type { GazetteHeadline } from '@/server/modules/gazette/service';
import { log } from '@/server/observability/logger';
import { brand } from '@/config';
import { formatCount } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * GELECEK GAZETESİ — herkese açık kapak.
 *
 * ── BU SAYFANIN İŞİ ────────────────────────────────────────────────────────
 * Paylaşım bağlantısına tıklayan kişi giriş yapmamıştır ve MEYDAN'ı bilmez.
 * Ona üç şeyi bu sırayla vermek gerekir: (1) arkadaşının ne iddia ettiği,
 * (2) sonucun henüz belli olmadığı, (3) kendisinin de aynısını
 * yapabileceği. Üçüncüsü olmadan sayfa bir afiş; birincisi olmadan bir reklam
 * olur.
 *
 * ── NEDEN "TAHMİN" ETİKETİ HER YERDE ───────────────────────────────────────
 * Kapak biçimi bilinçli olarak gazeteye benzer. Tam bu yüzden manşetlerin
 * HABER SANILMAMASI gerekir: sayfa gerçek bir yayın gibi görünüp olmamış bir
 * olayı olmuş gibi aktarırsa, ürünün kendisi bir yanlış bilgi kaynağına
 * dönüşür. Bu yüzden başlıkta, her manşette ve künyede tahmin olduğu yazar;
 * kaldırılabilir bir süs değil, sayfanın var olma şartıdır.
 *
 * ── ZİYARETÇİYE DAĞILIM YOK ────────────────────────────────────────────────
 * Kapakta yalnızca SAHİBİNİN iddiası görünür; kalabalığın ne dediği
 * görünmez. "Önce sen söyle" kuralı burada da geçerli: ziyaretçi henüz
 * tahmin yapmadı.
 */

type Params = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  const gazette = await gazetteService.byToken(token);
  if (!gazette) return { title: 'Gazete bulunamadı', robots: { index: false } };

  const description = `@${gazette.ownerUsername} ${formatCount(gazette.headlines.length)} tahminini ortaya koydu. Sen ne diyorsun?`;

  return {
    title: `${gazette.title} — tahmin kapağı`,
    description,
    /*
     * ARAMA MOTORUNA AÇILMAZ. Bağlantı tahmin edilemez ama "gizli" değildir;
     * dizine girerse kullanıcının paylaştığı kişilerin ötesine yayılır ve
     * paylaşım kararı kullanıcının elinden çıkar.
     */
    robots: { index: false, follow: false },
    openGraph: {
      type: 'article',
      title: gazette.title,
      description,
      siteName: brand.appName,
      locale: 'tr_TR',
      images: [{ url: `/g/${token}/kapak`, width: 1200, height: 630, alt: gazette.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: gazette.title,
      description,
      images: [`/g/${token}/kapak`],
    },
  };
}

function Headline({ item, index }: { readonly item: GazetteHeadline; readonly index: number }) {
  return (
    <li className="border-border border-t pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-3">
        {item.outcomeImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.outcomeImageUrl}
            alt=""
            aria-hidden="true"
            width={48}
            height={48}
            loading="lazy"
            className="h-12 w-12 shrink-0 object-contain"
          />
        ) : (
          <span
            aria-hidden="true"
            className="text-muted flex h-12 w-12 shrink-0 items-center justify-center text-2xl font-black"
          >
            {index + 1}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-muted text-xs">{item.eventTitle}</p>
          <p className="text-ink mt-0.5 text-lg leading-snug font-bold">
            &laquo;{item.outcomeLabel}&raquo;
          </p>
          <p className="text-muted mt-1 text-xs">{item.question}</p>

          {/* Durum satırı: manşetin şu anki hâli tek bakışta okunmalı. */}
          <p className="mt-2 text-sm font-semibold">
            {item.voided ? (
              <span className="text-muted">
                <span aria-hidden="true">➖ </span>Bu etkinlik iptal edildi — sayılmıyor.
              </span>
            ) : item.correct === true ? (
              <span className="text-brand">
                <span aria-hidden="true">✅ </span>Tuttu · Sonuç: {item.resolvedOutcomeLabel}
              </span>
            ) : item.correct === false ? (
              <span className="text-muted">
                <span aria-hidden="true">❌ </span>Tutmadı · Sonuç: {item.resolvedOutcomeLabel}
              </span>
            ) : (
              <span className="text-muted">
                <span aria-hidden="true">⏳ </span>Sonuç henüz belli değil
              </span>
            )}
          </p>

          <Link
            href={`/event/${item.eventSlug}`}
            className="text-brand focus-visible:outline-ink mt-2 inline-flex min-h-11 items-center text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Sen ne diyorsun? →
          </Link>
        </div>
      </div>
    </li>
  );
}

export default async function GazettePage({ params }: Params) {
  const { token } = await params;
  const gazette = await gazetteService.byToken(token);
  if (!gazette) notFound();

  const actor = await currentActor();

  /*
   * Sayaç YANITTAN SONRA artırılır. Sayfanın açılması bir veritabanı
   * yazmasını beklememeli: sayaç yanlış sayarsa kimse zarar görmez, sayfa
   * geç açılırsa ziyaretçi gider. Hata da yutulur — bir sayaç yüzünden
   * paylaşılmış bir bağlantı bozulmaz.
   */
  after(async () => {
    try {
      await gazetteService.countView(token);
    } catch (error) {
      log.warn('gazette.view_count_failed', { operation: 'gazette.countView', error });
    }
  });

  const pending = gazette.headlines.filter((h) => h.correct === null && !h.voided).length;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <article className="border-ink bg-background rounded-xl border-2 p-5 sm:p-7">
        {/* ── Künye ── */}
        <header className="border-ink border-b-4 pb-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-ink text-xs font-black tracking-[0.2em] uppercase">
              {brand.appName} · Gelecek Gazetesi
            </p>
            <p className="text-muted text-xs">{gazette.publishedDay}</p>
          </div>
          <h1 className="text-ink mt-3 text-3xl leading-tight font-black text-balance sm:text-4xl">
            {gazette.title}
          </h1>
          <p className="text-muted mt-2 text-sm">
            <Link
              href={`/u/${gazette.ownerUsername}`}
              className="text-brand focus-visible:outline-ink font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              @{gazette.ownerUsername}
            </Link>{' '}
            yazdı
          </p>
        </header>

        {/*
          BU BİR HABER DEĞİL. Uyarı manşetlerin ÜSTÜNDE durur: altta olsaydı
          okuyan kişi manşetleri zaten haber sanmış olarak aşağı inerdi.
        */}
        <p className="border-border text-muted mt-4 rounded-lg border border-dashed px-3 py-2 text-xs">
          <span aria-hidden="true">⚠️ </span>
          Bu bir haber değildir. Aşağıdakiler @{gazette.ownerUsername} kişisinin{' '}
          <strong>tahminleridir</strong>; henüz olmamış olaylar hakkındadır.
        </p>

        <ul className="mt-5 space-y-4">
          {gazette.headlines.map((h, i) => (
            <Headline key={h.slot} item={h} index={i} />
          ))}
        </ul>

        {/* ── Karne ── */}
        <footer className="border-ink mt-6 border-t-2 pt-3">
          <p className="text-muted text-sm">
            {gazette.settled === 0 ? (
              <>
                <span aria-hidden="true">⏳ </span>
                {formatCount(pending)} manşetin sonucu bekleniyor.
              </>
            ) : (
              <>
                Sonuçlanan {formatCount(gazette.settled)} manşetten{' '}
                <strong className="text-ink">{formatCount(gazette.hits)}</strong> tanesi tuttu
                {pending > 0 ? ` · ${formatCount(pending)} manşet bekliyor` : ''}.
              </>
            )}
          </p>
          <p className="text-muted mt-1 text-xs">
            Manşetler birlikte kilitlendi; hiçbiri sonradan çıkarılamaz.
          </p>
        </footer>
      </article>

      {/* ── Ziyaretçiye çağrı ── */}
      <section className="border-border bg-surface mt-6 rounded-xl border p-5 text-center">
        {actor ? (
          <>
            <p className="text-ink text-base font-bold">Sıra sende.</p>
            <p className="text-muted mt-1 text-sm">
              Kendi manşetlerini seç, kapağını kur ve paylaş.
            </p>
            <Link
              href="/app/gazete/yeni"
              className="bg-brand text-brand-fg focus-visible:outline-ink mt-4 inline-flex min-h-11 items-center rounded-lg px-5 font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Gazeteni kur
            </Link>
          </>
        ) : (
          <>
            <p className="text-ink text-base font-bold">Sen ne diyorsun?</p>
            <p className="text-muted mt-1 text-sm">
              Katıl, tahminini yap ve sonucu birlikte görelim. Gerçek para yok.
            </p>
            {/*
              `ref` gazetenin jetonunu taşır: kaydolan kişinin hangi kapaktan
              geldiği yalnızca SAYI olarak işlenir. Kim olduğu kaydedilmez.
            */}
            <Link
              href={`/register?ref=${encodeURIComponent(token)}&next=${encodeURIComponent(`/g/${token}`)}`}
              className="bg-brand text-brand-fg focus-visible:outline-ink mt-4 inline-flex min-h-11 items-center rounded-lg px-5 font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Katıl ve tahminini yap
            </Link>
            <p className="text-muted mt-3 text-xs">
              Zaten üye misin?{' '}
              <Link
                href={`/login?next=${encodeURIComponent(`/g/${token}`)}`}
                className="text-brand font-semibold"
              >
                Giriş yap
              </Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
