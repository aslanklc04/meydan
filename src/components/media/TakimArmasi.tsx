'use client';

import { useState } from 'react';

/**
 * TAKIM ARMASI — yüklenemezse KENDİNİ SİLER.
 *
 * ── NEDEN GEREKLİ ──────────────────────────────────────────────────────────
 * Armalar bizim sunucumuzdan değil, dış bir kaynaktan geliyor. O kaynak bir
 * gün yavaşlar, bir görsel silinir ya da kullanıcının ağı o adresi engeller —
 * ve ekranda takım armasının yerinde tarayıcının "kırık görsel" simgesi
 * belirir. Bu, sitenin bakımsız olduğunu düşündüren türden bir ayrıntıdır ve
 * tam olarak güven isteyen bir üründe olmaması gereken şeydir.
 *
 * Denemede (dış ağın kapalı olduğu bir ortamda) bütün armalar kırık simgeyle
 * göründü; ürün bu durumu hiç ele almıyordu.
 *
 * Arma BİLGİ TAŞIMAZ, süstür: takım adı zaten yanında yazıyor. Bu yüzden
 * yüklenemediğinde doğru davranış yerine bir şey koymak değil, sessizce
 * kaybolmaktır — yer tutucu bir kutu da ekranı bozardı.
 */
export function TakimArmasi({
  src,
  boyut = 28,
  className = '',
}: {
  readonly src: string | null;
  readonly boyut?: number;
  readonly className?: string;
}) {
  const [bozuk, setBozuk] = useState(false);
  if (!src || bozuk) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={boyut}
      height={boyut}
      loading="lazy"
      onError={() => setBozuk(true)}
      className={className}
    />
  );
}
