import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';

/**
 * Economy context — Gümüş Çip.
 *
 * GÜMÜŞ ÇİP GERÇEK PARA DEĞİLDİR. Sanal, oyun içi bir puandır: nakde çevrilemez,
 * çekilemez, gerçek para ile satın alınamaz, kullanıcılar arasında gerçek para
 * karşılığı transfer edilemez. Bu dosyada ve tüm ekonomi modülünde deposit,
 * withdrawal, payment, cashout veya satın alma kavramı YOKTUR.
 *
 * İki tablo, tek gerçek:
 *   coin_ledger  → KAYNAK DOĞRULUK. Değişmez. Yalnızca INSERT.
 *   coin_account → performans için türev bakiye. Yalnızca ledger yazımıyla
 *                  aynı transaction içinde güncellenir.
 *
 * Sıfır toplam invariant'ı: her hareket SYSTEM karşı kaydıyla yazılır, bu yüzden
 * SUM(amount) tüm ledger üzerinde her zaman 0'dır. Bu tek satır, "para yoktan var
 * oldu" durumunu yakalayan mutabakat kontrolüdür.
 */

export const ledgerType = pgEnum('ledger_type', [
  'INITIAL_GRANT',
  'CHALLENGE_STAKE',
  'CHALLENGE_WIN',
  'CHALLENGE_REFUND',
  'DAILY_REWARD',
  'ADMIN_ADJUSTMENT',
  /** SYSTEM hesabının karşı kayıtları — sıfır toplamı korur. */
  'SYSTEM_COUNTERPART',
]);

export const coinAccounts = pgTable('coin_account', {
  /**
   * Kullanıcı kimliği veya 'SYSTEM'. Foreign key BİLİNÇLİ olarak yoktur:
   * SYSTEM hesabı bir kullanıcı değildir ve negatif bakiyeye izin verilen
   * tek hesaptır (dağıtılan toplam arzı temsil eder).
   */
  ownerId: text('owner_id').primaryKey(),
  balance: integer('balance').notNull().default(0),
  /** Optimistic locking sayacı — her yazımda artar. */
  version: integer('version').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const coinLedger = pgTable(
  'coin_ledger',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    ownerId: text('owner_id').notNull(),
    /** + giriş, − çıkış. Tam sayı; kayan nokta kullanılmaz. */
    amount: integer('amount').notNull(),
    type: ledgerType('type').notNull(),

    referenceType: varchar('reference_type', { length: 20 }),
    referenceId: text('reference_id'),

    /** Yazım anındaki bakiye — denetim izi. */
    balanceAfter: integer('balance_after').notNull(),

    /**
     * Çift ödemeyi VERİTABANI seviyesinde imkânsız kılar.
     * Örn: "challenge:{id}:payout:{userId}". İkinci yazım 23505 alır ve
     * servis bunu "zaten işlendi" olarak yorumlar.
     */
    idempotencyKey: varchar('idempotency_key', { length: 160 }).notNull(),

    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('coin_ledger_idempotency_key').on(t.idempotencyKey),
    index('coin_ledger_owner_idx').on(t.ownerId, t.createdAt.desc()),
    index('coin_ledger_reference_idx').on(t.referenceType, t.referenceId),
  ],
);

export type CoinAccount = typeof coinAccounts.$inferSelect;
export type LedgerEntry = typeof coinLedger.$inferSelect;
