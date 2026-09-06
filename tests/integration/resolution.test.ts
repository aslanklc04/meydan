import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { challenges, events, predictions } from '../../src/server/db/schema';
import { challengeService } from '../../src/server/modules/challenge/service';
import { predictionService } from '../../src/server/modules/prediction/service';
import { resolutionService } from '../../src/server/modules/resolution/service';
import { reputationService } from '../../src/server/modules/reputation/service';
import { coinService } from '../../src/server/modules/economy/service';
import { economy, rating } from '../../src/config';
import { createEvent, createUser } from '../factories';

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE coin_ledger, coin_account, rating_history, user_category_stat, user_rating,
            event_resolution, challenge, prediction, event_outcome, event, category, "user" CASCADE`;
});

afterAll(async () => {
  await sql.end();
});

/** Emir "Galatasaray" der, Mert kabul eder (otomatik "Fenerbahçe"). */
async function setupChallenge(stake = 50) {
  const emir = await createUser('emir');
  const mert = await createUser('mert');
  const event = await createEvent();
  const admin = await createUser('yonetici');

  const { challengeId } = await challengeService.create({
    creatorId: emir.userId,
    eventId: event.eventId,
    outcomeId: event.outcomes[0]!.id,
    stakeAmount: stake,
    opponentUsername: mert.username,
  });
  await challengeService.accept(challengeId, mert.userId);

  return { emir, mert, admin, event, challengeId, stake };
}

// ═══════════════════════════════════════════════════════════════════════════
describe('KABUL KRİTERİ — uçtan uca çekirdek döngü', () => {
  it('Emir kazanır, çipler doğru akar, Tahmin Gücü güncellenir', async () => {
    const { emir, mert, admin, event, challengeId, stake } = await setupChallenge(50);

    // Stake sonrası her iki taraftan da 50 düşülmüş olmalı
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant - stake);
    expect(await coinService.getBalance(mert.userId)).toBe(economy.initialGrant - stake);

    // Admin sonucu Galatasaray olarak belirler
    const result = await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      decision: 'RESOLVED',
      resolvedById: admin.userId,
    });

    expect(result.alreadyResolved).toBe(false);
    expect(result.predictionsResolved).toBe(2);
    expect(result.challengesSettled).toBe(1);

    // Meydan Okuma tamamlandı, kazanan Emir
    const [challenge] = await db.select().from(challenges).where(eq(challenges.id, challengeId));
    expect(challenge?.status).toBe('COMPLETED');
    expect(challenge?.settlement).toBe('WIN_LOSS');
    expect(challenge?.winnerUserId).toBe(emir.userId);

    // Çip ledger doğru: Emir net +50, Mert net −50
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant + stake);
    expect(await coinService.getBalance(mert.userId)).toBe(economy.initialGrant - stake);

    // Tahmin sonuçları doğru
    const rows = await db.select().from(predictions).where(eq(predictions.eventId, event.eventId));
    const emirPrediction = rows.find((r) => r.userId === emir.userId);
    const mertPrediction = rows.find((r) => r.userId === mert.userId);
    expect(emirPrediction?.result).toBe('CORRECT');
    expect(mertPrediction?.result).toBe('INCORRECT');
    expect(emirPrediction?.status).toBe('RESOLVED');

    // Etkinlik sonuçlandı
    const [ev] = await db.select().from(events).where(eq(events.id, event.eventId));
    expect(ev?.status).toBe('RESOLVED');
    expect(ev?.resolvedOutcomeId).toBe(event.outcomes[0]!.id);

    // Tahmin Gücü güncellendi ve iki kullanıcı ayrıştı
    const emirPower = await reputationService.getSummary(emir.userId);
    const mertPower = await reputationService.getSummary(mert.userId);
    expect(emirPower.completed).toBe(1);
    expect(emirPower.correct).toBe(1);
    expect(mertPower.correct).toBe(0);
    expect(emirPower.power).toBeGreaterThan(rating.coldStartPower);
    // Anlamlı invariant: doğru bilen, yanılandan HER ZAMAN yukarıda olur.
    expect(emirPower.power).toBeGreaterThan(mertPower.power);

    // Ekonomi hâlâ sıfır toplamlı
    const { ledgerSum, mismatches } = await coinService.reconcile(db);
    expect(ledgerSum).toBe(0);
    expect(mismatches).toEqual([]);
  });

  it('İKİNCİ KEZ çalıştırıldığında hiçbir şey değişmez — idempotency', async () => {
    const { emir, mert, admin, event, challengeId } = await setupChallenge(50);

    await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      decision: 'RESOLVED',
      resolvedById: admin.userId,
    });

    const emirAfterFirst = await coinService.getBalance(emir.userId);
    const mertAfterFirst = await coinService.getBalance(mert.userId);
    const powerAfterFirst = (await reputationService.getSummary(emir.userId)).power;
    const [ledgerCountBefore] = await sql`SELECT count(*)::int AS n FROM coin_ledger`;

    // Aynı sonuçlandırma tekrar çalıştırılır
    const second = await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      decision: 'RESOLVED',
      resolvedById: admin.userId,
    });

    expect(second.alreadyResolved).toBe(true);

    // İkinci kez ödeme YOK
    expect(await coinService.getBalance(emir.userId)).toBe(emirAfterFirst);
    expect(await coinService.getBalance(mert.userId)).toBe(mertAfterFirst);

    // İkinci kez Tahmin Gücü değişimi YOK
    expect((await reputationService.getSummary(emir.userId)).power).toBe(powerAfterFirst);

    // İkinci kez ledger satırı YOK
    const [ledgerCountAfter] = await sql`SELECT count(*)::int AS n FROM coin_ledger`;
    expect(ledgerCountAfter?.n).toBe(ledgerCountBefore?.n);

    // Meydan Okuma tek kez tamamlanmış
    const [challenge] = await db.select().from(challenges).where(eq(challenges.id, challengeId));
    expect(challenge?.status).toBe('COMPLETED');

    const [resolutionCount] = await sql`SELECT count(*)::int AS n FROM event_resolution`;
    expect(resolutionCount?.n).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('beraberlik — iki taraf da yanılır', () => {
  it('üçüncü sonuç çıkarsa herkes çipini geri alır', async () => {
    const { emir, mert, admin, event, challengeId } = await setupChallenge(50);

    // Sonuç: Beraberlik — ne Emir'in ne Mert'in seçimi
    await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: event.outcomes[2]!.id,
      decision: 'RESOLVED',
      resolvedById: admin.userId,
    });

    const [challenge] = await db.select().from(challenges).where(eq(challenges.id, challengeId));
    expect(challenge?.settlement).toBe('REFUND_BOTH');
    expect(challenge?.winnerUserId).toBeNull();

    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);
    expect(await coinService.getBalance(mert.userId)).toBe(economy.initialGrant);

    // Yine de iki tahmin de YANLIŞ sayılır — itibara işlenir
    const rows = await db.select().from(predictions).where(eq(predictions.eventId, event.eventId));
    expect(rows.every((r) => r.result === 'INCORRECT')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('VOID — sonuç güvenilir biçimde belirlenemedi', () => {
  it('çipler kaybolmaz, iade edilir', async () => {
    const { emir, mert, admin, event, challengeId } = await setupChallenge(50);

    await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: null,
      decision: 'VOID',
      resolvedById: admin.userId,
      note: 'Maç ertelendi.',
    });

    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);
    expect(await coinService.getBalance(mert.userId)).toBe(economy.initialGrant);

    const [challenge] = await db.select().from(challenges).where(eq(challenges.id, challengeId));
    expect(challenge?.settlement).toBe('REFUND_BOTH');

    const [ev] = await db.select().from(events).where(eq(events.id, event.eventId));
    expect(ev?.status).toBe('VOID');
    expect(ev?.resolvedOutcomeId).toBeNull();
  });

  it('VOID tahminler Tahmin Gücüne GİRMEZ', async () => {
    const { emir, admin, event } = await setupChallenge(50);

    await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: null,
      decision: 'VOID',
      resolvedById: admin.userId,
    });

    const summary = await reputationService.getSummary(emir.userId);
    expect(summary.completed).toBe(0);
    expect(summary.power).toBe(rating.coldStartPower);

    const rows = await db.select().from(predictions).where(eq(predictions.eventId, event.eventId));
    expect(rows.every((r) => r.status === 'VOID' && r.result === 'VOID')).toBe(true);
  });

  it('VOID iadesi İKİNCİ KEZ yapılamaz', async () => {
    const { emir, mert, admin, event } = await setupChallenge(50);

    await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: null,
      decision: 'VOID',
      resolvedById: admin.userId,
    });
    await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: null,
      decision: 'VOID',
      resolvedById: admin.userId,
    });

    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);
    expect(await coinService.getBalance(mert.userId)).toBe(economy.initialGrant);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('kabul edilmemiş Meydan Okuma', () => {
  it('etkinlik sonuçlanınca YALNIZCA oluşturana iade edilir (REFUND_CREATOR)', async () => {
    const emir = await createUser('emir');
    const admin = await createUser('yonetici');
    const event = await createEvent();

    await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 50,
    });
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant - 50);

    await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      decision: 'RESOLVED',
      resolvedById: admin.userId,
    });

    // Rakip bulunmadığı için çip iade edilir — ama tahmin yine de sonuçlanır
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);

    // Settlement semantiği doğru: iki tarafa değil, YALNIZCA oluşturana iade
    const [ch] = await db.select().from(challenges).where(eq(challenges.eventId, event.eventId));
    expect(ch?.settlement).toBe('REFUND_CREATOR');
    expect(ch?.status).toBe('EXPIRED');
    const summary = await reputationService.getSummary(emir.userId);
    expect(summary.completed).toBe(1);
    expect(summary.correct).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('serbest tahminler', () => {
  it('meydan okumasız tahminler de sonuçlanır ve itibara işlenir', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const admin = await createUser('yonetici');
    const event = await createEvent();

    await predictionService.create({
      userId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
    });
    await predictionService.create({
      userId: mert.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[1]!.id,
    });

    await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      decision: 'RESOLVED',
      resolvedById: admin.userId,
    });

    // Çip hareketi yok — serbest tahminde stake yoktur
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);

    const emirSummary = await reputationService.getSummary(emir.userId);
    const mertSummary = await reputationService.getSummary(mert.userId);
    expect(emirSummary.correct).toBe(1);
    expect(mertSummary.correct).toBe(0);
    expect(emirSummary.power).toBeGreaterThan(mertSummary.power);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('sonuçlandırma doğrulamaları', () => {
  it('başka etkinliğin sonucu seçilemez', async () => {
    const admin = await createUser('yonetici');
    const event = await createEvent();
    const other = await createEvent();

    await expect(
      resolutionService.resolve({
        eventId: event.eventId,
        outcomeId: other.outcomes[0]!.id,
        decision: 'RESOLVED',
        resolvedById: admin.userId,
      }),
    ).rejects.toThrow(/bu etkinliğe ait değil/i);
  });

  it('RESOLVED kararında sonuç zorunludur', async () => {
    const admin = await createUser('yonetici');
    const event = await createEvent();

    await expect(
      resolutionService.resolve({
        eventId: event.eventId,
        outcomeId: null,
        decision: 'RESOLVED',
        resolvedById: admin.userId,
      }),
    ).rejects.toThrow(/bir sonuç seçmelisin/i);
  });

  it('tahmin dağılımı sonuçlandırmada DONDURULUR', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const admin = await createUser('yonetici');
    const event = await createEvent();

    await predictionService.create({
      userId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
    });
    await predictionService.create({
      userId: mert.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
    });

    await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      decision: 'RESOLVED',
      resolvedById: admin.userId,
    });

    const rows = await sql`
      SELECT key, consensus_share FROM event_outcome WHERE event_id = ${event.eventId} ORDER BY sort_order`;
    // İki kişiden ikisi de ilk sonucu seçti → payı 1.0
    expect(Number(rows[0]?.consensus_share)).toBe(1);
    expect(Number(rows[1]?.consensus_share)).toBe(0);
  });
});
