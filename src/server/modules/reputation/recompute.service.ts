import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db, withTransaction } from '@/server/db';
import {
  eventOutcomes,
  events,
  predictions,
  userCategoryStats,
  userRatings,
} from '@/server/db/schema';
import {
  applyResolvedPrediction,
  computePredictionPower,
  difficultyWeight,
  emptyCounters,
  rawAccuracy,
  type RatingCounters,
} from './domain/prediction-power';
import { rating } from '@/config';
import { log } from '@/server/observability/logger';
import { auditService } from '@/server/modules/governance/audit.service';

/**
 * İTİBARIN YENİDEN HESAPLANMASI — algoritma sürüm geçişleri için.
 *
 * NEDEN GEREKLİ: Tahmin Gücü sayaçlardan türetilir, ama `power` sütunu
 * hesaplanmış hâliyle SAKLANIR (liderlik sıralaması bunun üzerinden çalışır).
 * Algoritma sürümü değiştiğinde saklanan puanlar eski formülün ürünüdür ve
 * yeni formülle üretilenlerle AYNI TABLODA yan yana durur — sıralama anlamsız
 * hale gelir. Bu betik geçmişi baştan oynatarak tabloyu tek sürüme taşır.
 *
 * NEDEN GEÇMİŞ YENİDEN OYNANABİLİR: zorluk ağırlığının girdisi olan
 * `consensus_share` tahmin kapanışında DONDURULUR (Ek A.4). Bu yüzden aynı
 * geçmiş her zaman aynı sonucu verir — hesap denetlenebilirdir.
 *
 * NEDEN VOID HARİÇ: iptal edilen etkinlik kullanıcının becerisi hakkında bilgi
 * taşımaz; sayaçlara hiç girmez.
 */

type ResolvedRow = {
  readonly userId: string;
  readonly categoryId: string;
  readonly result: 'CORRECT' | 'INCORRECT';
  readonly consensusShare: string | null;
  readonly participantCount: number;
};

export type RecomputeReport = {
  readonly users: number;
  readonly predictions: number;
  readonly categoryStats: number;
  readonly changed: number;
  readonly maxDelta: number;
};

export const recomputeService = {
  /**
   * Tüm kullanıcıların itibarını sıfırdan hesaplar.
   *
   * `dryRun` ile yalnızca farkı raporlar, hiçbir satırı değiştirmez —
   * production'da önce bununla çalıştırılması beklenir.
   */
  async recomputeAll(options: { readonly dryRun?: boolean } = {}): Promise<RecomputeReport> {
    const dryRun = options.dryRun ?? false;

    // Sonuçlanmış tüm tahminler, KRONOLOJİK sırayla. Sıra formu (EWMA)
    // etkilediği için rastgele sırayla oynanamaz.
    const rows = (await db
      .select({
        userId: predictions.userId,
        categoryId: predictions.categoryId,
        result: predictions.result,
        consensusShare: eventOutcomes.consensusShare,
        participantCount: events.predictionCount,
      })
      .from(predictions)
      .innerJoin(eventOutcomes, eq(eventOutcomes.id, predictions.outcomeId))
      .innerJoin(events, eq(events.id, predictions.eventId))
      .where(inArray(predictions.result, ['CORRECT', 'INCORRECT']))
      .orderBy(asc(predictions.resolvedAt), asc(predictions.id))) as ResolvedRow[];

    const general = new Map<string, RatingCounters>();
    const perCategory = new Map<string, RatingCounters>();

    for (const row of rows) {
      const weight = difficultyWeight(
        row.consensusShare === null ? null : Number(row.consensusShare),
        row.participantCount,
      );
      const input = { wasCorrect: row.result === 'CORRECT', weight };

      general.set(
        row.userId,
        applyResolvedPrediction(general.get(row.userId) ?? emptyCounters, input),
      );

      const key = `${row.userId}|${row.categoryId}`;
      perCategory.set(key, applyResolvedPrediction(perCategory.get(key) ?? emptyCounters, input));
    }

    // Hiç tahmini olmayan kullanıcıların satırı da sürüme taşınmalı:
    // puanları soğuk başlangıç değeridir ve sürüm 1'de bu değer farklıydı.
    const allRatings = await db
      .select({ userId: userRatings.userId, power: userRatings.predictionPower })
      .from(userRatings);

    let changed = 0;
    let maxDelta = 0;

    for (const existing of allRatings) {
      const counters = general.get(existing.userId) ?? emptyCounters;
      const computed = computePredictionPower(counters);
      const delta = Math.abs(computed.power - Number(existing.power));
      if (delta > 0.0005) {
        changed += 1;
        maxDelta = Math.max(maxDelta, delta);
      }
    }

    if (dryRun) {
      log.info('rating.recompute.dry_run', {
        users: allRatings.length,
        predictions: rows.length,
        changed,
        maxDelta: Number(maxDelta.toFixed(3)),
      });
      return {
        users: allRatings.length,
        predictions: rows.length,
        categoryStats: perCategory.size,
        changed,
        maxDelta: Number(maxDelta.toFixed(3)),
      };
    }

    // Yazma TEK transaction'da: yarım kalmış bir geçiş, tabloyu iki sürümün
    // karışımı hâlinde bırakır ve liderlik anlamsızlaşır.
    await withTransaction(async (tx) => {
      for (const existing of allRatings) {
        const counters = general.get(existing.userId) ?? emptyCounters;
        const computed = computePredictionPower(counters);

        await tx
          .update(userRatings)
          .set({
            predictionPower: String(computed.power),
            rawAccuracy: rawAccuracy(counters.correct, counters.total).toFixed(5),
            completedPredictions: counters.total,
            correctPredictions: counters.correct,
            difficultyWeightSum: counters.weightSum.toFixed(5),
            difficultyScoreSum: counters.weightedCorrectSum.toFixed(5),
            formScore: counters.form.toFixed(5),
            recentCount: counters.recentCount,
            algorithmVersion: rating.algorithmVersion,
            updatedAt: new Date(),
          })
          .where(eq(userRatings.userId, existing.userId));
      }

      for (const [key, counters] of perCategory) {
        const [userId, categoryId] = key.split('|');
        if (!userId || !categoryId) continue;
        const computed = computePredictionPower(counters);

        await tx
          .update(userCategoryStats)
          .set({
            predictionPower: String(computed.power),
            completedPredictions: counters.total,
            correctPredictions: counters.correct,
            difficultyWeightSum: counters.weightSum.toFixed(5),
            difficultyScoreSum: counters.weightedCorrectSum.toFixed(5),
            formScore: counters.form.toFixed(5),
            recentCount: counters.recentCount,
            updatedAt: new Date(),
          })
          .where(
            sql`${userCategoryStats.userId} = ${userId} AND ${userCategoryStats.categoryId} = ${categoryId}`,
          );
      }
    });

    /*
     * DENETİM KAYDI: bu işlem her kullanıcının başkalarına gösterdiği
     * itibar sayısını toplu olarak değiştirir. Geri alınamaz ve
     * kullanıcıya görünürdür; kim ne zaman çalıştırdı kayıt altında olmalı.
     * (Aktör null: betik insan tarafından elle tetiklenir, oturum yoktur —
     * bunu `trigger` alanı açıklar.)
     */
    await auditService.record({
      actorId: null,
      action: 'RATINGS_RECOMPUTED',
      targetType: 'user_rating',
      metadata: {
        version: rating.algorithmVersion,
        users: allRatings.length,
        predictions: rows.length,
        changed,
        maxDelta: Number(maxDelta.toFixed(3)),
        trigger: 'cli',
      },
    });

    log.info('rating.recompute.applied', {
      users: allRatings.length,
      predictions: rows.length,
      changed,
      version: rating.algorithmVersion,
    });

    return {
      users: allRatings.length,
      predictions: rows.length,
      categoryStats: perCategory.size,
      changed,
      maxDelta: Number(maxDelta.toFixed(3)),
    };
  },

  /** Kaç kullanıcı hâlâ eski sürümde? Dağıtım sonrası kontrol için. */
  async staleVersionCount(): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(userRatings)
      .where(sql`${userRatings.algorithmVersion} <> ${rating.algorithmVersion}`);
    return rows[0]?.n ?? 0;
  },
};
