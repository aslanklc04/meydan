import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { serverEnv } from '@/config/env';
import { normalizeDatabaseUrl } from './url';
import * as schema from './schema';

/**
 * Veritabanı istemcisi — tek örnek.
 *
 * Bu modül yalnızca `src/server/**` içinden import edilir. UI katmanının doğrudan
 * erişimi ESLint ile engellenir (Bölüm 3.2, KURAL 1), çünkü UI'nin veritabanına
 * doğrudan erişimi transaction sınırlarını görünmez şekilde kırar.
 */
declare global {
  var __meydanSql: ReturnType<typeof postgres> | undefined;
}

/**
 * HAVUZ BOYUTU — sunucusuz (serverless) ortam için bilinçli olarak KÜÇÜK.
 *
 * Vercel'de her eşzamanlı istek dalgası yeni bir çalışma örneği doğurabilir ve
 * HER ÖRNEK kendi havuzunu açar. Örnek başına 20 bağlantı, 10 örnekte 200
 * bağlantı demektir; ücretsiz katmandaki yönetilen PostgreSQL'in sınırı
 * genelde bunun çok altındadır. Sınır dolduğunda arıza "yavaşlama" değil,
 * "veritabanına bağlanılamıyor" olur ve TÜM kullanıcıları vurur.
 *
 * Doğru ayar, örnek başına küçük bir havuz + sağlayıcının havuzlanmış
 * (pooled / pgbouncer) bağlantı dizesidir.
 *
 * `prepare: false` ZORUNLUDUR: pgbouncer'ın transaction modunda hazırlanmış
 * ifadeler oturumlar arasında taşınmaz.
 */
const POOL_MAX = process.env.NODE_ENV === 'production' ? 3 : 5;

/**
 * Sağlayıcı panelinden kopyalanan adres, sürücünün tanımadığı parametreler
 * içerebilir ve bu bağlantıyı tamamen engeller (bkz. ./url.ts).
 */
const { url: DB_URL, dropped } = normalizeDatabaseUrl(serverEnv.DATABASE_URL);
if (dropped.length > 0) {
  // Yalnızca ADLAR yazılır; adresin kendisi ve parola asla günlüğe girmez.
  console.warn(
    `[veritabanı] Desteklenmeyen bağlantı parametreleri yok sayıldı: ${dropped.join(', ')}`,
  );
}

const connection =
  globalThis.__meydanSql ??
  postgres(DB_URL, {
    max: POOL_MAX,
    idle_timeout: 20,
    /** Soğuk başlangıçta ağ yavaşsa istek asılı kalmasın. */
    connect_timeout: 15,
    prepare: false,
  });

// Üretimde de saklanır: modül yeniden değerlendirildiğinde (sıcak örnek) yeni
// bir havuz açılmasını ve bağlantıların sızmasını engeller.
globalThis.__meydanSql = connection;

export const db = drizzle(connection, { schema, casing: 'snake_case' });

export type Database = typeof db;

/**
 * Transaction sarmalayıcı — Spesifikasyon Bölüm 5.2.
 *
 * KURAL: transaction'ı yalnızca use-case servisi açar. CoinService gibi alt
 * servisler kendilerine verilen `tx` bağlamında çalışır, kendi başlarına commit
 * etmezler. "Stake düşüldü ama challenge yaratılmadı" durumu böylece imkânsızdır.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

export { schema };
