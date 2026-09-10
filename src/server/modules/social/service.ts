import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { db, withTransaction, type Tx } from '@/server/db';
import {
  blocks,
  categories,
  challenges,
  eventOutcomes,
  events,
  feedItems,
  follows,
  predictions,
  profiles,
  reactions,
  reports,
  userRatings,
  users,
} from '@/server/db/schema';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  isUniqueViolation,
} from '@/server/errors';
import { pagination } from '@/config';
import { notificationKeys, notificationService } from './notification.service';

/**
 * SocialService — takip, akış, reaksiyon ve moderasyon.
 *
 * Akış "fan-out on read" ile üretilir: takip edilenlerin `feed_item` satırları
 * tek sorguda okunur. Yazma anında her takipçiye satır kopyalamak (fan-out on
 * write) bu ölçekte gereksiz depolama ve karmaşıklık üretir.
 */

type Ctx = Tx | typeof db;

export const socialService = {
  // ── TAKİP ────────────────────────────────────────────────────────────────

  async follow(followerId: string, targetUsername: string): Promise<{ following: true }> {
    return withTransaction(async (tx) => {
      const target = await findUserByUsername(tx, targetUsername);

      if (target.id === followerId) {
        throw new BusinessRuleError('SELF_FOLLOW', 'Kendini takip edemezsin.');
      }
      if (target.status !== 'ACTIVE') {
        throw new BusinessRuleError('USER_UNAVAILABLE', 'Bu kullanıcı şu an takip edilemiyor.');
      }
      if (await isBlockedEitherWay(tx, followerId, target.id)) {
        throw new BusinessRuleError('BLOCKED', 'Bu kullanıcıyı takip edemezsin.');
      }

      const inserted = await tx
        .insert(follows)
        .values({ followerId, followingId: target.id })
        .onConflictDoNothing()
        .returning({ followerId: follows.followerId });

      // Zaten takip ediliyorsa sayaçlar İKİNCİ KEZ artmaz.
      if (inserted.length === 0) return { following: true };

      await tx
        .update(profiles)
        .set({ followerCount: sql`${profiles.followerCount} + 1` })
        .where(eq(profiles.userId, target.id));
      await tx
        .update(profiles)
        .set({ followingCount: sql`${profiles.followingCount} + 1` })
        .where(eq(profiles.userId, followerId));

      const follower = await tx
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, followerId))
        .limit(1);

      await notificationService.create(tx, {
        userId: target.id,
        type: 'NEW_FOLLOWER',
        actorId: followerId,
        body: `@${follower[0]?.username ?? 'Bir kullanıcı'} seni takip etmeye başladı.`,
        href: `/u/${follower[0]?.username ?? ''}`,
        dedupeKey: notificationKeys.newFollower(followerId, target.id),
      });

      return { following: true };
    });
  },

  async unfollow(followerId: string, targetUsername: string): Promise<{ following: false }> {
    return withTransaction(async (tx) => {
      const target = await findUserByUsername(tx, targetUsername);

      const removed = await tx
        .delete(follows)
        .where(and(eq(follows.followerId, followerId), eq(follows.followingId, target.id)))
        .returning({ followerId: follows.followerId });

      // Takip edilmiyorsa sayaçlar düşürülmez.
      if (removed.length === 0) return { following: false };

      await tx
        .update(profiles)
        .set({ followerCount: sql`GREATEST(${profiles.followerCount} - 1, 0)` })
        .where(eq(profiles.userId, target.id));
      await tx
        .update(profiles)
        .set({ followingCount: sql`GREATEST(${profiles.followingCount} - 1, 0)` })
        .where(eq(profiles.userId, followerId));

      return { following: false };
    });
  },

  async isFollowing(followerId: string, followingId: string, ctx: Ctx = db): Promise<boolean> {
    const rows = await ctx
      .select({ id: follows.followerId })
      .from(follows)
      .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)))
      .limit(1);
    return rows.length === 1;
  },

  async listFollowing(userId: string, ctx: Ctx = db): Promise<string[]> {
    const rows = await ctx
      .select({ id: follows.followingId })
      .from(follows)
      .where(eq(follows.followerId, userId));
    return rows.map((r) => r.id);
  },

  // ── AKIŞ ─────────────────────────────────────────────────────────────────

  /** Akış öğesi yazar. Tahmin/Meydan Okuma servisleri tarafından çağrılır. */
  async recordFeedItem(
    tx: Tx,
    input: {
      readonly actorId: string;
      readonly kind: 'PREDICTION_CREATED' | 'CHALLENGE_CREATED' | 'CHALLENGE_COMPLETED';
      readonly eventId?: string;
      readonly predictionId?: string;
      readonly challengeId?: string;
      readonly categoryId?: string;
    },
  ): Promise<void> {
    await tx.insert(feedItems).values({
      actorId: input.actorId,
      kind: input.kind,
      eventId: input.eventId ?? null,
      predictionId: input.predictionId ?? null,
      challengeId: input.challengeId ?? null,
      categoryId: input.categoryId ?? null,
    });
  },

  /**
   * Takip edilen kullanıcıların akışı — cursor pagination.
   *
   * Cursor `(createdAt, id)` çiftidir; yalnızca `createdAt` kullanmak aynı
   * milisaniyede oluşan iki öğeden birini atlar.
   */
  async feed(
    viewerId: string,
    options: { readonly limit?: number; readonly cursor?: string } = {},
    ctx: Ctx = db,
  ) {
    const limit = Math.min(options.limit ?? pagination.defaultLimit, pagination.maxLimit);
    const following = await socialService.listFollowing(viewerId, ctx);
    if (following.length === 0) return { items: [], nextCursor: null };

    const cursor = decodeCursor(options.cursor);

    const rows = await ctx
      .select({
        id: feedItems.id,
        kind: feedItems.kind,
        createdAt: feedItems.createdAt,
        actorUsername: users.username,
        actorPower: userRatings.predictionPower,
        eventTitle: events.title,
        eventQuestion: events.question,
        eventSlug: events.slug,
        outcomeLabel: eventOutcomes.label,
        stakeAmount: predictions.stakeAmount,
        challengeId: feedItems.challengeId,
      })
      .from(feedItems)
      .innerJoin(users, eq(users.id, feedItems.actorId))
      .leftJoin(userRatings, eq(userRatings.userId, feedItems.actorId))
      .leftJoin(events, eq(events.id, feedItems.eventId))
      .leftJoin(predictions, eq(predictions.id, feedItems.predictionId))
      .leftJoin(eventOutcomes, eq(eventOutcomes.id, predictions.outcomeId))
      .where(
        cursor
          ? and(
              inArray(feedItems.actorId, following),
              or(
                lt(feedItems.createdAt, cursor.createdAt),
                and(eq(feedItems.createdAt, cursor.createdAt), lt(feedItems.id, cursor.id)),
              ),
            )
          : inArray(feedItems.actorId, following),
      )
      .orderBy(desc(feedItems.createdAt), desc(feedItems.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];

    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  },

  // ── REAKSİYON ────────────────────────────────────────────────────────────

  /** Aynı içeriğe tekrar basmak reaksiyonu kaldırır (aç/kapa). */
  async toggleReaction(
    userId: string,
    targetType: 'PREDICTION' | 'EVENT',
    targetId: string,
    kind: 'LIKE' | 'FIRE' | 'CLAP' = 'LIKE',
  ): Promise<{ reacted: boolean }> {
    return withTransaction(async (tx) => {
      const existing = await tx
        .select({ kind: reactions.kind })
        .from(reactions)
        .where(
          and(
            eq(reactions.userId, userId),
            eq(reactions.targetType, targetType),
            eq(reactions.targetId, targetId),
          ),
        )
        .limit(1);

      if (existing[0]?.kind === kind) {
        await tx
          .delete(reactions)
          .where(
            and(
              eq(reactions.userId, userId),
              eq(reactions.targetType, targetType),
              eq(reactions.targetId, targetId),
            ),
          );
        return { reacted: false };
      }

      await tx
        .insert(reactions)
        .values({ userId, targetType, targetId, kind })
        .onConflictDoUpdate({
          target: [reactions.userId, reactions.targetType, reactions.targetId],
          set: { kind },
        });
      return { reacted: true };
    });
  },

  async countReactions(
    targetType: 'PREDICTION' | 'EVENT',
    targetId: string,
    ctx: Ctx = db,
  ): Promise<number> {
    const rows = await ctx
      .select({ n: sql<number>`count(*)::int` })
      .from(reactions)
      .where(and(eq(reactions.targetType, targetType), eq(reactions.targetId, targetId)));
    return rows[0]?.n ?? 0;
  },

  // ── MODERASYON ───────────────────────────────────────────────────────────

  async report(input: {
    readonly reporterId: string;
    readonly targetType: 'USER' | 'PREDICTION' | 'EVENT' | 'GAZETTE';
    readonly targetId: string;
    readonly reason: 'SPAM' | 'ABUSE' | 'IMPERSONATION' | 'CHEATING' | 'OTHER';
    readonly note?: string;
  }): Promise<void> {
    if (input.targetType === 'USER' && input.targetId === input.reporterId) {
      throw new BusinessRuleError('SELF_REPORT', 'Kendini raporlayamazsın.');
    }
    try {
      await db.insert(reports).values({
        reporterId: input.reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        note: input.note ?? null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('ALREADY_REPORTED', 'Bu içeriği zaten bildirdin.');
      }
      throw error;
    }
  },

  /** Engelleme takibi de koparır — iki yönlü. */
  async block(blockerId: string, targetUsername: string): Promise<void> {
    await withTransaction(async (tx) => {
      const target = await findUserByUsername(tx, targetUsername);
      if (target.id === blockerId) {
        throw new BusinessRuleError('SELF_BLOCK', 'Kendini engelleyemezsin.');
      }

      await tx.insert(blocks).values({ blockerId, blockedId: target.id }).onConflictDoNothing();

      await tx
        .delete(follows)
        .where(
          or(
            and(eq(follows.followerId, blockerId), eq(follows.followingId, target.id)),
            and(eq(follows.followerId, target.id), eq(follows.followingId, blockerId)),
          ),
        );
    });
  },

  async unblock(blockerId: string, targetUsername: string): Promise<void> {
    const target = await findUserByUsername(db, targetUsername);
    await db
      .delete(blocks)
      .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, target.id)));
  },

  isBlockedEitherWay,

  // ── ARAMA ────────────────────────────────────────────────────────────────

  /**
   * Arama — kullanıcı, etkinlik ve kategori.
   *
   * "@emir" yazan kullanıcı @ işaretini kaldırmak zorunda kalmamalı; bu yüzden
   * baştaki '@' temizlenir. LIKE deseninde `%` ve `_` KAÇIRILIR: aksi hâlde
   * tek bir '%' bütün tabloyu döndürür (SQL enjeksiyonu değil ama gereksiz
   * tarama ve şaşırtıcı sonuç).
   */
  async search(query: string, ctx: Ctx = db) {
    const term = query.trim().toLowerCase().replace(/^@+/, '');
    if (term.length < 2) return { users: [], events: [], categories: [] };
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

    const [userRows, eventRows, categoryRows] = await Promise.all([
      ctx
        .select({
          username: users.username,
          displayName: profiles.displayName,
          power: userRatings.predictionPower,
        })
        .from(users)
        .innerJoin(profiles, eq(profiles.userId, users.id))
        .leftJoin(userRatings, eq(userRatings.userId, users.id))
        .where(and(eq(users.status, 'ACTIVE'), sql`${users.usernameLower} LIKE ${like}`))
        .limit(10),
      ctx
        .select({
          slug: events.slug,
          title: events.title,
          question: events.question,
          status: events.status,
          predictionCount: events.predictionCount,
        })
        .from(events)
        .where(
          and(
            inArray(events.status, ['OPEN', 'CLOSED', 'RESOLVED']),
            sql`lower(${events.title}) LIKE ${like}`,
          ),
        )
        .orderBy(desc(events.predictionCount))
        .limit(10),
      ctx
        .select({
          slug: categories.slug,
          name: categories.name,
          icon: categories.icon,
        })
        .from(categories)
        .where(and(eq(categories.active, true), sql`lower(${categories.name}) LIKE ${like}`))
        .limit(5),
    ]);

    return { users: userRows, events: eventRows, categories: categoryRows };
  },
};

// ── yardımcılar ────────────────────────────────────────────────────────────

async function findUserByUsername(ctx: Ctx, username: string) {
  const rows = await ctx
    .select({ id: users.id, username: users.username, status: users.status })
    .from(users)
    .where(eq(users.usernameLower, username.trim().toLowerCase()))
    .limit(1);
  const user = rows[0];
  if (!user) throw new NotFoundError('Bu kullanıcıyı bulamadık.');
  return user;
}

async function isBlockedEitherWay(ctx: Ctx, a: string, b: string): Promise<boolean> {
  const rows = await ctx
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Cursor: base64("<iso>|<id>") — istemciye teknik kimlik sızdırmaz. */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor?: string): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
  } catch {
    return null;
  }
}

export { encodeCursor, decodeCursor, challenges };
