import { describe, expect, it } from 'vitest';
import {
  canAcceptChallenge,
  canCreateOpenChallenge,
  computeExpiry,
  stakeIdempotencyKey,
  type AcceptContext,
  type ChallengeSnapshot,
  type CreateOpenContext,
  type EventSnapshot,
  type ActorSnapshot,
} from '../../src/server/modules/challenge/domain/open-challenge';
import { economy } from '../../src/config/economy';

/**
 * ADR-15 — Açık Meydan Okuma kabul kuralları.
 *
 * Kritik nokta: açık mod, doğrudan moda göre GEVŞEK DEĞİLDİR. Aynı guard
 * zincirinden geçer; tek fark rakibin kim olabileceğidir.
 */

const NOW = new Date('2026-09-03T12:00:00Z');
const DEADLINE = new Date('2026-09-03T20:00:00Z');

const event: EventSnapshot = {
  id: 'evt1',
  status: 'OPEN',
  predictionDeadline: DEADLINE,
  outcomeIds: ['gs', 'fb', 'draw'],
};

const openChallenge: ChallengeSnapshot = {
  id: 'ch1',
  mode: 'OPEN',
  status: 'PENDING',
  eventId: 'evt1',
  creatorId: 'emir',
  opponentId: null,
  creatorOutcomeId: 'gs',
  stakeAmount: 10,
  expiresAt: new Date('2026-09-03T18:00:00Z'),
};

const actor: ActorSnapshot = {
  id: 'mert',
  status: 'ACTIVE',
  balance: 1000,
  hasActivePredictionOnEvent: false,
};

const base: AcceptContext = {
  challenge: openChallenge,
  event,
  actor,
  chosenOutcomeId: 'fb',
  now: NOW,
  isBlockedEitherWay: false,
};

const accept = (over: Partial<AcceptContext> = {}) => canAcceptChallenge({ ...base, ...over });

describe('ADR-15 · Açık Meydan Okuma kabulü', () => {
  it('uygun bir kullanıcı açık meydan okumayı kabul edebilir', () => {
    expect(accept()).toEqual({ ok: true });
  });

  it('rakip zorunlu değildir — OPEN modda opponentId null olabilir', () => {
    expect(openChallenge.opponentId).toBeNull();
    expect(accept().ok).toBe(true);
  });

  it('ilk kabul eden kazanır: kapılmış meydan okuma reddedilir', () => {
    // Yarışı kaybeden istek: satır artık PENDING değil
    expect(accept({ challenge: { ...openChallenge, status: 'ACCEPTED' } })).toEqual({
      ok: false,
      reason: 'CHALLENGE_ALREADY_CLAIMED',
    });
  });

  it('OPEN + PENDING iken rakip doluysa yarış kaybedilmiştir', () => {
    expect(accept({ challenge: { ...openChallenge, opponentId: 'can' } })).toEqual({
      ok: false,
      reason: 'CHALLENGE_ALREADY_CLAIMED',
    });
  });

  it('kullanıcı kendi açık meydan okumasını kabul edemez', () => {
    expect(accept({ actor: { ...actor, id: 'emir' } })).toEqual({
      ok: false,
      reason: 'SELF_CHALLENGE',
    });
  });

  it('farklı sonuç seçmek zorunludur', () => {
    expect(accept({ chosenOutcomeId: 'gs' })).toEqual({
      ok: false,
      reason: 'SAME_OUTCOME_NOT_ALLOWED',
    });
  });

  it('geçersiz outcome reddedilir', () => {
    expect(accept({ chosenOutcomeId: 'baska-eventin-outcome' })).toEqual({
      ok: false,
      reason: 'INVALID_OUTCOME',
    });
  });

  it('süresi dolmuş meydan okuma kabul edilemez', () => {
    expect(accept({ now: new Date('2026-09-03T18:00:01Z') })).toEqual({
      ok: false,
      reason: 'CHALLENGE_EXPIRED',
    });
  });

  it('tahmin kapanışı geçtikten sonra kabul edilemez', () => {
    expect(
      accept({
        now: new Date('2026-09-03T20:00:01Z'),
        challenge: { ...openChallenge, expiresAt: new Date('2026-09-04T00:00:00Z') },
      }),
    ).toEqual({ ok: false, reason: 'EVENT_DEADLINE_PASSED' });
  });

  it('etkinlik açık değilse kabul edilemez', () => {
    expect(accept({ event: { ...event, status: 'CLOSED' } })).toEqual({
      ok: false,
      reason: 'EVENT_NOT_OPEN',
    });
  });

  it('askıya alınmış hesap kabul edemez', () => {
    expect(accept({ actor: { ...actor, status: 'SUSPENDED' } })).toEqual({
      ok: false,
      reason: 'ACCOUNT_NOT_ACTIVE',
    });
  });

  it('engellenmiş taraflar arasında kabul gerçekleşmez', () => {
    expect(accept({ isBlockedEitherWay: true })).toEqual({ ok: false, reason: 'BLOCKED' });
  });

  it('etkinlikte zaten aktif tahmini olan kabul edemez', () => {
    expect(accept({ actor: { ...actor, hasActivePredictionOnEvent: true } })).toEqual({
      ok: false,
      reason: 'ALREADY_PREDICTED',
    });
  });

  it('yetersiz bakiye reddedilir — bakiye kontrolü açık modda da uygulanır', () => {
    expect(accept({ actor: { ...actor, balance: 9 } })).toEqual({
      ok: false,
      reason: 'INSUFFICIENT_BALANCE',
    });
  });
});

describe('ADR-15 · Doğrudan Meydan Okuma davranışı korunur', () => {
  const direct: ChallengeSnapshot = { ...openChallenge, mode: 'DIRECT', opponentId: 'mert' };

  it('adı verilen kullanıcı kabul edebilir', () => {
    expect(accept({ challenge: direct })).toEqual({ ok: true });
  });

  it('davet edilmeyen kullanıcı kabul EDEMEZ', () => {
    expect(accept({ challenge: direct, actor: { ...actor, id: 'can' } })).toEqual({
      ok: false,
      reason: 'NOT_INVITED',
    });
  });

  it('doğrudan modda kapılma değil, durum hatası döner', () => {
    expect(accept({ challenge: { ...direct, status: 'DECLINED' } })).toEqual({
      ok: false,
      reason: 'CHALLENGE_NOT_PENDING',
    });
  });
});

describe('ADR-15 · Açık Meydan Okuma yayınlama', () => {
  const creator: ActorSnapshot = {
    id: 'emir',
    status: 'ACTIVE',
    balance: 1000,
    hasActivePredictionOnEvent: false,
  };

  const ctx: CreateOpenContext = {
    creator,
    event,
    outcomeId: 'gs',
    stakeAmount: 10,
    now: NOW,
    hasPendingOpenOnEvent: false,
    openChallengesToday: 0,
  };

  const create = (over: Partial<CreateOpenContext> = {}) =>
    canCreateOpenChallenge({ ...ctx, ...over });

  it('rakip belirtmeden yayınlanabilir', () => {
    const result = create();
    expect(result.ok).toBe(true);
  });

  it('aynı etkinlikte ikinci bekleyen açık meydan okuma açılamaz', () => {
    expect(create({ hasPendingOpenOnEvent: true })).toEqual({
      ok: false,
      reason: 'DUPLICATE_OPEN_CHALLENGE',
    });
  });

  it('günlük açık meydan okuma tavanı uygulanır', () => {
    expect(create({ openChallengesToday: economy.maxOpenChallengesPerDay })).toEqual({
      ok: false,
      reason: 'DAILY_LIMIT_REACHED',
    });
  });

  it('minimum altındaki çip reddedilir', () => {
    expect(create({ stakeAmount: 1 })).toEqual({ ok: false, reason: 'INVALID_STAKE' });
  });

  it('ondalıklı çip reddedilir', () => {
    expect(create({ stakeAmount: 10.5 })).toEqual({ ok: false, reason: 'INVALID_STAKE' });
  });

  it('bakiyeden fazla çip reddedilir', () => {
    expect(create({ stakeAmount: 400, creator: { ...creator, balance: 100 } })).toEqual({
      ok: false,
      reason: 'INSUFFICIENT_BALANCE',
    });
  });
});

describe('süre ve idempotency', () => {
  it('süre, TTL ile tahmin kapanışının erken olanıdır', () => {
    const farDeadline = new Date('2026-09-10T00:00:00Z');
    const expiry = computeExpiry(farDeadline, NOW);
    expect(expiry.getTime()).toBe(NOW.getTime() + economy.challengeTtlHours * 3600_000);
  });

  it('tahmin kapanışı TTL içindeyse çip kapanıştan sonra kilitli kalmaz', () => {
    const soon = new Date('2026-09-03T14:00:00Z');
    expect(computeExpiry(soon, NOW).getTime()).toBe(soon.getTime());
  });

  it('stake idempotency anahtarı kullanıcı başına tekildir', () => {
    expect(stakeIdempotencyKey('ch1', 'emir')).toBe('challenge:ch1:stake:emir');
    expect(stakeIdempotencyKey('ch1', 'mert')).not.toBe(stakeIdempotencyKey('ch1', 'emir'));
  });
});
