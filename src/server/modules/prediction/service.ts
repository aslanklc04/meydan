import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, withTransaction, type Tx } from '@/server/db';
import { eventOutcomes, events, predictions } from '@/server/db/schema';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  isUniqueViolation,
} from '@/server/errors';
import { socialService } from '@/server/modules/social/service';
import {
  notificationKeys,
  notificationService,
} from '@/server/modules/social/notification.service';
import { users, follows, eventOutcomes as outcomesTable } from '@/server/db/schema';

/**
 * PredictionService — tahmin oluşturma ve okuma.
 *
 * Sahip olduğu kurallar:
 *   - etkinlik açık ve tahmin süresi dolmamış olmalı
 *   - sonuç o etkinliğe ait olmalı
 *   - kullanıcının aynı etkinlikte tek aktif tahmini olabilir
 *   - sonuçlanmış tahmin değiştirilemez
 */

type Ctx = Tx | typeof db;

export type CreatePredictionInput = {
  readonly userId: string;
  readonly eventId: string;
  readonly outcomeId: string;
  readonly stakeAmount?: number;
  readonly locked?: boolean;
};

/** Etkinliği kilitleyip tahmine uygunluğunu doğrular. Meydan okuma da bunu kullanır. */
export async function assertEventAcceptsPredictions(tx: Tx, eventId: string, now: Date) {
  const rows = await tx
    .select({
      id: events.id,
      status: events.status,
      closesAt: events.closesAt,
      categoryId: events.categoryId,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  const event = rows[0];
  if (!event) throw new NotFoundError('Etkinlik bulunamadı.');
  if (event.status !== 'OPEN') {
    throw new BusinessRuleError('EVENT_NOT_OPEN', 'Bu etkinlik tahmine kapalı.');
  }
  if (event.closesAt.getTime() <= now.getTime()) {
    throw new BusinessRuleError('EVENT_CLOSED', 'Bu etkinlik için tahmin süresi doldu.');
  }
  return event;
}

/** Sonucun gerçekten bu etkinliğe ait olduğunu doğrular (IDOR koruması). */
export async function assertOutcomeBelongsToEvent(tx: Tx, eventId: string, outcomeId: string) {
  const rows = await tx
    .select({ id: eventOutcomes.id, label: eventOutcomes.label })
    .from(eventOutcomes)
    .where(and(eq(eventOutcomes.id, outcomeId), eq(eventOutcomes.eventId, eventId)))
    .limit(1);

  const outcome = rows[0];
  if (!outcome) throw new BusinessRuleError('INVALID_OUTCOME', 'Geçersiz seçim.');
  return outcome;
}

/**
 * Tahmin satırını yazar ve sayaçları günceller.
 * Transaction'ı AÇMAZ — çağıranın bağlamında çalışır.
 */
export async function insertPrediction(
  tx: Tx,
  input: CreatePredictionInput & { categoryId: string },
): Promise<{ id: string }> {
  try {
    const inserted = await tx
      .insert(predictions)
      .values({
        userId: input.userId,
        eventId: input.eventId,
        outcomeId: input.outcomeId,
        categoryId: input.categoryId,
        stakeAmount: input.stakeAmount ?? 0,
        status: input.locked ? 'LOCKED' : 'OPEN',
        isLocked: input.locked ?? false,
      })
      .returning({ id: predictions.id });

    const row = inserted[0];
    if (!row) throw new Error('Tahmin oluşturulamadı.');

    await tx
      .update(events)
      .set({ predictionCount: sql`${events.predictionCount} + 1`, updatedAt: new Date() })
      .where(eq(events.id, input.eventId));

    await tx
      .update(eventOutcomes)
      .set({ predictionCount: sql`${eventOutcomes.predictionCount} + 1` })
      .where(eq(eventOutcomes.id, input.outcomeId));

    return row;
  } catch (error) {
    // Yarış koşulu: iki istek uygulama kontrolünü aynı anda geçebilir.
    // Partial unique index ikinciyi reddeder — nihai savunma budur.
    if (isUniqueViolation(error)) {
      throw new ConflictError('ALREADY_PREDICTED', 'Bu tahmini zaten yaptın.');
    }
    throw error;
  }
}

export const predictionService = {
  assertEventAcceptsPredictions,
  assertOutcomeBelongsToEvent,
  insertPrediction,

  /** Serbest tahmin — meydan okumasız. */
  async create(input: CreatePredictionInput): Promise<{ predictionId: string }> {
    const now = new Date();
    return withTransaction(async (tx) => {
      const event = await assertEventAcceptsPredictions(tx, input.eventId, now);
      const outcome = await assertOutcomeBelongsToEvent(tx, input.eventId, input.outcomeId);

      const row = await insertPrediction(tx, {
        ...input,
        categoryId: event.categoryId,
      });

      await publishPredictionToFollowers(tx, {
        actorId: input.userId,
        predictionId: row.id,
        eventId: input.eventId,
        categoryId: event.categoryId,
        outcomeLabel: outcome.label,
      });

      return { predictionId: row.id };
    });
  },

  async findActiveForUserEvent(userId: string, eventId: string, ctx: Ctx = db) {
    const rows = await ctx
      .select()
      .from(predictions)
      .where(
        and(
          eq(predictions.userId, userId),
          eq(predictions.eventId, eventId),
          inArray(predictions.status, ['OPEN', 'LOCKED']),
        ),
      )
      .limit(1);
    return rows[0];
  },

  /** Kullanıcının tahmin geçmişi — profil ve akış için. */
  async listForUser(userId: string, limit = 20, ctx: Ctx = db) {
    return ctx
      .select({
        id: predictions.id,
        status: predictions.status,
        result: predictions.result,
        stakeAmount: predictions.stakeAmount,
        createdAt: predictions.createdAt,
        eventTitle: events.title,
        eventQuestion: events.question,
        outcomeLabel: eventOutcomes.label,
      })
      .from(predictions)
      .innerJoin(events, eq(events.id, predictions.eventId))
      .innerJoin(eventOutcomes, eq(eventOutcomes.id, predictions.outcomeId))
      .where(eq(predictions.userId, userId))
      .orderBy(sql`${predictions.createdAt} DESC`)
      .limit(limit);
  },
};

/**
 * Tahmin yapıldığında akışa yazar ve takipçilere bildirir.
 *
 * Akış "fan-out on read" ile okunur (tek `feed_item` satırı), bildirim ise
 * takipçi başına üretilir. Bildirim sayısı takipçi sayısıyla büyüdüğü için
 * tavan uygulanır: çok takipçili hesaplarda bildirim seli oluşmaz.
 */
export async function publishPredictionToFollowers(
  tx: Tx,
  input: {
    readonly actorId: string;
    readonly predictionId: string;
    readonly eventId: string;
    readonly categoryId: string;
    readonly outcomeLabel: string;
  },
): Promise<void> {
  await socialService.recordFeedItem(tx, {
    actorId: input.actorId,
    kind: 'PREDICTION_CREATED',
    eventId: input.eventId,
    predictionId: input.predictionId,
    categoryId: input.categoryId,
  });

  const actorRows = await tx
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, input.actorId))
    .limit(1);
  const username = actorRows[0]?.username;
  if (!username) return;

  const eventRows = await tx
    .select({ title: events.title })
    .from(events)
    .where(eq(events.id, input.eventId))
    .limit(1);
  const title = eventRows[0]?.title ?? 'bir etkinlik';

  const followerRows = await tx
    .select({ id: follows.followerId })
    .from(follows)
    .where(eq(follows.followingId, input.actorId))
    .limit(FOLLOWER_NOTIFICATION_CAP);

  await notificationService.createMany(
    tx,
    followerRows.map((f) => ({
      userId: f.id,
      type: 'FOLLOWED_USER_PREDICTION' as const,
      actorId: input.actorId,
      body: `@${username} yeni bir tahmin yaptı: ${title} — ${input.outcomeLabel}`,
      href: '/app/feed',
      dedupeKey: notificationKeys.followedPrediction(input.predictionId, f.id),
    })),
  );
}

/** Bildirim seli tavanı — çok takipçili hesaplarda kuyruk şişmesin. */
const FOLLOWER_NOTIFICATION_CAP = 500;

export { outcomesTable };
