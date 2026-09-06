import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentActor } from '@/server/auth';
import { profileService } from '@/server/modules/social/profile.service';
import { socialService } from '@/server/modules/social/service';
import { FollowButton } from '@/features/profiles/components/FollowButton';
import { ProfileTabs } from '@/features/profiles/components/ProfileTabs';
import { StatStrip } from '@/features/profiles/components/StatStrip';
import { EmptyState } from '@/components/feedback/EmptyState';
import { predictionResultLabel, predictionStatusLabel } from '@/features/predictions/labels';
import { brand } from '@/config';
import { formatCount, formatPercent } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** SEO — public profil arama motorlarında görünür. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const profile = await profileService.getByUsername(username);
  if (!profile) return { title: 'Profil bulunamadı' };

  const title = `@${profile.username} — ${brand.appName} Tahmin Profili`;
  const description = `${brand.ratingName} ${Math.round(profile.power)} · ${profile.completed} tamamlanan tahmin · ${profile.correct} doğru`;

  return {
    title,
    description,
    alternates: { canonical: `/u/${profile.username}` },
    openGraph: {
      type: 'profile',
      title,
      description,
      url: `/u/${profile.username}`,
      siteName: brand.appName,
      locale: 'tr_TR',
    },
    twitter: { card: 'summary', title, description },
  };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const profile = await profileService.getByUsername(username);
  if (!profile) notFound();

  const actor = await currentActor();
  const isSelf = actor?.id === profile.userId;

  const [predictions, challengeHistory, badges, expertise, challengeStats, following] =
    await Promise.all([
      profileService.recentPredictions(profile.userId),
      profileService.challengeHistory(profile.userId),
      profileService.badges(profile.userId),
      profileService.expertise(profile.userId),
      profileService.challengeStats(profile.userId),
      actor && !isSelf
        ? socialService.isFollowing(actor.id, profile.userId)
        : Promise.resolve(false),
    ]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      {/* ── Başlık ── */}
      <header>
        <h1 className="text-ink text-2xl font-bold">@{profile.username}</h1>
        {profile.displayName !== profile.username && (
          <p className="text-muted text-sm">{profile.displayName}</p>
        )}
        {profile.bio && <p className="text-foreground mt-2 text-sm">{profile.bio}</p>}
      </header>

      <div className="mt-5">
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
      </div>

      {/* ── Eylem ── */}
      <div className="mt-4">
        {isSelf ? (
          <Link
            href="/app/profile"
            className="border-border text-ink flex min-h-12 w-full items-center justify-center rounded-lg border text-base font-semibold"
          >
            Profilim
          </Link>
        ) : actor ? (
          <FollowButton username={profile.username} initiallyFollowing={following} />
        ) : (
          <Link
            href="/register"
            className="bg-brand text-brand-fg flex min-h-12 w-full items-center justify-center rounded-lg text-base font-semibold"
          >
            Takip etmek için Meydana Katıl
          </Link>
        )}
      </div>

      {/* ── Sekmeler ── */}
      <div className="mt-6">
        <ProfileTabs
          general={
            <dl className="grid grid-cols-2 gap-3">
              <Stat label="Toplam tahmin" value={formatCount(profile.completed)} />
              <Stat label="Doğru" value={formatCount(profile.correct)} />
              <Stat label="Yanlış" value={formatCount(profile.incorrect)} />
              <Stat
                label="Başarı oranı"
                value={profile.completed === 0 ? '—' : formatPercent(profile.rawAccuracy)}
              />
            </dl>
          }
          predictions={
            predictions.length === 0 ? (
              <EmptyState
                title="Henüz tahmin yok."
                hint="Bu kullanıcı tahmin yaptığında burada görünecek."
              />
            ) : (
              <ul className="space-y-2">
                {predictions.map((p) => (
                  <li key={p.id} className="border-border rounded-lg border px-3 py-3 text-sm">
                    <Link href={`/event/${p.eventSlug}`} className="text-ink font-medium">
                      {p.eventTitle}
                    </Link>
                    <p className="text-muted mt-1">
                      {p.outcomeLabel} ·{' '}
                      {p.result ? predictionResultLabel[p.result] : predictionStatusLabel[p.status]}
                    </p>
                  </li>
                ))}
              </ul>
            )
          }
          challenges={
            challengeHistory.length === 0 ? (
              <EmptyState
                title="Henüz Meydan Okuma yok."
                hint="Kabul edilen ve sonuçlanan Meydan Okumalar burada birikir."
              />
            ) : (
              <ul className="space-y-2">
                {challengeHistory.map((c) => (
                  <li key={c.id} className="border-border rounded-lg border px-3 py-3 text-sm">
                    <p className="text-ink font-medium">{c.eventTitle}</p>
                    <p className="text-muted mt-1">
                      {c.stakeAmount} {brand.currencyName}
                      {c.status === 'COMPLETED' &&
                        (c.settlement === 'WIN_LOSS'
                          ? c.winnerUserId === profile.userId
                            ? ' · Kazandı'
                            : ' · Kaybetti'
                          : ' · Çipler iade edildi')}
                    </p>
                  </li>
                ))}
              </ul>
            )
          }
          badges={
            badges.length === 0 ? (
              <EmptyState
                title="Henüz rozet kazanılmadı."
                hint="Doğru tahminler ve kazanılan Meydan Okumalar rozet getirir."
              />
            ) : (
              <ul className="grid grid-cols-2 gap-3">
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
            )
          }
          expertise={
            expertise.length === 0 ? (
              <EmptyState
                title="Kategori uzmanlığı henüz oluşmadı."
                hint="Bir kategoride yeterli tahmin sonuçlanınca uzmanlık puanı burada görünür."
              />
            ) : (
              <ul className="space-y-2">
                {expertise.map((c) => (
                  <li
                    key={c.slug}
                    className="border-border flex items-center justify-between rounded-lg border px-3 py-3"
                  >
                    <span className="text-ink text-sm font-medium">
                      <span aria-hidden="true">{c.icon} </span>
                      {c.name}
                      {c.isExpert && <span className="text-brand ml-2 text-xs">🏆 Uzman</span>}
                    </span>
                    <span className="text-ink text-sm font-bold">{Math.round(c.power)}</span>
                  </li>
                ))}
              </ul>
            )
          }
        />
      </div>
    </main>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="border-border rounded-lg border px-3 py-3">
      <dt className="text-muted text-xs">{label}</dt>
      <dd className="text-ink mt-1 text-xl font-bold">{value}</dd>
    </div>
  );
}
