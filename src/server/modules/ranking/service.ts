import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { db, withTransaction, type Tx } from '@/server/db';
import {
  badges,
  categories,
  challenges,
  events,
  leaderboardEntries,
  leaderboardSnapshots,
  predictions,
  profiles,
  seasons,
  trendingSnapshots,
  userBadges,
  userCategoryStats,
  userRatings,
  users,
} from '@/server/db/schema';
import { expertise } from '@/config';
import {
  notificationKeys,
  notificationService,
} from '@/server/modules/social/notification.service';

/**
 * RankingService — liderlik, rozet, sezon ve gündem.
 *
 * Liderlik ve gündem SNAPSHOT olarak üretilir. Gerekçe: her istekte
 * `user_rating JOIN prediction GROUP BY` çalıştırmak kullanıcı sayısıyla
 * doğrusal büyür; snapshot ile okuma tek indexli sorguya iner.
 */

type Ctx = Tx | typeof db;
type Period = 'WEEKLY' | 'MONTHLY' | 'SEASON' | 'ALL_TIME';

const num = (v: string | number | null): number => Number(v ?? 0);

// ── LİDERLİK ────────────────────────────────────────────────────────────────

function periodBounds(period: Period, now = new Date()): { start: Date; end: Date } {
  const end = new Date(now);
  const start = new Date(now);

  switch (period) {
    case 'WEEKLY':
      start.setUTCDate(start.getUTCDate() - 7);
      break;
    case 'MONTHLY':
      start.setUTCMonth(start.getUTCMonth() - 1);
      break;
    case 'SEASON':
    case 'ALL_TIME':
      start.setTime(0);
      break;
  }
  return { start, end };
}

export const rankingService = {
  /**
   * Liderlik anlık görüntüsü üretir.
   *
   * KRİTİK: az tahmin yapan kullanıcı üst sıralara ÇIKAMAZ. Eşik config'ten
   * gelir (`expertise.leaderboardMinPredictions`), koda gömülmez.
   */
  async generateLeaderboard(input: {
    readonly period: Period;
    readonly categorySlug?: string;
    readonly now?: Date;
  }): Promise<{ snapshotId: string; entries: number }> {
    const now = input.now ?? new Date();
    const { start, end } = periodBounds(input.period, now);

    return withTransaction(async (tx) => {
      let categoryId: string | null = null;
      let minPredictions: number = expertise.leaderboardMinPredictions;

      if (input.categorySlug) {
        const cat = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.slug, input.categorySlug))
          .limit(1);
        categoryId = cat[0]?.id ?? null;
        minPredictions = expertise.leaderboardMinCategoryPredictions;
      }

      // Sıralama kaynağı: kategori verilmişse kategori istatistiği, yoksa genel.
      const ranked = categoryId
        ? await tx
            .select({
              userId: userCategoryStats.userId,
              power: userCategoryStats.predictionPower,
              completed: userCategoryStats.completedPredictions,
              correct: userCategoryStats.correctPredictions,
            })
            .from(userCategoryStats)
            .innerJoin(users, eq(users.id, userCategoryStats.userId))
            .where(
              and(
                eq(userCategoryStats.categoryId, categoryId),
                eq(users.status, 'ACTIVE'),
                gte(userCategoryStats.completedPredictions, minPredictions),
              ),
            )
            .orderBy(desc(userCategoryStats.predictionPower))
            .limit(100)
        : await tx
            .select({
              userId: userRatings.userId,
              power: userRatings.predictionPower,
              completed: userRatings.completedPredictions,
              correct: userRatings.correctPredictions,
            })
            .from(userRatings)
            .innerJoin(users, eq(users.id, userRatings.userId))
            .where(
              and(
                eq(users.status, 'ACTIVE'),
                gte(userRatings.completedPredictions, minPredictions),
              ),
            )
            .orderBy(desc(userRatings.predictionPower))
            .limit(100);

      // Aynı dönem için var olan snapshot yenilenir (idempotent üretim).
      const existing = await tx
        .select({ id: leaderboardSnapshots.id })
        .from(leaderboardSnapshots)
        .where(
          and(
            eq(leaderboardSnapshots.period, input.period),
            categoryId
              ? eq(leaderboardSnapshots.categoryId, categoryId)
              : isNull(leaderboardSnapshots.categoryId),
            eq(leaderboardSnapshots.periodStart, start),
          ),
        )
        .limit(1);

      let snapshotId = existing[0]?.id;

      if (snapshotId) {
        await tx.delete(leaderboardEntries).where(eq(leaderboardEntries.snapshotId, snapshotId));
        await tx
          .update(leaderboardSnapshots)
          .set({ generatedAt: now, minPredictions })
          .where(eq(leaderboardSnapshots.id, snapshotId));
      } else {
        const inserted = await tx
          .insert(leaderboardSnapshots)
          .values({
            period: input.period,
            categoryId,
            periodStart: start,
            periodEnd: end,
            minPredictions,
            generatedAt: now,
          })
          .returning({ id: leaderboardSnapshots.id });
        snapshotId = inserted[0]?.id;
      }

      if (!snapshotId) throw new Error('Liderlik anlık görüntüsü oluşturulamadı.');

      if (ranked.length > 0) {
        await tx.insert(leaderboardEntries).values(
          ranked.map((r, i) => ({
            snapshotId,
            userId: r.userId,
            rank: i + 1,
            power: String(r.power),
            completedPredictions: r.completed,
            correctPredictions: r.correct,
          })),
        );
      }

      return { snapshotId, entries: ranked.length };
    });
  },

  /** Liderlik tablosunu okur. Snapshot yoksa boş döner (sayfa boş kalmaz, mesaj gösterir). */
  async getLeaderboard(
    input: { readonly period: Period; readonly categorySlug?: string },
    ctx: Ctx = db,
  ) {
    let categoryId: string | null = null;
    if (input.categorySlug) {
      const cat = await ctx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, input.categorySlug))
        .limit(1);
      categoryId = cat[0]?.id ?? null;
      if (!categoryId) return { entries: [], generatedAt: null, minPredictions: 0 };
    }

    const snapshot = await ctx
      .select({
        id: leaderboardSnapshots.id,
        generatedAt: leaderboardSnapshots.generatedAt,
        minPredictions: leaderboardSnapshots.minPredictions,
      })
      .from(leaderboardSnapshots)
      .where(
        and(
          eq(leaderboardSnapshots.period, input.period),
          categoryId
            ? eq(leaderboardSnapshots.categoryId, categoryId)
            : isNull(leaderboardSnapshots.categoryId),
        ),
      )
      .orderBy(desc(leaderboardSnapshots.generatedAt))
      .limit(1);

    const snap = snapshot[0];
    if (!snap) return { entries: [], generatedAt: null, minPredictions: 0 };

    const entries = await ctx
      .select({
        rank: leaderboardEntries.rank,
        power: leaderboardEntries.power,
        completed: leaderboardEntries.completedPredictions,
        correct: leaderboardEntries.correctPredictions,
        username: users.username,
        displayName: profiles.displayName,
      })
      .from(leaderboardEntries)
      .innerJoin(users, eq(users.id, leaderboardEntries.userId))
      .innerJoin(profiles, eq(profiles.userId, leaderboardEntries.userId))
      .where(eq(leaderboardEntries.snapshotId, snap.id))
      .orderBy(leaderboardEntries.rank)
      .limit(50);

    return { entries, generatedAt: snap.generatedAt, minPredictions: snap.minPredictions };
  },

  /**
   * Kullanıcının kendi sırası — Faz 5.
   *
   * Liderlik tablosu ilk 50'yi gösterir. Kullanıcının kendi yeri listede
   * değilse tablo motive edici olmaktan çıkar ("ben neredeyim?"). Bu yüzden
   * sıra AYRICA okunur; listede zaten varsa da aynı sayı döner ve ekran
   * "Sen #12'sin" diyebilir.
   *
   * Listede olmamanın iki farklı sebebi vardır ve ikisi AYRI mesaj ister:
   *   - eşik dolmadı (`belowThreshold`),
   *   - eşik doldu ama sıralama ilk 100'ün dışında kaldı.
   */
  async viewerStanding(
    input: { readonly period: Period; readonly categorySlug?: string; readonly userId: string },
    ctx: Ctx = db,
  ): Promise<{
    rank: number | null;
    total: number;
    minPredictions: number;
    completed: number;
    belowThreshold: boolean;
  } | null> {
    let categoryId: string | null = null;
    if (input.categorySlug) {
      const cat = await ctx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, input.categorySlug))
        .limit(1);
      categoryId = cat[0]?.id ?? null;
      if (!categoryId) return null;
    }

    const snapshot = await ctx
      .select({
        id: leaderboardSnapshots.id,
        minPredictions: leaderboardSnapshots.minPredictions,
      })
      .from(leaderboardSnapshots)
      .where(
        and(
          eq(leaderboardSnapshots.period, input.period),
          categoryId
            ? eq(leaderboardSnapshots.categoryId, categoryId)
            : isNull(leaderboardSnapshots.categoryId),
        ),
      )
      .orderBy(desc(leaderboardSnapshots.generatedAt))
      .limit(1);

    const snap = snapshot[0];
    if (!snap) return null;

    // Toplam katılımcı: "3.412 kişi içinde 127." demek için gerekir.
    const totals = await ctx
      .select({ n: sql<number>`count(*)::int` })
      .from(leaderboardEntries)
      .where(eq(leaderboardEntries.snapshotId, snap.id));

    const mine = await ctx
      .select({ rank: leaderboardEntries.rank })
      .from(leaderboardEntries)
      .where(
        and(
          eq(leaderboardEntries.snapshotId, snap.id),
          eq(leaderboardEntries.userId, input.userId),
        ),
      )
      .limit(1);

    const ratingRows = await ctx
      .select({ completed: userRatings.completedPredictions })
      .from(userRatings)
      .where(eq(userRatings.userId, input.userId))
      .limit(1);
    const completed = ratingRows[0]?.completed ?? 0;

    return {
      rank: mine[0]?.rank ?? null,
      total: totals[0]?.n ?? 0,
      minPredictions: snap.minPredictions,
      completed,
      belowThreshold: completed < snap.minPredictions,
    };
  },

  // ── GÜNDEM ────────────────────────────────────────────────────────────────

  /**
   * Gündem sıralaması — BASİT ve AÇIKLANABİLİR. ML/AI yoktur.
   *
   *   skor = (son 24 saatteki tahmin × 3) + (son 24 saatteki Meydan Okuma × 5)
   *          + toplam tahmin × 0,5
   *
   * Meydan Okuma daha ağır, çünkü ürünün asıl sinyali odur.
   */
  async generateTrending(now = new Date()): Promise<{ ranked: number }> {
    // NOT: ham SQL parametresi olarak `Date` GEÇİLMEZ. Drizzle bu alt sorgudaki
    // parametreye sütun tipi bilgisi ekleyemediği için sürücü ham Date'i
    // serileştiremiyor ve sorgu çalışma anında patlıyordu (entegrasyon testinde
    // yakalandı). ISO metin + açık `::timestamptz` dönüşümü tipi kesinleştirir.
    const since = new Date(now.getTime() - 24 * 3600_000).toISOString();

    return withTransaction(async (tx) => {
      const rows = await tx
        .select({
          eventId: events.id,
          totalPredictions: events.predictionCount,
          recentPredictions: sql<number>`
            (SELECT count(*)::int FROM prediction p
              WHERE p.event_id = ${events.id} AND p.created_at >= ${since}::timestamptz)`,
          recentChallenges: sql<number>`
            (SELECT count(*)::int FROM challenge c
              WHERE c.event_id = ${events.id} AND c.created_at >= ${since}::timestamptz)`,
        })
        .from(events)
        .where(eq(events.status, 'OPEN'));

      const scored = rows
        .map((r) => ({
          ...r,
          score: r.recentPredictions * 3 + r.recentChallenges * 5 + r.totalPredictions * 0.5,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);

      await tx.delete(trendingSnapshots);

      if (scored.length > 0) {
        await tx.insert(trendingSnapshots).values(
          scored.map((s, i) => ({
            eventId: s.eventId,
            rank: i + 1,
            score: s.score.toFixed(4),
            recentPredictions: s.recentPredictions,
            recentChallenges: s.recentChallenges,
            generatedAt: now,
          })),
        );
      }

      return { ranked: scored.length };
    });
  },

  async getTrending(limit = 10, ctx: Ctx = db) {
    return ctx
      .select({
        rank: trendingSnapshots.rank,
        recentPredictions: trendingSnapshots.recentPredictions,
        recentChallenges: trendingSnapshots.recentChallenges,
        eventId: events.id,
        slug: events.slug,
        title: events.title,
        question: events.question,
        closesAt: events.closesAt,
        predictionCount: events.predictionCount,
        challengeCount: events.challengeCount,
        categoryName: categories.name,
        categoryIcon: categories.icon,
        categoryKind: categories.kind,
      })
      .from(trendingSnapshots)
      .innerJoin(events, eq(events.id, trendingSnapshots.eventId))
      .innerJoin(categories, eq(categories.id, events.categoryId))
      .where(eq(events.status, 'OPEN'))
      .orderBy(trendingSnapshots.rank)
      .limit(limit);
  },

  // ── ROZETLER ──────────────────────────────────────────────────────────────

  /**
   * Kullanıcının hak ettiği rozetleri verir.
   *
   * Kurallar VERİTABANINDAN okunur; frontend'de sabit liste yoktur.
   * `user_badge` birincil anahtarı aynı rozetin iki kez verilmesini engeller.
   */
  async evaluateBadges(tx: Tx, userId: string): Promise<string[]> {
    const active = await tx.select().from(badges).where(eq(badges.active, true));
    if (active.length === 0) return [];

    const owned = await tx
      .select({ badgeId: userBadges.badgeId })
      .from(userBadges)
      .where(eq(userBadges.userId, userId));
    const ownedIds = new Set(owned.map((o) => o.badgeId));

    const ratingRows = await tx
      .select()
      .from(userRatings)
      .where(eq(userRatings.userId, userId))
      .limit(1);
    const rating = ratingRows[0];
    if (!rating) return [];

    const winsRow = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(challenges)
      .where(eq(challenges.winnerUserId, userId));
    const wins = winsRow[0]?.n ?? 0;

    const catStats = await tx
      .select({
        categoryId: userCategoryStats.categoryId,
        slug: categories.slug,
        power: userCategoryStats.predictionPower,
        completed: userCategoryStats.completedPredictions,
      })
      .from(userCategoryStats)
      .innerJoin(categories, eq(categories.id, userCategoryStats.categoryId))
      .where(eq(userCategoryStats.userId, userId));

    const awarded: string[] = [];

    for (const badge of active) {
      if (ownedIds.has(badge.id)) continue;
      const cfg = (badge.ruleConfig ?? {}) as Record<string, unknown>;
      let qualifies = false;

      switch (badge.rule) {
        case 'CORRECT_PREDICTIONS':
          qualifies = rating.correctPredictions >= Number(cfg.count ?? Infinity);
          break;
        case 'COMPLETED_PREDICTIONS':
          qualifies = rating.completedPredictions >= Number(cfg.count ?? Infinity);
          break;
        case 'CHALLENGE_WINS':
          qualifies = wins >= Number(cfg.count ?? Infinity);
          break;
        case 'PREDICTION_POWER':
          qualifies =
            num(rating.predictionPower) >= Number(cfg.power ?? Infinity) &&
            rating.completedPredictions >= Number(cfg.count ?? 0);
          break;
        case 'CATEGORY_EXPERT': {
          const stat = catStats.find((c) => c.slug === cfg.categorySlug);
          qualifies =
            !!stat &&
            num(stat.power) >= Number(cfg.power ?? expertise.minCategoryPower) &&
            stat.completed >= Number(cfg.count ?? expertise.minCategoryPredictions);
          break;
        }
        case 'LEADERBOARD_RANK':
          // Liderlik rozetleri snapshot üretiminde verilir; burada atlanır.
          qualifies = false;
          break;
      }

      if (!qualifies) continue;

      const inserted = await tx
        .insert(userBadges)
        .values({ userId, badgeId: badge.id })
        .onConflictDoNothing()
        .returning({ badgeId: userBadges.badgeId });

      if (inserted.length === 1) {
        awarded.push(badge.slug);
        await notificationService.create(tx, {
          userId,
          type: 'BADGE_EARNED',
          body: `${badge.icon} "${badge.name}" rozetini kazandın!`,
          href: '/app/profile',
          dedupeKey: notificationKeys.badgeEarned(userId, badge.id),
        });
      }
    }

    return awarded;
  },

  async listUserBadges(userId: string, ctx: Ctx = db) {
    return ctx
      .select({
        slug: badges.slug,
        name: badges.name,
        description: badges.description,
        icon: badges.icon,
        awardedAt: userBadges.awardedAt,
      })
      .from(userBadges)
      .innerJoin(badges, eq(badges.id, userBadges.badgeId))
      .where(eq(userBadges.userId, userId))
      .orderBy(desc(userBadges.awardedAt));
  },

  // ── SEZON ─────────────────────────────────────────────────────────────────

  async activeSeason(ctx: Ctx = db) {
    const rows = await ctx.select().from(seasons).where(eq(seasons.status, 'ACTIVE')).limit(1);
    return rows[0];
  },

  /** Yönetim: tanımlı tüm rozetler (kural motoru veriden okur). */
  async listBadges(ctx: Ctx = db) {
    return ctx.select().from(badges).orderBy(asc(badges.sortOrder));
  },

  async listSeasons(ctx: Ctx = db) {
    return ctx.select().from(seasons).orderBy(desc(seasons.startAt));
  },

  /** Kullanıcının kategori uzmanlıkları — profil "UZMANLIK" sekmesi. */
  async categoryExpertise(userId: string, ctx: Ctx = db) {
    const rows = await ctx
      .select({
        slug: categories.slug,
        name: categories.name,
        icon: categories.icon,
        power: userCategoryStats.predictionPower,
        completed: userCategoryStats.completedPredictions,
        correct: userCategoryStats.correctPredictions,
      })
      .from(userCategoryStats)
      .innerJoin(categories, eq(categories.id, userCategoryStats.categoryId))
      .where(eq(userCategoryStats.userId, userId))
      .orderBy(desc(userCategoryStats.predictionPower));

    return rows.map((r) => ({
      ...r,
      power: num(r.power),
      // Uzmanlık eşiği config'ten gelir; koda gömülmez.
      isExpert:
        r.completed >= expertise.minCategoryPredictions &&
        num(r.power) >= expertise.minCategoryPower,
    }));
  },
};

export { predictions };
