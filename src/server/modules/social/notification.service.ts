import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db, type Tx } from '@/server/db';
import { notifications } from '@/server/db/schema';
import { isUniqueViolation } from '@/server/errors';

/**
 * NotificationService.
 *
 * Bildirim METNİ yazma anında üretilir ve satıra yazılır. Okuma yolunda
 * birleştirme (join) yapılmaz — bildirim listesi tek indexli sorguya iner.
 *
 * `dedupeKey` üzerindeki UNIQUE index, aynı olayın iki kez bildirilmesini
 * veritabanı seviyesinde engeller. Sonuçlandırma iki kez çalışsa bile kullanıcı
 * "Meydan Okumayı kazandın" bildirimini iki kez almaz (ürün kuralı 17).
 */

type Ctx = Tx | typeof db;

export type NotificationType =
  | 'CHALLENGE_RECEIVED'
  | 'CHALLENGE_ACCEPTED'
  | 'CHALLENGE_DECLINED'
  | 'CHALLENGE_COMPLETED'
  | 'CHALLENGE_EXPIRED'
  | 'PREDICTION_CORRECT'
  | 'PREDICTION_INCORRECT'
  | 'RATING_CHANGED'
  | 'NEW_FOLLOWER'
  | 'FOLLOWED_USER_PREDICTION'
  | 'BADGE_EARNED'
  | 'SEASON_RESULT';

export type CreateNotificationInput = {
  readonly userId: string;
  readonly type: NotificationType;
  readonly body: string;
  readonly dedupeKey: string;
  readonly actorId?: string;
  readonly href?: string;
};

export const notificationService = {
  /**
   * Bildirim üretir. Aynı `dedupeKey` ile ikinci çağrı SESSİZCE yok sayılır —
   * bu bir hata değil, tasarımın parçasıdır.
   */
  async create(ctx: Ctx, input: CreateNotificationInput): Promise<boolean> {
    try {
      const inserted = await ctx
        .insert(notifications)
        .values({
          userId: input.userId,
          type: input.type,
          body: input.body,
          dedupeKey: input.dedupeKey,
          actorId: input.actorId ?? null,
          href: input.href ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: notifications.id });
      return inserted.length === 1;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  },

  /** Toplu üretim — takip edilen kullanıcı tahmin yaptığında fan-out. */
  async createMany(ctx: Ctx, items: readonly CreateNotificationInput[]): Promise<number> {
    if (items.length === 0) return 0;
    const inserted = await ctx
      .insert(notifications)
      .values(
        items.map((i) => ({
          userId: i.userId,
          type: i.type,
          body: i.body,
          dedupeKey: i.dedupeKey,
          actorId: i.actorId ?? null,
          href: i.href ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    return inserted.length;
  },

  async unreadCount(userId: string, ctx: Ctx = db): Promise<number> {
    const rows = await ctx
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return rows[0]?.n ?? 0;
  },

  /** Cursor pagination — `createdAt` azalan. */
  async list(
    userId: string,
    options: { readonly limit?: number; readonly cursor?: string } = {},
    ctx: Ctx = db,
  ) {
    const limit = Math.min(options.limit ?? 20, 50);
    const cursorDate = options.cursor ? new Date(options.cursor) : null;

    const rows = await ctx
      .select({
        id: notifications.id,
        type: notifications.type,
        body: notifications.body,
        href: notifications.href,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(
        cursorDate
          ? and(eq(notifications.userId, userId), lt(notifications.createdAt, cursorDate))
          : eq(notifications.userId, userId),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.createdAt.toISOString() ?? null) : null,
    };
  },

  async markRead(userId: string, ids: readonly string[], ctx: Ctx = db): Promise<void> {
    if (ids.length === 0) return;
    await ctx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          or(...ids.map((id) => eq(notifications.id, id))),
        ),
      );
  },

  async markAllRead(userId: string, ctx: Ctx = db): Promise<void> {
    await ctx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  },
};

/** Bildirim dedupe anahtarları — tek kaynak. */
export const notificationKeys = {
  challengeReceived: (challengeId: string) => `challenge:${challengeId}:received`,
  challengeAccepted: (challengeId: string) => `challenge:${challengeId}:accepted`,
  challengeDeclined: (challengeId: string) => `challenge:${challengeId}:declined`,
  challengeCompleted: (challengeId: string, userId: string) =>
    `challenge:${challengeId}:completed:${userId}`,
  challengeExpired: (challengeId: string) => `challenge:${challengeId}:expired`,
  predictionResolved: (predictionId: string) => `prediction:${predictionId}:resolved`,
  newFollower: (followerId: string, followingId: string) => `follow:${followerId}:${followingId}`,
  followedPrediction: (predictionId: string, userId: string) => `feed:${predictionId}:${userId}`,
  badgeEarned: (userId: string, badgeId: string) => `badge:${badgeId}:${userId}`,
} as const;
