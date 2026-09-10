import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentActor } from '@/server/auth';
import { catalogService } from '@/server/modules/catalog/service';
import { consensusService } from '@/server/modules/catalog/consensus.service';
import { profileService } from '@/server/modules/social/profile.service';
import { EventCard } from '@/features/events/components/EventCard';
import { FinancialDisclaimer } from '@/components/disclaimers/FinancialDisclaimer';
import { timeRemaining } from '@/features/predictions/labels';
import { brand } from '@/config';
import { formatCount, formatPercent } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** SEO — public etkinlik sayfası arama motorlarında görünür. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await catalogService.getPublicEvent(slug, null);
  if (!event) return { title: 'Etkinlik bulunamadı' };

  const title = event.title;
  const description =
    event.status === 'RESOLVED' && event.resolvedOutcomeLabel
      ? `${event.question} Sonuç: ${event.resolvedOutcomeLabel}. ${formatCount(event.predictionCount)} tahmin.`
      : `${event.question} ${formatCount(event.predictionCount)} kişi tahminini ortaya koydu.`;

  return {
    title,
    description,
    alternates: { canonical: `/event/${event.slug}` },
    openGraph: {
      type: 'article',
      title,
      description,
      url: `/event/${event.slug}`,
      siteName: brand.appName,
      locale: 'tr_TR',
    },
    twitter: { card: 'summary', title, description },
  };
}

export default async function PublicEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await currentActor();
  const event = await catalogService.getPublicEvent(slug, actor?.id ?? null);
  if (!event) notFound();

  /*
   * Dağılım TEK KARAR NOKTASINDAN geçer. Sayfa kendi yüzdesini hesaplasaydı
   * (ve hesaplıyordu) "önce sen söyle" ve "düşük örneklemde yüzde yok"
   * kuralları burada sessizce delinirdi — canlıda tam olarak bu oldu.
   */
  const consensus = await consensusService.view(event.id, event.myOutcomeId);

  const topPredictors = await profileService.topPredictorsForEvent(event.id);
  const myOutcomeLabel = event.outcomes.find((o) => o.id === event.myOutcomeId)?.label ?? null;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <p className="text-muted text-xs">
        <span aria-hidden="true">{event.categoryIcon} </span>
        {event.categoryName}
      </p>
      <h1 className="text-ink mt-1 text-2xl font-bold">{event.title}</h1>
      <p className="text-foreground mt-2 text-base">{event.question}</p>

      <p className="text-muted mt-3 text-sm">
        {event.status === 'RESOLVED'
          ? 'Sonuçlandı'
          : event.status === 'VOID'
            ? 'Bu etkinlik iptal edildi.'
            : event.isOpen
              ? `Kapanışa ${timeRemaining(event.closesAt)}`
              : 'Tahminler kapandı, sonuç bekleniyor.'}
        {' · '}
        {formatCount(event.predictionCount)} tahmin · {formatCount(event.challengeCount)}{' '}
        {brand.challengeNoun}
      </p>

      {event.isFinancial && (
        <div className="mt-4">
          <FinancialDisclaimer />
        </div>
      )}

      {/* ── Sonuç (varsa) ── */}
      {event.status === 'RESOLVED' && event.resolvedOutcomeLabel && (
        <section className="border-border bg-surface mt-5 rounded-xl border p-4">
          <p className="text-muted text-xs">Sonuç</p>
          <p className="text-ink text-xl font-bold">{event.resolvedOutcomeLabel}</p>
          {myOutcomeLabel && (
            <p className="text-muted mt-1 text-sm">
              Senin tahminin: {myOutcomeLabel}
              {myOutcomeLabel === event.resolvedOutcomeLabel ? ' · Doğru bildin' : ' · Tutmadı'}
            </p>
          )}
        </section>
      )}

      {/* ── Dağılım ────────────────────────────────────────────────────────
          ÖNCE SEN SÖYLE. Bu bölüm daha önce dağılımı HERKESE gösteriyordu ve
          tek kişilik bir etkinlikte "%100" yazıyordu — ürünün iki kuralını
          birden çiğniyordu. Artık tek karar noktası consensusService'tir. */}
      <section className="mt-6">
        <h2 className="text-ink mb-3 text-base font-bold">Kalabalık ne diyor?</h2>

        {consensus.total === 0 ? (
          <p className="border-border rounded-xl border border-dashed p-6 text-center text-sm">
            Henüz kimse tahmin yapmadı. İlk sen ol.
          </p>
        ) : !consensus.revealed ? (
          <p className="border-border rounded-xl border border-dashed p-6 text-center text-sm">
            {formatCount(consensus.total)} kişi tahmin yaptı.
            <br />
            <span aria-hidden="true">🔒 </span>
            Dağılımı görmek için önce tarafını seç.
          </p>
        ) : consensus.shares === null ? (
          /* Eşik altında YÜZDE DEĞİL KESİR. "%100" arkasında tek kişi varken
             teknik olarak doğru, iletişim olarak sahtedir: yüzde işareti bir
             kalabalık ima eder. "1 kişiden 1'i" ise hem dürüst hem daha çok
             bilgi taşır — örneklemi saklamaz, söyler. */
          <ul className="space-y-2">
            {event.outcomes.map((o) => {
              const count = consensus.counts.find((c) => c.outcomeId === o.id)?.count ?? 0;
              return (
                <li key={o.id} className="border-border rounded-lg border px-3 py-3">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-ink flex items-center gap-2 font-medium">
                      {o.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={o.imageUrl}
                          alt=""
                          aria-hidden="true"
                          width={24}
                          height={24}
                          loading="lazy"
                          className="h-6 w-6 shrink-0 object-contain"
                        />
                      )}
                      {o.label}
                      {o.id === event.myOutcomeId && (
                        <span className="text-brand text-xs">senin tahminin</span>
                      )}
                    </span>
                    <span className="text-ink font-bold">
                      {count === 0
                        ? '—'
                        : `${formatCount(consensus.total)} kişiden ${formatCount(count)}'i`}
                    </span>
                  </div>
                </li>
              );
            })}
            <li className="text-muted px-1 pt-1 text-xs">
              Yüzde, yeterli tahmin toplandığında gösterilir. Küçük sayıda yüzde yanıltır.
            </li>
          </ul>
        ) : (
          <ul className="space-y-2">
            {event.outcomes.map((o) => {
              const share = (consensus.shares ?? []).find((x) => x.outcomeId === o.id)?.share ?? 0;
              return (
                <li key={o.id} className="border-border rounded-lg border px-3 py-3">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-ink flex items-center gap-2 font-medium">
                      {o.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={o.imageUrl}
                          alt=""
                          aria-hidden="true"
                          width={24}
                          height={24}
                          loading="lazy"
                          className="h-6 w-6 shrink-0 object-contain"
                        />
                      )}
                      {o.label}
                      {o.id === event.myOutcomeId && (
                        <span className="text-brand text-xs">senin tahminin</span>
                      )}
                    </span>
                    <span className="text-ink font-bold">{formatPercent(share)}</span>
                  </div>
                  <div
                    className="bg-surface mt-2 h-2 w-full overflow-hidden rounded-full"
                    role="img"
                    aria-label={`${o.label}: ${formatPercent(share)}`}
                  >
                    <div
                      className="bg-brand h-full rounded-full"
                      style={{ width: `${Math.round(share * 100)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {consensus.revealed && consensus.position === 'MINORITY' && (
          <p className="text-ink mt-3 text-sm font-semibold">
            <span aria-hidden="true">🐺 </span>Azınlıktasın.
          </p>
        )}
        {consensus.revealed && consensus.position === 'MAJORITY' && (
          <p className="text-ink mt-3 text-sm font-semibold">
            <span aria-hidden="true">👥 </span>Çoğunluktasın.
          </p>
        )}
      </section>

      {/* ── Tahmin kartı / davet ── */}
      <section className="mt-6">
        {event.isOpen ? (
          actor ? (
            <EventCard
              event={{
                id: event.id,
                slug: event.slug,
                title: event.title,
                question: event.question,
                categoryIcon: event.categoryIcon,
                categoryName: event.categoryName,
                isFinancial: event.isFinancial,
                closesAt: event.closesAt.toISOString(),
                predictionCount: event.predictionCount,
                challengeCount: event.challengeCount,
                outcomes: event.outcomes.map((o) => ({ id: o.id, label: o.label })),
                myOutcomeId: event.myOutcomeId,
                myOutcomeLabel,
              }}
            />
          ) : (
            <div className="border-border rounded-xl border p-4 text-center">
              <p className="text-ink text-base font-semibold">Sen ne diyorsun?</p>
              <p className="text-muted mt-1 text-sm">
                Tahminini ortaya koymak ve birine Meydan Okumak için katıl.
              </p>
              <Link
                href="/register"
                className="bg-brand text-brand-fg mt-3 flex min-h-12 w-full items-center justify-center rounded-lg text-base font-semibold"
              >
                Meydana Katıl
              </Link>
            </div>
          )
        ) : null}
      </section>

      {/* ── En iyi tahminciler ── */}
      {topPredictors.length > 0 && (
        <section className="mt-6">
          <h2 className="text-ink mb-3 text-base font-bold">
            <span aria-hidden="true">🧠 </span>Bu etkinlikte {brand.ratingName} en yüksek olanlar
          </h2>
          <ul className="space-y-2">
            {topPredictors.map((p) => (
              <li
                key={p.username}
                className="border-border flex items-center justify-between rounded-lg border px-3 py-3 text-sm"
              >
                <Link href={`/u/${p.username}`} className="text-ink font-medium">
                  @{p.username}
                </Link>
                <span className="text-muted">
                  {event.status === 'RESOLVED' ? `${p.outcomeLabel} · ` : ''}
                  {Math.round(Number(p.power ?? 0))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
