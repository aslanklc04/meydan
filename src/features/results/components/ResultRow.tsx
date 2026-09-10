import Link from 'next/link';
import { formatCount } from '@/lib/utils';
import { socialProof } from '@/config/social-proof';
import { timeAgo } from '@/features/predictions/labels';

export type ResultRowData = {
  readonly slug: string;
  readonly title: string;
  readonly categoryName: string;
  readonly categoryIcon: string;
  readonly resolvedAt: Date | null;
  readonly predictionCount: number;
  readonly winnerLabel: string | null;
  readonly winnerImageUrl: string | null;
  readonly voided: boolean;
  /** İptal edilen etkinlikte null: "kimse bilemedi" değil, "sayılmadı". */
  readonly correctCount: number | null;
};

/**
 * SONUÇ SATIRI — herkese açık sonuç listesinin tek satırı.
 *
 * ── KİMSENİN ADI GEÇMEZ ────────────────────────────────────────────────────
 * Burada "kim bildi" değil "kaç kişi bildi" yazar. Doğru bilenlerin adını
 * herkese açık bir listede saymak, tahmini bir performans gösterisine
 * çevirir ve yanlış bilenleri de aynı listede sessizce teşhir eder.
 *
 * ── KÜÇÜK SAYIDA YÜZDE YOK ─────────────────────────────────────────────────
 * Konsensüste verdiğimiz kararın aynısı: eşiğin altında "%67" değil
 * "3 kişiden 2'si" yazılır. Yüzde örneklem büyüklüğünü saklar, kesir söyler.
 * Ürünün kendi ölçüm ekranında bile aynı kural işliyor; burada da işler.
 *
 * ── HİÇ TAHMİN YOKSA HİÇBİR ŞEY YAZILMAZ ───────────────────────────────────
 * "0 kişiden 0'ı bildi" doğru ama utanç verici bir cümledir ve bir şey
 * öğretmez. Tahmin yoksa satır yalnızca sonucu söyler.
 */
export function ResultRow({ data }: { readonly data: ResultRowData }) {
  const total = data.predictionCount;
  const hit = data.correctCount;
  const showsCount = !data.voided && hit !== null && total > 0;

  return (
    <li>
      <Link
        href={`/event/${data.slug}`}
        className="border-border hover:border-brand focus-visible:outline-ink flex items-center gap-3 rounded-xl border px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {data.winnerImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.winnerImageUrl}
            alt=""
            aria-hidden="true"
            width={32}
            height={32}
            loading="lazy"
            className="bg-background h-8 w-8 shrink-0 rounded-full object-contain"
          />
        ) : (
          <span aria-hidden="true" className="w-8 shrink-0 text-center text-xl">
            {data.voided ? '➖' : '🏁'}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-ink truncate text-sm font-semibold">{data.title}</p>

          <p className="mt-0.5 text-sm">
            {data.voided ? (
              <span className="text-muted">İptal edildi — tahminler sayılmadı</span>
            ) : (
              <span className="text-ink font-bold">
                <span className="text-muted font-normal">Sonuç: </span>
                {data.winnerLabel ?? 'Açıklandı'}
              </span>
            )}
          </p>

          <p className="text-muted mt-0.5 text-xs">
            <span aria-hidden="true">{data.categoryIcon} </span>
            {data.categoryName}
            {data.resolvedAt && (
              <>
                <span aria-hidden="true"> · </span>
                {timeAgo(data.resolvedAt)}
              </>
            )}
            {showsCount && (
              <>
                <span aria-hidden="true"> · </span>
                {total >= socialProof.minSampleForPercentage ? (
                  <>%{Math.round((hit / total) * 100)} bildi</>
                ) : (
                  <>
                    {formatCount(total)} kişiden {formatCount(hit)}&apos;i bildi
                  </>
                )}
              </>
            )}
          </p>
        </div>
      </Link>
    </li>
  );
}
