import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql as raw } from 'drizzle-orm';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { challenges } from '../../src/server/db/schema';
import { challengeService } from '../../src/server/modules/challenge/service';
import { coinService } from '../../src/server/modules/economy/service';
import { notificationService } from '../../src/server/modules/social/notification.service';
import { jobsService } from '../../src/server/modules/governance/jobs.service';
import { economy } from '../../src/config';
import { createEvent, createUser } from '../factories';

/**
 * Bakım işleri.
 *
 * FAZ 3'ÜN BİLİNEN AÇIĞI BURADA KAPANIYOR: kabul edilmemiş bir Meydan Okuma
 * yalnızca etkinlik sonuçlandığında iade ediliyordu. Artık süresi dolduğunda
 * iade ediliyor — çip haftalarca askıda kalmıyor.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE notification, feed_item, coin_ledger, coin_account, challenge,
                           prediction, event_outcome, event, category, "user" CASCADE`;
});

afterAll(async () => {
  await sql.end();
});

/** Süreyi geçmişe çeker — CHECK'leri aşmak için doğrudan UPDATE. */
async function forceExpiry(challengeId: string): Promise<void> {
  await db.execute(
    raw`UPDATE challenge SET expires_at = now() - interval '1 hour' WHERE id = ${challengeId}`,
  );
}

async function createPendingChallenge() {
  const emir = await createUser('emir');
  const event = await createEvent();

  const { challengeId } = await challengeService.create({
    creatorId: emir.userId,
    eventId: event.eventId,
    outcomeId: event.outcomes[0]!.id,
    stakeAmount: economy.stakePresets[0]!,
    // Rakip verilmediği için AÇIK MEYDAN OKUMA olur.
  });

  return { emir, event, challengeId };
}

describe('süresi dolan Meydan Okuma', () => {
  it('süresi dolunca kapanır ve çip oluşturana İADE EDİLİR', async () => {
    const { emir, challengeId } = await createPendingChallenge();
    const stake = economy.stakePresets[0]!;

    const afterStake = await coinService.getBalance(emir.userId);
    expect(afterStake).toBe(economy.initialGrant - stake);

    await forceExpiry(challengeId);
    const expired = await jobsService.expireStaleChallenges();

    expect(expired).toBe(1);
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);

    const rows = await db.select().from(challenges).where(eq(challenges.id, challengeId));
    expect(rows[0]!.status).toBe('EXPIRED');
    // Kabul edilmemiş Meydan Okumada YALNIZCA oluşturan çip koymuştur;
    // "iki tarafa iade" demek semantik olarak yanlış olurdu.
    expect(rows[0]!.settlement).toBe('REFUND_CREATOR');
  });

  it('İKİNCİ çalıştırma ikinci kez İADE ETMEZ', async () => {
    const { emir, challengeId } = await createPendingChallenge();
    await forceExpiry(challengeId);

    await jobsService.expireStaleChallenges();
    const second = await jobsService.expireStaleChallenges();

    expect(second).toBe(0);
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);
  });

  it('süresi DOLMAMIŞ Meydan Okumaya dokunmaz', async () => {
    const { emir, challengeId } = await createPendingChallenge();

    const expired = await jobsService.expireStaleChallenges();
    expect(expired).toBe(0);

    const rows = await db.select().from(challenges).where(eq(challenges.id, challengeId));
    expect(rows[0]!.status).toBe('PENDING');
    expect(await coinService.getBalance(emir.userId)).toBe(
      economy.initialGrant - economy.stakePresets[0]!,
    );
  });

  it('oluşturana bildirim düşer ve tekrarlanmaz', async () => {
    const { emir, challengeId } = await createPendingChallenge();
    await forceExpiry(challengeId);

    await jobsService.expireStaleChallenges();
    await jobsService.expireStaleChallenges();

    expect(await notificationService.unreadCount(emir.userId)).toBe(1);
  });

  it('iade sonrası defter DENGELİ kalır', async () => {
    const { challengeId } = await createPendingChallenge();
    await forceExpiry(challengeId);
    await jobsService.expireStaleChallenges();

    const health = await jobsService.ledgerHealth();
    // Değişmez kural: çift kayıtlı defterde toplam her zaman SIFIR.
    expect(health.balanced).toBe(true);
    expect(health.total).toBe(0);
  });
});

describe('kapanışı geçen etkinlik', () => {
  it('tahminleri kapatılır', async () => {
    const event = await createEvent();
    await db.execute(
      raw`UPDATE event SET closes_at = now() - interval '1 hour',
                            resolves_at = now() + interval '1 hour'
           WHERE id = ${event.eventId}`,
    );

    const closed = await jobsService.closeDueEvents();
    expect(closed).toBe(1);

    const rows = await sql`SELECT status FROM event WHERE id = ${event.eventId}`;
    expect(rows[0]?.status).toBe('CLOSED');
  });
});
