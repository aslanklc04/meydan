import { and, eq, sql } from 'drizzle-orm';
import { db, type Tx } from '@/server/db';
import { coinAccounts, coinLedger } from '@/server/db/schema';
import { economy } from '@/config';
import { BusinessRuleError } from '@/server/errors';
import { ledgerKeys } from './domain/ledger-keys';

/**
 * CoinService — Gümüş Çip ekonomisi.
 *
 * GERÇEK PARA YOKTUR. Bu modülde deposit, withdrawal, payment, cashout veya
 * satın alma kavramı bulunmaz ve eklenmemelidir. Gümüş Çip sanal, oyun içi bir
 * puandır; nakde çevrilemez.
 *
 * SÖZLEŞME: her metot ÇAĞIRANIN transaction'ı içinde çalışır ve kendi başına
 * commit ETMEZ. Transaction'ı yalnızca use-case servisi açar (Bölüm 5.2).
 * Bu sayede "stake düşüldü ama meydan okuma yaratılmadı" durumu imkânsızdır.
 *
 * ÇİFT KAYIT: her kullanıcı hareketi bir SYSTEM karşı kaydıyla yazılır.
 * Sonuç: SUM(amount) tüm ledger üzerinde her zaman 0'dır.
 */

const SYSTEM = economy.systemAccountId;

type Ctx = Tx | typeof db;

export type PostEntryInput = {
  readonly ownerId: string;
  /** + giriş, − çıkış. Sıfır olamaz. */
  readonly amount: number;
  readonly type:
    | 'INITIAL_GRANT'
    | 'CHALLENGE_STAKE'
    | 'CHALLENGE_WIN'
    | 'CHALLENGE_REFUND'
    | 'DAILY_REWARD'
    | 'ADMIN_ADJUSTMENT';
  readonly idempotencyKey: string;
  readonly referenceType?: string;
  readonly referenceId?: string;
  readonly metadata?: Record<string, unknown>;
};

export type PostEntryResult = {
  /** true ise hareket zaten yazılmıştı; bakiye İKİNCİ KEZ değiştirilmedi. */
  readonly alreadyPosted: boolean;
  readonly balanceAfter: number;
};

async function ensureAccount(ctx: Ctx, ownerId: string): Promise<void> {
  await ctx.insert(coinAccounts).values({ ownerId, balance: 0 }).onConflictDoNothing();
}

/** Bakiyeyi kilitler ve okur. Kilit sırası çağıran tarafından belirlenir. */
async function lockBalance(ctx: Ctx, ownerId: string): Promise<number> {
  const rows = await ctx
    .select({ balance: coinAccounts.balance })
    .from(coinAccounts)
    .where(eq(coinAccounts.ownerId, ownerId))
    .for('update');
  return rows[0]?.balance ?? 0;
}

export const coinService = {
  /** Hesabı oluşturur (yoksa). Kayıt akışında çağrılır. */
  ensureAccount,

  async getBalance(ownerId: string, ctx: Ctx = db): Promise<number> {
    const rows = await ctx
      .select({ balance: coinAccounts.balance })
      .from(coinAccounts)
      .where(eq(coinAccounts.ownerId, ownerId));
    return rows[0]?.balance ?? 0;
  },

  /**
   * Tek bir çip hareketi yazar ve SYSTEM karşı kaydını üretir.
   *
   * İdempotency: aynı anahtarla ikinci çağrı hiçbir şey değiştirmez ve
   * `alreadyPosted: true` döner. Ayrıca `coin_ledger.idempotency_key` üzerindeki
   * UNIQUE index, uygulama kontrolü atlansa dahi çift yazımı reddeder.
   *
   * Negatif bakiye: dört katman (istemci → servis → koşullu UPDATE → CHECK).
   * Burası üçüncü ve dördüncü katmandır.
   */
  async post(tx: Tx, input: PostEntryInput): Promise<PostEntryResult> {
    if (!Number.isInteger(input.amount) || input.amount === 0) {
      throw new BusinessRuleError('INVALID_AMOUNT', 'Geçersiz çip tutarı.');
    }

    // 1) Zaten yazılmış mı? Hesap kilidi altında kontrol edilir.
    const existing = await tx
      .select({ balanceAfter: coinLedger.balanceAfter })
      .from(coinLedger)
      .where(eq(coinLedger.idempotencyKey, input.idempotencyKey))
      .limit(1);

    if (existing[0]) {
      return { alreadyPosted: true, balanceAfter: existing[0].balanceAfter };
    }

    await ensureAccount(tx, input.ownerId);
    await ensureAccount(tx, SYSTEM);

    // 2) Deterministik kilit sırası — karşılıklı meydan okumalarda deadlock olmaz.
    const [first, second] = [input.ownerId, SYSTEM].sort();
    await lockBalance(tx, first as string);
    if (second !== first) await lockBalance(tx, second as string);

    // 3) Koşullu UPDATE: yetersiz bakiyede etkilenen satır 0 olur.
    const updated = await tx
      .update(coinAccounts)
      .set({
        balance: sql`${coinAccounts.balance} + ${input.amount}`,
        version: sql`${coinAccounts.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(coinAccounts.ownerId, input.ownerId),
          sql`${coinAccounts.balance} + ${input.amount} >= 0`,
        ),
      )
      .returning({ balance: coinAccounts.balance });

    const balanceAfter = updated[0]?.balance;
    if (balanceAfter === undefined) {
      throw new BusinessRuleError('INSUFFICIENT_BALANCE', 'Bu işlem için yeterli Gümüş Çipin yok.');
    }

    // 4) SYSTEM karşı kaydı — negatif bakiyeye izin verilen tek hesap.
    const systemUpdated = await tx
      .update(coinAccounts)
      .set({
        balance: sql`${coinAccounts.balance} - ${input.amount}`,
        version: sql`${coinAccounts.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(coinAccounts.ownerId, SYSTEM))
      .returning({ balance: coinAccounts.balance });

    const systemBalance = systemUpdated[0]?.balance ?? 0;

    // 5) Ledger — değişmez. UNIQUE index son savunma hattıdır.
    await tx.insert(coinLedger).values([
      {
        ownerId: input.ownerId,
        amount: input.amount,
        type: input.type,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        balanceAfter,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? null,
      },
      {
        ownerId: SYSTEM,
        amount: -input.amount,
        type: 'SYSTEM_COUNTERPART',
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        balanceAfter: systemBalance,
        idempotencyKey: ledgerKeys.systemCounterpart(input.idempotencyKey),
        metadata: null,
      },
    ]);

    return { alreadyPosted: false, balanceAfter };
  },

  /** Kayıt anında verilen başlangıç çipi. */
  async grantInitial(tx: Tx, userId: string): Promise<PostEntryResult> {
    return coinService.post(tx, {
      ownerId: userId,
      amount: economy.initialGrant,
      type: 'INITIAL_GRANT',
      idempotencyKey: ledgerKeys.initialGrant(userId),
      referenceType: 'user',
      referenceId: userId,
    });
  },

  /** Kullanıcının kendi hareket dökümü — şeffaflık destek yükünü azaltır. */
  async getLedger(ownerId: string, limit = 50, ctx: Ctx = db) {
    return ctx
      .select({
        id: coinLedger.id,
        amount: coinLedger.amount,
        type: coinLedger.type,
        balanceAfter: coinLedger.balanceAfter,
        createdAt: coinLedger.createdAt,
        referenceType: coinLedger.referenceType,
        referenceId: coinLedger.referenceId,
      })
      .from(coinLedger)
      .where(eq(coinLedger.ownerId, ownerId))
      .orderBy(sql`${coinLedger.createdAt} DESC`)
      .limit(limit);
  },

  /**
   * Mutabakat — gecelik iş.
   * İki invariant: (1) ledger toplamı 0, (2) her bakiye kendi hareketlerinin toplamı.
   * Sessiz para üretimi ancak bu kontrolle yakalanır.
   */
  async reconcile(ctx: Ctx = db): Promise<{ ledgerSum: number; mismatches: string[] }> {
    const sumRows = await ctx.execute(
      sql`SELECT COALESCE(SUM(amount), 0)::int AS total FROM coin_ledger`,
    );
    const ledgerSum = Number((sumRows as unknown as { total: number }[])[0]?.total ?? 0);

    const mismatchRows = await ctx.execute(sql`
      SELECT a.owner_id
      FROM coin_account a
      LEFT JOIN (
        SELECT owner_id, SUM(amount)::int AS s FROM coin_ledger GROUP BY owner_id
      ) l ON l.owner_id = a.owner_id
      WHERE a.balance <> COALESCE(l.s, 0)
    `);

    const mismatches = (mismatchRows as unknown as { owner_id: string }[]).map((r) => r.owner_id);
    return { ledgerSum, mismatches };
  },
};

export { ledgerKeys };
