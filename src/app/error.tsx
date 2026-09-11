'use client';

import { useEffect } from 'react';
import { ErrorScreen } from '@/components/feedback/ErrorScreen';

/**
 * KÖK HATA SINIRI — ana sayfanın kendi sınırı.
 *
 * ── NEDEN EKLENDİ ──────────────────────────────────────────────────────────
 * Ana sayfa (`src/app/page.tsx`) hiçbir hata sınırının altında değildi.
 * `(marketing)`, `(app)` ve `admin` gruplarının her birinin kendi sınırı
 * vardı; sitenin ÖN KAPISININ yoktu. Bu yüzden ana sayfadaki tek bir hata
 * doğrudan `global-error`'a düşüyor ve ziyaretçi tasarımsız, çıplak bir
 * "Bir sorun oluştu" ekranı görüyordu — üstelik sunucu 500 döndürdüğü için
 * arama motoru da sayfayı bozuk kabul ediyordu.
 *
 * Asıl koruma sayfanın kendi içinde: her bölüm ayrı ayrı korunuyor ve biri
 * düşse bile sayfa açılıyor. Bu sınır SON çaredir; buraya düşülmesi bile
 * artık beklenmiyor.
 */
export default function RootError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error('[kok] beklenmeyen hata', error.digest ?? error.message);
  }, [error]);

  return (
    <ErrorScreen
      reset={reset}
      hint="Bizde geçici bir aksaklık olabilir. Tekrar denemek genelde yeterli oluyor."
      backHref="/sonuclar"
      backLabel="Sonuçlara bak"
    />
  );
}
