import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrateTestDatabase, truncateAll } from './setup';

/**
 * Kimlik şemasının bütünlük kuralları — GERÇEK PostgreSQL üzerinde.
 *
 * Buradaki her kural, uygulama katmanındaki kontrolün ATLANDIĞI durumda devreye
 * girer: kod hatası, migration hatası, elle SQL veya yarış koşulu.
 */

const sql = createSql();

const baseUser = (over: Record<string, unknown> = {}) => ({
  id: `u_${Math.random().toString(36).slice(2, 12)}`,
  username: 'Emir',
  username_lower: 'emir',
  email: 'emir@example.com',
  terms_accepted_at: new Date(),
  terms_version: '2026-09-01',
  ...over,
});

async function insertUser(over: Record<string, unknown> = {}) {
  const u = baseUser(over);
  await sql`INSERT INTO "user" ${sql(u)}`;
  return u;
}

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await truncateAll(sql);
});

afterAll(async () => {
  await sql.end();
});

describe('kullanıcı adı bütünlüğü', () => {
  it('geçerli kullanıcıyı kabul eder', async () => {
    await expect(insertUser()).resolves.toBeDefined();
  });

  it('kullanıcı adı büyük/küçük harften bağımsız TEKİLDİR', async () => {
    await insertUser({ username: 'Emir', username_lower: 'emir' });
    // "EMIR" farklı bir yazım ama aynı kişiyi taklit eder — reddedilmeli
    await expect(
      insertUser({ username: 'EMIR', username_lower: 'emir', email: 'baska@example.com' }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('username_lower ile username tutarsız olamaz', async () => {
    await expect(insertUser({ username: 'Emir', username_lower: 'mert' })).rejects.toThrow(
      /user_username_lower_consistent/,
    );
  });

  it('geçersiz karakterli kullanıcı adını reddeder', async () => {
    await expect(insertUser({ username: 'emir-can', username_lower: 'emir-can' })).rejects.toThrow(
      /user_username_format/,
    );
  });

  it('çok kısa kullanıcı adını reddeder', async () => {
    await expect(insertUser({ username: 'ab', username_lower: 'ab' })).rejects.toThrow(
      /user_username_format/,
    );
  });
});

describe('e-posta bütünlüğü', () => {
  it('normalize edilmemiş e-postayı reddeder', async () => {
    await expect(insertUser({ email: 'Emir@Example.com' })).rejects.toThrow(
      /user_email_normalized/,
    );
    await expect(insertUser({ email: ' emir@example.com ' })).rejects.toThrow(
      /user_email_normalized/,
    );
  });

  it('e-posta tekildir', async () => {
    await insertUser();
    await expect(insertUser({ username: 'Mert', username_lower: 'mert' })).rejects.toThrow(
      /duplicate key|unique/i,
    );
  });
});

describe('oturum bütünlüğü (ADR-06a)', () => {
  it('geçmiş tarihli son kullanma reddedilir', async () => {
    const user = await insertUser();
    await expect(
      sql`INSERT INTO "session" ("id","user_id","expires_at","created_at")
          VALUES ('s1', ${user.id}, now() - interval '1 day', now())`,
    ).rejects.toThrow(/session_expiry_after_creation/);
  });

  it('kullanıcı silindiğinde oturumları da silinir', async () => {
    const user = await insertUser();
    await sql`INSERT INTO "session" ("id","user_id","expires_at")
              VALUES ('s2', ${user.id}, now() + interval '30 days')`;
    await sql`DELETE FROM "user" WHERE id = ${user.id}`;
    const rows = await sql`SELECT 1 FROM "session" WHERE id = 's2'`;
    expect(rows).toHaveLength(0);
  });
});

describe('token bütünlüğü', () => {
  it('aynı amaçla ikinci AKTİF token oluşturulamaz', async () => {
    const user = await insertUser();
    await sql`INSERT INTO "verification_token" ("token_hash","user_id","purpose","expires_at")
              VALUES ('hash1', ${user.id}, 'PASSWORD_RESET', now() + interval '15 minutes')`;

    // Yeni sıfırlama bağlantısı üretmek, öncekini geçersiz kılmadan yazılamaz
    await expect(
      sql`INSERT INTO "verification_token" ("token_hash","user_id","purpose","expires_at")
          VALUES ('hash2', ${user.id}, 'PASSWORD_RESET', now() + interval '15 minutes')`,
    ).rejects.toThrow(/verification_one_active_per_purpose/);
  });

  it('tüketilmiş token yeni token yazımını engellemez', async () => {
    const user = await insertUser();
    await sql`INSERT INTO "verification_token" ("token_hash","user_id","purpose","expires_at","consumed_at")
              VALUES ('hash3', ${user.id}, 'PASSWORD_RESET', now() + interval '15 minutes', now())`;
    await expect(
      sql`INSERT INTO "verification_token" ("token_hash","user_id","purpose","expires_at")
          VALUES ('hash4', ${user.id}, 'PASSWORD_RESET', now() + interval '15 minutes')`,
    ).resolves.toBeDefined();
  });

  it('farklı amaçlar aynı anda aktif olabilir', async () => {
    const user = await insertUser();
    await sql`INSERT INTO "verification_token" ("token_hash","user_id","purpose","expires_at")
              VALUES ('h5', ${user.id}, 'PASSWORD_RESET', now() + interval '15 minutes')`;
    await expect(
      sql`INSERT INTO "verification_token" ("token_hash","user_id","purpose","expires_at")
          VALUES ('h6', ${user.id}, 'EMAIL_VERIFICATION', now() + interval '24 hours')`,
    ).resolves.toBeDefined();
  });
});

describe('profil bütünlüğü', () => {
  it('negatif takipçi sayısı reddedilir', async () => {
    const user = await insertUser();
    await sql`INSERT INTO "profile" ("user_id","display_name") VALUES (${user.id}, 'Emir')`;
    await expect(
      sql`UPDATE "profile" SET follower_count = -1 WHERE user_id = ${user.id}`,
    ).rejects.toThrow(/profile_counts_non_negative/);
  });
});
