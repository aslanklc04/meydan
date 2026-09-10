'use client';

import { useState } from 'react';
import Link from 'next/link';
import { brand } from '@/config';
import { formatCount } from '@/lib/utils';

/**
 * GÜNÜN MEYDANI — ana sayfadaki etkileşimli kart (Faz 8).
 *
 * ── MİSAFİR SEÇİMİ NEDEN SUNUCUYA GİTMİYOR ─────────────────────────────────
 * Kayıt olmamış ziyaretçi taraf seçebilir, ama bu seçim VERİTABANINA
 * YAZILMAZ. Sebebi tek bir cümlede: sayaç doğru kalmalı.
 *
 * Misafir seçimleri sayılsaydı, tek bir kişi gizli sekmelerle yüzlerce "oy"
 * üretebilir ve konsensüs anlamını yitirirdi. Daha sinsisi: kimse kötü
 * niyetli olmasa bile, bir bağlantıya tıklayıp savrulan yüzlerce ziyaretçi
 * "1.284 kişi tahmin yaptı" sayısını şişirir ve o sayı artık kimsenin
 * gerçekten taraf tuttuğunu göstermez.
 *
 * Bu yüzden misafir seçimi yalnızca bu bileşenin içinde, bellekte durur.
 * Kaydolmaya gidildiğinde adres satırında taşınır — böylece kullanıcı
 * kaydolduktan sonra seçtiği tarafa geri döner ve niyeti kaybolmaz.
 *
 * ── DAĞILIM NEDEN BURADA YOK ───────────────────────────────────────────────
 * Bu bileşene topluluk dağılımı HİÇ GÖNDERİLMEZ. Gizlenmiş değil, yok:
 * misafir tahmin yapmadığı için sunucu o veriyi hiç üretmez. Gizleme
 * istemcide yapılsaydı, sayfa kaynağına bakan herkes görürdü.
 */

export type DailyOutcome = {
  readonly id: string;
  readonly label: string;
  /** Maçlarda takım arması; "Beraberlik" gibi seçeneklerde null. */
  readonly imageUrl: string | null;
};

/**
 * Arma — yüklenmezse yerine bir şey KONMAZ.
 *
 * Kırık görsel simgesi ya da "resim yok" yer tutucusu, hiç görsel
 * olmamasından kötüdür: kullanıcı bir şeyin bozuk olduğunu düşünür. Sağlayıcı
 * armayı kaldırırsa düğme sade metne döner ve hiçbir şey kırılmış görünmez.
 */
function Badge({ url, label }: { readonly url: string | null; readonly label: string }) {
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      aria-hidden="true"
      width={40}
      height={40}
      loading="lazy"
      className="h-10 w-10 shrink-0 object-contain"
      data-team={label}
    />
  );
}

export function DailyMeydan({
  slug,
  question,
  title,
  outcomes,
  total,
  closesInLabel,
  categoryIcon,
  categoryName,
}: {
  readonly slug: string;
  readonly question: string;
  readonly title: string;
  readonly outcomes: readonly DailyOutcome[];
  readonly total: number;
  readonly closesInLabel: string;
  readonly categoryIcon: string;
  readonly categoryName: string;
}) {
  const [picked, setPicked] = useState<DailyOutcome | null>(null);

  return (
    <section
      aria-labelledby="gunun-meydani"
      className="border-border bg-surface rounded-2xl border p-5 sm:p-6"
    >
      <div className="text-muted flex items-center gap-2 text-xs font-semibold tracking-wide">
        <span aria-hidden="true">🔥</span>
        <span id="gunun-meydani" className="uppercase">
          Günün Meydanı
        </span>
        <span aria-hidden="true">·</span>
        <span aria-hidden="true">{categoryIcon}</span>
        <span>{categoryName}</span>
      </div>

      <h2 className="text-ink mt-3 text-xl font-bold text-balance sm:text-2xl">{title}</h2>
      <p className="text-ink mt-1 text-base">{question}</p>

      {picked === null ? (
        <>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            {outcomes.map((outcome) => (
              <button
                key={outcome.id}
                type="button"
                onClick={() => setPicked(outcome)}
                className="border-border text-ink hover:border-brand focus-visible:outline-ink flex min-h-16 flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-base font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <Badge url={outcome.imageUrl} label={outcome.label} />
                <span className="text-center leading-tight">{outcome.label}</span>
              </button>
            ))}
          </div>

          <p className="text-muted mt-4 text-sm">
            {total > 0 ? `${formatCount(total)} kişi tahmin yaptı. ` : ''}
            <span aria-hidden="true">🔒 </span>
            Dağılımı görmek için önce tarafını seç.
          </p>
        </>
      ) : (
        <div className="mt-5">
          <div className="border-brand bg-warning-bg rounded-xl border-2 px-4 py-3">
            <p className="text-muted text-xs font-semibold uppercase">Senin tarafın</p>
            <div className="mt-1 flex items-center gap-3">
              <Badge url={picked.imageUrl} label={picked.label} />
              <p className="text-ink text-lg font-bold">{picked.label}</p>
            </div>
          </div>

          {/*
            Seçim adres satırında taşınır: kayıttan sonra kullanıcı aynı
            etkinliğe ve aynı tarafa geri döner. "Kaydol, sonra bul" akışı
            niyeti kaybettirir — gelen kişi neden geldiğini unutmaz, ama
            ürün unutturur.
          */}
          <Link
            href={`/register?next=${encodeURIComponent(`/event/${slug}?outcome=${picked.id}`)}`}
            className="bg-brand text-brand-fg focus-visible:outline-ink mt-4 flex min-h-13 items-center justify-center rounded-lg text-base font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Tahminimi kaydet
          </Link>

          <p className="text-muted mt-3 text-sm">
            Tahminini kaydeden herkes topluluğun ne dediğini görür. {brand.ratingName}&apos;n
            buradan işlemeye başlar.
          </p>

          <button
            type="button"
            onClick={() => setPicked(null)}
            className="text-muted focus-visible:outline-ink mt-2 min-h-11 text-sm underline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Seçimimi değiştir
          </button>
        </div>
      )}

      <p className="text-muted mt-4 text-xs">Tahminlere {closesInLabel} kaldı.</p>
    </section>
  );
}
