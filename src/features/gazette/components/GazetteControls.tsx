'use client';

import { useState, useTransition } from 'react';
import { reportAction } from '@/features/social/actions';
import { makeGazettePrivateAction } from '../actions';

/**
 * Kapak sayfasının alt kontrolleri: bildir (herkes) ve raftan çek (sahibi).
 *
 * ── NEDEN İKİSİ AYNI DOSYADA ───────────────────────────────────────────────
 * İkisi de aynı soruya cevap verir: "bu kapak burada durmasın." Farkı kimin
 * sorduğudur. Bir arada durmaları, birinin eklenip diğerinin unutulmasını
 * zorlaştırır — şikâyet yolu olmayan bir açık raf, ürünün taşıyamayacağı bir
 * sorumluluktur.
 *
 * ── BİLDİRİM OTOMATİK YAPTIRIM ÜRETMEZ ─────────────────────────────────────
 * Tek bir bildirim içeriği kaldırmaz. Kaldırsaydı, birinden hoşlanmayan üç
 * kişi onun kapağını istediği zaman sustururdu. Bildirim bir kuyruğa düşer,
 * kararı insan verir. Kullanıcıya da bu söylenir — "kaldırdık" demek yalan
 * olurdu.
 */
export function GazetteControls({
  publicToken,
  isOwner,
  isPublic,
}: {
  readonly publicToken: string;
  readonly isOwner: boolean;
  readonly isPublic: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function report(reason: 'ABUSE' | 'SPAM' | 'IMPERSONATION' | 'OTHER') {
    startTransition(async () => {
      const result = await reportAction({ targetType: 'GAZETTE', targetId: publicToken, reason });
      setMessage(result.message);
      setReportOpen(false);
    });
  }

  function makePrivate() {
    startTransition(async () => {
      const result = await makeGazettePrivateAction(publicToken);
      setMessage(result.message);
      setConfirming(false);
    });
  }

  return (
    <div className="mt-6 text-center">
      {message && (
        <p role="status" className="text-muted mb-3 text-sm">
          {message}
        </p>
      )}

      {isOwner && isPublic && !confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-muted min-h-11 text-xs underline"
        >
          Bu kapağı ana sayfadaki raftan çek
        </button>
      )}

      {isOwner && isPublic && confirming && (
        /* GERİ DÖNÜŞÜ OLMADIĞI, BASMADAN ÖNCE SÖYLENİR. */
        <div className="border-border rounded-lg border border-dashed p-3">
          <p className="text-muted text-xs">
            Kapağın raftan iner ve <strong>bir daha geri konamaz</strong>. Manşetler silinmez,
            bağlantın çalışmaya devam eder — sadece sitede listelenmez.
          </p>
          <div className="mt-3 flex justify-center gap-2">
            <button
              type="button"
              onClick={makePrivate}
              disabled={pending}
              className="border-border text-ink min-h-11 rounded-lg border px-4 text-sm font-semibold disabled:opacity-50"
            >
              {pending ? 'Çekiliyor…' : 'Evet, raftan çek'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-muted min-h-11 px-4 text-sm"
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {!isOwner && !reportOpen && (
        <button
          type="button"
          onClick={() => setReportOpen(true)}
          className="text-muted min-h-11 text-xs underline"
        >
          Bu kapağı bildir
        </button>
      )}

      {!isOwner && reportOpen && (
        <div className="border-border rounded-lg border border-dashed p-3">
          <p className="text-muted text-xs">Sebebi seç. Bildirim bir kişi tarafından incelenir.</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {(
              [
                ['ABUSE', 'Hakaret / taciz'],
                ['SPAM', 'İstenmeyen içerik'],
                ['IMPERSONATION', 'Kimlik taklidi'],
                ['OTHER', 'Diğer'],
              ] as const
            ).map(([reason, label]) => (
              <button
                key={reason}
                type="button"
                onClick={() => report(reason)}
                disabled={pending}
                className="border-border text-ink min-h-11 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50"
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setReportOpen(false)}
              className="text-muted min-h-11 px-3 text-xs"
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
