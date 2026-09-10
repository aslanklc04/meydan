'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { createShareLinkAction } from '../actions';

export type ResultCardData = {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly eventTitle: string;
  readonly question: string;
  readonly myOutcomeLabel: string;
  readonly resultOutcomeLabel: string | null;
  /** true = tuttu, false = tutmadı, null = etkinlik iptal edildi. */
  readonly correct: boolean | null;
};

/**
 * "BEN DEMİŞTİM" — sonuç kartı.
 *
 * ── NEDEN BU EKRAN GEREKLİ ─────────────────────────────────────────────────
 * Kullanıcı tahminini yapıyor, maç oynanıyor, sonuç geliyordu — ve akışta
 * hiçbir şey değişmiyordu. Ürünün verdiği tek söz "sonucu göreceksin"di ve o
 * söz, sonucun görüneceği bir yer olmadığı için tutulmuyordu.
 *
 * ── PAYLAŞIM İÇİN YENİ BİR YÜZEY AÇILMADI ──────────────────────────────────
 * Tuttuğunda paylaşılan şey, o tahminin ZATEN var olan meydan okuma
 * bağlantısıdır (`/m/...`). O sayfa sonuç geldiğinde zaten sonucu gösteriyor.
 * Üçüncü bir paylaşım nesnesi üretmek, sayaçları böler ve hangisinin işe
 * yaradığını söylenemez hâle getirirdi.
 *
 * ── TUTMAYAN TAHMİN DE PAYLAŞILABİLİR ──────────────────────────────────────
 * Paylaş düğmesi yalnızca doğru bilene gösterilseydi, ürün kullanıcıya
 * "sadece kazandığını anlat" demiş olurdu — ve MEYDAN'ın bütün iddiası bunun
 * tersi. Kart iki durumda da aynı düğmeyi taşır.
 */
export function ResultCard({ data }: { readonly data: ResultCardData }) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function share() {
    setError(null);
    startTransition(async () => {
      const result = await createShareLinkAction(data.eventId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setUrl(result.url);
      try {
        await navigator.clipboard.writeText(result.url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        /* Kopyalanamadı; adres kutusu aşağıda duruyor. */
      }
    });
  }

  const voided = data.correct === null;
  const message = voided
    ? `${data.eventTitle} — iptal edildi.`
    : data.correct
      ? `${data.question} Ben "${data.myOutcomeLabel}" demiştim. Sonuç: ${data.resultOutcomeLabel}.`
      : `${data.question} Ben "${data.myOutcomeLabel}" demiştim, tutmadı. Sonuç: ${data.resultOutcomeLabel}.`;

  return (
    <article className="border-border bg-background rounded-xl border p-4">
      <p className="text-muted text-xs">{data.eventTitle}</p>

      <p className="mt-2 text-base font-bold">
        {voided ? (
          <span className="text-muted">
            <span aria-hidden="true">➖ </span>İptal edildi — sayılmadı
          </span>
        ) : data.correct ? (
          <span className="text-brand">
            <span aria-hidden="true">✅ </span>Ben demiştim
          </span>
        ) : (
          <span className="text-muted">
            <span aria-hidden="true">❌ </span>Tutmadı
          </span>
        )}
      </p>

      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Sen</dt>
          <dd className="text-ink font-semibold">{data.myOutcomeLabel}</dd>
        </div>
        {data.resultOutcomeLabel && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">Sonuç</dt>
            <dd className="text-ink font-semibold">{data.resultOutcomeLabel}</dd>
          </div>
        )}
      </dl>

      {!voided && (
        <div className="mt-3">
          {!url ? (
            <button
              type="button"
              onClick={share}
              disabled={pending}
              className="border-border text-ink focus-visible:outline-ink flex min-h-11 w-full items-center justify-center rounded-lg border text-sm font-semibold focus-visible:outline-2 disabled:opacity-60"
            >
              {pending ? 'Hazırlanıyor…' : 'Paylaş'}
            </button>
          ) : (
            <div>
              <p className="text-muted text-xs">
                {copied ? '✓ Bağlantı kopyalandı.' : 'Bağlantını gönder:'}
              </p>
              <div className="mt-2 flex gap-2">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`${message} ${url}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border-border text-ink flex min-h-11 flex-1 items-center justify-center rounded-lg border text-sm font-semibold"
                >
                  WhatsApp
                </a>
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}&url=${encodeURIComponent(url)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border-border text-ink flex min-h-11 flex-1 items-center justify-center rounded-lg border text-sm font-semibold"
                >
                  X
                </a>
              </div>
              <input
                type="text"
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Bağlantı"
                className="border-border bg-surface text-muted mt-2 w-full rounded-lg border px-3 py-2 text-xs"
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-incorrect mt-2 text-sm">
              {error}
            </p>
          )}
        </div>
      )}

      <p className="mt-2 text-center">
        <Link href={`/event/${data.eventSlug}`} className="text-brand text-xs font-semibold">
          Etkinliğe git →
        </Link>
      </p>
    </article>
  );
}
