import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentActor } from '@/server/auth';
import { socialService } from '@/server/modules/social/service';
import { rankingService } from '@/server/modules/ranking/service';
import { enforceSharedRateLimit } from '@/server/security/shared-rate-limit';
import { EmptyState } from '@/components/feedback/EmptyState';
import { formatCount } from '@/lib/utils';

export const metadata: Metadata = { title: 'Ara', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Arama ve keşif.
 *
 * BOŞ ARAMA BOŞ EKRAN DEĞİLDİR: sorgu yokken gündemdeki etkinlikler önerilir.
 * "Ne arayacağımı bilmiyorum" durumu, ürünün terk edildiği anlardan biridir.
 */
export default async function SearchPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ q?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect('/login');

  const { q } = await searchParams;
  const query = (q ?? '').trim();

  let results: Awaited<ReturnType<typeof socialService.search>> = {
    users: [],
    events: [],
    categories: [],
  };
  let limited = false;

  if (query.length >= 2) {
    try {
      await enforceSharedRateLimit('search.query', { userId: actor.id });
      results = await socialService.search(query);
    } catch {
      limited = true;
    }
  }

  const suggestions = query.length >= 2 ? [] : await rankingService.getTrending(5);
  const nothingFound =
    query.length >= 2 &&
    !limited &&
    results.users.length === 0 &&
    results.events.length === 0 &&
    results.categories.length === 0;

  return (
    <main className="space-y-5">
      <h1 className="text-ink text-xl font-bold">Ara</h1>

      <form action="/app/search" role="search" className="flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="@kullanıcı ya da etkinlik"
          aria-label="Kullanıcı veya etkinlik ara"
          autoComplete="off"
          className="border-border bg-background text-foreground focus-visible:outline-brand min-h-12 flex-1 rounded-lg border px-3 text-base focus-visible:outline-2"
        />
        <button
          type="submit"
          className="bg-brand text-brand-fg focus-visible:outline-ink min-h-12 rounded-lg px-5 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Ara
        </button>
      </form>

      {limited && (
        <p role="alert" className="text-incorrect text-sm">
          Çok hızlı arıyorsun. Biraz bekleyip tekrar dene.
        </p>
      )}

      {query.length > 0 && query.length < 2 && (
        <p className="text-muted text-sm">Aramak için en az iki harf yaz.</p>
      )}

      {nothingFound && (
        <EmptyState
          icon="🔍"
          title={`"${query}" için sonuç yok.`}
          hint="Yazımı kontrol edebilir ya da gündeme göz atabilirsin."
          action={{ href: '/app/trending', label: 'Gündeme bak' }}
        />
      )}

      {query.length >= 2 && !limited && !nothingFound && (
        <>
          {results.users.length > 0 && (
            <section>
              <h2 className="text-ink mb-2 text-base font-bold">Kullanıcılar</h2>
              <ul className="space-y-2">
                {results.users.map((u) => (
                  <li key={u.username}>
                    <Link
                      href={`/u/${u.username}`}
                      className="border-border flex min-h-14 items-center justify-between rounded-lg border px-3"
                    >
                      <span className="text-ink text-sm font-semibold">@{u.username}</span>
                      <span className="text-muted text-sm">
                        <span aria-hidden="true">🧠 </span>
                        {Math.round(Number(u.power ?? 40))}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.events.length > 0 && (
            <section>
              <h2 className="text-ink mb-2 text-base font-bold">Etkinlikler</h2>
              <ul className="space-y-2">
                {results.events.map((e) => (
                  <li key={e.slug}>
                    <Link
                      href={`/event/${e.slug}`}
                      className="border-border block rounded-lg border px-3 py-3"
                    >
                      <p className="text-ink text-sm font-semibold">{e.title}</p>
                      <p className="text-muted text-xs">
                        {e.question} · {formatCount(e.predictionCount)} tahmin
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.categories.length > 0 && (
            <section>
              <h2 className="text-ink mb-2 text-base font-bold">Kategoriler</h2>
              <ul className="flex flex-wrap gap-2">
                {results.categories.map((c) => (
                  <li key={c.slug}>
                    <Link
                      href={`/app/leaderboard?kategori=${c.slug}`}
                      className="border-border text-ink flex min-h-11 items-center rounded-full border px-4 text-sm font-medium"
                    >
                      <span aria-hidden="true">{c.icon} </span>
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* ── Sorgu yokken: keşif ── */}
      {query.length < 2 && (
        <section>
          <h2 className="text-ink mb-2 text-base font-bold">
            <span aria-hidden="true">🔥 </span>Şu an gündemde
          </h2>
          {suggestions.length === 0 ? (
            <EmptyState
              title="Gündem henüz oluşmadı."
              hint="İlk tahminleri sen yap, gündemi sen belirle."
              action={{ href: '/app/feed', label: 'Akışa git' }}
            />
          ) : (
            <ul className="space-y-2">
              {suggestions.map((t) => (
                <li key={t.eventId}>
                  <Link
                    href={`/event/${t.slug}`}
                    className="border-border block rounded-lg border px-3 py-3"
                  >
                    <p className="text-ink text-sm font-semibold">{t.title}</p>
                    <p className="text-muted text-xs">{formatCount(t.predictionCount)} tahmin</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
