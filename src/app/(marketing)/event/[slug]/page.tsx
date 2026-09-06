import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentActor } from '@/server/auth';
import { catalogService } from '@/server/modules/catalog/service';
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

      {/* ── Dağılım ── */}
      <section className="mt-6">
        <h2 className="text-ink mb-3 text-base font-bold">Kalabalık ne diyor?</h2>
        {event.predictionCount === 0 ? (
          <p className="border-border rounded-xl border border-dashed p-6 text-center text-sm">
            Henüz kimse tahmin yapmadı. İlk sen ol.
          </p>
        ) : (
          <ul className="space-y-2">
            {event.outcomes.map((o) => (
              <li key={o.id} className="border-border rounded-lg border px-3 py-3">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-ink font-medium">
                    {o.label}
                    {o.id === event.myOutcomeId && (
                      <span className="text-brand ml-2 text-xs">senin tahminin</span>
                    )}
                  </span>
                  <span className="text-ink font-bold">{formatPercent(o.share)}</span>
                </div>
                <div
                  className="bg-surface mt-2 h-2 w-full overflow-hidden rounded-full"
                  role="img"
                  aria-label={`${o.label}: ${formatPercent(o.share)}`}
                >
                  <div
                    className="bg-brand h-full rounded-full"
                    style={{ width: `${Math.round(o.share * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
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
