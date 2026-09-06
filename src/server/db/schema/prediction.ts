import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';
import { users } from './identity';
import { categories, eventOutcomes, events } from './catalog';

/**
 * Prediction context.
 *
 * Kullanıcıya teknik durum adları GÖSTERİLMEZ. Eşleme `src/features/predictions/labels.ts`
 * içinde tek yerde tanımlıdır: OPEN → "Sonuç bekleniyor", CORRECT → "Doğru bildin".
 */

export const predictionStatus = pgEnum('prediction_status', [
  /** Tahmin açık, etkinlik henüz kapanmadı. */
  'OPEN',
  /** Meydan okuma kabul edildi — tahmin artık değiştirilemez. */
  'LOCKED',
  /** Etkinlik sonuçlandı. */
  'RESOLVED',
  /** Etkinlik geçersiz kılındı; bu tahmin itibar hesabına GİRMEZ. */
  'VOID',
]);

export const predictionResult = pgEnum('prediction_result', ['CORRECT', 'INCORRECT', 'VOID']);

export const predictions = pgTable(
  'prediction',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    outcomeId: text('outcome_id')
      .notNull()
      .references(() => eventOutcomes.id),
    /** Denormalize: kategori bazlı uzmanlık sorguları tek tabloda kalsın. */
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id),

    /** Meydan okumaya bağlıysa ortaya konan çip; serbest tahminde 0. */
    stakeAmount: integer('stake_amount').notNull().default(0),

    status: predictionStatus('status').notNull().default('OPEN'),
    result: predictionResult('result'),

    /** Tahmin kapanışında dondurulan zorluk katsayısı: 1 - consensusShare. */
    difficultyScore: numeric('difficulty_score', { precision: 6, scale: 5 }),

    /** Tahmin Gücü'ne işlendi mi — idempotency koruması. */
    ratingApplied: boolean('rating_applied').notNull().default(false),
    /** Meydan okuma kabul edildiğinde true; tahmin dokunulmaz hâle gelir. */
    isLocked: boolean('is_locked').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('prediction_user_created_idx').on(t.userId, t.createdAt.desc()),
    index('prediction_event_idx').on(t.eventId, t.createdAt.desc()),
    index('prediction_user_category_idx').on(t.userId, t.categoryId, t.status),
    index('prediction_status_event_idx').on(t.status, t.eventId),
  ],
);

export type Prediction = typeof predictions.$inferSelect;
export type NewPrediction = typeof predictions.$inferInsert;
