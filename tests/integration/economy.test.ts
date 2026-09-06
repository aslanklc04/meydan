import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrateTestDatabase } from './setup';
import { db, withTransaction } from '../../src/server/db';
import { coinService, ledgerKeys } from '../../src/server/modules/economy/service';
import { economy } from '../../src/config';
import { createUser } from '../factories';

/**
 * Gümüş Çip ekonomisi — GERÇEK PostgreSQL üzerinde.
 *
 * Gümüş Çip sanal bir puandır; gerçek para değildir. Buradaki testler para
 * bütünlüğünü değil, OYUN İÇİ ekonominin tutarlılığını doğrular.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE coin_ledger, coin_account, "user" CASCADE`;
});

afterAll(async () => {
  await sql.end();
});

describe('başlangıç çipi', () => {
  it('kayıtta 1.000 Gümüş Çip verilir', async () => {
    const user = await createUser();
    expect(await coinService.getBalance(user.userId)).toBe(economy.initialGrant);
  });

  it('başlangıç çipi iki kez verilemez', async () => {
    const user = await createUser();
    const result = await withTransaction((tx) => coinService.grantInitial(tx, user.userId));

    expect(result.alreadyPosted).toBe(true);
    expect(await coinService.getBalance(user.userId)).toBe(economy.initialGrant);
  });
});

describe('bakiye hareketleri', () => {
  it('harcama bakiyeyi düşürür', async () => {
    const user = await createUser();
    await withTransaction((tx) =>
      coinService.post(tx, {
        ownerId: user.userId,
        amount: -50,
        type: 'CHALLENGE_STAKE',
        idempotencyKey: 'test:stake:1',
      }),
    );
    expect(await coinService.getBalance(user.userId)).toBe(economy.initialGrant - 50);
  });

  it('bakiyeden fazla harcama REDDEDİLİR', async () => {
    const user = await createUser();
    await expect(
      withTransaction((tx) =>
        coinService.post(tx, {
          ownerId: user.userId,
          amount: -(economy.initialGrant + 1),
          type: 'CHALLENGE_STAKE',
          idempotencyKey: 'test:stake:overdraft',
        }),
      ),
    ).rejects.toThrow(/yeterli Gümüş Çipin yok/i);

    expect(await coinService.getBalance(user.userId)).toBe(economy.initialGrant);
  });

  it('reddedilen harcama ledger kaydı oluşturmaz', async () => {
    const user = await createUser();
    await expect(
      withTransaction((tx) =>
        coinService.post(tx, {
          ownerId: user.userId,
          amount: -99_999,
          type: 'CHALLENGE_STAKE',
          idempotencyKey: 'test:stake:fail',
        }),
      ),
    ).rejects.toThrow();

    const rows = await sql`SELECT 1 FROM coin_ledger WHERE idempotency_key = 'test:stake:fail'`;
    expect(rows).toHaveLength(0);
  });

  it('sıfır tutarlı hareket reddedilir', async () => {
    const user = await createUser();
    await expect(
      withTransaction((tx) =>
        coinService.post(tx, {
          ownerId: user.userId,
          amount: 0,
          type: 'ADMIN_ADJUSTMENT',
          idempotencyKey: 'test:zero',
        }),
      ),
    ).rejects.toThrow(/geçersiz çip tutarı/i);
  });
});

describe('idempotency', () => {
  it('aynı anahtarla ikinci harcama bakiyeyi DEĞİŞTİRMEZ', async () => {
    const user = await createUser();
    const key = 'test:stake:idem';

    await withTransaction((tx) =>
      coinService.post(tx, {
        ownerId: user.userId,
        amount: -50,
        type: 'CHALLENGE_STAKE',
        idempotencyKey: key,
      }),
    );
    const second = await withTransaction((tx) =>
      coinService.post(tx, {
        ownerId: user.userId,
        amount: -50,
        type: 'CHALLENGE_STAKE',
        idempotencyKey: key,
      }),
    );

    expect(second.alreadyPosted).toBe(true);
    expect(await coinService.getBalance(user.userId)).toBe(economy.initialGrant - 50);
  });

  it('aynı ödeme iki kez yazılamaz — ÇİFT ÖDEME KORUMASI', async () => {
    const user = await createUser();
    const key = ledgerKeys.challengePayout('ch1', user.userId);

    await withTransaction((tx) =>
      coinService.post(tx, {
        ownerId: user.userId,
        amount: 100,
        type: 'CHALLENGE_WIN',
        idempotencyKey: key,
      }),
    );
    await withTransaction((tx) =>
      coinService.post(tx, {
        ownerId: user.userId,
        amount: 100,
        type: 'CHALLENGE_WIN',
        idempotencyKey: key,
      }),
    );

    expect(await coinService.getBalance(user.userId)).toBe(economy.initialGrant + 100);
  });

  it('aynı iade iki kez yapılamaz', async () => {
    const user = await createUser();
    const key = ledgerKeys.challengeRefund('ch1', user.userId);

    await withTransaction((tx) =>
      coinService.post(tx, {
        ownerId: user.userId,
        amount: 50,
        type: 'CHALLENGE_REFUND',
        idempotencyKey: key,
      }),
    );
    const again = await withTransaction((tx) =>
      coinService.post(tx, {
        ownerId: user.userId,
        amount: 50,
        type: 'CHALLENGE_REFUND',
        idempotencyKey: key,
      }),
    );

    expect(again.alreadyPosted).toBe(true);
    expect(await coinService.getBalance(user.userId)).toBe(economy.initialGrant + 50);
  });
});

describe('eşzamanlılık', () => {
  it('eşzamanlı harcamalar kullanıcıyı NEGATİF bakiyeye düşüremez', async () => {
    const user = await createUser();
    // Bakiyeyi 100'e indir
    await withTransaction((tx) =>
      coinService.post(tx, {
        ownerId: user.userId,
        amount: -(economy.initialGrant - 100),
        type: 'ADMIN_ADJUSTMENT',
        idempotencyKey: 'test:setup:100',
      }),
    );
    expect(await coinService.getBalance(user.userId)).toBe(100);

    // Aynı anda üç kez 80 harcamaya çalış — en fazla biri başarılı olabilir
    const attempts = [1, 2, 3].map((n) =>
      withTransaction((tx) =>
        coinService.post(tx, {
          ownerId: user.userId,
          amount: -80,
          type: 'CHALLENGE_STAKE',
          idempotencyKey: `test:concurrent:${n}`,
        }),
      ).then(
        () => true,
        () => false,
      ),
    );

    const results = await Promise.all(attempts);
    expect(results.filter(Boolean).length).toBe(1);

    const balance = await coinService.getBalance(user.userId);
    expect(balance).toBe(20);
    expect(balance).toBeGreaterThanOrEqual(0);
  });
});

describe('mutabakat invariantı', () => {
  it('ledger toplamı HER ZAMAN sıfırdır', async () => {
    const a = await createUser('emir');
    const b = await createUser('mert');

    await withTransaction((tx) =>
      coinService.post(tx, {
        ownerId: a.userId,
        amount: -50,
        type: 'CHALLENGE_STAKE',
        idempotencyKey: 'k1',
      }),
    );
    await withTransaction((tx) =>
      coinService.post(tx, {
        ownerId: b.userId,
        amount: -50,
        type: 'CHALLENGE_STAKE',
        idempotencyKey: 'k2',
      }),
    );
    await withTransaction((tx) =>
      coinService.post(tx, {
        ownerId: a.userId,
        amount: 100,
        type: 'CHALLENGE_WIN',
        idempotencyKey: 'k3',
      }),
    );

    const { ledgerSum, mismatches } = await coinService.reconcile(db);
    expect(ledgerSum).toBe(0);
    expect(mismatches).toEqual([]);
  });

  it('her bakiye kendi hareketlerinin toplamına eşittir', async () => {
    const user = await createUser();
    await withTransaction((tx) =>
      coinService.post(tx, {
        ownerId: user.userId,
        amount: -25,
        type: 'CHALLENGE_STAKE',
        idempotencyKey: 'm1',
      }),
    );

    const [row] = await sql`
      SELECT a.balance, COALESCE(SUM(l.amount), 0)::int AS ledger_total
      FROM coin_account a
      LEFT JOIN coin_ledger l ON l.owner_id = a.owner_id
      WHERE a.owner_id = ${user.userId}
      GROUP BY a.balance`;

    expect(row?.balance).toBe(row?.ledger_total);
  });

  it('SYSTEM hesabı dağıtılan toplam arzı taşır ve negatif olabilir', async () => {
    await createUser();
    const systemBalance = await coinService.getBalance(economy.systemAccountId);
    expect(systemBalance).toBe(-economy.initialGrant);
  });
});
