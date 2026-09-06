'use client';

import { useState, useTransition } from 'react';
import { useToast } from '@/components/feedback/Toast';
import type { FlowResult } from '@/features/events/actions';
import { resolveEventAction } from '../actions';

type Props = {
  readonly eventId: string;
  readonly title: string;
  readonly question: string;
  readonly predictionCount: number;
  readonly challengeCount: number;
  readonly outcomes: readonly { id: string; label: string }[];
};

/** Etkinlik seç → sonucu seç → onayla. Üç adım, fazlası yok. */
export function ResolvePanel({
  eventId,
  title,
  question,
  predictionCount,
  challengeCount,
  outcomes,
}: Props) {
  const { show } = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<FlowResult | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (decision: 'RESOLVED' | 'VOID') => {
    setResult(null);
    startTransition(async () => {
      const outcome = await resolveEventAction({
        eventId,
        outcomeId: decision === 'VOID' ? null : selected,
        decision,
      });
      setConfirming(false);
      // Başarı mesajı layout seviyesinde: bu panel sonuçlandıktan sonra
      // "bekleyen etkinlikler" listesinden düşer ve içindeki mesaj kaybolurdu.
      if (outcome.ok) {
        show(outcome.message);
        setSelected(null);
      } else {
        setResult(outcome);
      }
    });
  };

  return (
    <article className="border-border rounded-xl border p-4">
      <h3 className="text-ink text-base font-bold">{title}</h3>
      <p className="text-muted text-sm">{question}</p>
      <p className="text-muted mt-1 text-xs">
        {predictionCount} tahmin · {challengeCount} Meydan Okuma
      </p>

      <div className="mt-3 grid gap-2">
        {outcomes.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={selected === o.id}
            onClick={() => {
              setSelected(selected === o.id ? null : o.id);
              setConfirming(false);
            }}
            className={[
              'min-h-12 rounded-lg border px-3 py-2 text-left text-sm font-medium',
              selected === o.id ? 'border-brand bg-brand text-brand-fg' : 'border-border text-ink',
            ].join(' ')}
          >
            {o.label}
          </button>
        ))}
      </div>

      {selected && !confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="bg-brand text-brand-fg mt-3 min-h-12 w-full rounded-lg text-sm font-bold"
        >
          Sonucu Onayla
        </button>
      )}

      {confirming && (
        <div className="border-brand bg-warning-bg mt-3 rounded-lg border p-3">
          <p className="text-ink text-sm">
            Bu işlem geri alınamaz: tahminler sonuçlanır, çipler el değiştirir ve Tahmin Gücü
            güncellenir. Emin misin?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run('RESOLVED')}
              className="bg-brand text-brand-fg min-h-11 flex-1 rounded-lg text-sm font-bold disabled:opacity-60"
            >
              Evet, sonuçlandır
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="border-border text-ink min-h-11 flex-1 rounded-lg border text-sm"
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={() => run('VOID')}
        className="border-border text-muted mt-2 min-h-11 w-full rounded-lg border text-xs disabled:opacity-60"
      >
        Sonuç belirlenemedi — geçersiz say ve çipleri iade et
      </button>

      {result && !result.ok && (
        <p role="alert" className="text-incorrect mt-3 text-sm">
          {result.message}
        </p>
      )}
    </article>
  );
}
