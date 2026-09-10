'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/feedback/Toast';
import { brand, economy } from '@/config';
import { FinancialDisclaimer } from '@/components/disclaimers/FinancialDisclaimer';
import { timeRemaining } from '@/features/predictions/labels';
import { AskAFriend } from '@/features/share/components/AskAFriend';
import { challengeAction, predictAction, type FlowResult } from '../actions';

/**
 * Etkinlik kartı — ürünün ana ekranı.
 *
 * FAZ 5 SADELEŞTİRMESİ. Önceki tasarımda sonuç seçilir seçilmez ekrana aynı
 * anda dört şey geliyordu: "Tahmin Et", çip seçenekleri, "Açık Meydan Okuma" ve
 * "Birine Meydan Oku". Kullanıcı hangi düğmenin çip harcadığını anlamıyordu.
 *
 * Yeni akış İKİ ADIM:
 *   1. Sonuç seç → tek birincil eylem: "Tahmin Et" (çip harcanmaz).
 *      Yanında ikincil bir yol: "Meydan Oku" (çip gerektirir).
 *   2. Meydan Oku seçilirse çip miktarı ve rakip sorulur — ancak o zaman.
 *
 * Tahmin yapmış kullanıcıya "BU TAHMİNLE MEYDAN OKU" gösterilir; Faz 3
 * denetiminde tespit edilen kopukluk buydu — tahmin yapan kullanıcının Meydan
 * Okumaya geçmek için kartı sıfırdan doldurması gerekiyordu.
 */

export type EventCardData = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly question: string;
  readonly categoryIcon: string;
  readonly categoryName: string;
  readonly isFinancial: boolean;
  readonly closesAt: string;
  readonly predictionCount: number;
  readonly challengeCount: number;
  readonly outcomes: readonly { id: string; label: string }[];
  readonly myOutcomeId: string | null;
  readonly myOutcomeLabel: string | null;
};

/** ADR-18 ile aynı kural: sıralı sonuçlarda, seçilmeyen İLK sonuç karşı taraftır. */
function counterLabel(
  outcomes: readonly { id: string; label: string }[],
  chosenId: string | null,
): string | null {
  if (!chosenId) return null;
  return outcomes.find((o) => o.id !== chosenId)?.label ?? null;
}

export function EventCard({
  event,
  balance,
}: {
  readonly event: EventCardData;
  readonly balance?: number;
}) {
  const router = useRouter();
  const { show } = useToast();

  const [outcomeId, setOutcomeId] = useState<string | null>(null);
  const [stakeStep, setStakeStep] = useState(false);
  const [stake, setStake] = useState<number>(economy.stakePresets[1] ?? 25);
  const [opponent, setOpponent] = useState('');
  const [askOpponent, setAskOpponent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const alreadyPredicted = event.myOutcomeLabel !== null;
  /** Meydan Okuma hangi sonuç üzerinden kurulacak: yeni seçim ya da mevcut tahmin. */
  const activeOutcomeId = outcomeId ?? event.myOutcomeId;
  const activeLabel =
    event.outcomes.find((o) => o.id === activeOutcomeId)?.label ?? event.myOutcomeLabel;
  const rivalLabel = counterLabel(event.outcomes, activeOutcomeId);

  const reset = () => {
    setOutcomeId(null);
    setStakeStep(false);
    setAskOpponent(false);
    setOpponent('');
  };

  const run = (fn: () => Promise<FlowResult>) => {
    setError(null);
    startTransition(async () => {
      const outcome = await fn();
      if (outcome.ok) {
        show(outcome.message);
        reset();
        router.refresh();
      } else {
        setError(outcome.message);
      }
    });
  };

  const canAfford = balance === undefined || balance >= stake;

  return (
    <article className="border-border bg-background rounded-xl border p-4 shadow-sm">
      <div className="text-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span aria-hidden="true">{event.categoryIcon}</span>
        <span>{event.categoryName}</span>
        <span aria-hidden="true">·</span>
        <span>Kapanmasına {timeRemaining(new Date(event.closesAt))}</span>
      </div>

      <h3 className="text-ink mt-2 text-lg font-bold">
        <Link href={`/event/${event.slug}`} className="hover:underline">
          {event.title}
        </Link>
      </h3>
      <p className="text-foreground mt-1 text-sm">{event.question}</p>

      {event.isFinancial && <FinancialDisclaimer variant="inline" className="mt-2" />}

      {/* ── Tahmin yapılmışsa: durum + Meydan Okuma köprüsü ── */}
      {alreadyPredicted && !stakeStep && (
        <div className="border-brand bg-surface mt-4 rounded-lg border p-3">
          <p className="text-foreground text-sm">
            Tahminin: <strong className="text-ink">{event.myOutcomeLabel}</strong> · Sonuç
            bekleniyor
          </p>
          <button
            type="button"
            onClick={() => setStakeStep(true)}
            className="bg-brand text-brand-fg focus-visible:outline-ink mt-3 min-h-13 w-full rounded-lg text-base font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span aria-hidden="true">⚔️ </span>BU TAHMİNLE MEYDAN OKU
          </button>

          {/*
            ── PAYLAŞ, TAHMİNİN YAPILDIĞI YERDE ────────────────────────────
            Bu kutu önce yalnızca herkese açık etkinlik sayfasındaydı. Ama
            insanlar tahminlerini AKIŞTA yapıyor ve oradan etkinlik sayfasına
            hiç geçmiyorlar: düğme vardı, görülmüyordu.

            Kart hem akışta hem etkinlik sayfasında kullanıldığı için burada
            durması, iki yerde birden görünmesini sağlar — ve iki ayrı yere
            kopyalanmasını önler.

            Meydan Okuma'nın ALTINDA: o çip ortaya koyar ve karşı taraf
            gerektirir; bu ise bedava ve tek yönlüdür. Birincil eylem üstte
            kalır.
          */}
          <div className="border-border mt-3 border-t pt-3">
            <AskAFriend eventId={event.id} question={event.question} />
          </div>
        </div>
      )}

      {/* ── ADIM 1: sonuç seçimi ── */}
      {!alreadyPredicted && !stakeStep && (
        <>
          <div className="mt-4 grid gap-2">
            {event.outcomes.map((outcome) => {
              const selected = outcomeId === outcome.id;
              return (
                <button
                  key={outcome.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setOutcomeId(selected ? null : outcome.id)}
                  className={[
                    'focus-visible:outline-ink min-h-13 w-full rounded-lg border px-4 py-3 text-left text-base font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2',
                    selected
                      ? 'border-brand bg-brand text-brand-fg'
                      : 'border-border bg-background text-ink',
                  ].join(' ')}
                >
                  {/* Renk tek başına anlam taşımaz: seçili olan işaretle de belli edilir. */}
                  <span aria-hidden="true">{selected ? '✓ ' : ''}</span>
                  {outcome.label}
                </button>
              );
            })}
          </div>

          {outcomeId && (
            <div className="border-border mt-4 grid gap-2 border-t pt-4">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => predictAction({ eventId: event.id, outcomeId }))}
                className="bg-brand text-brand-fg focus-visible:outline-ink min-h-13 w-full rounded-lg text-base font-bold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
              >
                {pending ? 'Kaydediliyor…' : 'TAHMİN ET'}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setStakeStep(true)}
                className="border-border text-ink focus-visible:outline-ink min-h-13 w-full rounded-lg border text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <span aria-hidden="true">⚔️ </span>Meydan Oku
              </button>
              <p className="text-muted text-xs">
                Tahmin etmek {brand.currencyName} harcamaz. Meydan Okuma çip ortaya koyar.
              </p>
            </div>
          )}
        </>
      )}

      {/* ── ADIM 2: çip ve rakip ── */}
      {stakeStep && activeOutcomeId && (
        <div className="border-border mt-4 border-t pt-4">
          <p className="text-foreground text-sm">
            Sen <strong className="text-ink">{activeLabel}</strong> diyorsun.
          </p>
          {rivalLabel && (
            <p className="text-muted mt-1 text-sm">
              Karşı taraf <strong className="text-ink">{rivalLabel}</strong> tarafını alacak.
            </p>
          )}

          <p className="text-muted mt-4 mb-2 text-sm">
            Kaç {brand.currencyName} ortaya koyuyorsun?
            {balance !== undefined && <span className="text-muted"> (Bakiyen: {balance})</span>}
          </p>
          <div className="grid grid-cols-4 gap-2">
            {economy.stakePresets.map((amount) => {
              const on = stake === amount;
              const tooMuch = balance !== undefined && balance < amount;
              return (
                <button
                  key={amount}
                  type="button"
                  aria-pressed={on}
                  disabled={tooMuch}
                  onClick={() => setStake(amount)}
                  className={[
                    'focus-visible:outline-ink min-h-12 rounded-lg border text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40',
                    on ? 'border-brand bg-brand text-brand-fg' : 'border-border text-ink',
                  ].join(' ')}
                >
                  {amount}
                </button>
              );
            })}
          </div>

          {!canAfford && (
            <p role="alert" className="text-incorrect mt-2 text-sm">
              Bu Meydan Okuma için yeterli {brand.currencyName}in yok.
            </p>
          )}

          {askOpponent ? (
            <div className="mt-4">
              <label htmlFor={`opponent-${event.id}`} className="text-muted text-sm">
                Kime Meydan Okumak istiyorsun?
              </label>
              <input
                id={`opponent-${event.id}`}
                value={opponent}
                onChange={(e) => setOpponent(e.target.value)}
                placeholder="kullanıcı adı"
                autoComplete="off"
                className="border-border bg-background text-foreground focus-visible:outline-brand mt-1 min-h-12 w-full rounded-lg border px-3 text-base focus-visible:outline-2"
              />
              <button
                type="button"
                disabled={pending || opponent.trim().length < 3 || !canAfford}
                onClick={() =>
                  run(() =>
                    challengeAction({
                      eventId: event.id,
                      outcomeId: activeOutcomeId,
                      stakeAmount: stake,
                      opponentUsername: opponent.trim(),
                    }),
                  )
                }
                className="bg-brand text-brand-fg mt-2 min-h-13 w-full rounded-lg text-base font-bold disabled:opacity-60"
              >
                {pending ? 'Gönderiliyor…' : 'MEYDAN OKU'}
              </button>
            </div>
          ) : (
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                disabled={pending || !canAfford}
                onClick={() =>
                  run(() =>
                    challengeAction({
                      eventId: event.id,
                      outcomeId: activeOutcomeId,
                      stakeAmount: stake,
                    }),
                  )
                }
                className="bg-brand text-brand-fg min-h-13 w-full rounded-lg text-base font-bold disabled:opacity-60"
              >
                {pending ? 'Yayınlanıyor…' : 'AÇIK MEYDAN OLUŞTUR'}
              </button>
              <p className="text-muted text-xs">
                Açık Meydan Okumayı ilk kabul eden karşına çıkar.
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => setAskOpponent(true)}
                className="border-border text-ink min-h-13 w-full rounded-lg border text-base font-semibold"
              >
                Belirli birine Meydan Oku
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={reset}
            className="text-muted mt-3 min-h-11 w-full text-sm underline"
          >
            Vazgeç
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-incorrect mt-3 text-sm">
          {error}
        </p>
      )}

      <p className="text-muted mt-3 text-xs">
        {event.predictionCount} tahmin · {event.challengeCount} {brand.challengeNoun}
      </p>
    </article>
  );
}
