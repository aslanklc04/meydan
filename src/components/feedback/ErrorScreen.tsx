'use client';

import Link from 'next/link';

/**
 * Hata ekranı — kullanıcı diliyle.
 *
 * KURAL: teknik hiçbir şey gösterilmez. Yığın izi, "DrizzleError",
 * "PostgresError", UUID veya HTTP kodu ekrana ÇIKMAZ; bunlar sunucu günlüğüne
 * gider. Kullanıcının ihtiyacı olan tek şey ne olduğunu ve ne yapabileceğini
 * bilmektir.
 */
export function ErrorScreen({
  reset,
  title = 'Bir sorun oluştu.',
  hint = 'Bağlantında ya da bizde geçici bir aksaklık olabilir. Tekrar denemek genelde yeterli oluyor.',
}: {
  readonly reset?: () => void;
  readonly title?: string;
  readonly hint?: string;
}) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-12 text-center">
      <p aria-hidden="true" className="text-4xl">
        😕
      </p>
      <h1 className="text-ink mt-3 text-xl font-bold">{title}</h1>
      <p className="text-muted mt-2 text-sm">{hint}</p>

      <div className="mt-6 grid gap-2">
        {reset && (
          <button
            type="button"
            onClick={reset}
            className="bg-brand text-brand-fg focus-visible:outline-ink min-h-12 w-full rounded-lg text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Tekrar dene
          </button>
        )}
        <Link
          href="/app/feed"
          className="border-border text-ink flex min-h-12 w-full items-center justify-center rounded-lg border text-base font-semibold"
        >
          Akışa dön
        </Link>
      </div>
    </main>
  );
}
