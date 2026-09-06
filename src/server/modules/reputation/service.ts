import { eq, sql } from 'drizzle-orm';
import { db, type Tx } from '@/server/db';
import { ratingHistory, userCategoryStats, userRatings } from '@/server/db/schema';
import { rating } from '@/config';
import {
  applyResolvedPrediction,
  computePredictionPower,
  emptyCounters,
  rawAccuracy,
  type PowerBreakdown,
  type RatingCounters,
} from './domain/prediction-power';

/**
 * ReputationService — Tahmin Gücü'nün kalıcılaştırılması.
 *
 * Hesabın kendisi `domain/prediction-power.ts` içindedir (saf, I/O'suz).
 * Bu servis yalnızca sayaçları okur, saf fonksiyonu çağırır ve sonucu yazar.
 *
 * Güncelleme O(1)'dir: kümülatif alanlar sayesinde geçmiş taranmaz.
 */

type Ctx = Tx | typeof db;

const num = (v: string | number | null): number => Number(v ?? 0);

function toCounters(row: {
  completedPredictions: number;
  correctPredictions: number;
  difficultyWeightSum: string;
  difficultyScoreSum: string;
  formScore: string;
  recentCount: number;
}): RatingCounters {
  return {
    total: row.completedPredictions,
    correct: row.correctPredictions,
    weightSum: num(row.difficultyWeightSum),
    weightedCorrectSum: num(row.difficultyScoreSum),
    form: num(row.formScore),
    recentCount: row.recentCount,
  };
}

export const reputationService = {
  /** Kullanıcının Tahmin Gücü özeti — profil ve akış başlığı için. */
  async getSummary(
    userId: string,
    ctx: Ctx = db,
  ): Promise<{
    power: number;
    completed: number;
    correct: number;
    rawAccuracy: number;
    breakdown: PowerBreakdown;
  }> {
    const rows = await ctx
      .select()
      .from(userRatings)
      .where(eq(userRatings.userId, userId))
      .limit(1);
    const row = rows[0];

    if (!row) {
      const fresh = computePredictionPower(emptyCounters);
      return {
        power: fresh.power,
        completed: 0,
        correct: 0,
        rawAccuracy: 0,
        breakdown: fresh.breakdown,
      };
    }

    const counters = toCounters(row);
    const result = computePredictionPower(counters);
    return {
      power: num(row.predictionPower),
      completed: row.completedPredictions,
      correct: row.correctPredictions,
      rawAccuracy: num(row.rawAccuracy),
      breakdown: result.breakdown,
    };
  },

  /**
   * Sonuçlanan bir tahmini itibara işler.
   *
   * VOID tahminler HİÇBİR sayaca girmez — etkinliğin belirsizliği kullanıcının
   * itibarını etkilememelidir.
   */
  async applyPrediction(
    tx: Tx,
    input: {
      readonly userId: string;
      readonly categoryId: string;
      readonly wasCorrect: boolean;
      readonly weight: number;
      readonly predictionId: string;
    },
  ): Promise<{ before: number; after: number }> {
    // --- Genel Tahmin Gücü ---
    await tx.insert(userRatings).values({ userId: input.userId }).onConflictDoNothing();

    const currentRows = await tx
      .select()
      .from(userRatings)
      .where(eq(userRatings.userId, input.userId))
      .for('update');

    const current = currentRows[0];
    if (!current) throw new Error('İtibar kaydı oluşturulamadı.');

    const before = num(current.predictionPower);
    const next = applyResolvedPrediction(toCounters(current), {
      wasCorrect: input.wasCorrect,
      weight: input.weight,
    });
    const computed = computePredictionPower(next);

    await tx
      .update(userRatings)
      .set({
        predictionPower: String(computed.power),
        rawAccuracy: String(rawAccuracy(next.correct, next.total).toFixed(5)),
        completedPredictions: next.total,
        correctPredictions: next.correct,
        difficultyWeightSum: next.weightSum.toFixed(5),
        difficultyScoreSum: next.weightedCorrectSum.toFixed(5),
        formScore: next.form.toFixed(5),
        recentCount: next.recentCount,
        last30Total: Math.min(rating.recentWindow, next.total),
        last30Correct: Math.min(rating.recentWindow, next.correct),
        algorithmVersion: rating.algorithmVersion,
        updatedAt: new Date(),
      })
      .where(eq(userRatings.userId, input.userId));

    // --- Kategori uzmanlığı: aynı formül, kategoriye filtrelenmiş sayaçlarla ---
    await tx
      .insert(userCategoryStats)
      .values({ userId: input.userId, categoryId: input.categoryId })
      .onConflictDoNothing();

    const catRows = await tx
      .select()
      .from(userCategoryStats)
      .where(
        sql`${userCategoryStats.userId} = ${input.userId} AND ${userCategoryStats.categoryId} = ${input.categoryId}`,
      )
      .for('update');

    const cat = catRows[0];
    if (cat) {
      const nextCat = applyResolvedPrediction(toCounters(cat), {
        wasCorrect: input.wasCorrect,
        weight: input.weight,
      });
      const catPower = computePredictionPower(nextCat);

      await tx
        .update(userCategoryStats)
        .set({
          predictionPower: String(catPower.power),
          completedPredictions: nextCat.total,
          correctPredictions: nextCat.correct,
          difficultyWeightSum: nextCat.weightSum.toFixed(5),
          difficultyScoreSum: nextCat.weightedCorrectSum.toFixed(5),
          formScore: nextCat.form.toFixed(5),
          recentCount: nextCat.recentCount,
          updatedAt: new Date(),
        })
        .where(
          sql`${userCategoryStats.userId} = ${input.userId} AND ${userCategoryStats.categoryId} = ${input.categoryId}`,
        );
    }

    // --- Denetim izi ---
    await tx.insert(ratingHistory).values({
      userId: input.userId,
      categoryId: null,
      power: String(computed.power),
      delta: (computed.power - before).toFixed(3),
      reason: `prediction:${input.predictionId}`,
      version: rating.algorithmVersion,
    });

    return { before, after: computed.power };
  },
};
