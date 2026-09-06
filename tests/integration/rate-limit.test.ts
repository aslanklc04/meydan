import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrateTestDatabase } from './setup';
import {
  enforceSharedRateLimit,
  pruneRateLimitCounters,
  remainingSharedQuota,
} from '../../src/server/security/shared-rate-limit';
import { rateLimits, noviceAccount } from '../../src/config';

/**
 * PAYLAŞIMLI ORAN SINIRLAMA — Faz 6.
 *
 * Sınanan asıl şey, sayacın SÜREÇ DIŞINDA olmasıdır: aynı kimlik farklı
 * "instance"lardan gelse de tek sayaç görür. Testte bu, aynı veritabanına
 * ayrı çağrılar yapılarak temsil edilir — süreç belleğinde tutulan bir sayaç
 * bu testi geçemezdi.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE rate_limit_counter`;
});

afterAll(async () => {
  await sql.end();
});

const LOGIN = rateLimits['auth.login'];

describe('sınır uygulaması', () => {
  it('limite kadar geçer, limitten sonra REDDEDER', async () => {
    const identity = { userId: 'kullanici-a', ipHash: 'ip-a' };

    for (let i = 0; i < LOGIN.limit; i += 1) {
      await expect(enforceSharedRateLimit('auth.login', identity)).resolves.toBeUndefined();
    }

    await expect(enforceSharedRateLimit('auth.login', identity)).rejects.toThrow(
      /çok hızlı|bekleyip/i,
    );
  });

  it('FARKLI kimlikler birbirini etkilemez', async () => {
    const a = { userId: 'a', ipHash: 'ip-a' };
    const b = { userId: 'b', ipHash: 'ip-b' };

    for (let i = 0; i < LOGIN.limit; i += 1) {
      await enforceSharedRateLimit('auth.login', a);
    }
    await expect(enforceSharedRateLimit('auth.login', a)).rejects.toThrow();

    // B hiç istek yapmadı; onun hakkı dokunulmamış olmalı.
    await expect(enforceSharedRateLimit('auth.login', b)).resolves.toBeUndefined();
  });

  it('FARKLI eylemler ayrı sayaç kullanır', async () => {
    const identity = { userId: 'a', ipHash: 'ip-a' };

    for (let i = 0; i < LOGIN.limit; i += 1) {
      await enforceSharedRateLimit('auth.login', identity);
    }
    await expect(enforceSharedRateLimit('auth.login', identity)).rejects.toThrow();

    // Kayıt sınırı ayrıdır; giriş sınırının dolması onu kapatmaz.
    await expect(enforceSharedRateLimit('auth.register', identity)).resolves.toBeUndefined();
  });

  it('PENCERE ilerleyince hak yenilenir', async () => {
    const identity = { userId: 'a', ipHash: 'ip-a' };
    const now = Date.now();

    for (let i = 0; i < LOGIN.limit; i += 1) {
      await enforceSharedRateLimit('auth.login', identity, now);
    }
    await expect(enforceSharedRateLimit('auth.login', identity, now)).rejects.toThrow();

    // Bir pencere sonrası: yeni kova, temiz sayfa.
    const nextWindow = now + LOGIN.windowSec * 1000;
    await expect(
      enforceSharedRateLimit('auth.login', identity, nextWindow),
    ).resolves.toBeUndefined();
  });

  it('AYNI kimlik ayrı çağrılardan tek sayaç görür (süreç dışı)', async () => {
    const identity = { userId: 'paylasimli', ipHash: 'ip-p' };
    const now = Date.now();

    // Sayaç süreç belleğinde olsaydı her çağrı kendi sayacını görür ve
    // aşağıdaki reddetme GERÇEKLEŞMEZDİ.
    await Promise.all(
      Array.from({ length: LOGIN.limit }, () =>
        enforceSharedRateLimit('auth.login', identity, now),
      ),
    );

    await expect(enforceSharedRateLimit('auth.login', identity, now)).rejects.toThrow();

    const rows = await sql`SELECT hits FROM rate_limit_counter`;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.hits)).toBeGreaterThanOrEqual(LOGIN.limit);
  });

  it('EŞZAMANLI istekler sayacı ATLAYAMAZ', async () => {
    const identity = { userId: 'yaris', ipHash: 'ip-y' };
    const now = Date.now();
    const attempts = LOGIN.limit + 10;

    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () => enforceSharedRateLimit('auth.login', identity, now)),
    );

    const passed = results.filter((r) => r.status === 'fulfilled').length;
    // Atomik UPSERT sayesinde limitten fazlası geçemez.
    expect(passed).toBe(LOGIN.limit);
  });
});

describe('kalan hak', () => {
  it('kullanıldıkça azalır', async () => {
    const identity = { userId: 'a', ipHash: 'ip-a' };
    expect(await remainingSharedQuota('auth.login', identity)).toBe(LOGIN.limit);

    await enforceSharedRateLimit('auth.login', identity);
    expect(await remainingSharedQuota('auth.login', identity)).toBe(LOGIN.limit - 1);
  });

  it('YENİ HESAP için sınır daha sıkıdır', async () => {
    const identity = {
      userId: 'yeni',
      ipHash: 'ip-yeni',
      accountCreatedAt: new Date(),
    };

    const expected = Math.max(1, Math.floor(LOGIN.limit * noviceAccount.multiplier));
    expect(await remainingSharedQuota('auth.login', identity)).toBe(expected);
    expect(expected).toBeLessThan(LOGIN.limit);
  });

  it('ESKİ HESAP tam sınırı görür', async () => {
    const identity = {
      userId: 'eski',
      ipHash: 'ip-eski',
      accountCreatedAt: new Date(Date.now() - (noviceAccount.windowHours + 1) * 3600_000),
    };
    expect(await remainingSharedQuota('auth.login', identity)).toBe(LOGIN.limit);
  });
});

describe('temizlik', () => {
  it('süresi dolmuş sayaçlar silinir, güncel olanlar KALIR', async () => {
    const now = Date.now();
    await enforceSharedRateLimit('auth.login', { userId: 'eski', ipHash: 'i' }, now);
    await enforceSharedRateLimit('auth.login', { userId: 'yeni', ipHash: 'i' }, now);

    // Pencerenin bitiminden sonrasına bakılır: iki kova da süresini doldurur.
    const after = new Date(now + LOGIN.windowSec * 1000 + 1000);
    const deleted = await pruneRateLimitCounters(after);
    expect(deleted).toBe(2);

    const remaining = await sql`SELECT count(*)::int AS n FROM rate_limit_counter`;
    expect(remaining[0]?.n).toBe(0);
  });

  it('temizlik güncel sayaçlara DOKUNMAZ', async () => {
    const now = Date.now();
    await enforceSharedRateLimit('auth.login', { userId: 'aktif', ipHash: 'i' }, now);

    const deleted = await pruneRateLimitCounters(new Date(now));
    expect(deleted).toBe(0);

    const remaining = await sql`SELECT count(*)::int AS n FROM rate_limit_counter`;
    expect(remaining[0]?.n).toBe(1);
  });
});
