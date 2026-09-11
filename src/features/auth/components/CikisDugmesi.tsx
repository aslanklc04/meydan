'use client';

import { useState } from 'react';

/**
 * ÇIKIŞ DÜĞMESİ — onay ister.
 *
 * ── NEDEN ONAY EKLENDİ ─────────────────────────────────────────────────────
 * Çıkış düğmesi üst çubukta, bildirim zilinin 12 piksel yanında, 44x44
 * boyutunda ve onaysız duruyordu: tek dokunuşla oturum kapanıyordu. Site
 * gezintisi sırasında benim kendi denetleme betiğim bile yanlışlıkla bu
 * düğmeye bastı ve oturumu kapattı. Bir otomasyonun karıştırdığı düğmeyi,
 * telefonda başparmakla gezen bir kullanıcı kesinlikle karıştırır.
 *
 * Yanlışlıkla çıkmanın bedeli küçük değil: kullanıcı e-postasını ve parolasını
 * yeniden yazmak zorunda kalır, çoğu kişi o noktada sekmeyi kapatır.
 *
 * ── NEDEN DÜĞME GİZLENMEDİ ─────────────────────────────────────────────────
 * Çözüm düğmeyi zorlaştırmak değil. Çıkış yolu GÖRÜNÜR kalmalı — daha önce
 * profil sayfasının dibinde duruyordu ve kurucu bulamamıştı. Görünür kalır,
 * yalnızca bir adım sorar.
 */
export function CikisDugmesi({ cikis }: { readonly cikis: () => Promise<void> }) {
  const [soruyor, setSoruyor] = useState(false);

  if (!soruyor) {
    return (
      <button
        type="button"
        onClick={() => setSoruyor(true)}
        aria-label="Oturumu kapat"
        title="Oturumu kapat"
        className="text-muted focus-visible:outline-ink flex min-h-11 min-w-11 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span aria-hidden="true" className="text-lg">
          ⏻
        </span>
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Çıkış onayı"
      className="border-border bg-background absolute top-full right-4 z-20 mt-2 w-60 rounded-xl border p-3 shadow-lg"
    >
      <p className="text-ink text-sm font-semibold">Oturumu kapatalım mı?</p>
      <p className="text-muted mt-1 text-xs">Tekrar girmek için e-posta ve parola gerekecek.</p>
      <div className="mt-3 flex gap-2">
        <form action={cikis} className="flex-1">
          <button
            type="submit"
            className="border-border text-ink focus-visible:outline-ink min-h-11 w-full rounded-lg border text-sm font-semibold focus-visible:outline-2"
          >
            Çıkış yap
          </button>
        </form>
        <button
          type="button"
          onClick={() => setSoruyor(false)}
          className="bg-brand text-brand-fg focus-visible:outline-ink min-h-11 flex-1 rounded-lg text-sm font-bold focus-visible:outline-2"
        >
          Vazgeç
        </button>
      </div>
    </div>
  );
}
