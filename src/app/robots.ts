import type { MetadataRoute } from 'next';
import { serverEnv } from '@/config/env';

/**
 * robots.txt — Faz 5.
 *
 * KURAL: yalnızca herkese açık, kalıcı içerik indekslenir.
 * `/app/*` oturum içi ekranlardır (kişiye özel, oturum gerektirir),
 * `/admin/*` yönetimdir, `/api/*` makine arayüzüdür — hiçbiri arama
 * sonuçlarında işe yaramaz ve indekslenmeleri gereksiz tarama üretir.
 */
export default function robots(): MetadataRoute.Robots {
  const base = serverEnv.APP_URL.replace(/\/$/, '');
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/app/',
          '/admin/',
          '/api/',
          '/login',
          '/register',
          '/reset-password',
          '/verify-email',
          /*
           * Gelecek Gazetesi bağlantıları TAHMİN EDİLEMEZ ama "gizli" değildir.
           * Dizine girerlerse kullanıcının paylaştığı kişilerin ötesine yayılır
           * ve kiminle paylaşılacağı kararı kullanıcının elinden çıkar. Sayfa
           * ayrıca kendi başlığında da indekslenmemeyi söyler; ikisi birden
           * durur çünkü robots.txt bir rica, sayfa etiketi ise ikinci kapıdır.
           */
          '/g/',
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
