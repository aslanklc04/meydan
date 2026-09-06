import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { profiles } from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';
import { socialService } from '../../src/server/modules/social/service';
import { notificationService } from '../../src/server/modules/social/notification.service';
import { predictionService } from '../../src/server/modules/prediction/service';
import { createEvent, createUser } from '../factories';

/**
 * Sosyal katman — takip, akış, moderasyon.
 *
 * Bu testler GERÇEK PostgreSQL üzerinde çalışır. Sahte veritabanıyla sınanamayan
 * şeyler burada sınanır: tekil index'in kopya takibi engellemesi, sayaçların
 * tam olarak bir kez artması, engellemenin takibi iki yönlü koparması.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE notification, feed_item, reaction, report, block, follow,
                           coin_ledger, coin_account, challenge, prediction,
                           event_outcome, event, category, "user" CASCADE`;
});

afterAll(async () => {
  await sql.end();
});

async function followerCounts(userId: string) {
  const rows = await db
    .select({ followers: profiles.followerCount, following: profiles.followingCount })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  return rows[0]!;
}

// ═══════════════════════════════════════════════════════════════════════════
describe('takip', () => {
  it('takip eder ve sayaçlar bir kez artar', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');

    await socialService.follow(emir.userId, mert.username);

    expect(await socialService.isFollowing(emir.userId, mert.userId)).toBe(true);
    expect((await followerCounts(mert.userId)).followers).toBe(1);
    expect((await followerCounts(emir.userId)).following).toBe(1);
  });

  it('AYNI takip iki kez yapılırsa sayaç İKİNCİ KEZ ARTMAZ', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');

    await socialService.follow(emir.userId, mert.username);
    await socialService.follow(emir.userId, mert.username);

    // Bu, tekil index + onConflictDoNothing birleşiminin asıl sınavı:
    // kopya satır yazılmadığı için sayaç da artmamalı.
    expect((await followerCounts(mert.userId)).followers).toBe(1);
    expect((await followerCounts(emir.userId)).following).toBe(1);
  });

  it('kendini takip edemez', async () => {
    const emir = await createUser('emir');
    await expect(socialService.follow(emir.userId, emir.username)).rejects.toThrow(
      /Kendini takip edemezsin/,
    );
  });

  it('takipten çıkınca sayaçlar geri iner ve ikinci çıkış sayacı eksiye düşürmez', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');

    await socialService.follow(emir.userId, mert.username);
    await socialService.unfollow(emir.userId, mert.username);
    await socialService.unfollow(emir.userId, mert.username);

    expect(await socialService.isFollowing(emir.userId, mert.userId)).toBe(false);
    expect((await followerCounts(mert.userId)).followers).toBe(0);
    expect((await followerCounts(emir.userId)).following).toBe(0);
  });

  it('takip bildirimi üretir ve kopyalanmaz', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');

    await socialService.follow(emir.userId, mert.username);
    await socialService.unfollow(emir.userId, mert.username);
    await socialService.follow(emir.userId, mert.username);

    // dedupeKey aynı çift için sabittir: ikinci takip yeni bildirim üretmez.
    expect(await notificationService.unreadCount(mert.userId)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('akış', () => {
  it('takip edilen kullanıcının tahmini akışta görünür, edilmeyenin görünmez', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const ayse = await createUser('ayse');
    const event = await createEvent();

    await socialService.follow(emir.userId, mert.username);

    await predictionService.create({
      userId: mert.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
    });
    await predictionService.create({
      userId: ayse.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[1]!.id,
    });

    const feed = await socialService.feed(emir.userId);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]!.actorUsername).toBe(mert.username);
  });

  it('kimseyi takip etmeyen kullanıcının akışı boştur', async () => {
    const emir = await createUser('emir');
    const feed = await socialService.feed(emir.userId);
    expect(feed.items).toHaveLength(0);
    expect(feed.nextCursor).toBeNull();
  });

  it('cursor sayfalama aynı öğeyi iki kez vermez ve atlamaz', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    await socialService.follow(emir.userId, mert.username);

    // Aynı milisaniyeye düşebilecek beş tahmin — cursor (createdAt, id) çifti
    // olmasaydı burada öğe kaybı yaşanırdı.
    for (let i = 0; i < 5; i += 1) {
      const event = await createEvent();
      await predictionService.create({
        userId: mert.userId,
        eventId: event.eventId,
        outcomeId: event.outcomes[0]!.id,
      });
    }

    const first = await socialService.feed(emir.userId, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();

    const second = await socialService.feed(emir.userId, {
      limit: 2,
      cursor: first.nextCursor!,
    });
    const third = await socialService.feed(emir.userId, {
      limit: 2,
      cursor: second.nextCursor!,
    });

    const ids = [...first.items, ...second.items, ...third.items].map((i) => i.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('moderasyon', () => {
  it('bildirim kaydedilir, aynı içerik iki kez bildirilemez', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');

    await socialService.report({
      reporterId: emir.userId,
      targetType: 'USER',
      targetId: mert.userId,
      reason: 'SPAM',
    });

    await expect(
      socialService.report({
        reporterId: emir.userId,
        targetType: 'USER',
        targetId: mert.userId,
        reason: 'SPAM',
      }),
    ).rejects.toThrow(/zaten bildirdin/);
  });

  it('kendini bildiremez', async () => {
    const emir = await createUser('emir');
    await expect(
      socialService.report({
        reporterId: emir.userId,
        targetType: 'USER',
        targetId: emir.userId,
        reason: 'OTHER',
      }),
    ).rejects.toThrow(/Kendini raporlayamazsın/);
  });

  it('engelleme takibi İKİ YÖNLÜ koparır ve yeniden takibi engeller', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');

    await socialService.follow(emir.userId, mert.username);
    await socialService.follow(mert.userId, emir.username);

    await socialService.block(emir.userId, mert.username);

    expect(await socialService.isFollowing(emir.userId, mert.userId)).toBe(false);
    expect(await socialService.isFollowing(mert.userId, emir.userId)).toBe(false);

    await expect(socialService.follow(mert.userId, emir.username)).rejects.toThrow(
      /takip edemezsin/,
    );
  });

  it('kendini engelleyemez', async () => {
    const emir = await createUser('emir');
    await expect(socialService.block(emir.userId, emir.username)).rejects.toThrow(
      /Kendini engelleyemezsin/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('reaksiyon', () => {
  it('aynı içeriğe ikinci kez basmak reaksiyonu kaldırır', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const event = await createEvent();

    const { predictionId } = await predictionService.create({
      userId: mert.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
    });

    const on = await socialService.toggleReaction(emir.userId, 'PREDICTION', predictionId);
    expect(on.reacted).toBe(true);

    const off = await socialService.toggleReaction(emir.userId, 'PREDICTION', predictionId);
    expect(off.reacted).toBe(false);
  });
});
