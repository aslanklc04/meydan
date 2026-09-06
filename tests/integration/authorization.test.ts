import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { users } from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';
import { challengeService } from '../../src/server/modules/challenge/service';
import { predictionService } from '../../src/server/modules/prediction/service';
import { coinService } from '../../src/server/modules/economy/service';
import { notificationService } from '../../src/server/modules/social/notification.service';
import { adminService } from '../../src/server/modules/governance/admin.service';
import { identityService } from '../../src/server/modules/identity/service';
import { onboardingService } from '../../src/server/modules/identity/onboarding.service';
import { economy } from '../../src/config';
import { createEvent, createUser, ensureCategory } from '../factories';

/**
 * GÜVENLİK DENETİMİ — Faz 5.
 *
 * Sorulan soru şudur: "Başkasının kimliğini bilen biri, o kimliğe ait veriye
 * erişebilir mi ya da onun adına işlem yapabilir mi?" (IDOR)
 *
 * cuid2 kimlikleri tahmin edilemez; ama tahmin edilemezlik YETKİLENDİRME
 * DEĞİLDİR. Kimlik bir yerden sızabilir (ekran görüntüsü, paylaşılan bağlantı,
 * günlük). Bu yüzden her erişim yolu kimliği ayrıca doğrulamalıdır.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE audit_log, user_interest, notification, feed_item, follow, block,
                           report, reaction, coin_ledger, coin_account, challenge, prediction,
                           event_outcome, event, category, "user" CASCADE`;
});

afterAll(async () => {
  await sql.end();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Meydan Okuma yetkilendirmesi (IDOR)', () => {
  async function directChallenge() {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const davetsiz = await createUser('davetsiz');
    const event = await createEvent();

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: economy.stakePresets[0]!,
      opponentUsername: mert.username,
    });

    return { emir, mert, davetsiz, event, challengeId };
  }

  it('ÜÇÜNCÜ KİŞİ, başkasına gönderilmiş Meydan Okumayı KABUL EDEMEZ', async () => {
    const { davetsiz, challengeId } = await directChallenge();

    await expect(challengeService.accept(challengeId, davetsiz.userId)).rejects.toThrow(
      /sana gönderilmedi/i,
    );
  });

  it('ÜÇÜNCÜ KİŞİ, başkasının Meydan Okumasını REDDEDEMEZ', async () => {
    const { davetsiz, challengeId } = await directChallenge();

    await expect(challengeService.decline(challengeId, davetsiz.userId)).rejects.toThrow(
      /reddedemezsin/i,
    );
  });

  it('ÜÇÜNCÜ KİŞİ, başkasının Meydan Okumasını İPTAL EDEMEZ (çip çalınamaz)', async () => {
    const { emir, davetsiz, challengeId } = await directChallenge();
    const stake = economy.stakePresets[0]!;

    await expect(challengeService.cancel(challengeId, davetsiz.userId)).rejects.toThrow(
      /iptal edemezsin/i,
    );

    // Çip hâlâ askıda: iptal gerçekleşmedi.
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant - stake);
  });

  it('OLUŞTURAN kendi Meydan Okumasını kabul edemez', async () => {
    const { emir, challengeId } = await directChallenge();
    await expect(challengeService.accept(challengeId, emir.userId)).rejects.toThrow(
      /Kendi Meydan Okumanı/i,
    );
  });

  it('ÜÇÜNCÜ KİŞİ, bekleyen doğrudan daveti GÖRÜNTÜLEYEMEZ', async () => {
    const { emir, mert, davetsiz, challengeId } = await directChallenge();

    // Taraflar görür.
    expect(await challengeService.detailFor(challengeId, emir.userId)).not.toBeNull();
    expect(await challengeService.detailFor(challengeId, mert.userId)).not.toBeNull();

    // Üçüncü kişi ve anonim görmez — "yok" ile "yetkin yok" ayrımı yapılmaz.
    expect(await challengeService.detailFor(challengeId, davetsiz.userId)).toBeNull();
    expect(await challengeService.detailFor(challengeId, null)).toBeNull();
  });

  it('AÇIK Meydan Okuma herkese görünür — gizli değil, davetsiz', async () => {
    const emir = await createUser('emir');
    const yabanci = await createUser('yabanci');
    const event = await createEvent();

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: economy.stakePresets[0]!,
    });

    expect(await challengeService.detailFor(challengeId, yabanci.userId)).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('kişisel veri sızıntısı', () => {
  it('bildirimler YALNIZCA sahibine döner', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');

    await notificationService.create(db, {
      userId: mert.userId,
      type: 'NEW_FOLLOWER',
      body: 'Mert için özel bildirim',
      dedupeKey: 'gizli:1',
    });

    const emirList = await notificationService.list(emir.userId);
    expect(emirList.items).toHaveLength(0);
    expect(await notificationService.unreadCount(emir.userId)).toBe(0);
  });

  it('bakiye YALNIZCA sahibinin hesabından okunur', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const event = await createEvent();

    await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: economy.stakePresets[3]!,
    });

    // Emir'in bakiyesi düştü; Mert'inki dokunulmadı.
    expect(await coinService.getBalance(mert.userId)).toBe(economy.initialGrant);
  });

  it('tahmin listesi başkasının tahminlerini karıştırmaz', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const event = await createEvent();

    await predictionService.create({
      userId: mert.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
    });

    expect(await predictionService.listForUser(emir.userId, 10)).toHaveLength(0);
    expect(await predictionService.listForUser(mert.userId, 10)).toHaveLength(1);
  });

  it('ilgi alanları kullanıcıya özeldir', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    await ensureCategory('spor');

    await onboardingService.complete(emir.userId, ['spor']);

    expect(await onboardingService.interestSlugs(emir.userId)).toEqual(['spor']);
    expect(await onboardingService.interestSlugs(mert.userId)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('askıya alınan hesap', () => {
  it('askıya alınınca oturum ÇÖZÜLEMEZ hale gelir', async () => {
    const emir = await createUser('emir');

    const session = await identityService.startSession({ userId: emir.userId });
    const epochRows = await db
      .select({ epoch: users.sessionEpoch })
      .from(users)
      .where(eq(users.id, emir.userId));
    const epoch = epochRows[0]!.epoch;

    const before = await identityService.resolveSession(session.sessionId, epoch);
    expect(before).not.toBeNull();

    await adminService.setUserStatus(emir.userId, 'SUSPENDED');

    // Aynı token artık geçersiz: yetki her istekte veritabanından doğrulanır
    // (ADR-06a). Askı, bir sonraki istekte ANINDA etkili olur.
    const after = await identityService.resolveSession(session.sessionId, epoch);
    expect(after).toBeNull();
  });

  it('silinmiş hesabın durumu değiştirilemez', async () => {
    const emir = await createUser('emir');
    await db.update(users).set({ status: 'DELETED' }).where(eq(users.id, emir.userId));

    await expect(adminService.setUserStatus(emir.userId, 'ACTIVE')).rejects.toThrow(
      /bulamadık|bulunamadı/i,
    );
  });
});
