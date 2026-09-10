'use client';

import { useState } from 'react';

/**
 * PAYLAŞ ÇUBUĞU — paylaşım özelliğinin eksik kalan yarısı.
 *
 * ── NEDEN GEREKLİ ──────────────────────────────────────────────────────────
 * İlk sürümde kapak kuruluyor, adresi oluşuyor ve kullanıcı ekranda ne
 * yapacağını bilmeden kalıyordu: bağlantıyı adres çubuğundan elle seçip
 * kopyalaması gerekiyordu. Paylaşılmak için yapılmış bir şeyin paylaşma
 * düğmesi yoksa, o şey paylaşılmaz.
 *
 * ── ÜÇ KADEMELİ GERİ DÜŞÜŞ ─────────────────────────────────────────────────
 * Kullanıcının tarayıcısı bilinmiyor (Windows 7 + eski Chrome dâhil), bu
 * yüzden tek bir API'ye güvenilmez:
 *   1. `navigator.share` — telefonda sistemin kendi paylaşım menüsü açılır.
 *   2. `navigator.clipboard` — masaüstünde panoya kopyalar.
 *   3. Salt okunur bir kutu — ikisi de yoksa kullanıcı metni kendi seçer.
 * Üçüncü kademe her zaman EKRANDA DURUR; "kopyalandı" diyemediğimiz durumda
 * kullanıcı boşluğa bakmaz.
 *
 * WhatsApp ve X bağlantıları düz `href`'tir: ne bir betik yüklenir, ne bir
 * izleme pikseli konur. Paylaşım kimin nereye gittiğini bize bildirmez;
 * yalnızca kapağın kendi sayacı artar.
 */
export function ShareBar({
  url,
  title,
  username,
}: {
  readonly url: string;
  readonly title: string;
  readonly username: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const message = `${title} — @${username} tahminlerini ortaya koydu. Sen ne diyorsun?`;

  async function share() {
    setFailed(false);

    // 1. Telefonun kendi paylaşım menüsü.
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: message, url });
        return;
      } catch {
        // Kullanıcı vazgeçmiş olabilir; sessizce panoya düş.
      }
    }

    // 2. Pano.
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      return;
    } catch {
      // 3. Elle seçme kutusu zaten ekranda.
      setFailed(true);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={share}
        className="bg-brand text-brand-fg focus-visible:outline-ink min-h-11 w-full rounded-lg px-5 font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {copied ? '✓ Bağlantı kopyalandı' : 'Gazeteni paylaş'}
      </button>

      <div className="mt-3 flex gap-2">
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

      {/* Üçüncü kademe: her zaman görünür, kopyalama çalışmasa da işe yarar. */}
      <label className="mt-3 block">
        <span className="text-muted text-xs">Bağlantı</span>
        <input
          type="text"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="border-border bg-surface text-muted mt-1 w-full rounded-lg border px-3 py-2 text-xs"
        />
      </label>

      {failed && (
        <p role="status" className="text-muted mt-2 text-xs">
          Tarayıcın otomatik kopyalamaya izin vermedi. Yukarıdaki kutudaki adresi seçip kopyala.
        </p>
      )}
    </div>
  );
}
