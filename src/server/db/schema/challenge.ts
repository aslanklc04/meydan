import { index, integer, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';
import { users } from './identity';
import { eventOutcomes, events } from './catalog';
import { predictions } from './prediction';

/**
 * Challenge context — Meydan Okuma. ADR-15.
 *
 * İki mod:
 *   DIRECT — rakip oluştururken belirtilir; yalnızca o kişi kabul edebilir
 *   OPEN   — rakip yok; ilk uygun kullanıcı kabul eder
 *
 * SAHTE/BOT RAKİP YOKTUR. Karşı taraf her zaman gerçek bir kullanıcı hesabıdır.
 *
 * ADR-18 GÜNCELLENDİ (göç 0018): karşı sonuç artık oluşturmada atanmaz, KABUL
 * ANINDA kabul eden kişi tarafından seçilir. Eski deterministik atama üç
 * sonuçlu maçlarda kabul edene çoğunlukla beraberliği veriyordu ve iki tarafın
 * pozisyonu eşit olmuyordu. İki sonuçlu etkinlikte seçenek zaten tek olduğu
 * için arayüz onu hazır işaretler; fazladan adım doğmaz.
 */

export const challengeMode = pgEnum('challenge_mode', ['DIRECT', 'OPEN']);

export const challengeStatus = pgEnum('challenge_status', [
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'COMPLETED',
]);

/**
 * Sonuçlandırmada uygulanan ödeme biçimi.
 *
 *   WIN_LOSS       → bir taraf kazandı, havuz kazanana gitti
 *   REFUND_BOTH    → İKİ taraf da stake etmişti ve ikisi de kaybetti (beraberlik)
 *                    ya da etkinlik VOID oldu → her ikisine iade
 *   REFUND_CREATOR → Meydan Okuma hiç KABUL EDİLMEDİ; yalnızca oluşturan stake
 *                    etmişti → yalnızca ona iade. "İki tarafa iade" demek
 *                    burada semantik olarak yanlıştır (Faz 3 kapanış düzeltmesi).
 */
export const settlementKind = pgEnum('settlement_kind', [
  'WIN_LOSS',
  'REFUND_BOTH',
  'REFUND_CREATOR',
]);

export const challenges = pgTable(
  'challenge',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),

    mode: challengeMode('mode').notNull().default('DIRECT'),
    status: challengeStatus('status').notNull().default('PENDING'),

    creatorId: text('creator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** OPEN modda kabul anına kadar null. */
    opponentId: text('opponent_id').references(() => users.id, { onDelete: 'cascade' }),

    creatorOutcomeId: text('creator_outcome_id')
      .notNull()
      .references(() => eventOutcomes.id),
    /**
     * Kabul edenin savunduğu sonuç — KABUL ANINDA, kabul eden tarafından
     * seçilir. Kabul edilene kadar null.
     *
     * Önceden oluşturma anında deterministik olarak atanıyordu (ADR-18). Üç
     * sonuçlu maçlarda bu, kabul edene çoğu zaman BERABERLİK'i veriyordu:
     * oluşturan en olası sonucu seçiyor, karşı taraf azınlıkta kalan sonucu
     * almış oluyordu. Pozisyonlar eşit değildi.
     */
    opponentOutcomeId: text('opponent_outcome_id').references(() => eventOutcomes.id),

    creatorPredictionId: text('creator_prediction_id')
      .notNull()
      .references(() => predictions.id),
    opponentPredictionId: text('opponent_prediction_id').references(() => predictions.id),

    /** Taraf başına eşit çip. Havuz = 2 × stakeAmount. */
    stakeAmount: integer('stake_amount').notNull(),

    winnerUserId: text('winner_user_id').references(() => users.id),
    settlement: settlementKind('settlement'),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    declinedAt: timestamp('declined_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Ledger yazımı tamamlandı — çift ödeme koruması. */
    settledAt: timestamp('settled_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('challenge_opponent_idx').on(t.opponentId, t.status, t.createdAt.desc()),
    index('challenge_creator_idx').on(t.creatorId, t.status, t.createdAt.desc()),
    index('challenge_event_status_idx').on(t.eventId, t.status),
    index('challenge_expiry_idx').on(t.status, t.expiresAt),
  ],
);

export type Challenge = typeof challenges.$inferSelect;
export type NewChallenge = typeof challenges.$inferInsert;
