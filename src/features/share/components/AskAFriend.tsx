'use client';

import { useState, useTransition } from 'react';
import { createShareLinkAction } from '../actions';

/**
 * “Bunu birine sor” — tahmin yaptıktan SONRA çıkan paylaşım düğmesi.
 *
 * ── NEDEN TAHMİNDEN SONRA ──────────────────────────────────────────────────
 * Tahmin yapmadan paylaşılacak bir şey yok: bağlantının bütün değeri
 * "arkadaşım ne demiş" merakında ve o merak ancak bir cevap varsa doğar.
 * Bu yüzden düğme kendini yalnızca tahmin sahibine gösterir.
 *
 * ── BAĞLANTI TIKLAYINCA ÜRETİLİR ───────────────────────────────────────────
 * Her tahmin için önceden jeton üretmek, çoğu hiç paylaşılmayacak binlerce
 * satır demektir. Jeton ilk paylaşma isteğinde doğar ve o tahmin için sabit
 * kalır.
 */
export function AskAFriend({ eventId, question }: { eventId: string; question: string }) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function make() {
    setError(null);
    startTransition(async () => {
      const result = await createShareLinkAction(eventId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setUrl(result.url);
      // Bağlantı üretilir üretilmez panoya konur: kullanıcının tek istediği
      // şey o. Başarısız olursa adres kutusu zaten ekranda.
      try {
        await navigator.clipboard.writeText(result.url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        /* Kopyalanamadı; kutudan elle alınır. */
      }
    });
  }

  const message = `${question} Sen ne diyorsun?`;

  if (!url) {
    return (
      <div>
        <button
          type="button"
          onClick={make}
          disabled={pending}
          className="border-border text-ink focus-visible:outline-ink flex min-h-11 w-full items-center justify-center rounded-lg border text-sm font-semibold focus-visible:outline-2 disabled:opacity-60"
        >
          {pending ? 'Hazırlanıyor…' : 'Bunu birine sor'}
        </button>
        {error && (
          <p role="alert" className="text-incorrect mt-2 text-sm">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="text-muted text-xs">
        {copied ? '✓ Bağlantı kopyalandı.' : 'Bağlantını gönder:'}
      </p>
      <div className="mt-2 flex gap-2">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(`${message} ${url}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="border-border text-ink focus-visible:outline-ink flex min-h-11 flex-1 items-center justify-center rounded-lg border text-sm font-semibold focus-visible:outline-2"
        >
          WhatsApp
        </a>
        <a
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}&url=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="border-border text-ink focus-visible:outline-ink flex min-h-11 flex-1 items-center justify-center rounded-lg border text-sm font-semibold focus-visible:outline-2"
        >
          X
        </a>
      </div>
      <label className="mt-2 block">
        <span className="sr-only">Bağlantı</span>
        <input
          type="text"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="border-border bg-surface text-muted w-full rounded-lg border px-3 py-2 text-xs"
        />
      </label>
      <p className="text-muted mt-2 text-xs">
        Arkadaşın senin ne dediğini, kendi tahminini yapmadan göremeyecek.
      </p>
    </div>
  );
}
