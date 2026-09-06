import {
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';
import { users } from './identity';
import { categories, events } from './catalog';

/**
 * Reputation context — Tahmin Gücü ve kategori uzmanlığı.
 *
 * Kümülatif alanlar (n, correct, Σw, Σws, form) sayesinde Tahmin Gücü tüm geçmiş
 * TARANMADAN O(1) maliyetle güncellenir. Tam yeniden hesaplama yalnızca algoritma
 * sürümü değiştiğinde bir backfill işiyle yapılır.
 */

export const userRatings = pgTable(
  'user_rating',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** 0–100. Yeni kullanıcı formülden 40 alır. */
    predictionPower: numeric('prediction_power', { precision: 6, scale: 3 })
      .notNull()
      .default('40'),
    /** Ham başarı yüzdesi — Tahmin Gücü'nden AYRI gösterilir. */
    rawAccuracy: numeric('raw_accuracy', { precision: 6, scale: 5 }).notNull().default('0'),

    completedPredictions: integer('completed_predictions').notNull().default(0),
    correctPredictions: integer('correct_predictions').notNull().default(0),

    /** Zorluk ağırlıklı toplamlar — Σw ve Σ(w·s). */
    difficultyWeightSum: numeric('difficulty_weight_sum', { precision: 12, scale: 5 })
      .notNull()
      .default('0'),
    difficultyScoreSum: numeric('difficulty_score_sum', { precision: 12, scale: 5 })
      .notNull()
      .default('0'),

    /** EWMA form skoru ve son dönem sayaçları. */
    formScore: numeric('form_score', { precision: 6, scale: 5 }).notNull().default('0.5'),
    recentCount: integer('recent_count').notNull().default(0),
    last30Correct: integer('last30_correct').notNull().default(0),
    last30Total: integer('last30_total').notNull().default(0),

    algorithmVersion: integer('algorithm_version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('user_rating_power_idx').on(t.predictionPower.desc(), t.completedPredictions.desc()),
  ],
);

export const userCategoryStats = pgTable(
  'user_category_stat',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),

    predictionPower: numeric('prediction_power', { precision: 6, scale: 3 })
      .notNull()
      .default('40'),
    completedPredictions: integer('completed_predictions').notNull().default(0),
    correctPredictions: integer('correct_predictions').notNull().default(0),
    difficultyWeightSum: numeric('difficulty_weight_sum', { precision: 12, scale: 5 })
      .notNull()
      .default('0'),
    difficultyScoreSum: numeric('difficulty_score_sum', { precision: 12, scale: 5 })
      .notNull()
      .default('0'),
    formScore: numeric('form_score', { precision: 6, scale: 5 }).notNull().default('0.5'),
    recentCount: integer('recent_count').notNull().default(0),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.categoryId] }),
    index('user_category_power_idx').on(t.categoryId, t.predictionPower.desc()),
  ],
);

/**
 * Sonuçlandırmanın denetim kaydı.
 * `eventId` UNIQUE — bir etkinlik yalnızca BİR KEZ sonuçlandırılabilir.
 * Bu, çift ödemeye karşı nihai savunma hattıdır.
 */
export const eventResolutions = pgTable(
  'event_resolution',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    /** VOID kararında null. */
    outcomeId: text('outcome_id'),
    decision: varchar('decision', { length: 20 }).notNull(),
    source: varchar('source', { length: 20 }).notNull(),
    note: varchar('note', { length: 300 }),
    resolvedById: text('resolved_by_id').references(() => users.id),
    /** Kaç tahmin ve meydan okuma işlendi — denetim için. */
    predictionsResolved: integer('predictions_resolved').notNull().default(0),
    challengesSettled: integer('challenges_settled').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('event_resolution_event_unique').on(t.eventId)],
);

export const ratingHistory = pgTable(
  'rating_history',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'cascade' }),
    power: numeric('power', { precision: 6, scale: 3 }).notNull(),
    delta: numeric('delta', { precision: 6, scale: 3 }).notNull(),
    reason: varchar('reason', { length: 80 }).notNull(),
    version: integer('version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('rating_history_user_idx').on(t.userId, t.createdAt.desc())],
);

export type UserRating = typeof userRatings.$inferSelect;
export type UserCategoryStat = typeof userCategoryStats.$inferSelect;
