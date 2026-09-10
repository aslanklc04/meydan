import Link from 'next/link';
import { currentActor } from '@/server/auth';
import { triggerMaintenanceAfterResponse } from '@/server/modules/governance/visit-trigger';
import { ToastProvider } from '@/components/feedback/Toast';
import { brand } from '@/config';

/**
 * Public kabuk — giriş yapmamış ziyaretçi de görebilir.
 *
 * ÜST ÇUBUK NEDEN EKLENDİ: bu kabuk gezinme içermiyordu. Ana sayfadaki Günün
 * Meydanı'ndan bir etkinliğe giren kullanıcı çıkmaz sokakta kalıyordu —
 * geri dönmenin tek yolu tarayıcının geri düğmesiydi, ve giriş yaptıktan
 * sonra oraya düşen kullanıcı kendi akışını bile bulamıyordu. Yazılmış ama
 * ulaşılamayan ekran, yazılmamış ekrandır.
 *
 * Bağlantı kullanıcının durumuna göre değişir: giriş yapmışsa akışına,
 * yapmamışsa ana sayfaya gider. İkisi de "buradan çıkabilirim" der.
 *
 * ToastProvider burada da gerekli: public etkinlik sayfasındaki tahmin kartı
 * (giriş yapmış kullanıcı için) başarı mesajını bu katmanda gösterir (ADR-20).
 */
export default async function MarketingLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const actor = await currentActor();

  /*
   * BAKIM İŞİ BURADA DA TETİKLENİR.
   *
   * Daha önce yalnızca oturum içi kabukta duruyordu ve canlıda şu görüldü:
   * kurucu bir gün giriş yapmayınca maç çekilmedi, Günün Meydanı seçilmedi
   * ve ana sayfa boş kaldı — hem de tam olarak siteyi ilk kez gören
   * ziyaretçiler için. Ürünün en çok dolu görünmesi gereken sayfa, en boş
   * kalan sayfaydı.
   *
   * Ziyaretçi beklemez: iş yanıttan sonra çalışır ve bayat değilse hiç
   * başlamaz.
   */
  triggerMaintenanceAfterResponse();

  return (
    <ToastProvider>
      <div className="flex min-h-full flex-col">
        <header className="border-border bg-background sticky top-0 z-10 border-b">
          <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-3">
            <Link
              href={actor ? '/app/feed' : '/'}
              className="text-ink focus-visible:outline-ink text-lg font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {brand.appName}
            </Link>

            {actor ? (
              <Link
                href="/app/feed"
                className="text-brand focus-visible:outline-ink flex min-h-11 items-center text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Akışıma dön
              </Link>
            ) : (
              <div className="flex items-center gap-3 text-sm">
                <Link
                  href="/login"
                  className="text-ink focus-visible:outline-ink flex min-h-11 items-center font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  Giriş yap
                </Link>
                <Link
                  href="/register"
                  className="bg-brand text-brand-fg focus-visible:outline-ink flex min-h-11 items-center rounded-lg px-3 font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  Katıl
                </Link>
              </div>
            )}
          </div>
        </header>

        <div id="icerik" className="flex-1">
          {children}
        </div>
      </div>
    </ToastProvider>
  );
}
