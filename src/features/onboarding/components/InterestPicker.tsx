'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { completeOnboardingAction } from '../actions';

/**
 * İlgi alanı seçimi — tek ekran, tek dokunuş.
 *
 * Zorunlu değildir: hiçbir şey seçmeden de devam edilebilir. Seçim yapmayan
 * kullanıcı tüm kategorileri görür; bu bir ceza değil, varsayılan davranıştır.
 */
export function InterestPicker({
  categories,
  initiallySelected,
}: {
  readonly categories: readonly {
    readonly slug: string;
    readonly name: string;
    readonly icon: string;
  }[];
  readonly initiallySelected: readonly string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([...initiallySelected]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (slug: string) =>
    setSelected((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await completeOnboardingAction(selected);
      if (result.ok) {
        router.replace('/app/feed');
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {categories.map((c) => {
          const on = selected.includes(c.slug);
          return (
            <li key={c.slug}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(c.slug)}
                className={[
                  'focus-visible:outline-brand flex min-h-14 w-full items-center gap-2 rounded-xl border px-3 text-left text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2',
                  on ? 'border-brand bg-brand text-brand-fg' : 'border-border text-ink',
                ].join(' ')}
              >
                <span aria-hidden="true" className="text-xl">
                  {c.icon}
                </span>
                <span className="flex-1">{c.name}</span>
                {/* Seçim rengin YANI SIRA bir işaretle de belli edilir —
                    renk tek başına anlam taşımamalı (erişilebilirlik). */}
                <span aria-hidden="true" className="text-sm font-bold">
                  {on ? '✓' : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="text-incorrect mt-3 text-sm">
          {error}
        </p>
      )}

      <p className="text-muted mt-4 text-sm" aria-live="polite">
        {selected.length === 0
          ? 'Hiçbirini seçmeden de devam edebilirsin — o zaman her şeyi görürsün.'
          : `${selected.length} alan seçtin.`}
      </p>

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="bg-brand text-brand-fg focus-visible:outline-ink mt-3 min-h-13 w-full rounded-lg text-base font-bold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
      >
        {pending ? 'Kaydediliyor…' : 'Meydana Gir'}
      </button>
    </div>
  );
}
