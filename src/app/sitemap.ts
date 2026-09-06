import type { MetadataRoute } from 'next';
import { serverEnv } from '@/config/env';
import { catalogService } from '@/server/modules/catalog/service';

export const revalidate = 3600;

/**
 * Site haritası — yalnızca PUBLIC sayfalar.
 *
 * Kapsam bilinçli olarak dar: ana sayfa, Tahmin Gücü açıklaması ve herkese
 * açık etkinlik sayfaları. Profil sayfaları (`/u/[username]`) haritaya
 * KONMAZ: bunlar kişilere ait sayfalardır ve toplu listelenmeleri, kullanıcı
 * adlarının tek dosyada dökümünü üretir. Profiller kendi `canonical`
 * etiketleriyle zaten indekslenebilir.
 *
 * Hata durumunda harita boş dönmez; en azından statik sayfalar döner —
 * veritabanı erişilemez diye tüm harita kaybolmamalı.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = serverEnv.APP_URL.replace(/\/$/, '');

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/tahmin-gucu`, changeFrequency: 'monthly', priority: 0.5 },
  ];

  try {
    const [open, resolved] = await Promise.all([
      catalogService.listOpenEvents(null, 100),
      catalogService.recentResolved(100),
    ]);

    const openEntries: MetadataRoute.Sitemap = open.map((e) => ({
      url: `${base}/event/${e.slug}`,
      lastModified: e.closesAt,
      changeFrequency: 'hourly' as const,
      priority: 0.8,
    }));

    // Sonuçlanmış etkinlikler değişmez; arama motoruna da öyle söylenir.
    const resolvedEntries: MetadataRoute.Sitemap = resolved.map((e) => ({
      url: `${base}/event/${e.slug}`,
      ...(e.resolvedAt ? { lastModified: e.resolvedAt } : {}),
      changeFrequency: 'yearly' as const,
      priority: 0.4,
    }));

    return [...staticEntries, ...openEntries, ...resolvedEntries];
  } catch {
    return staticEntries;
  }
}
