import { execSync } from 'node:child_process';
import postgres from 'postgres';

/**
 * E2E öncesi veritabanını TEKRARLANABİLİR hâle getirir.
 *
 * Gerekçe: bir E2E koşusu seed etkinliğini sonuçlandırır. Temizlik olmadan
 * ikinci koşu "Galatasaray — Fenerbahçe" etkinliğini akışta bulamaz ve
 * testler kendi geçmişleri yüzünden kırılır.
 */
export default async function globalSetup(): Promise<void> {
  const url =
    process.env.E2E_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://meydan:meydan@127.0.0.1:5432/meydan?sslmode=disable';

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
