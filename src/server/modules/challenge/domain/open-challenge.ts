import { economy, isStakeAllowed } from '@/config';

/**
 * Açık Meydan Okuma kabul kuralları — ADR-15. Saf domain: I/O yok.
 *
 * Bu dosya, açık ve doğrudan meydan okumanın kabul edilebilirliğini TEK yerde
 * karara bağlar. Açık mod için ayrı ve gevşek bir yol YOKTUR: her iki mod da
 * aynı guard zincirinden geçer, ardından aynı atomik kabul akışına girer
 * (satır kilidi → koşullu UPDATE → deterministik bakiye kilidi → idempotent stake).
 *
 * SAHTE/BOT RAKİP KULLANILMAZ. Karşı taraf her zaman gerçek bir kullanıcı hesabıdır.
 */

export type ChallengeMode = 'DIRECT' | 'OPEN';
export type ChallengeStatus =
  'PENDING' | 'ACCEPTED' | 'ACTIVE' | 'DECLINED' | 'EXPIRED' | 'CANCELLED' | 'COMPLETED';

export type ChallengeSnapshot = {
  readonly id: string;
  readonly mode: ChallengeMode;
  readonly status: ChallengeStatus;
  readonly eventId: string;
  readonly creatorId: string;
  /** OPEN modda kabul anına kadar null. */
  readonly opponentId: string | null;
  readonly creatorOutcomeId: string;
  readonly stakeAmount: number;
  readonly expiresAt: Date;
};

export type EventSnapshot = {
  readonly id: string;
  readonly status: 'DRAFT' | 'OPEN' | 'CLOSED' | 'RESOLVING' | 'RESOLVED' | 'VOID' | 'CANCELLED';
  readonly predictionDeadline: Date;
  readonly outcomeIds: readonly string[];
};

export type ActorSnapshot = {
  readonly id: string;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DELETED';
  readonly balance: number;
  /** Bu etkinlikte kullanıcının halihazırda aktif bir tahmini var mı? */
  readonly hasActivePredictionOnEvent: boolean;
};

export type AcceptContext = {
  readonly challenge: ChallengeSnapshot;
  readonly event: EventSnapshot;
  readonly actor: ActorSnapshot;
  readonly chosenOutcomeId: string;
  readonly now: Date;
  /** Taraflardan biri diğerini engellemiş mi? */
  readonly isBlockedEitherWay: boolean;
};

export type AcceptRejection =
  | 'CHALLENGE_NOT_PENDING'
  | 'CHALLENGE_EXPIRED'
  | 'CHALLENGE_ALREADY_CLAIMED'
  | 'NOT_INVITED'
  | 'SELF_CHALLENGE'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'BLOCKED'
  | 'EVENT_NOT_OPEN'
  | 'EVENT_DEADLINE_PASSED'
  | 'INVALID_OUTCOME'
  | 'SAME_OUTCOME_NOT_ALLOWED'
  | 'ALREADY_PREDICTED'
  | 'INSUFFICIENT_BALANCE';

export type AcceptDecision =
  { readonly ok: true } | { readonly ok: false; readonly reason: AcceptRejection };

/**
 * Bir kullanıcının bu meydan okumayı kabul edip edemeyeceğine karar verir.
 *
 * Guard sırası bilinçlidir: önce meydan okumanın kendi durumu, sonra kimlik ve
 * yetki, sonra etkinlik, en sonda ekonomi. Böylece kullanıcı en anlamlı hatayı
 * görür ve bakiye kontrolü gereksiz yere en başta yapılmaz.
 */
export function canAcceptChallenge(ctx: AcceptContext): AcceptDecision {
  const { challenge, event, actor, chosenOutcomeId, now } = ctx;

  // --- Meydan okumanın durumu ---------------------------------------------
  if (challenge.status !== 'PENDING') {
    // OPEN modda "artık PENDING değil" demek, başkası tarafından kapılmış demektir.
    return {
      ok: false,
      reason: challenge.mode === 'OPEN' ? 'CHALLENGE_ALREADY_CLAIMED' : 'CHALLENGE_NOT_PENDING',
    };
  }
  if (challenge.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: 'CHALLENGE_EXPIRED' };
  }

  // --- Kimlik ve yetki ------------------------------------------------------
  if (actor.id === challenge.creatorId) return { ok: false, reason: 'SELF_CHALLENGE' };

  if (challenge.mode === 'DIRECT') {
    if (challenge.opponentId !== actor.id) return { ok: false, reason: 'NOT_INVITED' };
  } else if (challenge.opponentId !== null) {
    // OPEN modda PENDING iken rakip dolu olamaz; doluysa yarışı başkası kazanmıştır.
    return { ok: false, reason: 'CHALLENGE_ALREADY_CLAIMED' };
  }

  if (actor.status !== 'ACTIVE') return { ok: false, reason: 'ACCOUNT_NOT_ACTIVE' };
  if (ctx.isBlockedEitherWay) return { ok: false, reason: 'BLOCKED' };

  // --- Etkinlik -------------------------------------------------------------
  if (event.status !== 'OPEN') return { ok: false, reason: 'EVENT_NOT_OPEN' };
  if (event.predictionDeadline.getTime() <= now.getTime()) {
    return { ok: false, reason: 'EVENT_DEADLINE_PASSED' };
  }
  if (!event.outcomeIds.includes(chosenOutcomeId)) {
    return { ok: false, reason: 'INVALID_OUTCOME' };
  }
  if (chosenOutcomeId === challenge.creatorOutcomeId) {
    return { ok: false, reason: 'SAME_OUTCOME_NOT_ALLOWED' };
  }
  if (actor.hasActivePredictionOnEvent) return { ok: false, reason: 'ALREADY_PREDICTED' };

  // --- Ekonomi --------------------------------------------------------------
  if (actor.balance < challenge.stakeAmount) {
    return { ok: false, reason: 'INSUFFICIENT_BALANCE' };
  }

  return { ok: true };
}

export type CreateOpenContext = {
  readonly creator: ActorSnapshot;
  readonly event: EventSnapshot;
  readonly outcomeId: string;
  readonly stakeAmount: number;
  readonly now: Date;
  /** Bu kullanıcının bu etkinlikte bekleyen bir açık meydan okuması var mı? */
  readonly hasPendingOpenOnEvent: boolean;
  readonly openChallengesToday: number;
};

export type CreateOpenRejection =
  | 'ACCOUNT_NOT_ACTIVE'
  | 'EVENT_NOT_OPEN'
  | 'EVENT_DEADLINE_PASSED'
  | 'INVALID_OUTCOME'
  | 'ALREADY_PREDICTED'
  | 'DUPLICATE_OPEN_CHALLENGE'
  | 'DAILY_LIMIT_REACHED'
  | 'INVALID_STAKE'
  | 'INSUFFICIENT_BALANCE';

export type CreateOpenDecision =
  | { readonly ok: true; readonly expiresAt: Date }
  | { readonly ok: false; readonly reason: CreateOpenRejection };

/** Açık Meydan Okuma yayınlama kuralları. */
export function canCreateOpenChallenge(ctx: CreateOpenContext): CreateOpenDecision {
  const { creator, event, outcomeId, stakeAmount, now } = ctx;

  if (creator.status !== 'ACTIVE') return { ok: false, reason: 'ACCOUNT_NOT_ACTIVE' };
  if (event.status !== 'OPEN') return { ok: false, reason: 'EVENT_NOT_OPEN' };
  if (event.predictionDeadline.getTime() <= now.getTime()) {
    return { ok: false, reason: 'EVENT_DEADLINE_PASSED' };
  }
  if (!event.outcomeIds.includes(outcomeId)) return { ok: false, reason: 'INVALID_OUTCOME' };
  if (creator.hasActivePredictionOnEvent) return { ok: false, reason: 'ALREADY_PREDICTED' };
  if (ctx.hasPendingOpenOnEvent) return { ok: false, reason: 'DUPLICATE_OPEN_CHALLENGE' };
  if (ctx.openChallengesToday >= economy.maxOpenChallengesPerDay) {
    return { ok: false, reason: 'DAILY_LIMIT_REACHED' };
  }
  if (!Number.isInteger(stakeAmount) || stakeAmount < economy.minStake) {
    return { ok: false, reason: 'INVALID_STAKE' };
  }
  if (stakeAmount > creator.balance) return { ok: false, reason: 'INSUFFICIENT_BALANCE' };
  if (!isStakeAllowed(stakeAmount, creator.balance)) return { ok: false, reason: 'INVALID_STAKE' };

  return { ok: true, expiresAt: computeExpiry(event.predictionDeadline, now) };
}

/**
 * Meydan okumanın süresi: yapılandırılan pencere ile etkinlik tahmin kapanışının
 * ERKEN olanı. Çip, tahmin kapandıktan sonra kilitli kalamaz.
 */
export function computeExpiry(predictionDeadline: Date, now: Date): Date {
  const ttl = new Date(now.getTime() + economy.challengeTtlHours * 60 * 60 * 1000);
  return ttl.getTime() < predictionDeadline.getTime() ? ttl : predictionDeadline;
}

/** Kabul edildiğinde stake kaydının idempotency anahtarı — Bölüm 8.3. */
export function stakeIdempotencyKey(challengeId: string, userId: string): string {
  return `challenge:${challengeId}:stake:${userId}`;
}
