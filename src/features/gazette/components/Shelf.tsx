import Link from 'next/link';
import type { ShelfEntry } from '@/server/modules/gazette/service';
import { formatCount } from '@/lib/utils';
import { timeRemaining } from '@/features/predictions/labels';

/**
 * GAZETE RAFI — ana sayfada herkese açık kapaklar.
 *
 * ── KÜÇÜK SAYIDA "EN ÇOK" DENMEZ ───────────────────────────────────────────
 * Üç kapaklı bir listeye "en çok tutanlar" demek, arkasında bir yarış varmış
 * izlenimi verir. Yoktur. Bu yüzden başlıklar sıralama iddiası taşımaz ve
 * altında kaç kapak olduğu dürüstçe yazılır. Aynı karar konsensüs yüzdesi
 * için de verilmişti: sayı küçükken sayının kendisi gösterilir.
 *
 * ── BOŞ RAF HİÇ GÖRÜNMEZ ───────────────────────────────────────────────────
 * "Henüz kapak yok" yazan bir bölüm, ana sayfayı ıssız gösterir ve
 * ziyaretçiye yapabileceği bir şey söylemez. Boşsa bölüm hiç çizilmez.
 */
export function Shelf({
  title,
  hint,
  entries,
  show,
}: {
  readonly title: string;
  readonly hint: string;
  readonly entries: readonly ShelfEntry[];
  /** Satırda hangi bilginin öne çıkacağı — rafın amacına göre değişir. */
  readonly show: 'time' | 'countdown' | 'record';
}) {
  if (entries.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="text-ink text-lg font-bold">{title}</h2>
      <p className="text-muted mt-0.5 mb-3 text-xs">
        {hint}
        <span aria-hidden="true"> · </span>
        {formatCount(entries.length)} kapak
      </p>

      <ul className="space-y-2">
        {entries.map((g) => (
          <li key={g.publicToken}>
            <Link
              href={`/g/${g.publicToken}`}
              className="border-border hover:border-brand focus-visible:outline-ink block rounded-xl border px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <p className="text-ink text-sm font-bold text-balance">{g.title}</p>
              <p className="text-muted mt-1 text-xs">
                @{g.ownerUsername}
                <span aria-hidden="true"> · </span>
                {formatCount(g.headlineCount)} manşet
                <span aria-hidden="true"> · </span>
                {show === 'countdown' && g.nextResolvesAt ? (
                  <>Sonuca {timeRemaining(g.nextResolvesAt)}</>
                ) : show === 'record' ? (
                  /* KARNENİN TAMAMI. Yalnızca isabetleri yazmak, kapağın
                     kusursuz olduğu izlenimini verirdi. */
                  <>
                    {formatCount(g.settled)} sonuçtan{' '}
                    <strong className="text-ink">{formatCount(g.hits)}</strong> tuttu
                  </>
                ) : (
                  <>{g.publishedDay}</>
                )}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
