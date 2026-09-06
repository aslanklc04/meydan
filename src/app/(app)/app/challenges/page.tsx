import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentActor } from '@/server/auth';
import { challengeService } from '@/server/modules/challenge/service';
import { ChallengeCard } from '@/features/challenges/components/ChallengeCard';
import { Tabs } from '@/components/nav/Tabs';
import { challengeStatusLabel, challengeOutcomeMessage } from '@/features/predictions/labels';
import { brand } from '@/config';

export const metadata: Metadata = { title: brand.nav.challenges, robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Meydan Okumalar — dört sekme.
 *
 * Sıra bilinçli: önce cevap bekleyen (eyleme çağrı), sonra kendi gönderdiklerin,
 * sonra herkese açık meydanlar, en sonda geçmiş.
 */
export default async function ChallengesPage() {
  const actor = await currentActor();
  if (!actor) redirect('/login');

  const [incoming, mine, open] = await Promise.all([
    challengeService.listIncoming(actor.id),
    challengeService.listMine(actor.id),
    challengeService.listOpen(actor.id),
  ]);

  const sent = mine.filter((c) => c.status === 'PENDING' && c.creatorId === actor.id);
  const done = mine.filter((c) => c.status !== 'PENDING');

  const card = (c: (typeof incoming)[number], kind: 'incoming' | 'open' | 'mine') => (
    <ChallengeCard
      key={c.id}
      kind={kind}
      challenge={{
        id: c.id,
        mode: c.mode,
        creatorUsername: c.creatorUsername,
        eventTitle: c.eventTitle,
        eventQuestion: c.eventQuestion,
        creatorOutcomeLabel: c.creatorOutcomeLabel,
        yourOutcomeLabel: c.opponentOutcomeLabel,
        stakeAmount: c.stakeAmount,
        expiresAt: c.expiresAt.toISOString(),
      }}
    />
  );

  return (
    <main className="space-y-4">
      <h1 className="text-ink text-xl font-bold">{brand.challengeMine}</h1>

      <Tabs
        label="Meydan Okuma bölümleri"
        panels={[
          {
            key: 'GELEN',
            content:
              incoming.length === 0 ? (
                <EmptyState
                  title="Sana gelen bir Meydan Okuma yok."
                  hint="Bir tahmin seç ve bir arkadaşına Meydan Oku."
                />
              ) : (
                <div className="space-y-3">{incoming.map((c) => card(c, 'incoming'))}</div>
              ),
          },
          {
            key: 'GÖNDERDİKLERİM',
            content:
              sent.length === 0 ? (
                <EmptyState
                  title="Bekleyen bir Meydan Okuman yok."
                  hint="Akıştan bir etkinlik seçip Meydan Okuyabilirsin."
                />
              ) : (
                <div className="space-y-3">{sent.map((c) => card(c, 'mine'))}</div>
              ),
          },
          {
            key: 'AÇIK MEYDANLAR',
            content:
              open.length === 0 ? (
                <EmptyState
                  title="Şu an açık Meydan Okuma yok."
                  hint="Rakip seçmeden Meydan Okursan ilk kabul eden karşına çıkar."
                />
              ) : (
                <div className="space-y-3">{open.map((c) => card(c, 'open'))}</div>
              ),
          },
          {
            key: 'TAMAMLANANLAR',
            content:
              done.length === 0 ? (
                <EmptyState
                  title="Henüz tamamlanan Meydan Okuman yok."
                  hint="Sonuçlanan Meydan Okumaların burada birikecek."
                />
              ) : (
                <ul className="space-y-2">
                  {done.map((c) => (
                    <li key={c.id} className="border-border rounded-lg border px-3 py-3 text-sm">
                      <p className="text-ink font-medium">{c.eventTitle}</p>
                      <p className="text-muted mt-1">
                        {c.stakeAmount} {brand.currencyName} · {challengeStatusLabel[c.status]}
                      </p>
                      {c.status === 'COMPLETED' && (
                        <p className="text-ink mt-1">
                          {challengeOutcomeMessage({
                            settlement: c.settlement,
                            winnerUserId: c.winnerUserId,
                            viewerId: actor.id,
                            stakeAmount: c.stakeAmount,
                          })}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              ),
          },
        ]}
      />
    </main>
  );
}

function EmptyState({ title, hint }: { readonly title: string; readonly hint: string }) {
  return (
    <div className="border-border rounded-xl border border-dashed p-6 text-center">
      <p className="text-ink text-sm font-semibold">{title}</p>
      <p className="text-muted mt-1 text-sm">{hint}</p>
    </div>
  );
}
