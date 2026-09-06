import {
  index,
  jsonb,
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
import { predictions } from './prediction';
import { challenges } from './challenge';

/**
 * Social context — takip, bildirim, reaksiyon ve moderasyon.
 *
 * Bu tablolar ürünün tekrar kullanılabilirliğini taşır: kullanıcı geri gelmek
 * için bir sebep bulmalı. Sebep, takip ettiği kişilerin tahminleri ve kendisine
 * gelen bildirimlerdir.
 */

export const follows = pgTable(
  'follow',
  {
    followerId: text('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followingId: text('following_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followingId] }),
    // "Takipçilerim" ve "Takip ettiklerim" listeleri için ayrı yönlerde index.
    index('follow_following_idx').on(t.followingId, t.createdAt.desc()),
    index('follow_follower_idx').on(t.followerId, t.createdAt.desc()),
  ],
);

export const notificationType = pgEnum('notification_type', [
  'CHALLENGE_RECEIVED',
  'CHALLENGE_ACCEPTED',
  'CHALLENGE_DECLINED',
  'CHALLENGE_COMPLETED',
  'CHALLENGE_EXPIRED',
  'PREDICTION_CORRECT',
  'PREDICTION_INCORRECT',
  'RATING_CHANGED',
  'NEW_FOLLOWER',
  'FOLLOWED_USER_PREDICTION',
  'BADGE_EARNED',
  'SEASON_RESULT',
]);

export const notifications = pgTable(
  'notification',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationType('type').notNull(),
    /** Bildirimi tetikleyen kullanıcı (varsa). */
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Kullanıcıya gösterilecek HAZIR metin. Teknik kimlik içermez.
     * Bildirim üretilirken yazılır; okuma yolunda birleştirme (join) gerekmez.
     */
    body: varchar('body', { length: 300 }).notNull(),
    /** Tıklanınca gidilecek uygulama içi yol. */
    href: varchar('href', { length: 200 }),
    payload: jsonb('payload'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Aynı olayın iki kez bildirilmesini engeller.
     * Örn: "challenge:{id}:accepted:{userId}"
     */
    dedupeKey: varchar('dedupe_key', { length: 160 }).notNull(),
  },
  (t) => [
    uniqueIndex('notification_dedupe_key').on(t.dedupeKey),
    index('notification_user_idx').on(t.userId, t.createdAt.desc()),
    index('notification_unread_idx').on(t.userId, t.readAt),
  ],
);

export const reactionKind = pgEnum('reaction_kind', ['LIKE', 'FIRE', 'CLAP']);
export const reactionTarget = pgEnum('reaction_target', ['PREDICTION', 'EVENT']);

export const reactions = pgTable(
  'reaction',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: reactionTarget('target_type').notNull(),
    targetId: text('target_id').notNull(),
    kind: reactionKind('kind').notNull().default('LIKE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Bir kullanıcı bir içeriğe TEK reaksiyon verir; tekrar basınca değişir/kalkar.
    primaryKey({ columns: [t.userId, t.targetType, t.targetId] }),
    index('reaction_target_idx').on(t.targetType, t.targetId),
  ],
);

export const reportReason = pgEnum('report_reason', [
  'SPAM',
  'ABUSE',
  'IMPERSONATION',
  'CHEATING',
  'OTHER',
]);
export const reportStatus = pgEnum('report_status', ['OPEN', 'REVIEWED', 'DISMISSED']);

export const reports = pgTable(
  'report',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: varchar('target_type', { length: 20 }).notNull(),
    targetId: text('target_id').notNull(),
    reason: reportReason('reason').notNull(),
    note: varchar('note', { length: 500 }),
    status: reportStatus('status').notNull().default('OPEN'),
    reviewedById: text('reviewed_by_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Aynı kullanıcı aynı içeriği tekrar tekrar raporlayamaz.
    uniqueIndex('report_once_per_target').on(t.reporterId, t.targetType, t.targetId),
    index('report_status_idx').on(t.status, t.createdAt.desc()),
  ],
);

export const blocks = pgTable(
  'block',
  {
    blockerId: text('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: text('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index('block_blocked_idx').on(t.blockedId),
  ],
);

/**
 * Akış öğesi — takip edilenlerin tahminleri.
 *
 * Neden ayrı tablo: akışı her istekte `prediction JOIN follow` ile üretmek,
 * takipçi sayısı büyüdükçe pahalılaşır. Bu tablo yazma anında doldurulur
 * (fan-out on write) ve cursor pagination'a doğrudan uygundur.
 */
export const feedItemKind = pgEnum('feed_item_kind', [
  'PREDICTION_CREATED',
  'CHALLENGE_CREATED',
  'CHALLENGE_COMPLETED',
]);

export const feedItems = pgTable(
  'feed_item',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    /** Öğeyi üreten kullanıcı. */
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: feedItemKind('kind').notNull(),
    eventId: text('event_id').references(() => events.id, { onDelete: 'cascade' }),
    predictionId: text('prediction_id').references(() => predictions.id, { onDelete: 'cascade' }),
    challengeId: text('challenge_id').references(() => challenges.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Cursor pagination: (created_at DESC, id DESC)
    index('feed_actor_created_idx').on(t.actorId, t.createdAt.desc(), t.id),
    index('feed_created_idx').on(t.createdAt.desc(), t.id),
  ],
);

export type Follow = typeof follows.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type FeedItem = typeof feedItems.$inferSelect;
