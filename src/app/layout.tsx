import type { Metadata, Viewport } from 'next';
import { brand } from '@/config';
import { serverEnv } from '@/config/env';
import './globals.css';

/**
 * Mobil öncelikli görünüm ayarı.
 * `maximumScale` KISITLANMAZ: yakınlaştırmayı engellemek, az gören
 * kullanıcıları dışarıda bırakır (WCAG 1.4.4).
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
};

export const metadata: Metadata = {
  // Göreli `canonical` ve OpenGraph adreslerinin mutlak hale gelmesi için gerekir.
  metadataBase: new URL(serverEnv.APP_URL),
  title: {
    default: `${brand.appName} — ${brand.tagline}`,
    template: `%s · ${brand.appName}`,
  },
  description: brand.description,
  applicationName: brand.appName,
  openGraph: {
    type: 'website',
    locale: 'tr_TR',
    siteName: brand.appName,
    title: `${brand.appName} — ${brand.tagline}`,
    description: brand.description,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${brand.appName} — ${brand.tagline}`,
    description: brand.description,
  },
  /*
   * GOOGLE DOĞRULAMASI — yalnızca değer VARSA.
   *
   * Site hiçbir aramada görünmüyordu; sebebi teknik bir kusur değil,
   * Google'ın siteden habersiz olmasıydı. Search Console'da alan adını
   * doğrulamak bunun ilk adımı ve alt alan adlarında en kolay yolu bu etiket.
   *
   * Değer yoksa etiket hiç basılmaz: boş `content` taşıyan bir doğrulama
   * etiketi, doğrulamayı sessizce başarısız kılar ve neden olmadığı
   * anlaşılmaz.
   */
  ...(serverEnv.GOOGLE_SITE_VERIFICATION
    ? { verification: { google: serverEnv.GOOGLE_SITE_VERIFICATION } }
    : {}),
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="tr" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        {/* Klavye ile gezenler menüyü her sayfada baştan geçmek zorunda kalmasın. */}
        <a href="#icerik" className="skip-link">
          İçeriğe atla
        </a>
        {children}
      </body>
    </html>
  );
}
