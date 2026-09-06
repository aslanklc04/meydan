import Link from 'next/link';
import { brand } from '@/config';
import { formatCount, formatPercent } from '@/lib/utils';

/**
 * Profil istatistik şeridi — Faz 5.
 *
 * Profile giren biri TEK BAKIŞTA "bu kişi ne kadar iyi tahmin yapıyor?"
 * sorusunun cevabını almalı. Bu yüzden Tahmin Gücü büyük ve tek başına durur;
 * ham sayılar (tahmin, doğru, yanlış, galibiyet) altında ikinci sırada.
 *
 * Tüm değerler VERİTABANINDAN gelir; hiçbiri tahmini ya da örnek değildir.
 */
export function StatStrip({
  power,
  completed,
  correct,
  rawAccuracy,
  challengeTotal,
  challengeWins,
  followerCount,
  followingCount,
  last30,
}: {
  readonly power: number;
  readonly completed: number;
  readonly correct: number;
  readonly rawAccuracy: number;
  readonly challengeTotal: number;
  readonly challengeWins: number;
  readonly followerCount: number;
  readonly followingCount: number;
  readonly last30: { readonly correct: number; readonly total: number };
}) {
  const incorrect = completed - correct;
  const formText =
    last30.total >= 5
      ? `Son ${last30.total} tahminde ${formatPercent(last30.correct / last30.total)} isabet.`
      : 'Form için biraz daha tahmin gerekiyor.';

  return (
    <div className="space-y-3">
      {/* ── Tek sayı: Tahmin Gücü ── */}
      <section
        role="group"
        aria-label={brand.ratingName}
        className="border-border rounded-xl border p-4"
      >
        <p className="text-muted text-xs">
          <span aria-hidden="true">🧠 </span>
          {brand.ratingName}
        </p>
        {/* data-stat-value: değerin DOM'da kararlı bir tutamağı olsun diye —
            E2E metin sırasına göre değil, bu niteliğe göre okur. */}
        <p data-stat-value className="text-ink text-4xl font-bold">
          {Math.round(power)}
        </p>
        <p className="text-muted mt-1 text-sm">{formText}</p>
        <Link href="/tahmin-gucu" className="text-brand mt-2 inline-block text-sm underline">
          Bu sayı nasıl hesaplanıyor?
        </Link>
      </section>

      {/* ── Ham sayılar ── */}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Cell icon="🎯" label="Tahmin" value={formatCount(completed)} />
        <Cell icon="✅" label="Doğru" value={formatCount(correct)} />
        <Cell icon="❌" label="Yanlış" value={formatCount(incorrect)} />
        <Cell
          icon="📊"
          label={brand.accuracyName}
          value={completed === 0 ? '—' : formatPercent(rawAccuracy)}
        />
        <Cell icon="⚔️" label={brand.challengeNoun} value={formatCount(challengeTotal)} />
        <Cell icon="🏆" label="Galibiyet" value={formatCount(challengeWins)} />
      </dl>

      <p className="text-muted text-sm">
        <strong className="text-ink">{formatCount(followerCount)}</strong> takipçi ·{' '}
        <strong className="text-ink">{formatCount(followingCount)}</strong> takip
      </p>
    </div>
  );
}

function Cell({
  icon,
  label,
  value,
}: {
  readonly icon: string;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div role="group" aria-label={label} className="border-border rounded-lg border px-3 py-3">
      <dt className="text-muted text-xs">
        <span aria-hidden="true">{icon} </span>
        {label}
      </dt>
      <dd data-stat-value className="text-ink mt-1 text-xl font-bold">
        {value}
      </dd>
    </div>
  );
}
