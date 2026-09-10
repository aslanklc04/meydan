import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentActor } from '@/server/auth';
import { coinService } from '@/server/modules/economy/service';
import { predictionService } from '@/server/modules/prediction/service';
import { profileService } from '@/server/modules/social/profile.service';
import { logoutAction } from '@/features/auth/actions';
import { StatStrip } from '@/features/profiles/components/StatStrip';
import { EmptyState } from '@/components/feedback/EmptyState';
import { predictionResultLabel, predictionStatusLabel } from '@/features/predictions/labels';
import { brand } from '@/config';
import { formatCount } from '@/lib/utils';

export const metadata: Metadata = { title: brand.nav.profile, robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Kendi profilin.
 *
 * Public profille AYNI istatistik şeridini kullanır: kullanıcı başkalarının
 * kendisini nasıl gördüğünü görür. Farkı, buraya bakiye, çıkış ve public
 * profile giden bağlantının eklenmesidir.
 */
export default async function ProfilePage() {
  const actor = await currentActor();
  if (!actor) redirect('/login');

  const [profile, balance, recent, challengeStats, expertise, badges] = await Promise.all([
    profileService.getByUsername(actor.username),
    coinService.getBalance(actor.id),
    predictionService.listForUser(actor.id, 10),
    profileService.challengeStats(actor.id),
    profileService.expertise(actor.id),
    profileService.badges(actor.id),
  ]);

  if (!profile) redirect('/login');

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-ink text-xl font-bold">@{actor.username}</h1>
        <Link href={`/u/${actor.username}`} className="text-brand text-sm underline">
          Herkese açık profilini gör
        </Link>
      </header>

      {/* ── Gümüş Çip ── */}
      <section
        role="group"
        aria-label={brand.currencyName}
        className="border-border rounded-xl border p-4"
      >
        <p className="text-muted text-xs">
          <span aria-hidden="true">🪙 </span>
          {brand.currencyName}
        </p>
        <p data-stat-value className="text-ink text-3xl font-bold">
          {formatCount(balance)}
        </p>
        <p className="text-muted mt-1 text-xs">
          {brand.currencyName} oyun içi bir puandır. Gerçek para değildir; nakde çevrilemez, gerçek
          parayla satın alınamaz.
        </p>
      </section>

      <StatStrip
        power={profile.power}
        completed={profile.completed}
        correct={profile.correct}
        rawAccuracy={profile.rawAccuracy}
        challengeTotal={challengeStats.total}
        challengeWins={challengeStats.wins}
        followerCount={profile.followerCount}
        followingCount={profile.followingCount}
        last30={profile.last30}
      />

      {/* ── Rozetler ── */}
      <section>
        <h2 className="text-ink mb-3 text-base font-bold">
          <span aria-hidden="true">🏅 </span>Rozetlerin
        </h2>
        {badges.length === 0 ? (
          <EmptyState
            title="Henüz rozetin yok."
            hint="Doğru tahminler ve kazanılan Meydan Okumalar rozet getirir."
            action={{ href: '/app/feed', label: 'Tahmin yap' }}
          />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {badges.map((b) => (
              <li key={b.slug} className="border-border rounded-lg border p-3">
                <p className="text-2xl" aria-hidden="true">
                  {b.icon}
                </p>
                <p className="text-ink mt-1 text-sm font-semibold">{b.name}</p>
                <p className="text-muted text-xs">{b.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Kategori uzmanlığı ── */}
      {expertise.length > 0 && (
        <section>
          <h2 className="text-ink mb-3 text-base font-bold">
            <span aria-hidden="true">🎓 </span>Kategori Uzmanlığın
          </h2>
          <ul className="space-y-2">
            {expertise.map((c) => (
              <li
                key={c.slug}
                className="border-border flex items-center justify-between rounded-lg border px-3 py-3"
              >
                <span className="text-ink text-sm font-medium">
                  <span aria-hidden="true">{c.icon} </span>
                  {c.name}
                  {c.isExpert && (
                    <span className="text-brand ml-2 text-xs">
                      <span aria-hidden="true">🏆 </span>
                      {brand.expertSuffix}
                    </span>
                  )}
                </span>
                <span className="text-ink text-sm font-bold">{Math.round(c.power)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Son tahminler ── */}
      <section>
        <h2 className="text-ink mb-3 text-base font-bold">Son Tahminlerin</h2>
        {recent.length === 0 ? (
          <EmptyState
            title="Henüz tahmin yapmadın."
            hint="Bir sonuç seç, tahminini yap. Sonucu burada takip edersin."
            action={{ href: '/app/feed', label: 'İlk tahminini yap' }}
          />
        ) : (
          <ul className="space-y-2">
            {recent.map((p) => (
              <li key={p.id} className="border-border rounded-lg border px-3 py-3 text-sm">
                <p className="text-ink font-medium">{p.eventTitle}</p>
                <p className="text-muted mt-1">
                  {p.outcomeLabel} ·{' '}
                  {p.result ? predictionResultLabel[p.result] : predictionStatusLabel[p.status]}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-2">
        <Link
          href="/app/welcome"
          className="border-border text-ink flex min-h-12 w-full items-center justify-center rounded-lg border text-sm font-semibold"
        >
          İlgi alanlarını düzenle
        </Link>
      </div>

      {/*
        HESAP bölümü ayrı bir başlık altında. Önceden çıkış düğmesi, diğer
        bağlantıların arasında ve soluk renkte duruyordu; kullanıcı bulamadı.
        Aynı görünüme sahip düğmeler arasında duran bir eylem, aranmadığı
        sürece görünmez.
      */}
      <section aria-labelledby="hesap-baslik" className="border-border mt-6 border-t pt-5">
        <h2 id="hesap-baslik" className="text-ink text-base font-bold">
          Hesap
        </h2>
        <p className="text-muted mt-1 mb-3 text-sm">
          Oturumun bu tarayıcıda açık. Ortak bir bilgisayardaysan çıkış yapmayı unutma.
        </p>
        <form action={logoutAction}>
          <button
            type="submit"
            className="border-border text-ink focus-visible:outline-ink min-h-12 w-full rounded-lg border text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span aria-hidden="true">⏻ </span>Oturumu kapat
          </button>
        </form>
      </section>
    </main>
  );
}
