import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, withTransaction, type Tx } from '@/server/db';
import { challenges, eventOutcomes, events, predictions, users } from '@/server/db/schema';
import { economy, isStakeAllowed } from '@/config';
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  isUniqueViolation,
} from '@/server/errors';
import { coinService, ledgerKeys } from '@/server/modules/economy/service';
import {
  assertEventAcceptsPredictions,
  assertOutcomeBelongsToEvent,
  insertPrediction,
} from '@/server/modules/prediction/service';
import { socialService } from '@/server/modules/social/service';
import {
  notificationKeys,
  notificationService,
} from '@/server/modules/social/notification.service';
import { publishPredictionToFollowers } from '@/server/modules/prediction/service';
import { computeExpiry } from './domain/open-challenge';
import { pickCounterOutcome, supportsChallenge } from './domain/counter-outcome';

/**
 * ChallengeService — Meydan Okuma yaşam döngüsü. ADR-15, ADR-18.
 *
 * Domain kuralları `domain/open-challenge.ts` ve `domain/counter-outcome.ts`
 * içindedir ve burada YENİDEN YAZILMAZ; bu servis onları veritabanına bağlar.
 *
 * SAHTE/BOT RAKİP YOKTUR: karşı taraf her zaman gerçek bir kullanıcı hesabıdır.
 */

type Ctx = Tx | typeof db;

export type CreateChallengeInput = {
  readonly creatorId: string;
  readonly eventId: string;
  readonly outcomeId: string;
  readonly stakeAmount: number;
  /** Verilirse DIRECT, verilmezse OPEN mod. */
  readonly opponentUsername?: string;
};

export const challengeService = {
  /**
   * Meydan Okuma oluşturur.
   *
   * Oluşturanın çipi BURADA stake edilir (kabulde değil). Gerekçe: aksi hâlde
   * kullanıcı 1.000 çiple aynı anda yirmi meydan okuma açıp hepsi kabul edilince
   * negatif bakiyeye düşerdi. Ürün kuralı 13 bunu yasaklıyor.
   */
  async create(input: CreateChallengeInput): Promise<{ challengeId: string; balance: number }> {
    const now = new Date();

    return withTransaction(async (tx) => {
      const event = await assertEventAcceptsPredictions(tx, input.eventId, now);
      await assertOutcomeBelongsToEvent(tx, input.eventId, input.outcomeId);

      // ADR-18: karşı sonuç oluşturmada deterministik olarak atanır.
      const outcomes = await tx
        .select({ id: eventOutcomes.id, sortOrder: eventOutcomes.sortOrder })
        .from(eventOutcomes)
        .where(eq(eventOutcomes.eventId, input.eventId));

      if (!supportsChallenge(outcomes)) {
        throw new BusinessRuleError('NOT_CHALLENGEABLE', 'Bu etkinlikte Meydan Okuma açılamaz.');
      }
      const counter = pickCounterOutcome(outcomes, input.outcomeId);
      if (!counter) {
        throw new BusinessRuleError('NOT_CHALLENGEABLE', 'Bu etkinlikte Meydan Okuma açılamaz.');
      }

      // Rakip — yalnızca DIRECT modda.
      let opponentId: string | null = null;
      if (input.opponentUsername) {
        const opponentRows = await tx
          .select({ id: users.id, status: users.status })
          .from(users)
          .where(eq(users.usernameLower, input.opponentUsername.trim().toLowerCase()))
          .limit(1);

        const opponent = opponentRows[0];
        if (!opponent) throw new NotFoundError('Bu kullanıcı adını bulamadık.');
        if (opponent.status !== 'ACTIVE') {
          throw new BusinessRuleError(
            'OPPONENT_UNAVAILABLE',
            'Bu kullanıcıya şu an Meydan Okunamaz.',
          );
        }
        if (opponent.id === input.creatorId) {
          throw new BusinessRuleError('SELF_CHALLENGE', 'Kendine Meydan Okuyamazsın.');
        }
        opponentId = opponent.id;
      }

      // Bakiye ve stake kuralları.
      const balance = await coinService.getBalance(input.creatorId, tx);
      if (!isStakeAllowed(input.stakeAmount, balance)) {
        if (input.stakeAmount > balance) {
          throw new BusinessRuleError('INSUFFICIENT_BALANCE', 'Yeterli Gümüş Çipin yok.');
        }
        throw new BusinessRuleError(
          'INVALID_STAKE',
          `Ortaya ${economy.minStake}–${economy.maxStake} arası çip koyabilirsin.`,
        );
      }

      // Günlük açık meydan okuma tavanı.
      if (!opponentId) {
        const since = new Date(now.getTime() - 24 * 3600_000);
        const todays = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(challenges)
          .where(
            and(
              eq(challenges.creatorId, input.creatorId),
              eq(challenges.mode, 'OPEN'),
              gte(challenges.createdAt, since),
            ),
          );
        if ((todays[0]?.n ?? 0) >= economy.maxOpenChallengesPerDay) {
          throw new BusinessRuleError(
            'DAILY_LIMIT_REACHED',
            'Bugünlük Açık Meydan Okuma sınırına ulaştın.',
          );
        }
      }

      /*
       * MEVCUT TAHMİNİ YENİDEN KULLAN — Faz 5.
       *
       * Kullanıcı önce "Tahmin Et" deyip sonra "Bu tahminle Meydan Oku"
       * dediğinde, aynı etkinlik için İKİNCİ bir tahmin satırı yazılamaz:
       * `prediction_one_active_per_user_event` kısmi tekil index'i buna izin
       * vermez ve doğru olan da budur — bir kişinin bir etkinlikte tek tahmini
       * olur. Faz 5'ten önce bu durum "Bu etkinlikte zaten bir tahminin var"
       * hatasına düşüyordu ve akış tıkanıyordu (E2E'de yakalandı).
       *
       * Doğru davranış: var olan tahmini Meydan Okumaya BAĞLA.
       *   - aynı sonuç, boşta        → yeniden kullanılır,
       *   - farklı sonuç             → reddedilir (kişi taraf değiştiremez),
       *   - zaten bir Meydan Okumada → reddedilir.
       *
       * "Zaten bir Meydan Okumada mı?" sorusu `prediction.isLocked` ile
       * YANITLANAMAZ: o bayrak ancak karşı taraf KABUL ettiğinde kalkar.
       * Doğru kaynak, tahmini işaret eden aktif bir Meydan Okuma satırının
       * olup olmadığıdır — `challenge_creator_prediction_unique` index'i de
       * bunu zorlar.
       */
      const existingRows = await tx
        .select({
          id: predictions.id,
          outcomeId: predictions.outcomeId,
        })
        .from(predictions)
        .where(
          and(
            eq(predictions.userId, input.creatorId),
            eq(predictions.eventId, input.eventId),
            inArray(predictions.status, ['OPEN', 'LOCKED']),
          ),
        )
        .limit(1);
      const existing = existingRows[0];

      if (existing) {
        const boundRows = await tx
          .select({ id: challenges.id })
          .from(challenges)
          .where(
            and(
              eq(challenges.creatorPredictionId, existing.id),
              inArray(challenges.status, ['PENDING', 'ACCEPTED']),
            ),
          )
          .limit(1);

        if (boundRows.length > 0) {
          throw new ConflictError(
            'ALREADY_CHALLENGED',
            'Bu etkinlikte zaten bir Meydan Okuman var.',
          );
        }
        if (existing.outcomeId !== input.outcomeId) {
          throw new ConflictError(
            'DIFFERENT_OUTCOME',
            'Bu etkinlikte başka bir sonuca tahmin yapmışsın. Meydan Okuma tahmininle aynı taraftan açılır.',
          );
        }
      }

      try {
        const prediction = existing
          ? await bindPredictionToChallenge(tx, existing.id, input.stakeAmount)
          : await insertPrediction(tx, {
              userId: input.creatorId,
              eventId: input.eventId,
              outcomeId: input.outcomeId,
              categoryId: event.categoryId,
              stakeAmount: input.stakeAmount,
            });

        const inserted = await tx
          .insert(challenges)
          .values({
            eventId: input.eventId,
            mode: opponentId ? 'DIRECT' : 'OPEN',
            creatorId: input.creatorId,
            opponentId,
            creatorOutcomeId: input.outcomeId,
            opponentOutcomeId: counter.id,
            creatorPredictionId: prediction.id,
            stakeAmount: input.stakeAmount,
            expiresAt: computeExpiry(event.closesAt, now),
          })
          .returning({ id: challenges.id });

        const challengeId = inserted[0]?.id;
        if (!challengeId) throw new Error('Meydan Okuma oluşturulamadı.');

        const posted = await coinService.post(tx, {
          ownerId: input.creatorId,
          amount: -input.stakeAmount,
          type: 'CHALLENGE_STAKE',
          idempotencyKey: ledgerKeys.challengeStake(challengeId, input.creatorId),
          referenceType: 'challenge',
          referenceId: challengeId,
        });

        await tx
          .update(events)
          .set({ challengeCount: sql`${events.challengeCount} + 1` })
          .where(eq(events.id, input.eventId));

        // Akışa yaz ve takipçilere bildir.
        const creatorOutcome = await tx
          .select({ label: eventOutcomes.label })
          .from(eventOutcomes)
          .where(eq(eventOutcomes.id, input.outcomeId))
          .limit(1);

        await publishPredictionToFollowers(tx, {
          actorId: input.creatorId,
          predictionId: prediction.id,
          eventId: input.eventId,
          categoryId: event.categoryId,
          outcomeLabel: creatorOutcome[0]?.label ?? '',
        });

        await socialService.recordFeedItem(tx, {
          actorId: input.creatorId,
          kind: 'CHALLENGE_CREATED',
          eventId: input.eventId,
          challengeId,
          categoryId: event.categoryId,
        });

        // Doğrudan Meydan Okumada rakibe bildirim gider.
        if (opponentId) {
          const creator = await tx
            .select({ username: users.username })
            .from(users)
            .where(eq(users.id, input.creatorId))
            .limit(1);
          const eventRow = await tx
            .select({ title: events.title })
            .from(events)
            .where(eq(events.id, input.eventId))
            .limit(1);

          await notificationService.create(tx, {
            userId: opponentId,
            type: 'CHALLENGE_RECEIVED',
            actorId: input.creatorId,
            body: `@${creator[0]?.username ?? 'Bir kullanıcı'} sana Meydan Okudu: ${eventRow[0]?.title ?? ''} — ${input.stakeAmount} Gümüş Çip`,
            // Bildirim DOĞRUDAN ilgili Meydan Okumaya götürür; listede aratmaz.
            href: `/app/challenges/${challengeId}`,
            dedupeKey: notificationKeys.challengeReceived(challengeId),
          });
        }

        return { challengeId, balance: posted.balanceAfter };
      } catch (error) {
        // Kullanıcının bu etkinlikte zaten aktif bir tahmini varsa (serbest tahmin
        // ya da başka bir Meydan Okuma), yeni Meydan Okuma açılamaz.
        if (error instanceof ConflictError || isUniqueViolation(error)) {
          throw new ConflictError(
            'DUPLICATE_CHALLENGE',
            'Bu etkinlikte zaten bir tahminin veya Meydan Okuman var.',
          );
        }
        throw error;
      }
    });
  },

  /**
   * Meydan Okumayı kabul eder — ATOMİK.
   *
   * Yarış koruması üç katmanlı:
   *   1. satır kilidi (SELECT ... FOR UPDATE)
   *   2. koşullu UPDATE (WHERE status = 'PENDING')
   *   3. partial unique index
   *
   * Kabul edenin sonucu ADR-18 uyarınca OTOMATİK atanır; tekrar seçim istenmez.
   */
  async accept(challengeId: string, actorId: string): Promise<{ balance: number }> {
    const now = new Date();

    return withTransaction(async (tx) => {
      const locked = await tx
        .select()
        .from(challenges)
        .where(eq(challenges.id, challengeId))
        .for('update');

      const challenge = locked[0];
      if (!challenge) throw new NotFoundError('Meydan Okuma bulunamadı.');

      if (challenge.status !== 'PENDING') {
        throw new ConflictError(
          'CHALLENGE_ALREADY_CLAIMED',
          challenge.mode === 'OPEN'
            ? 'Bu Meydan Okuma başka bir kullanıcı tarafından kabul edildi.'
            : 'Bu Meydan Okuma artık geçerli değil.',
        );
      }
      if (challenge.expiresAt.getTime() <= now.getTime()) {
        throw new BusinessRuleError('CHALLENGE_EXPIRED', 'Bu Meydan Okumanın süresi doldu.');
      }
      if (challenge.creatorId === actorId) {
        throw new BusinessRuleError('SELF_CHALLENGE', 'Kendi Meydan Okumanı kabul edemezsin.');
      }
      if (challenge.mode === 'DIRECT' && challenge.opponentId !== actorId) {
        throw new AuthorizationError('Bu Meydan Okuma sana gönderilmedi.');
      }

      const event = await assertEventAcceptsPredictions(tx, challenge.eventId, now);

      const balance = await coinService.getBalance(actorId, tx);
      if (balance < challenge.stakeAmount) {
        throw new BusinessRuleError('INSUFFICIENT_BALANCE', 'Yeterli Gümüş Çipin yok.');
      }

      // Karşıt sonuç zaten atanmış; burada yalnızca doğrulanır.
      if (challenge.opponentOutcomeId === challenge.creatorOutcomeId) {
        throw new BusinessRuleError('SAME_OUTCOME_NOT_ALLOWED', 'Karşıt sonuç seçilmeli.');
      }

      let opponentPredictionId: string;
      try {
        const prediction = await insertPrediction(tx, {
          userId: actorId,
          eventId: challenge.eventId,
          outcomeId: challenge.opponentOutcomeId,
          categoryId: event.categoryId,
          stakeAmount: challenge.stakeAmount,
          locked: true,
        });
        opponentPredictionId = prediction.id;
      } catch (error) {
        if (error instanceof ConflictError) {
          throw new ConflictError(
            'ALREADY_PREDICTED',
            'Bu etkinlikte zaten bir tahminin var; Meydan Okumayı kabul edemezsin.',
          );
        }
        throw error;
      }

      // Koşullu UPDATE: yarışı kaybeden 0 satır günceller.
      const updated = await tx
        .update(challenges)
        .set({
          status: 'ACCEPTED',
          opponentId: actorId,
          opponentPredictionId,
          acceptedAt: now,
        })
        .where(and(eq(challenges.id, challengeId), eq(challenges.status, 'PENDING')))
        .returning({ id: challenges.id });

      if (updated.length !== 1) {
        throw new ConflictError(
          'CHALLENGE_ALREADY_CLAIMED',
          'Bu Meydan Okuma başka bir kullanıcı tarafından kabul edildi.',
        );
      }

      // Her iki tahmin de artık dokunulmaz.
      await tx
        .update(predictions)
        .set({ isLocked: true, status: 'LOCKED', updatedAt: now })
        .where(eq(predictions.id, challenge.creatorPredictionId));

      const posted = await coinService.post(tx, {
        ownerId: actorId,
        amount: -challenge.stakeAmount,
        type: 'CHALLENGE_STAKE',
        idempotencyKey: ledgerKeys.challengeStake(challengeId, actorId),
        referenceType: 'challenge',
        referenceId: challengeId,
      });

      // Kabul edenin tahmini de akışa girer ve takipçilerine bildirilir.
      const opponentOutcome = await tx
        .select({ label: eventOutcomes.label })
        .from(eventOutcomes)
        .where(eq(eventOutcomes.id, challenge.opponentOutcomeId))
        .limit(1);

      await publishPredictionToFollowers(tx, {
        actorId,
        predictionId: opponentPredictionId,
        eventId: challenge.eventId,
        categoryId: event.categoryId,
        outcomeLabel: opponentOutcome[0]?.label ?? '',
      });

      const accepter = await tx
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, actorId))
        .limit(1);

      await notificationService.create(tx, {
        userId: challenge.creatorId,
        type: 'CHALLENGE_ACCEPTED',
        actorId,
        body: `@${accepter[0]?.username ?? 'Bir kullanıcı'} Meydan Okumanı kabul etti.`,
        href: `/app/challenges/${challengeId}`,
        dedupeKey: notificationKeys.challengeAccepted(challengeId),
      });

      return { balance: posted.balanceAfter };
    });
  },

  /** Rakip reddeder — oluşturanın çipi iade edilir. */
  async decline(challengeId: string, actorId: string): Promise<void> {
    const now = new Date();
    await withTransaction(async (tx) => {
      const locked = await tx
        .select()
        .from(challenges)
        .where(eq(challenges.id, challengeId))
        .for('update');

      const challenge = locked[0];
      if (!challenge) throw new NotFoundError('Meydan Okuma bulunamadı.');
      if (challenge.mode !== 'DIRECT' || challenge.opponentId !== actorId) {
        throw new AuthorizationError('Bu Meydan Okumayı reddedemezsin.');
      }
      if (challenge.status !== 'PENDING') {
        throw new ConflictError('CHALLENGE_NOT_PENDING', 'Bu Meydan Okuma artık geçerli değil.');
      }

      await tx
        .update(challenges)
        .set({ status: 'DECLINED', declinedAt: now, settlement: 'REFUND_CREATOR', settledAt: now })
        .where(and(eq(challenges.id, challengeId), eq(challenges.status, 'PENDING')));

      await refundParticipants(tx, challenge.id, challenge.stakeAmount, [challenge.creatorId]);
      await releasePrediction(tx, challenge.creatorPredictionId);
    });
  },

  /** Oluşturan iptal eder — yalnızca kabul edilmemişken. */
  async cancel(challengeId: string, actorId: string): Promise<void> {
    await withTransaction(async (tx) => {
      const locked = await tx
        .select()
        .from(challenges)
        .where(eq(challenges.id, challengeId))
        .for('update');

      const challenge = locked[0];
      if (!challenge) throw new NotFoundError('Meydan Okuma bulunamadı.');
      if (challenge.creatorId !== actorId) {
        throw new AuthorizationError('Bu Meydan Okumayı iptal edemezsin.');
      }
      if (challenge.status !== 'PENDING') {
        throw new ConflictError('CHALLENGE_NOT_PENDING', 'Bu Meydan Okuma artık iptal edilemez.');
      }

      await tx
        .update(challenges)
        .set({ status: 'CANCELLED', settlement: 'REFUND_CREATOR', settledAt: new Date() })
        .where(and(eq(challenges.id, challengeId), eq(challenges.status, 'PENDING')));

      await refundParticipants(tx, challenge.id, challenge.stakeAmount, [challenge.creatorId]);
      await releasePrediction(tx, challenge.creatorPredictionId);
    });
  },

  /** "Sana Gelen Meydan Okumalar" — doğrudan davetler. */
  async listIncoming(userId: string, ctx: Ctx = db) {
    return listChallengeCards(
      ctx,
      and(
        eq(challenges.opponentId, userId),
        eq(challenges.mode, 'DIRECT'),
        eq(challenges.status, 'PENDING'),
      ),
    );
  },

  /** Açık Meydan Okumalar — kendi açtıkları hariç. */
  async listOpen(userId: string | null, ctx: Ctx = db) {
    const base = and(
      eq(challenges.mode, 'OPEN'),
      eq(challenges.status, 'PENDING'),
      isNull(challenges.opponentId),
    );
    const rows = await listChallengeCards(ctx, base);
    return userId ? rows.filter((r) => r.creatorId !== userId) : rows;
  },

  async listMine(userId: string, ctx: Ctx = db) {
    return listChallengeCards(ctx, eq(challenges.creatorId, userId));
  },

  async getById(challengeId: string, ctx: Ctx = db) {
    const rows = await listChallengeCards(ctx, eq(challenges.id, challengeId));
    return rows[0];
  },

  /**
   * Meydan Okuma detayı — YETKİ DENETİMİYLE (Faz 5).
   *
   * IDOR KORUMASI: kimlik tahmin edilemez olsa da (cuid2), tek başına
   * "bilinmesi zor" bir kimlik yetkilendirme değildir. Kural şudur:
   *   - Tarafları (oluşturan / rakip) her zaman görebilir.
   *   - Herkese açık bir Meydan Okuma (mod OPEN, kabul bekliyor) herkese açıktır.
   *   - Sonuçlanmış Meydan Okuma da herkese açıktır: sonucu zaten public
   *     etkinlik sayfasında görünür.
   *   - Bunların dışında (ör. başkasına gönderilmiş, cevap bekleyen davet)
   *     görüntüleyemez ve `null` döner — "yok" ile "yetkin yok" ayrımı
   *     yapılmaz; bu ayrım kimlik sızdırır.
   */
  async detailFor(challengeId: string, viewerId: string | null, ctx: Ctx = db) {
    const row = await challengeService.getById(challengeId, ctx);
    if (!row) return null;

    const isParty =
      viewerId !== null && (row.creatorId === viewerId || row.opponentId === viewerId);
    const isPublicOpen = row.mode === 'OPEN' && row.status === 'PENDING';
    const isSettled = row.status === 'COMPLETED' || row.status === 'EXPIRED';

    if (!isParty && !isPublicOpen && !isSettled) return null;

    const opponentUsername = row.opponentId
      ? ((
          await ctx
            .select({ username: users.username })
            .from(users)
            .where(eq(users.id, row.opponentId))
            .limit(1)
        )[0]?.username ?? null)
      : null;

    return {
      ...row,
      opponentUsername,
      viewerIsCreator: viewerId !== null && row.creatorId === viewerId,
      viewerIsOpponent: viewerId !== null && row.opponentId === viewerId,
      viewerWon: viewerId !== null && row.winnerUserId === viewerId,
    };
  },
};

/** Kart görünümü: kullanıcıya gösterilecek her şey tek sorguda (N+1 yok). */
async function listChallengeCards(ctx: Ctx, where: ReturnType<typeof eq> | undefined) {
  const creatorOutcome = alias(eventOutcomes, 'creator_outcome');
  const opponentOutcome = alias(eventOutcomes, 'opponent_outcome');
  return ctx
    .select({
      id: challenges.id,
      mode: challenges.mode,
      status: challenges.status,
      stakeAmount: challenges.stakeAmount,
      expiresAt: challenges.expiresAt,
      createdAt: challenges.createdAt,
      creatorId: challenges.creatorId,
      creatorUsername: users.username,
      opponentId: challenges.opponentId,
      eventId: challenges.eventId,
      eventTitle: events.title,
      eventQuestion: events.question,
      closesAt: events.closesAt,
      creatorOutcomeLabel: creatorOutcome.label,
      opponentOutcomeLabel: opponentOutcome.label,
      winnerUserId: challenges.winnerUserId,
      settlement: challenges.settlement,
    })
    .from(challenges)
    .innerJoin(users, eq(users.id, challenges.creatorId))
    .innerJoin(events, eq(events.id, challenges.eventId))
    .innerJoin(creatorOutcome, eq(creatorOutcome.id, challenges.creatorOutcomeId))
    .innerJoin(opponentOutcome, eq(opponentOutcome.id, challenges.opponentOutcomeId))
    .where(where)
    .orderBy(desc(challenges.createdAt))
    .limit(30);
}

/** İade — idempotent. Aynı meydan okuma ikinci kez iade edilemez. */
export async function refundParticipants(
  tx: Tx,
  challengeId: string,
  stakeAmount: number,
  userIds: readonly string[],
): Promise<void> {
  for (const userId of userIds) {
    await coinService.post(tx, {
      ownerId: userId,
      amount: stakeAmount,
      type: 'CHALLENGE_REFUND',
      idempotencyKey: ledgerKeys.challengeRefund(challengeId, userId),
      referenceType: 'challenge',
      referenceId: challengeId,
    });
  }
}

/** Meydan okuma düştüğünde tahmin serbest kalır (kilidi açılır). */
/**
 * Var olan serbest tahmini Meydan Okumaya bağlar — `releasePrediction`'ın tersi.
 *
 * YALNIZCA çip yazılır. `isLocked` ve `status` DEĞİŞTİRİLMEZ: sıfırdan açılan
 * bir Meydan Okumada da tahmin 'OPEN' ve kilitsiz kalır, kilit ancak karşı
 * taraf kabul edince kurulur. İki yolun aynı satır durumunu üretmesi,
 * sonuçlandırmanın tek bir davranışla çalışmasını sağlar.
 */
async function bindPredictionToChallenge(
  tx: Tx,
  predictionId: string,
  stakeAmount: number,
): Promise<{ id: string }> {
  const updated = await tx
    .update(predictions)
    .set({ stakeAmount, updatedAt: new Date() })
    .where(and(eq(predictions.id, predictionId), eq(predictions.isLocked, false)))
    .returning({ id: predictions.id });

  const row = updated[0];
  if (!row) {
    // Tahmin bu arada kilitlenmiş olabilir; sessizce üzerine yazmayız.
    throw new ConflictError('ALREADY_CHALLENGED', 'Bu etkinlikte zaten bir Meydan Okuman var.');
  }
  return row;
}

async function releasePrediction(tx: Tx, predictionId: string): Promise<void> {
  await tx
    .update(predictions)
    .set({ isLocked: false, stakeAmount: 0, updatedAt: new Date() })
    .where(eq(predictions.id, predictionId));
}
