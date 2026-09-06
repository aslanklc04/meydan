import { ToastProvider } from '@/components/feedback/Toast';

/**
 * Public kabuk — giriş yapmamış ziyaretçi de görebilir.
 *
 * ToastProvider burada da gerekli: public etkinlik sayfasındaki tahmin kartı
 * (giriş yapmış kullanıcı için) başarı mesajını bu katmanda gösterir (ADR-20).
 */
export default function MarketingLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div id="icerik">{children}</div>
    </ToastProvider>
  );
}
