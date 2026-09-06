import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentActor } from '@/server/auth';
import { rankingService } from '@/server/modules/ranking/service';
import { catalogService } from '@/server/modules/catalog/service';
import { EmptyState } from '@/components/feedback/EmptyState';
import { brand } from '@/config';

export const metadata: Metadata = { title: brand.nav.leaderboard, robots: { index: false } };
export const dynamic = 'force-dynamic';

const PERIODS = [
  { key: 'WEEKLY', label: 'Haftalık' },
  { key: 'MONTHLY', label: 'Aylık' },
  { key: 'SEASON', label: 'Sezon' },
  { key: 'ALL_TIME', label: 'Tüm Zamanlar' },
] as const;

type Period = (typeof PERIODS)[number]['key'];

export default async function LeaderboardPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ period?: string; kategori?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect('/login');

  const sp = await searchParams;
  const period = (PERIODS.find((p) => p.key === sp.period)?.key ?? 'ALL_TIME') as Period;
  const categorySlug = sp.kategori;

  const [board, categories, standing] = await Promise.all([
    rankingService.getLeaderboard(categorySlug ? { period, categorySlug } : { period }),
    catalogService.listCategories(),
    rankingService.viewerStanding(
      categorySlug ? { period, categorySlug, userId: actor.id } : { period, userId: actor.id },
    ),
  ]);

  const qs = (next: { period?: string; kategori?: string }) => {
    const p = new URLSearchParams();
    p.set('period', next.period ?? period);
    if (next.kategori) p.set('kategori', next.kategori);
    return `/app/leaderboard?${p.toString()}`;
  };

  return (
    <main className="space-y-5">
      <h1 className="text-ink text-xl font-bold">
        <span aria-hidden="true">🏆 </span>
        {brand.nav.leaderboard}
      </h1>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={qs({ period: p.key, ...(categorySlug ? { kategori: categorySlug } : {}) })}
            className={[
              'min-h-11 shrink-0 rounded-full px-4 text-sm leading-[2.75rem] font-semibold',
              p.key === period ? 'bg-brand text-brand-fg' : 'border-border text-ink border',
            ].join(' ')}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
        <Link
          href={qs({ period })}
          className={[
            'min-h-10 shrink-0 rounded-full px-3 text-xs leading-10 font-medium',
            !categorySlug ? 'bg-ink text-background' : 'border-border text-muted border',
          ].join(' ')}
        >
          Genel
        </Link>
        {categories.map((c) => (
          <Link
            key={c.slug}
            href={qs({ period, kategori: c.slug })}
            className={[
              'min-h-10 shrink-0 rounded-full px-3 text-xs leading-10 font-medium',
              categorySlug === c.slug
                ? 'bg-ink text-background'
                : 'border-border text-muted border',
            ].join(' ')}
          >
            <span aria-hidden="true">{c.icon} </span>
            {c.name}
          </Link>
        ))}
      </div>

      {/* ── Kullanıcının kendi yeri — liste ilk 50'yi gösterir, kendi sırası ayrı okunur ── */}
      {standing && (
        <section
          aria-label="Senin durumun"
          className="border-brand bg-surface rounded-xl border p-4"
        >
          {standing.rank !== null ? (
            <>
              <p className="text-ink text-lg font-bold">Sen #{standing.rank}&apos;sin</p>
              <p className="text-muted mt-1 text-sm">
                {standing.total} kişilik listede. Doğru tahminler sıranı yukarı taşır.
              </p>
            </>
          ) : standing.belowThreshold ? (
            <>
              <p className="text-ink text-base font-semibold">Henüz listede değilsin.</p>
              <p className="text-muted mt-1 text-sm">
                Listeye girmek için {standing.minPredictions} tahminin sonuçlanmalı. Şu an{' '}
                {standing.completed} tanesi sonuçlandı —{' '}
                {standing.minPredictions - standing.completed} tane kaldı.
              </p>
            </>
          ) : (
            <>
              <p className="text-ink text-base font-semibold">Bu dönem listeye giremedin.</p>
              <p className="text-muted mt-1 text-sm">
                Eşiği geçtin ama sıralaman ilk 100&apos;ün dışında kaldı. Bir sonraki dönemde
                yeniden hesaplanacak.
              </p>
            </>
          )}
        </section>
      )}

      {board.entries.length === 0 ? (
        <EmptyState
          title="Bu liste henüz oluşmadı."
          hint={`Liderliğe girmek için en az ${board.minPredictions || 20} tahminin sonuçlanması gerekir. Sen de bir tahminle başlayabilirsin.`}
          action={{ href: '/app/feed', label: 'Tahmin yapmaya başla' }}
        />
      ) : (
        <>
          <ol className="space-y-2">
            {board.entries.map((e) => (
              <li
                key={e.username}
                className={[
                  'flex items-center gap-3 rounded-lg border px-3 py-3',
                  e.username === actor.username ? 'border-brand bg-surface' : 'border-border',
                ].join(' ')}
              >
                <span className="text-muted w-7 text-center text-sm font-bold">{e.rank}</span>
                <Link href={`/u/${e.username}`} className="flex-1">
                  <p className="text-ink text-sm font-semibold">@{e.username}</p>
                  <p className="text-muted text-xs">
                    {e.correct}/{e.completed} doğru
                  </p>
                </Link>
                <span className="text-ink text-lg font-bold">{Math.round(Number(e.power))}</span>
              </li>
            ))}
          </ol>
          <p className="text-muted text-center text-xs">
            Listeye girmek için en az {board.minPredictions} sonuçlanmış tahmin gerekir.
          </p>
        </>
      )}
    </main>
  );
}
