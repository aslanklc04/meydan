import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentActor } from '@/server/auth';
import { rankingService } from '@/server/modules/ranking/service';
import Link from 'next/link';
import { timeRemaining } from '@/features/predictions/labels';
import { EmptyState } from '@/components/feedback/EmptyState';
import { brand } from '@/config';
import { formatCount } from '@/lib/utils';

export const metadata: Metadata = { title: brand.nav.trending, robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Gündem — insanların ŞU AN neyi tahmin ettiği.
 * Sıralama basit ve açıklanabilir: son aktivite + Meydan Okuma ağırlıklı.
 */
export default async function TrendingPage() {
  const actor = await currentActor();
  if (!actor) redirect('/login');

  const trending = await rankingService.getTrending(15);

  return (
    <main className="space-y-5">
      <div>
        <h1 className="text-ink text-xl font-bold">
          <span aria-hidden="true">🔥 </span>
          {brand.nav.trending}
        </h1>
        <p className="text-muted mt-1 text-sm">
          Son 24 saatte en çok tahmin edilen ve Meydan Okunan etkinlikler. Sıralama basittir ve
          gerçek hareketten hesaplanır.
        </p>
      </div>

      {trending.length === 0 ? (
        <EmptyState
          icon="🔥"
          title="Gündem henüz oluşmadı."
          hint="Gündem, son 24 saatteki tahmin ve Meydan Okuma hareketinden oluşur. İlk hareketi sen başlat."
          action={{ href: '/app/feed', label: 'Tahmin yapmaya başla' }}
        />
      ) : (
        <ol className="space-y-3">
          {trending.map((t) => (
            <li key={t.eventId}>
              <Link href={`/event/${t.slug}`} className="border-border block rounded-xl border p-4">
                <div className="text-muted flex items-center gap-2 text-xs">
                  <span className="text-ink font-bold">#{t.rank}</span>
                  <span aria-hidden="true">{t.categoryIcon}</span>
                  <span>{t.categoryName}</span>
                  <span aria-hidden="true">·</span>
                  <span>Kapanmasına {timeRemaining(t.closesAt)}</span>
                </div>
                <p className="text-ink mt-2 text-base font-bold">{t.title}</p>
                <p className="text-muted text-sm">{t.question}</p>
                <p className="text-ink mt-2 text-sm font-semibold">
                  {formatCount(t.predictionCount)} tahmin
                  {t.challengeCount > 0 &&
                    ` · ${formatCount(t.challengeCount)} ${brand.challengeNoun}`}
                </p>
                <p className="text-muted text-xs">
                  Son 24 saatte {t.recentPredictions + t.recentChallenges} hareket
                </p>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
