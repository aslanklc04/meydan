'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { answerFromShareAction } from '../actions';

type Outcome = { readonly id: string; readonly label: string; readonly imageUrl: string | null };

/**
 * Meydan okuma bağlantısının cevap alanı.
 *
 * ── MİSAFİR SEÇİMİ HAFIZADA KALIR, VERİTABANINA YAZILMAZ ───────────────────
 * Giriş yapmamış ziyaretçi seçimini yapabilir ve o seçim ekranda görünür; ama
 * yalnızca tarayıcıda tutulur. Kaydolduktan sonra aynı seçimle geri döner.
 *
 * Böylece "misafir oyu kalabalığa karışmasın" kuralı bir filtreyle değil, bir
 * TASARIM KARARIYLA sağlanır: filtre unutulabilir, var olmayan kayıt sızamaz.
 *
 * ── NEDEN ÖNCE SEÇTİRİP SONRA KAYIT İSTİYORUZ ──────────────────────────────
 * Kayıt duvarını ilk ekrana koymak, ziyaretçiden değeri görmeden bedel
 * istemektir. Önce seçimini yapar — o an zaten bir fikri vardır ve onu
 * kaydetmek ister; kayıt artık bir engel değil, kendi seçimini saklamanın
 * yolu olur.
 */
export function ChallengeAnswer({
  publicToken,
  outcomes,
  isOpen,
  isLoggedIn,
  viewerOutcomeId,
  returnTo,
}: {
  readonly publicToken: string;
  readonly outcomes: readonly Outcome[];
  readonly isOpen: boolean;
  readonly isLoggedIn: boolean;
  readonly viewerOutcomeId: string | null;
  readonly returnTo: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cevabını vermiş kullanıcıya düğmeler tekrar gösterilmez.
  if (viewerOutcomeId !== null) {
    const mine = outcomes.find((o) => o.id === viewerOutcomeId);
    return (
      <p className="border-brand bg-surface text-ink rounded-xl border p-4 text-center text-sm font-semibold">
        <span aria-hidden="true">✓ </span>Senin tahminin: {mine?.label}
      </p>
    );
  }

  if (!isOpen) {
    return (
      <p className="border-border text-muted rounded-xl border border-dashed p-4 text-center text-sm">
        Bu soru kapandı; artık tahmin alınmıyor.
      </p>
    );
  }

  function submit(outcomeId: string) {
    setError(null);
    startTransition(async () => {
      const result = await answerFromShareAction({ publicToken, outcomeId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Sayfayı tazele: karşılaştırma bölümü artık sunucudan dolu gelecek.
      router.refresh();
    });
  }

  return (
    <div>
      <p className="text-ink mb-3 text-sm font-semibold">Sen ne diyorsun?</p>

      <div className="flex flex-col gap-2">
        {outcomes.map((o) => {
          const selected = picked === o.id;
          return (
            <button
              key={o.id}
              type="button"
              disabled={pending}
              onClick={() => (isLoggedIn ? submit(o.id) : setPicked(o.id))}
              aria-pressed={selected}
              className={`focus-visible:outline-ink flex min-h-14 items-center gap-3 rounded-xl border px-4 text-left font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${
                selected ? 'border-brand bg-surface text-ink' : 'border-border text-ink'
              }`}
            >
              {o.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={o.imageUrl}
                  alt=""
                  aria-hidden="true"
                  width={32}
                  height={32}
                  loading="lazy"
                  className="h-8 w-8 shrink-0 object-contain"
                />
              )}
              <span className="min-w-0 flex-1">{o.label}</span>
              {selected && (
                <span aria-hidden="true" className="text-brand">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="text-incorrect mt-3 text-sm">
          {error}
        </p>
      )}

      {!isLoggedIn && (
        <div className="mt-4">
          {picked ? (
            <>
              <Link
                href={`/register?next=${encodeURIComponent(returnTo)}&ref=${encodeURIComponent(publicToken)}`}
                className="bg-brand text-brand-fg focus-visible:outline-ink flex min-h-12 w-full items-center justify-center rounded-lg font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Tahminimi kaydet
              </Link>
              <p className="text-muted mt-2 text-center text-xs">
                Seçimin kaybolmaz — kaydolduktan sonra buraya döneceksin. Gerçek para yok.
              </p>
            </>
          ) : (
            <p className="text-muted text-center text-xs">
              Bir taraf seç; sonra tahminini kaydedersin.
            </p>
          )}
          <p className="text-muted mt-3 text-center text-xs">
            Zaten üye misin?{' '}
            <Link
              href={`/login?next=${encodeURIComponent(returnTo)}`}
              className="text-brand font-semibold"
            >
              Giriş yap
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
