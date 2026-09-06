import { execSync } from 'node:child_process';
import postgres from 'postgres';

/**
 * Entegrasyon testleri GERÇEK PostgreSQL üzerinde çalışır.
 *
 * Sahte veritabanıyla test edilemeyecek şeyler tam olarak bunlar:
 * partial unique index, CHECK constraint, FOR UPDATE satır kilidi,
 * transaction geri alma ve eşzamanlılık davranışı.
 *
 * CI'da servis olarak postgres kaldırılır; yerelde `npm run db:up`.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://meydan:meydan@127.0.0.1:5432/meydan_test?sslmode=disable';

export function createSql() {
  return postgres(TEST_DATABASE_URL, { max: 4, prepare: false, onnotice: () => {} });
}

/** Migration'ları test veritabanına uygular. */
export function migrateTestDatabase(): void {
  execSync('npx drizzle-kit migrate', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, SKIP_ENV_VALIDATION: '1' },
    stdio: 'pipe',
  });
}

export async function truncateAll(sql: ReturnType<typeof createSql>): Promise<void> {
  await sql`TRUNCATE TABLE "verification_token", "session", "account", "profile", "user" CASCADE`;
}

let counter = 0;
export function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter}`;
}
