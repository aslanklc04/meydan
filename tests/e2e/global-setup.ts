import { execSync } from 'node:child_process';
import postgres from 'postgres';

/**
 * E2E öncesi veritabanını TEKRARLANABİLİR hâle getirir.
 *
 * Gerekçe: bir E2E koşusu seed etkinliğini sonuçlandırır. Temizlik olmadan
 * ikinci koşu "Galatasaray — Fenerbahçe" etkinliğini akışta bulamaz ve
 * testler kendi geçmişleri yüzünden kırılır.
 */
/**
 * ÜRETİM VERİTABANINI SİLMEYE KARŞI EMNİYET KİLİDİ.
 *
 * Bu dosya TRUNCATE çalıştırır. Adres `E2E_DATABASE_URL` yoksa
 * `DATABASE_URL`'e düşüyordu — ve `DATABASE_URL` üretim ortamında ÜRETİM
 * VERİTABANIDIR. Yani üretim ortam değişkenleri yüklüyken E2E çalıştırmak
 * bütün kullanıcıları, tahminleri ve çip defterini silerdi. Yedekten dönmek
 * dışında geri dönüşü yoktur.
 *
 * Bu yüzden adres artık DENETLENİR: yalnızca yerel makinedeki ya da adı
 * açıkça test olduğunu söyleyen bir veritabanı silinebilir. Şüpheli her
 * durumda test BAŞLAMADAN durur.
 *
 * Kural bilinçli olarak katıdır: yanlış pozitifin bedeli "test çalışmadı",
 * yanlış negatifin bedeli "üretim verisi gitti".
 */
function assertSafeToTruncate(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('E2E: veritabanı adresi okunamadı. Test durduruldu.');
  }

  const host = parsed.hostname.toLowerCase();
  const name = parsed.pathname.replace(/^\//, '').toLowerCase();

  const localHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const testName = name.endsWith('_test') || name.endsWith('_e2e');

  if (!localHost && !testName) {
    throw new Error(
      'E2E DURDURULDU: bu adres yerel bir veritabanı değil ve adı test veritabanı gibi ' +
        'görünmüyor. E2E testleri tabloları TRUNCATE eder; üretim verisi silinebilirdi. ' +
        'E2E_DATABASE_URL değerini yerel ya da _test ile biten bir veritabanına ayarla.',
    );
  }
}

export default async function globalSetup(): Promise<void> {
  const url =
    process.env.E2E_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://meydan:meydan@127.0.0.1:5432/meydan?sslmode=disable';

  assertSafeToTruncate(url);

  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    await sql`
      TRUNCATE TABLE
        coin_ledger, coin_account, rating_history, user_category_stat, user_rating,
        event_resolution, challenge, prediction, event_outcome, event, event_template,
        category, verification_token, session, account, profile, "user",
        -- Faz 6: oran sınırlama sayacı da temizlenir, aksi hâlde bir önceki
        -- koşunun sayaçları yenisini engeller.
        rate_limit_counter, job_run, audit_log, user_interest
      CASCADE`;
  } finally {
    await sql.end();
  }

  execSync('npx tsx scripts/seed.ts', {
    env: { ...process.env, DATABASE_URL: url, SKIP_ENV_VALIDATION: '1' },
    stdio: 'pipe',
  });
}
