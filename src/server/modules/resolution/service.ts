import { and, eq, inArray, sql } from 'drizzle-orm';
import { withTransaction, type Tx } from '@/server/db';
import {
  challenges,
  eventOutcomes,
  eventResolutions,
  events,
  predictions,
} from '@/server/db/schema';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  isUniqueViolation,
} from '@/server/errors';
import { coinService, ledgerKeys } from '@/server/modules/economy/service';
import { computePayout } from '@/server/modules/economy/domain/ledger-keys';
import { reputationService } from '@/server/modules/reputation/service';
import { difficultyWeight } from '@/server/modules/reputation/domain/prediction-power';
import { catalogService } from '@/server/modules/catalog/service';
import { rankingService } from '@/server/modules/ranking/service';
import { socialService } from '@/server/modules/social/service';
import {
  notificationKeys,
  notificationService,
} from '@/server/modules/social/notification.service';

/**
 * EventResolutionService — sonuçlandırma orkestrasyonu.
 *
 * TAMAMEN İDEMPOTENT. Aynı etkinlik ikinci kez sonuçlandırılmaya çalışılırsa
 * hiçbir şey olmaz: ikinci kez ödeme yapılmaz, çip düşülmez, Tahmin Gücü
 * değişmez.
 *
 * Üç bağımsız savunma katmanı:
 *   1. `event_resolution.event_id` UNIQUE  → bir etkinlik bir kez sonuçlanır
 *   2. koşullu UPDATE (WHERE status = ...) → durum geçişi bir kez olur
 *   3. `coin_ledger.idempotency_key` UNIQUE → bir ödeme bir kez yazılır
 *
 * Tüm adımlar TEK transaction içindedir: "sonuç yazıldı ama para hareket etmedi"
 * gibi bir ara durum oluşamaz.
 */

export type ResolveInput = {
  readonly eventId: string;
  /** RESOLVED için zorunlu, VOID için null. */
  readonly outcomeId: string | null;
  readonly decision: 'RESOLVED' | 'VOID';
  readonly resolvedById: string;
  readonly note?: string;
};

export type ResolveResult = {
  readonly alreadyResolved: boolean;
  readonly predictionsResolved: number;
  readonly challengesSettled: number;
};

export const resolutionService = {
  async resolve(input: ResolveInput): Promise<ResolveResult> {
    const now = new Date();

    return withTransaction(async (tx) => {
      // ── 1. İdempotency guard ────────────────────────────────────────────
      const existing = await tx
        .select({
          predictionsResolved: eventResolutions.predictionsResolved,
          challengesSettled: eventResolutions.challengesSettled,
        })
        .from(eventResolutions)
        .where(eq(eventResolutions.eventId, input.eventId))
        .limit(1);

      if (existing[0]) {
        return {
          alreadyResolved: true,
          predictionsResolved: existing[0].predictionsResolved,
          challengesSettled: existing[0].challengesSettled,
        };
      }

      // ── 2. Etkinliği kilitle ve doğrula ─────────────────────────────────
      const eventRows = await tx
        .select()
        .from(events)
        .where(eq(events.id, input.eventId))
        .for('update');

      const event = eventRows[0];
      if (!event) throw new NotFoundError('Etkinlik bulunamadı.');
      if (event.status === 'RESOLVED' || event.status === 'VOID') {
        throw new ConflictError('EVENT_ALREADY_RESOLVED', 'Bu etkinlik zaten sonuçlandırıldı.');
      }

      if (input.decision === 'RESOLVED') {
        if (!input.outcomeId) {
          throw new BusinessRuleError('OUTCOME_REQUIRED', 'Bir sonuç seçmelisin.');
        }
        const valid = await tx
          .select({ id: eventOutcomes.id })
          .from(eventOutcomes)
          .where(
            and(eq(eventOutcomes.id, input.outcomeId), eq(eventOutcomes.eventId, input.eventId)),
          )
          .limit(1);
        if (!valid[0])
          throw new BusinessRuleError('INVALID_OUTCOME', 'Bu sonuç bu etkinliğe ait değil.');
      }

      // ── 3. Tahminleri kapat ve dağılımı dondur ──────────────────────────
      // (Zorluk katsayısının temeli — dondurulmadan geçmiş yeniden üretilemez.)
      if (event.status === 'OPEN') {
        await catalogService.closeEvent(input.eventId, tx);
      }

      const outcomeRows = await tx
        .select({
          id: eventOutcomes.id,
          consensusShare: eventOutcomes.consensusShare,
        })
        .from(eventOutcomes)
        .where(eq(eventOutcomes.eventId, input.eventId));

      const consensusById = new Map(
        outcomeRows.map((o) => [o.id, o.consensusShare === null ? null : Number(o.consensusShare)]),
      );
      const participantCount = event.predictionCount;

      // ── 4. Tahminleri sonuçlandır ───────────────────────────────────────
      const openPredictions = await tx
        .select()
        .from(predictions)
        .where(
          and(
            eq(predictions.eventId, input.eventId),
            inArray(predictions.status, ['OPEN', 'LOCKED']),
          ),
        );

      const isVoid = input.decision === 'VOID';

      for (const prediction of openPredictions) {
        const wasCorrect = !isVoid && prediction.outcomeId === input.outcomeId;
        const weight = difficultyWeight(
          consensusById.get(prediction.outcomeId) ?? null,
          participantCount,
        );

        await tx
          .update(predictions)
          .set({
            status: isVoid ? 'VOID' : 'RESOLVED',
            result: isVoid ? 'VOID' : wasCorrect ? 'CORRECT' : 'INCORRECT',
            difficultyScore: isVoid ? null : weight.toFixed(5),
            resolvedAt: now,
            updatedAt: now,
            ratingApplied: !isVoid,
          })
          .where(eq(predictions.id, prediction.id));

        // VOID tahminler itibara GİRMEZ.
        if (!isVoid) {
          await reputationService.applyPrediction(tx, {
            userId: prediction.userId,
            categoryId: prediction.categoryId,
            wasCorrect,
            weight,
            predictionId: prediction.id,
          });

          await notificationService.create(tx, {
            userId: prediction.userId,
            type: wasCorrect ? 'PREDICTION_CORRECT' : 'PREDICTION_INCORRECT',
            body: wasCorrect
              ? `Tahminin tuttu: ${event.title}`
              : `Tahminin tutmadı: ${event.title}`,
            href: '/app/profile',
            dedupeKey: notificationKeys.predictionResolved(prediction.id),
          });

          // Rozetler sonuçlandırmanın İÇİNDE değerlendirilir; ayrı bir iş
          // beklemeye gerek yok ve idempotency aynı transaction'da korunur.
          await rankingService.evaluateBadges(tx, prediction.userId);
        }
      }

      // ── 5. Meydan okumaları sonuçlandır ─────────────────────────────────
      const openChallenges = await tx
        .select()
        .from(challenges)
        .where(
          and(
            eq(challenges.eventId, input.eventId),
            inArray(challenges.status, ['PENDING', 'ACCEPTED']),
          ),
        );

      let settled = 0;

      for (const challenge of openChallenges) {
        // Kabul edilmemiş meydan okuma: yalnızca oluşturana iade.
        if (challenge.status === 'PENDING') {
          await coinService.post(tx, {
            ownerId: challenge.creatorId,
            amount: challenge.stakeAmount,
            type: 'CHALLENGE_REFUND',
            idempotencyKey: ledgerKeys.challengeRefund(challenge.id, challenge.creatorId),
            referenceType: 'challenge',
            referenceId: challenge.id,
          });
          // Kabul edilmemiş Meydan Okumada YALNIZCA oluşturan stake etmiştir.
          // "İki tarafa iade" demek burada semantik olarak yanlıştır.
          await tx
            .update(challenges)
            .set({
              status: 'EXPIRED',
              settlement: 'REFUND_CREATOR',
              settledAt: now,
              completedAt: now,
            })
            .where(and(eq(challenges.id, challenge.id), eq(challenges.status, 'PENDING')));
          settled += 1;
          continue;
        }

        const opponentId = challenge.opponentId;
        if (!opponentId) continue;

        const creatorWon = !isVoid && challenge.creatorOutcomeId === input.outcomeId;
        const opponentWon = !isVoid && challenge.opponentOutcomeId === input.outcomeId;

        // İKİSİ DE YANILDIYSA (ör. beraberlik çıktı) veya etkinlik VOID ise:
        // herkes kendi çipini geri alır. Bu, ADR-18'in deterministik karşı
        // sonuç atamasını adil kılan kuraldır.
        if (isVoid || (!creatorWon && !opponentWon)) {
          await coinService.post(tx, {
            ownerId: challenge.creatorId,
            amount: challenge.stakeAmount,
            type: 'CHALLENGE_REFUND',
            idempotencyKey: ledgerKeys.challengeRefund(challenge.id, challenge.creatorId),
            referenceType: 'challenge',
            referenceId: challenge.id,
          });
          await coinService.post(tx, {
            ownerId: opponentId,
            amount: challenge.stakeAmount,
            type: 'CHALLENGE_REFUND',
            idempotencyKey: ledgerKeys.challengeRefund(challenge.id, opponentId),
            referenceType: 'challenge',
            referenceId: challenge.id,
          });

          await tx
            .update(challenges)
            .set({
              status: 'COMPLETED',
              settlement: 'REFUND_BOTH',
              completedAt: now,
              settledAt: now,
            })
            .where(and(eq(challenges.id, challenge.id), eq(challenges.status, 'ACCEPTED')));
          settled += 1;
          continue;
        }

        // Bir taraf kazandı: toplam havuz kazanana gider (net +stake).
        const winnerId = creatorWon ? challenge.creatorId : opponentId;
        await coinService.post(tx, {
          ownerId: winnerId,
          amount: computePayout(challenge.stakeAmount),
          type: 'CHALLENGE_WIN',
          idempotencyKey: ledgerKeys.challengePayout(challenge.id, winnerId),
          referenceType: 'challenge',
          referenceId: challenge.id,
        });

        await tx
          .update(challenges)
          .set({
            status: 'COMPLETED',
            settlement: 'WIN_LOSS',
            winnerUserId: winnerId,
            completedAt: now,
            settledAt: now,
          })
          .where(and(eq(challenges.id, challenge.id), eq(challenges.status, 'ACCEPTED')));

        const loserId = winnerId === challenge.creatorId ? opponentId : challenge.creatorId;
        await notificationService.create(tx, {
          userId: winnerId,
          type: 'CHALLENGE_COMPLETED',
          body: `Tebrikler! Meydan Okumayı kazandın. +${challenge.stakeAmount * 2} Gümüş Çip.`,
          href: `/app/challenges/${challenge.id}`,
          dedupeKey: notificationKeys.challengeCompleted(challenge.id, winnerId),
        });
        await notificationService.create(tx, {
          userId: loserId,
          type: 'CHALLENGE_COMPLETED',
          body: `Bu Meydan Okumayı kaybettin. −${challenge.stakeAmount} Gümüş Çip.`,
          href: `/app/challenges/${challenge.id}`,
          dedupeKey: notificationKeys.challengeCompleted(challenge.id, loserId),
        });

        await socialService.recordFeedItem(tx, {
          actorId: winnerId,
          kind: 'CHALLENGE_COMPLETED',
          eventId: challenge.eventId,
          challengeId: challenge.id,
        });

        settled += 1;
      }

      // ── 6. Etkinliği kapat ──────────────────────────────────────────────
      await tx
        .update(events)
        .set({
          status: isVoid ? 'VOID' : 'RESOLVED',
          resolvedOutcomeId: isVoid ? null : input.outcomeId,
          resolvedAt: isVoid ? null : now,
          voidReason: isVoid ? (input.note ?? 'Sonuç güvenilir biçimde belirlenemedi.') : null,
          updatedAt: now,
        })
        .where(eq(events.id, input.eventId));

      // ── 7. Denetim kaydı — UNIQUE index nihai savunma ───────────────────
      try {
        await tx.insert(eventResolutions).values({
          eventId: input.eventId,
          outcomeId: isVoid ? null : input.outcomeId,
          decision: input.decision,
          source: 'MANUAL',
          note: input.note ?? null,
          resolvedById: input.resolvedById,
          predictionsResolved: openPredictions.length,
          challengesSettled: settled,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError('EVENT_ALREADY_RESOLVED', 'Bu etkinlik zaten sonuçlandırıldı.');
        }
        throw error;
      }

      return {
        alreadyResolved: false,
        predictionsResolved: openPredictions.length,
        challengesSettled: settled,
      };
    });
  },

  async getResolution(eventId: string, tx?: Tx) {
    const ctx = tx ?? (await import('@/server/db')).db;
    const rows = await ctx
      .select()
      .from(eventResolutions)
      .where(eq(eventResolutions.eventId, eventId))
      .limit(1);
    return rows[0];
  },
};

export { sql };
