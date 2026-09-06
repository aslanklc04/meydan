'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/feedback/Toast';
import type { FlowResult } from '@/features/events/actions';
import { timeRemaining } from '@/features/predictions/labels';
import { acceptChallengeAction, cancelChallengeAction, declineChallengeAction } from '../actions';

/**
 * Meydan Okuma kartı.
 *
 * ADR-18: kabul edenin sonucu ZATEN atanmıştır ve burada AÇIKÇA gösterilir.
 * Kullanıcı ne aldığını görür ama tekrar seçim yapmaz.
 */

export type ChallengeCardData = {
  readonly id: string;
  readonly mode: 'DIRECT' | 'OPEN';
  readonly creatorUsername: string;
  readonly eventTitle: string;
  readonly eventQuestion: string;
  readonly creatorOutcomeLabel: string;
  readonly yourOutcomeLabel: string;
  readonly stakeAmount: number;
  readonly expiresAt: string;
};

type Props = {
  readonly challenge: ChallengeCardData;
  /** 'incoming' = sana geldi · 'open' = açık · 'mine' = senin açtığın */
  readonly kind: 'incoming' | 'open' | 'mine';
};

export function ChallengeCard({ challenge, kind }: Props) {
  const router = useRouter();
  const { show } = useToast();
  const [result, setResult] = useState<FlowResult | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<FlowResult>) => {
    setResult(null);
    startTransition(async () => {
      const outcome = await fn();
      // Başarı mesajı LAYOUT seviyesinde gösterilir: bu kart birazdan
      // listeden düşeceği için içinde gösterilen mesaj kaybolurdu.
      if (outcome.ok) {
        show(outcome.message);
        router.refresh();
      } else setResult(outcome);
    });
  };

  const headline =
    kind === 'incoming'
      ? `@${challenge.creatorUsername} sana Meydan Okudu`
      : kind === 'open'
        ? `@${challenge.creatorUsername} Açık Meydan Okuma yayınladı`
        : 'Meydan Okuman yanıt bekliyor';

  return (
    <article className="border-border bg-background rounded-xl border p-4 shadow-sm">
      <p className="text-brand text-sm font-semibold">{headline}</p>

      <h3 className="text-ink mt-2 text-base font-bold">{challenge.eventTitle}</h3>
      <p className="text-muted text-sm">{challenge.eventQuestion}</p>

      <div className="bg-surface mt-3 grid gap-1 rounded-lg px-3 py-3 text-sm">
        <p>
          <span className="text-muted">@{challenge.creatorUsername}:</span>{' '}
          <strong className="text-ink">{challenge.creatorOutcomeLabel}</strong>
        </p>
        {kind !== 'mine' && (
          <p>
            <span className="text-muted">Sen:</span>{' '}
            <strong className="text-ink">{challenge.yourOutcomeLabel}</strong>
          </p>
        )}
        <p className="text-muted">
          Ortaya konan: <strong className="text-ink">{challenge.stakeAmount} Gümüş Çip</strong>
        </p>
      </div>

      <p className="text-muted mt-2 text-xs">
        Süresinin dolmasına {timeRemaining(new Date(challenge.expiresAt))} ·{' '}
        <Link href={`/app/challenges/${challenge.id}`} className="underline">
          Ayrıntı
        </Link>
      </p>

      {kind !== 'mine' && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => acceptChallengeAction(challenge.id))}
          className="bg-brand text-brand-fg mt-3 min-h-13 w-full rounded-lg py-3 text-base font-bold disabled:opacity-60"
        >
          Meydan Okumayı Kabul Et
        </button>
      )}

      {kind === 'incoming' && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => declineChallengeAction(challenge.id))}
          className="border-border text-muted mt-2 min-h-12 w-full rounded-lg border py-2 text-sm"
        >
          Reddet
        </button>
      )}

      {kind === 'mine' && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => cancelChallengeAction(challenge.id))}
          className="border-border text-muted mt-3 min-h-12 w-full rounded-lg border py-2 text-sm"
        >
          İptal et ve çipimi geri al
        </button>
      )}

      {result && !result.ok && (
        <p role="alert" className="text-incorrect mt-3 text-sm">
          {result.message}
        </p>
      )}
    </article>
  );
}
