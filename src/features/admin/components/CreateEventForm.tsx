'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/feedback/Toast';
import { createEventAction } from '../actions';

/**
 * Etkinlik oluşturma — yönetim.
 *
 * Sonuç sayısı en az iki olmalıdır; kural hem burada hem serviste hem de
 * veritabanı kısıtında ayrı ayrı korunur (defense in depth).
 */
export function CreateEventForm({
  categories,
}: {
  readonly categories: readonly { readonly slug: string; readonly name: string }[];
}) {
  const [outcomes, setOutcomes] = useState<string[]>(['Evet', 'Hayır']);
  const [pending, startTransition] = useTransition();
  const { show } = useToast();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="border-border space-y-3 rounded-xl border p-4"
      action={(formData) => {
        setError(null);
        const cleaned = outcomes.map((o) => o.trim()).filter((o) => o.length > 0);
        if (cleaned.length < 2) {
          setError('En az iki sonuç gerekir.');
          return;
        }

        startTransition(async () => {
          const result = await createEventAction({
            categorySlug: String(formData.get('categorySlug') ?? ''),
            title: String(formData.get('title') ?? ''),
            question: String(formData.get('question') ?? ''),
            slug: String(formData.get('slug') ?? ''),
            closesAt: String(formData.get('closesAt') ?? ''),
            resolvesAt: String(formData.get('resolvesAt') ?? ''),
            outcomes: cleaned.map((label, i) => ({ key: `OPT_${i + 1}`, label })),
          });

          if (result.ok) {
            show(result.message);
            router.refresh();
          } else {
            setError(result.message);
          }
        });
      }}
    >
      <h2 className="text-ink text-base font-bold">Yeni Etkinlik</h2>

      <Field label="Kategori">
        <select
          name="categorySlug"
          required
          className="border-border min-h-11 w-full rounded-lg border px-3"
        >
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Başlık">
        <input
          name="title"
          required
          maxLength={200}
          className="border-border min-h-11 w-full rounded-lg border px-3"
        />
      </Field>

      <Field label="Soru">
        <input
          name="question"
          required
          maxLength={200}
          className="border-border min-h-11 w-full rounded-lg border px-3"
        />
      </Field>

      <Field label="Bağlantı adresi (slug)">
        <input
          name="slug"
          required
          pattern="[a-z0-9\-]+"
          className="border-border min-h-11 w-full rounded-lg border px-3"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Tahminler kapanır">
          <input
            type="datetime-local"
            name="closesAt"
            required
            className="border-border min-h-11 w-full rounded-lg border px-3"
          />
        </Field>
        <Field label="Sonuç beklenir">
          <input
            type="datetime-local"
            name="resolvesAt"
            required
            className="border-border min-h-11 w-full rounded-lg border px-3"
          />
        </Field>
      </div>

      <fieldset>
        <legend className="text-muted text-xs">Sonuçlar</legend>
        <div className="mt-1 space-y-2">
          {outcomes.map((value, index) => (
            <input
              key={index}
              value={value}
              onChange={(e) =>
                setOutcomes((prev) => prev.map((v, i) => (i === index ? e.target.value : v)))
              }
              maxLength={80}
              className="border-border min-h-11 w-full rounded-lg border px-3"
            />
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setOutcomes((prev) => [...prev, ''])}
            className="border-border text-ink min-h-11 rounded-lg border px-3 text-sm font-semibold"
          >
            Sonuç ekle
          </button>
          {outcomes.length > 2 && (
            <button
              type="button"
              onClick={() => setOutcomes((prev) => prev.slice(0, -1))}
              className="border-border text-muted min-h-11 rounded-lg border px-3 text-sm font-semibold"
            >
              Sonuncuyu kaldır
            </button>
          )}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="text-incorrect text-sm">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-brand text-brand-fg min-h-12 w-full rounded-lg text-base font-semibold disabled:opacity-50"
      >
        {pending ? 'Oluşturuluyor…' : 'Etkinliği Oluştur'}
      </button>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-muted text-xs">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
