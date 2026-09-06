import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentActor } from '@/server/auth';
import { challengeService } from '@/server/modules/challenge/service';
import { challengeStatusLabel, timeRemaining } from '@/features/predictions/labels';
import { AcceptPanel } from '@/features/challenges/components/AcceptPanel';
import { brand } from '@/config';

export const metadata: Metadata = { title: brand.challengeNoun, robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Meydan Okuma detayı — Faz 5.
 *
 * İki tarafın ne dediği, ne kadar çip konduğu ve sonuç TEK ekranda görünür.
 * Hiçbir teknik kimlik gösterilmez; adresteki kimlik dışında ekranda kimlik yok.
 *
 * Yetki denetimi `challengeService.detailFor` içindedir: başkasına gönderilmiş
 * bekleyen bir davet üçüncü kişiye açılmaz ve "bulunamadı" döner.
 */
export default async function ChallengeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) redirect('/login');

  const { id } = await params;
  const c = await challengeService.detailFor(id, actor.id);
  if (!c) notFound();

  const completed = c.status === 'COMPLETED';
  const refunded = c.settlement === 'REFUND_BOTH' || c.settlement === 'REFUND_CREATOR';

  return (
    <main className="space-y-5">
      <nav aria-label="Geri">
        <Link href="/app/challenges" className="text-muted text-sm underline">
          ← {brand.challengeMine}
        </Link>
      </nav>

      <header>
        <h1 className="text-ink text-xl font-bold">{c.eventTitle}</h1>
        <p className="text-muted mt-1 text-sm">{c.eventQuestion}</p>
      </header>

      {/* ── Taraflar ── */}
      <section aria-label="Taraflar" className="grid gap-3 sm:grid-cols-2">
        <Side
          role="Meydan okuyan"
          username={c.creatorUsername}
          choice={c.creatorOutcomeLabel}
          isViewer={c.viewerIsCreator}
          isWinner={completed && !refunded && c.winnerUserId === c.creatorId}
        />
        <Side
          role="Karşı taraf"
          username={c.opponentUsername}
          choice={c.opponentOutcomeLabel}
          isViewer={c.viewerIsOpponent}
          isWinner={
            completed && !refunded && c.winnerUserId !== null && c.winnerUserId === c.opponentId
          }
        />
      </section>

      {/* ── Ortaya konan ── */}
      <section className="border-border rounded-xl border p-4">
        <p className="text-muted text-xs">Ortaya konan</p>
        <p className="text-ink text-2xl font-bold">
          <span aria-hidden="true">🪙 </span>
          {c.stakeAmount} {brand.currencyName}
        </p>
        <p className="text-muted mt-1 text-sm">Her iki taraf da aynı miktarı koyar.</p>
        <p className="text-muted mt-1 text-xs">
          {brand.currencyName} oyun içi bir puandır; gerçek para değildir ve nakde çevrilemez.
        </p>
      </section>

      {/* ── Durum ── */}
      <section className="border-border rounded-xl border p-4">
        <p className="text-muted text-xs">Durum</p>
        <p className="text-ink text-base font-bold">{challengeStatusLabel[c.status]}</p>
        {c.status === 'PENDING' && (
          <p className="text-muted mt-1 text-sm">
            Yanıt süresi: {timeRemaining(c.expiresAt)}. Süre dolarsa çipler oluşturana iade edilir.
          </p>
        )}
        {completed && (
          <p className="text-ink mt-2 text-sm">
            {refunded
              ? c.settlement === 'REFUND_CREATOR'
                ? 'Kimse kabul etmedi; çipler oluşturana iade edildi.'
                : 'İki taraf da bilemedi; çipler iade edildi.'
              : c.viewerWon
                ? `Kazandın. +${c.stakeAmount * 2} ${brand.currencyName} hesabına geçti.`
                : c.winnerUserId === null
                  ? 'Sonuçlandı.'
                  : `Bu Meydan Okumayı kaybettin. −${c.stakeAmount} ${brand.currencyName}.`}
          </p>
        )}
        {completed && (c.viewerIsCreator || c.viewerIsOpponent) && (
          <p className="text-muted mt-2 text-sm">
            <span aria-hidden="true">🧠 </span>
            {brand.ratingName} güncellendi —{' '}
            <Link href="/app/profile" className="underline">
              profilinden gör
            </Link>
            .
          </p>
        )}
      </section>

      {/* ── Eylem ── */}
      {c.status === 'PENDING' && !c.viewerIsCreator && (
        <AcceptPanel
          challengeId={c.id}
          creatorUsername={c.creatorUsername}
          creatorOutcomeLabel={c.creatorOutcomeLabel}
          yourOutcomeLabel={c.opponentOutcomeLabel}
          stakeAmount={c.stakeAmount}
          isOpen={c.mode === 'OPEN'}
        />
      )}
    </main>
  );
}

function Side({
  role,
  username,
  choice,
  isViewer,
  isWinner,
}: {
  readonly role: string;
  readonly username: string | null;
  readonly choice: string;
  readonly isViewer: boolean;
  readonly isWinner: boolean;
}) {
  return (
    <div
      className={['rounded-xl border p-4', isWinner ? 'border-correct' : 'border-border'].join(' ')}
    >
      <p className="text-muted text-xs">{role}</p>
      <p className="text-ink mt-1 text-base font-semibold">
        {username ? (
          <Link href={`/u/${username}`} className="underline">
            @{username}
          </Link>
        ) : (
          'Henüz kabul eden yok'
        )}
        {isViewer && <span className="text-muted ml-2 text-xs">(sen)</span>}
      </p>
      <p className="text-foreground mt-2 text-sm">
        Seçimi: <strong className="text-ink">{choice}</strong>
      </p>
      {isWinner && (
        <p className="text-correct mt-2 text-sm font-bold">
          <span aria-hidden="true">🏆 </span>Kazanan
        </p>
      )}
    </div>
  );
}
