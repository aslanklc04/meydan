import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
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
 * Ranking context — sezon, liderlik, rozet ve gündem.
 *
 * Liderlik ve gündem, her istekte hesaplanmak yerine SNAPSHOT olarak üretilir:
 * okuma yolu tek indexli sorguya iner, sıralama kriteri değiştiğinde geçmiş
 * bozulmaz.
 */

export const seasonStatus = pgEnum('season_status', ['UPCOMING', 'ACTIVE', 'CLOSED']);

export const seasons = pgTable(
  'season',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    name: varchar('name', { length: 80 }).notNull(),
    slug: varchar('slug', { length: 60 }).notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    status: seasonStatus('status').notNull().default('UPCOMING'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('season_slug_key').on(t.slug), index('season_status_idx').on(t.status)],
);

export const leaderboardPeriod = pgEnum('leaderboard_period', [
  'WEEKLY',
  'MONTHLY',
  'SEASON',
  'ALL_TIME',
]);

export const leaderboardSnapshots = pgTable(
  'leaderboard_snapshot',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    period: leaderboardPeriod('period').notNull(),
    /** null = genel liderlik. */
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'cascade' }),
    seasonId: text('season_id').references(() => seasons.id, { onDelete: 'cascade' }),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    /** Snapshot üretilirken uygulanan minimum tahmin eşiği — şeffaflık için saklanır. */
    minPredictions: integer('min_predictions').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('leaderboard_snapshot_unique').on(t.period, t.categoryId, t.periodStart),
    index('leaderboard_snapshot_lookup').on(t.period, t.categoryId, t.generatedAt.desc()),
  ],
);

export const leaderboardEntries = pgTable(
  'leaderboard_entry',
  {
    snapshotId: text('snapshot_id')
      .notNull()
      .references(() => leaderboardSnapshots.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(),
    power: numeric('power', { precision: 6, scale: 3 }).notNull(),
    completedPredictions: integer('completed_predictions').notNull(),
    correctPredictions: integer('correct_predictions').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotId, t.userId] }),
    index('leaderboard_entry_rank_idx').on(t.snapshotId, t.rank),
    index('leaderboard_entry_user_idx').on(t.userId),
  ],
);

/**
 * Rozet kuralları VERİTABANINDA tutulur — frontend'de sabit liste YOKTUR.
 * Yeni rozet eklemek bir satır eklemektir, kod değişikliği değil.
 */
export const badgeRule = pgEnum('badge_rule', [
  /** ruleConfig: { count } — toplam doğru tahmin */
  'CORRECT_PREDICTIONS',
  /** ruleConfig: { count } — kazanılan Meydan Okuma */
  'CHALLENGE_WINS',
  /** ruleConfig: { power } — Tahmin Gücü eşiği */
  'PREDICTION_POWER',
  /** ruleConfig: { count } — toplam tamamlanan tahmin */
  'COMPLETED_PREDICTIONS',
  /** ruleConfig: { categorySlug, power, count } — kategori uzmanlığı */
  'CATEGORY_EXPERT',
  /** ruleConfig: { rank } — liderlik derecesi */
  'LEADERBOARD_RANK',
]);

export const badges = pgTable(
  'badge',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    slug: varchar('slug', { length: 60 }).notNull(),
    name: varchar('name', { length: 60 }).notNull(),
    description: varchar('description', { length: 200 }).notNull(),
    icon: varchar('icon', { length: 8 }).notNull(),
    rule: badgeRule('rule').notNull(),
    ruleConfig: jsonb('rule_config').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => [uniqueIndex('badge_slug_key').on(t.slug), index('badge_active_idx').on(t.active)],
);

export const userBadges = pgTable(
  'user_badge',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    badgeId: text('badge_id')
      .notNull()
      .references(() => badges.id, { onDelete: 'cascade' }),
    /** Sezonluk rozetler sezon başına bir kez kazanılabilir; genel rozetlerde null. */
    seasonId: text('season_id').references(() => seasons.id, { onDelete: 'cascade' }),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Aynı rozet iki kez verilemez — nihai savunma.
    primaryKey({ columns: [t.userId, t.badgeId] }),
    index('user_badge_user_idx').on(t.userId, t.awardedAt.desc()),
  ],
);

/**
 * Gündem — basit ve AÇIKLANABİLİR sıralama.
 * ML/AI yok: yalnızca son aktivite + tahmin + Meydan Okuma sayısı.
 */
export const trendingSnapshots = pgTable(
  'trending_snapshot',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(),
    score: numeric('score', { precision: 12, scale: 4 }).notNull(),
    recentPredictions: integer('recent_predictions').notNull().default(0),
    recentChallenges: integer('recent_challenges').notNull().default(0),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('trending_event_unique').on(t.eventId),
    index('trending_rank_idx').on(t.rank),
  ],
);

export type Season = typeof seasons.$inferSelect;
export type Badge = typeof badges.$inferSelect;
export type LeaderboardEntry = typeof leaderboardEntries.$inferSelect;
