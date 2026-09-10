'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/feedback/Toast';
import { brand } from '@/config';
import type { FlowResult } from '@/features/events/actions';
import { acceptChallengeAction, declineChallengeAction } from '../actions';

/**
 * Detay ekranındaki kabul/ret paneli.
 *
 * ADR-18: kabul edenin tarafı zaten atanmıştır. Kullanıcı tekrar seçim yapmaz
 * ama NE ALDIĞINI ve ne kaybedebileceğini onaydan ÖNCE görür.
 */
export function AcceptPanel({
  challengeId,
  creatorUsername,
  creatorOutcomeLabel,
  options,
  stakeAmount,
  isOpen,
}: {
  readonly challengeId: string;
  readonly creatorUsername: string;
  readonly creatorOutcomeLabel: string;
  readonly options: readonly { readonly id: string; readonly label: string }[];
  readonly stakeAmount: number;
  readonly isOpen: boolean;
}) {
  const router = useRouter();
  const { show } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /* Tek seçenek varsa hazır işaretli: iki sonuçlu etkinlikte fazladan adım
     doğmasın; birden fazlaysa kullanıcı bilinçli olarak seçsin. */
  const [side, setSide] = useState<string | null>(
    options.length === 1 ? (options[0]?.id ?? null) : null,
  );

  const run = (fn: () => Promise<FlowResult>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        show(result.message);
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <section className="border-brand rounded-xl border p-4">
      <h2 className="text-ink text-base font-bold">Kabul edersen ne olur?</h2>
      <ul className="text-foreground mt-2 space-y-1 text-sm">
        <li>
          @{creatorUsername} <strong className="text-ink">{creatorOutcomeLabel}</strong> diyor.
        </li>
        <li>
          Sen <strong className="text-ink">kendi tarafını seçersin</strong> — aşağıdan.
        </li>
        <li>
          Hesabından{' '}
          <strong className="text-ink">
            {stakeAmount} {brand.currencyName}
          </strong>{' '}
          ortaya konur. Doğru bilirsen iki katını alırsın.
        </li>
      </ul>

      {/*
        TARAFINI SEÇ. Eskiden karşı taraf oluşturmada atanıyordu ve kullanıcı
        yalnızca "Kabul Et"e basıyordu; üç sonuçlu maçlarda bu ona çoğunlukla
        beraberliği veriyordu. Tek seçenek varsa hazır işaretli gelir.
      */}
      <p className="text-ink mt-4 text-sm font-semibold">Sen hangi taraftasın?</p>
      <div className="mt-2 grid gap-2">
        {options.map((o) => {
          const selected = side === o.id;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setSide(selected ? null : o.id)}
              className={[
                'focus-visible:outline-ink min-h-12 w-full rounded-lg border px-4 py-2 text-left text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2',
                selected
                  ? 'border-brand bg-brand text-brand-fg'
                  : 'border-border bg-background text-ink',
              ].join(' ')}
            >
              <span aria-hidden="true">{selected ? '✓ ' : ''}</span>
              {o.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={pending || side === null}
        onClick={() => side && run(() => acceptChallengeAction(challengeId, side))}
        className="bg-brand text-brand-fg focus-visible:outline-ink mt-4 min-h-13 w-full rounded-lg text-base font-bold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
      >
        {pending
          ? 'İşleniyor…'
          : side === null
            ? 'ÖNCE TARAFINI SEÇ'
            : brand.challengeAccept.toLocaleUpperCase('tr-TR')}
      </button>

      {!isOpen && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => declineChallengeAction(challengeId))}
          className="border-border text-muted mt-2 min-h-12 w-full rounded-lg border text-sm"
        >
          {brand.challengeDecline}
        </button>
      )}

      {error && (
        <p role="alert" className="text-incorrect mt-3 text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
