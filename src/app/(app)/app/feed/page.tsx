import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentActor } from '@/server/auth';
import { catalogService } from '@/server/modules/catalog/service';
import { challengeService } from '@/server/modules/challenge/service';
import { reputationService } from '@/server/modules/reputation/service';
import { coinService } from '@/server/modules/economy/service';
import { socialService } from '@/server/modules/social/service';
import { onboardingService } from '@/server/modules/identity/onboarding.service';
import { gazetteService } from '@/server/modules/gazette/service';
import { predictionService } from '@/server/modules/prediction/service';
import { ResultCard } from '@/features/share/components/ResultCard';
import { ResultRow } from '@/features/results/components/ResultRow';
import { EventCard } from '@/features/events/components/EventCard';
import { ChallengeCard } from '@/features/challenges/components/ChallengeCard';
import { EmptyState } from '@/components/feedback/EmptyState';
import { brand } from '@/config';
import { formatCount } from '@/lib/utils';

export const metadata: Metadata = { title: brand.nav.feed, robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Akış — ürünün ana ekranı.
 *
 * ÜÇ SANİYE KURALI: kullanıcı bu ekrana girdiğinde ne yapabileceğini okumadan
 * anlamalı. Bunun için sıra bilinçli:
 *   1. Sana gelen Meydan Okumalar — cevap bekleyen bir çağrı varsa her şeyin önünde.
 *   2. Tahmin edilecek etkinlikler — ürünün ASIL eylemi; kart üzerinde
 *      "Tahmin Et" ve "Meydan Oku" birlikte durur.
 *   3. Takip ettiklerin ve açık meydanlar — keşif katmanı, en sonda.
 * Faz 4'te sosyal akış etkinliklerin ÜSTÜNDEYDİ; yeni kullanıcıda bu bölüm boş
 * olduğu için ekran "yapılacak bir şey yok" hissi veriyordu.
 */
export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ akis?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect('/login');

  // Karşılama ekranı BİR KEZ gösterilir; "atla" da tamamlanmış sayılır.
  if (await onboardingService.needsOnboarding(actor.id)) redirect('/app/welcome');

  const { akis } = await searchParams;
  const interests = await onboardingService.interestCategoryIds(actor.id);

  const [events, incoming, open, rating, balance, social, gazetteEligible, results, allResults] =
    await Promise.all([
      catalogService.listOpenEvents(actor.id, 20, undefined, interests),
      challengeService.listIncoming(actor.id),
      challengeService.listOpen(actor.id),
      reputationService.getSummary(actor.id),
      coinService.getBalance(actor.id),
      socialService.feed(actor.id, akis ? { limit: 10, cursor: akis } : { limit: 10 }),
      gazetteService.eligible(actor.id),
      /*
       * PENCERE 3 GÜN DEĞİL 7 GÜN.
       *
       * Üç gün, hafta içi girmeyen bir kullanıcı için yetmiyordu: cumartesi
       * oynanan maçın sonucunu salı günü giren kişi HİÇ görmüyordu. Ürünün
       * verdiği tek söz "sonucu göreceksin" iken, o sözü tutmayan pencereyi
       * savunmanın bir yolu yok.
       *
       * Satır sayısı yine 5'te kalıyor: pencere uzadı diye ekranın tepesi
       * geçmişle dolmasın — asıl eylem hâlâ yeni tahmin.
       */
      predictionService.recentResults(actor.id, 24 * 7),
      /*
       * BİTEN MEYDANLAR — TAHMİN ETMEDİKLERİN DE DÂHİL.
       *
       * Yukarıdaki sorgu yalnızca KENDİ tahminlerini getirir. Bu, akıştan
       * geçen ama tahmin edilmeyen her maçın sonucunun kullanıcı için
       * sonsuza kadar kaybolması demekti: maç akışta görünüyor, kapanıyor,
       * listeden düşüyor ve bir daha hiçbir yerde görünmüyordu.
       *
       * Sonuç listesini önce ana sayfaya ve /sonuclar'a koydum; oysa giriş
       * yapmış kullanıcı ana sayfayı GÖRMÜYOR — burada yaşıyor. Aynı hatayı
       * (düzenlediğim sayfayı düzeltip kullanıcının kullandığı sayfayı
       * atlamak) dördüncü kez yaptım; bu satır o hatanın kaydıdır.
       */
      catalogService.resultsBoard(7, 12),
    ]);

  const isNewUser = rating.completed === 0;
  const gazetteReady = gazetteEligible.length;

  /*
   * AYNI MAÇ İKİ KEZ GÖSTERİLMEZ.
   *
   * Kendi tahminin varsa maç yukarıda "Ben demiştim" kartı olarak zaten
   * duruyor; aşağıdaki listede tekrar çıkması ekranı olduğundan dolu
   * gösterirdi. Ana sayfada gazete raflarında tam olarak bu olmuştu.
   */
  const mine = new Set(results.map((r) => r.eventId));
  const otherResults = allResults.filter((r) => !mine.has(r.id)).slice(0, 5);

  return (
    <main className="space-y-6">
      {/*
        Her sayfada TEK bir h1 bulunur (WCAG 1.3.1 / 2.4.6). Akışın başlığı
        görsel olarak gereksiz — ekranda zaten marka ve gezinme var — ama
        ekran okuyucu için sayfanın ne olduğunu söyleyen bir çıpa gerekir.
      */}
      <h1 className="sr-only">{brand.nav.feed}</h1>

      {isNewUser && (
        <section className="border-brand bg-surface rounded-xl border p-4">
          <p className="text-ink text-base font-semibold">Hoş geldin, @{actor.username}</p>
          <p className="text-muted mt-1 text-sm">
            <span aria-hidden="true">🪙 </span>
            {formatCount(balance)} {brand.currencyName} · <span aria-hidden="true">🧠 </span>
            {brand.ratingName} {Math.round(rating.power)}
          </p>
          <p className="text-foreground mt-2 text-sm">
            Aşağıdan bir sonuç seç, tahminini yap. İstersen aynı tahminle birine Meydan Oku.
          </p>
        </section>
      )}

      {/*
        GAZETE ÇAĞRISI — yalnızca kurabilecek kişiye gösterilir.
        Hiç açık tahmini olmayan birine "gazeteni kur" demek, tıklayınca boş
        bir ekrana götürmek olurdu. Bu yüzden ölçüt "tahmin yapmış olmak"
        değil, TAM OLARAK "şu an kapağa konabilecek tahmini olmak"tır.
      */}
      {gazetteReady > 0 && (
        <section className="border-border bg-surface rounded-xl border p-4">
          <p className="text-ink text-base font-semibold">
            <span aria-hidden="true">📰 </span>Gelecek Gazeteni kur
          </p>
          <p className="text-muted mt-1 text-sm">
            {formatCount(gazetteReady)} açık tahminin var. En çok üçünü bir kapakta topla, paylaş —
            arkadaşların sonucu görmek için geri gelir.
          </p>
          <Link
            href="/app/gazete/yeni"
            className="bg-brand text-brand-fg focus-visible:outline-ink mt-3 inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Kapağımı kur
          </Link>
        </section>
      )}

      {/* ── SONUÇLANDI — dönüş döngüsünün kapandığı yer ───────────────────
          Kullanıcı tahminini yapıyor, maç oynanıyor, sonuç geliyordu ve
          akışta hiçbir şey değişmiyordu. Ürünün verdiği tek söz "sonucu
          göreceksin"di; sonucun görüneceği bir yer yoktu.

          EN ÜSTTE, çünkü kullanıcı akışa girdiğinde ilk merak ettiği şey
          bu. Bekleyen bir çağrı varsa o daha acildir; sonuçlar hemen
          altında durur. */}
      {results.length > 0 && (
        <section aria-labelledby="sonuc-baslik">
          <h2 id="sonuc-baslik" className="text-ink mb-1 text-lg font-bold">
            <span aria-hidden="true">🏁 </span>Sonuçlandı
          </h2>
          <p className="text-muted mb-3 text-sm">Son yedi günde kapanan tahminlerin.</p>
          <div className="space-y-3">
            {results.map((r) => (
              <ResultCard
                key={r.predictionId}
                data={{
                  eventId: r.eventId,
                  eventSlug: r.eventSlug,
                  eventTitle: r.eventTitle,
                  question: r.eventQuestion,
                  myOutcomeLabel: r.myOutcomeLabel,
                  resultOutcomeLabel: r.resolvedOutcomeLabel,
                  correct: r.correct,
                }}
              />
            ))}
          </div>
          {/* Sonucu gören kişiyi YENİ TAHMİNE bağlayan cümle. Ölçtüğümüz
              davranış tam olarak bu geçiş. */}
          {/* Sonucu gören kişiyi YENİ TAHMİNE bağlayan cümle. Ölçtüğümüz
              davranış tam olarak bu geçiş. */}
          <p className="text-muted mt-3 text-sm">Sıradaki tahminin aşağıda seni bekliyor.</p>
        </section>
      )}

      {/* ── BİTEN MEYDANLAR — tahmin etmediklerin de ──────────────────────
          Akıştan geçen bir maçı tahmin etmeyen kullanıcı, o maçın sonucunu
          HİÇBİR YERDE göremiyordu: maç kapanıyor, açık listeden düşüyor ve
          kayboluyordu. Oysa sonucu merak etmek için tahmin etmiş olmak
          gerekmez — merak, tahminden önce gelir ve çoğu zaman tahmini o
          getirir.

          Kendi tahminlerin yukarıda; burada yalnızca ötekiler var. */}
      {otherResults.length > 0 && (
        <section aria-labelledby="biten-baslik">
          <h2 id="biten-baslik" className="text-ink mb-1 text-lg font-bold">
            <span aria-hidden="true">📋 </span>Biten meydanlar
          </h2>
          <p className="text-muted mb-3 text-sm">
            {results.length > 0
              ? 'Tahmin etmediklerin de dâhil, son yedi gün.'
              : 'Son yedi günde sonuçlananlar.'}
          </p>
          <ul className="space-y-2">
            {otherResults.map((r) => (
              <ResultRow key={r.id} data={r} />
            ))}
          </ul>
          <p className="mt-3 text-sm">
            <Link
              href="/sonuclar"
              className="text-brand focus-visible:outline-ink font-semibold underline underline-offset-4 focus-visible:outline-2"
            >
              Son 7 günün tüm sonuçları →
            </Link>
          </p>
        </section>
      )}

      {/* ── 1. Cevap bekleyen çağrılar ── */}
      {incoming.length > 0 && (
        <section aria-labelledby="gelen-baslik">
          <h2 id="gelen-baslik" className="text-ink mb-3 text-lg font-bold">
            <span aria-hidden="true">⚔️ </span>
            {brand.challengeInbox}
          </h2>
          <div className="space-y-3">
            {incoming.map((c) => (
              <ChallengeCard
                key={c.id}
                kind="incoming"
                challenge={{
                  id: c.id,
                  mode: c.mode,
                  creatorUsername: c.creatorUsername,
                  eventTitle: c.eventTitle,
                  eventQuestion: c.eventQuestion,
                  creatorOutcomeLabel: c.creatorOutcomeLabel,
                  yourOutcomeLabel: c.opponentOutcomeLabel,
                  options: c.options,
                  stakeAmount: c.stakeAmount,
                  expiresAt: c.expiresAt.toISOString(),
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── 2. ASIL EYLEM: tahmin ve Meydan Okuma ── */}
      <section aria-labelledby="etkinlik-baslik">
        <h2 id="etkinlik-baslik" className="text-ink mb-1 text-lg font-bold">
          <span aria-hidden="true">🎯 </span>Sen ne diyorsun?
        </h2>
        <p className="text-muted mb-3 text-sm">
          Bir sonuç seç, tahminini yap ya da doğrudan Meydan Oku.
        </p>

        {events.length === 0 ? (
          <EmptyState
            title="Şu an açık bir etkinlik yok."
            hint="Yeni etkinlikler eklendiğinde burada göreceksin. Bu arada gündeme göz atabilirsin."
            action={{ href: '/app/trending', label: 'Gündeme bak' }}
          />
        ) : (
          <div className="space-y-3">
            {events.map((event) => (
              <EventCard
                key={event.id}
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
                  outcomes: event.outcomes.map((o) => ({
                    id: o.id,
                    label: o.label,
                    imageUrl: o.imageUrl,
                  })),
                  myOutcomeId: event.myOutcomeId,
                  myOutcomeLabel:
                    event.outcomes.find((o) => o.id === event.myOutcomeId)?.label ?? null,
                }}
                balance={balance}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── 3. Keşif: açık meydanlar ── */}
      <section aria-labelledby="acik-baslik">
        <h2 id="acik-baslik" className="text-ink mb-3 text-lg font-bold">
          <span aria-hidden="true">⚔️ </span>Açık Meydan Okumalar
        </h2>
        {open.length === 0 ? (
          <EmptyState
            title="Şu an açık Meydan Okuma yok."
            hint="Rakip seçmeden Meydan Okursan ilk kabul eden karşına çıkar."
            action={{ href: '/app/challenges', label: brand.challengeMine }}
          />
        ) : (
          <div className="space-y-3">
            {open.slice(0, 5).map((c) => (
              <ChallengeCard
                key={c.id}
                kind="open"
                challenge={{
                  id: c.id,
                  mode: c.mode,
                  creatorUsername: c.creatorUsername,
                  eventTitle: c.eventTitle,
                  eventQuestion: c.eventQuestion,
                  creatorOutcomeLabel: c.creatorOutcomeLabel,
                  yourOutcomeLabel: c.opponentOutcomeLabel,
                  options: c.options,
                  stakeAmount: c.stakeAmount,
                  expiresAt: c.expiresAt.toISOString(),
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── 4. Keşif: takip ettiklerin ── */}
      <section aria-labelledby="takip-baslik">
        <h2 id="takip-baslik" className="text-ink mb-3 text-lg font-bold">
          <span aria-hidden="true">👥 </span>Takip Ettiklerin
        </h2>

        {social.items.length === 0 ? (
          <EmptyState
            title="Henüz kimseyi takip etmiyorsun."
            hint="İyi tahmincileri keşfet, takip et; ne yaptıklarını burada gör."
            action={{ href: '/app/leaderboard', label: 'İyi tahmincileri keşfet' }}
          />
        ) : (
          <>
            <ul className="space-y-2">
              {social.items.map((item) => (
                <li key={item.id} className="border-border rounded-lg border px-3 py-3 text-sm">
                  <p className="text-ink">
                    <Link href={`/u/${item.actorUsername}`} className="font-semibold underline">
                      @{item.actorUsername}
                    </Link>{' '}
                    {feedActionText(item.kind)}
                  </p>
                  {item.eventTitle && (
                    <p className="text-muted mt-1">
                      {item.eventSlug ? (
                        <Link href={`/event/${item.eventSlug}`} className="underline">
                          {item.eventTitle}
                        </Link>
                      ) : (
                        item.eventTitle
                      )}
                      {item.outcomeLabel ? ` · ${item.outcomeLabel}` : ''}
                    </p>
                  )}
                </li>
              ))}
            </ul>

            {social.nextCursor && (
              <Link
                href={`/app/feed?akis=${encodeURIComponent(social.nextCursor)}`}
                className="border-border text-ink mt-3 flex min-h-12 items-center justify-center rounded-lg border text-sm font-semibold"
              >
                Daha eskisini göster
              </Link>
            )}
          </>
        )}
      </section>
    </main>
  );
}

/** Akış olayının kullanıcı diline çevirisi — teknik enum ekrana çıkmaz. */
function feedActionText(
  kind: 'PREDICTION_CREATED' | 'CHALLENGE_CREATED' | 'CHALLENGE_COMPLETED',
): string {
  switch (kind) {
    case 'PREDICTION_CREATED':
      return 'tahminini ortaya koydu.';
    case 'CHALLENGE_CREATED':
      return `bir ${brand.challengeNoun} başlattı.`;
    case 'CHALLENGE_COMPLETED':
      return `bir ${brand.challengeNoun} tamamlandı.`;
  }
}
