import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type Tx } from '@/server/db';
import {
  challenges,
  eventOutcomes,
  events,
  predictions,
  profiles,
  userRatings,
  users,
} from '@/server/db/schema';
import {
  computePredictionPower,
  emptyCounters,
} from '@/server/modules/reputation/domain/prediction-power';
import { rankingService } from '@/server/modules/ranking/service';
import { rating as ratingConfig } from '@/config';

/**
 * Public profil okuma — /u/[username].
 *
 * Tek yerde toplanır çünkü hem public sayfa hem de kendi profil sayfası aynı
 * veriyi gösterir. Teknik kimlikler (userId, predictionId) çağırana DÖNMEZ;
 * yalnızca kullanıcı adı ve gösterilecek metinler döner.
 */

type Ctx = Tx | typeof db;
const num = (v: string | number | null): number => Number(v ?? 0);

export type PublicProfile = Awaited<ReturnType<typeof profileService.getByUsername>>;

export const profileService = {
  async getByUsername(username: string, ctx: Ctx = db) {
    const rows = await ctx
      .select({
        userId: users.id,
        username: users.username,
        status: users.status,
        createdAt: users.createdAt,
        displayName: profiles.displayName,
        bio: profiles.bio,
        avatarUrl: profiles.avatarUrl,
        followerCount: profiles.followerCount,
        followingCount: profiles.followingCount,
        power: userRatings.predictionPower,
        rawAccuracy: userRatings.rawAccuracy,
        completed: userRatings.completedPredictions,
        correct: userRatings.correctPredictions,
        last30Correct: userRatings.last30Correct,
        last30Total: userRatings.last30Total,
        formScore: userRatings.formScore,
        weightSum: userRatings.difficultyWeightSum,
        weightedCorrectSum: userRatings.difficultyScoreSum,
        recentCount: userRatings.recentCount,
      })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .leftJoin(userRatings, eq(userRatings.userId, users.id))
      .where(eq(users.usernameLower, username.trim().toLowerCase()))
      .limit(1);

    const row = rows[0];
    if (!row || row.status === 'DELETED') return null;

    const counters = {
      total: row.completed ?? 0,
      correct: row.correct ?? 0,
      weightSum: num(row.weightSum),
      weightedCorrectSum: num(row.weightedCorrectSum),
      form: row.formScore === null ? 0.5 : num(row.formScore),
      recentCount: row.recentCount ?? 0,
    };
    const computed = computePredictionPower(row.completed === null ? emptyCounters : counters);

    return {
      userId: row.userId,
      username: row.username,
      displayName: row.displayName,
      bio: row.bio,
      avatarUrl: row.avatarUrl,
      suspended: row.status !== 'ACTIVE',
      joinedAt: row.createdAt,
      followerCount: row.followerCount,
      followingCount: row.followingCount,
      power: row.power === null ? ratingConfig.coldStartPower : num(row.power),
      breakdown: computed.breakdown,
      completed: row.completed ?? 0,
      correct: row.correct ?? 0,
      incorrect: (row.completed ?? 0) - (row.correct ?? 0),
      rawAccuracy: num(row.rawAccuracy),
      last30: { correct: row.last30Correct ?? 0, total: row.last30Total ?? 0 },
    };
  },

  /** Public tahmin geçmişi — teknik kimlik içermez. */
  async recentPredictions(userId: string, limit = 20, ctx: Ctx = db) {
    return ctx
      .select({
        id: predictions.id,
        status: predictions.status,
        result: predictions.result,
        stakeAmount: predictions.stakeAmount,
        createdAt: predictions.createdAt,
        eventTitle: events.title,
        eventSlug: events.slug,
        outcomeLabel: eventOutcomes.label,
      })
      .from(predictions)
      .innerJoin(events, eq(events.id, predictions.eventId))
      .innerJoin(eventOutcomes, eq(eventOutcomes.id, predictions.outcomeId))
      .where(eq(predictions.userId, userId))
      .orderBy(desc(predictions.createdAt))
      .limit(limit);
  },

  /** Meydan Okuma geçmişi — kazanan/kaybeden gösterimi için. */
  async challengeHistory(userId: string, limit = 20, ctx: Ctx = db) {
    return ctx
      .select({
        id: challenges.id,
        status: challenges.status,
        settlement: challenges.settlement,
        stakeAmount: challenges.stakeAmount,
        winnerUserId: challenges.winnerUserId,
        createdAt: challenges.createdAt,
        eventTitle: events.title,
        creatorId: challenges.creatorId,
        opponentId: challenges.opponentId,
      })
      .from(challenges)
      .innerJoin(events, eq(events.id, challenges.eventId))
      .where(sql`${challenges.creatorId} = ${userId} OR ${challenges.opponentId} = ${userId}`)
      .orderBy(desc(challenges.createdAt))
      .limit(limit);
  },

  /**
   * Meydan Okuma sayaçları — profil üst şeridi (Faz 5).
   *
   * TEK sorguda toplanır. Ayrı ayrı `count(*)` çağırmak N+1'in küçük kardeşidir:
   * aynı tabloya art arda üç gidiş, tek taramayla aynı işi yapabilecekken.
   */
  async challengeStats(userId: string, ctx: Ctx = db) {
    const rows = await ctx.execute<{ total: string; wins: string; settled: string }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE creator_id = ${userId} OR opponent_id = ${userId})::text AS total,
        COUNT(*) FILTER (WHERE winner_user_id = ${userId})::text                        AS wins,
        COUNT(*) FILTER (
          WHERE status = 'COMPLETED' AND (creator_id = ${userId} OR opponent_id = ${userId})
        )::text AS settled
      FROM challenge
    `);
    const row = rows[0];
    return {
      total: Number(row?.total ?? 0),
      wins: Number(row?.wins ?? 0),
      settled: Number(row?.settled ?? 0),
    };
  },

  async badges(userId: string, ctx: Ctx = db) {
    return rankingService.listUserBadges(userId, ctx);
  },

  async expertise(userId: string, ctx: Ctx = db) {
    return rankingService.categoryExpertise(userId, ctx);
  },

  /** Etkinlik sayfasındaki "en iyi tahminciler" listesi. */
  async topPredictorsForEvent(eventId: string, limit = 5, ctx: Ctx = db) {
    return ctx
      .select({
        username: users.username,
        power: userRatings.predictionPower,
        outcomeLabel: eventOutcomes.label,
      })
      .from(predictions)
      .innerJoin(users, eq(users.id, predictions.userId))
      .innerJoin(eventOutcomes, eq(eventOutcomes.id, predictions.outcomeId))
      .leftJoin(userRatings, eq(userRatings.userId, predictions.userId))
      .where(
        and(
          eq(predictions.eventId, eventId),
          inArray(predictions.status, ['OPEN', 'LOCKED', 'RESOLVED']),
        ),
      )
      .orderBy(desc(userRatings.predictionPower))
      .limit(limit);
  },
};
