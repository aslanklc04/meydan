import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSql, migrateTestDatabase } from './setup';
import { db, withTransaction } from '../../src/server/db';
import { badges, userBadges, userCategoryStats, userRatings } from '../../src/server/db/schema';
import { rankingService } from '../../src/server/modules/ranking/service';
import { notificationService } from '../../src/server/modules/social/notification.service';
import { expertise } from '../../src/config';
import { predictionService } from '../../src/server/modules/prediction/service';
import { createEvent, createUser, ensureCategory } from '../factories';

/**
 * Sıralama, rozet ve sezon.
 *
 * Rating satırları BURADA DOĞRUDAN yazılır. Nedeni bilinçli: eşiği sınamak için
 * kullanıcı başına 20+ etkinlik sonuçlandırmak testi dakikalarca sürdürür ve
 * asıl sınanan şeyi (eşik, sıralama, rozet kuralı) gizler. Rating hesabının
 * kendisi `tests/unit/prediction-power.test.ts` ve `resolution.test.ts` içinde
 * gerçek akışla sınanır.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE leaderboard_entry, leaderboard_snapshot, trending_snapshot,
                           user_badge, badge, season, notification, user_category_stat,
                           user_rating, coin_ledger, coin_account, challenge, prediction,
                           event_outcome, event, category, "user" CASCADE`;
});

afterAll(async () => {
  await sql.end();
});

async function setRating(
  userId: string,
  input: { power: number; completed: number; correct: number },
) {
  await db
    .insert(userRatings)
    .values({
      userId,
      predictionPower: String(input.power),
      completedPredictions: input.completed,
      correctPredictions: input.correct,
      rawAccuracy: String(input.completed === 0 ? 0 : input.correct / input.completed),
    })
    .onConflictDoUpdate({
      target: userRatings.userId,
      set: {
        predictionPower: String(input.power),
        completedPredictions: input.completed,
        correctPredictions: input.correct,
      },
    });
}

// ═══════════════════════════════════════════════════════════════════════════
describe('liderlik tablosu', () => {
  it('Tahmin Gücüne göre sıralar', async () => {
    const a = await createUser('ali');
    const b = await createUser('veli');
    const c = await createUser('ayse');

    await setRating(a.userId, { power: 70, completed: 30, correct: 20 });
    await setRating(b.userId, { power: 85, completed: 30, correct: 25 });
    await setRating(c.userId, { power: 60, completed: 30, correct: 15 });

    await rankingService.generateLeaderboard({ period: 'ALL_TIME' });
    const board = await rankingService.getLeaderboard({ period: 'ALL_TIME' });

    expect(board.entries.map((e) => e.username)).toEqual([b.username, a.username, c.username]);
    expect(board.entries[0]!.rank).toBe(1);
  });

  it('EŞİĞİN ALTINDAKİ kullanıcı listeye GİRMEZ', async () => {
    const veteran = await createUser('usta');
    const rookie = await createUser('cirak');

    // Çırağın gücü daha yüksek ama tahmin sayısı eşiğin altında:
    // az sayıda şanslı tahminle zirveye çıkılamaz — eşiğin varlık sebebi budur.
    await setRating(veteran.userId, {
      power: 70,
      completed: expertise.leaderboardMinPredictions,
      correct: 20,
    });
    await setRating(rookie.userId, {
      power: 99,
      completed: expertise.leaderboardMinPredictions - 1,
      correct: 3,
    });

    await rankingService.generateLeaderboard({ period: 'ALL_TIME' });
    const board = await rankingService.getLeaderboard({ period: 'ALL_TIME' });

    expect(board.entries.map((e) => e.username)).toEqual([veteran.username]);
    expect(board.minPredictions).toBe(expertise.leaderboardMinPredictions);
  });

  it('kategori sıralaması yalnızca o kategorinin istatistiğini kullanır', async () => {
    const sporcu = await createUser('sporcu');
    const genel = await createUser('genelci');
    const categoryId = await ensureCategory('spor');

    await setRating(sporcu.userId, { power: 50, completed: 40, correct: 20 });
    await setRating(genel.userId, { power: 95, completed: 40, correct: 38 });

    // Yalnızca `sporcu`nun spor kategorisinde istatistiği var.
    await db.insert(userCategoryStats).values({
      userId: sporcu.userId,
      categoryId,
      predictionPower: '80',
      completedPredictions: expertise.leaderboardMinCategoryPredictions,
      correctPredictions: 8,
    });

    await rankingService.generateLeaderboard({ period: 'ALL_TIME', categorySlug: 'spor' });
    const board = await rankingService.getLeaderboard({
      period: 'ALL_TIME',
      categorySlug: 'spor',
    });

    expect(board.entries.map((e) => e.username)).toEqual([sporcu.username]);
  });

  it('aynı dönem iki kez üretilirse kayıtlar KOPYALANMAZ', async () => {
    const a = await createUser('ali');
    await setRating(a.userId, { power: 70, completed: 30, correct: 20 });

    await rankingService.generateLeaderboard({ period: 'ALL_TIME' });
    await rankingService.generateLeaderboard({ period: 'ALL_TIME' });

    const board = await rankingService.getLeaderboard({ period: 'ALL_TIME' });
    expect(board.entries).toHaveLength(1);

    const snapshots = await sql`SELECT count(*)::int AS n FROM leaderboard_snapshot`;
    expect(snapshots[0]?.n).toBe(1);
  });

  it('hiç snapshot yoksa boş liste döner, hata fırlatmaz', async () => {
    const board = await rankingService.getLeaderboard({ period: 'WEEKLY' });
    expect(board.entries).toHaveLength(0);
    expect(board.generatedAt).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('rozet', () => {
  async function seedBadge(rule: string, ruleConfig: Record<string, unknown>) {
    const inserted = await db
      .insert(badges)
      .values({
        slug: `rozet-${rule.toLowerCase()}`,
        name: 'Test Rozeti',
        description: 'Test',
        icon: '🏅',
        rule: rule as 'CORRECT_PREDICTIONS',
        ruleConfig,
        sortOrder: 0,
      })
      .returning({ id: badges.id });
    return inserted[0]!.id;
  }

  it('koşulu sağlayan kullanıcıya rozet verilir ve bildirim düşer', async () => {
    const emir = await createUser('emir');
    await seedBadge('CORRECT_PREDICTIONS', { count: 10 });
    await setRating(emir.userId, { power: 70, completed: 20, correct: 10 });

    const awarded = await withTransaction((tx) => rankingService.evaluateBadges(tx, emir.userId));

    expect(awarded).toHaveLength(1);
    expect(await notificationService.unreadCount(emir.userId)).toBe(1);
  });

  it('koşulu sağlamayan kullanıcıya rozet VERİLMEZ', async () => {
    const emir = await createUser('emir');
    await seedBadge('CORRECT_PREDICTIONS', { count: 10 });
    await setRating(emir.userId, { power: 70, completed: 20, correct: 9 });

    const awarded = await withTransaction((tx) => rankingService.evaluateBadges(tx, emir.userId));
    expect(awarded).toHaveLength(0);
  });

  it('aynı rozet İKİNCİ KEZ verilmez', async () => {
    const emir = await createUser('emir');
    await seedBadge('CORRECT_PREDICTIONS', { count: 10 });
    await setRating(emir.userId, { power: 70, completed: 20, correct: 10 });

    await withTransaction((tx) => rankingService.evaluateBadges(tx, emir.userId));
    const second = await withTransaction((tx) => rankingService.evaluateBadges(tx, emir.userId));

    expect(second).toHaveLength(0);

    const rows = await db.select().from(userBadges).where(eq(userBadges.userId, emir.userId));
    expect(rows).toHaveLength(1);
    // Bildirim de tekrarlanmaz: dedupeKey aynı.
    expect(await notificationService.unreadCount(emir.userId)).toBe(1);
  });

  it('Tahmin Gücü rozeti hem güç hem tahmin sayısı eşiğini ister', async () => {
    const emir = await createUser('emir');
    await seedBadge('PREDICTION_POWER', { power: 75, count: 20 });

    // Güç yeterli ama tahmin sayısı az → rozet YOK.
    await setRating(emir.userId, { power: 90, completed: 5, correct: 5 });
    expect(
      await withTransaction((tx) => rankingService.evaluateBadges(tx, emir.userId)),
    ).toHaveLength(0);

    // Tahmin sayısı da yeterli → rozet VAR.
    await setRating(emir.userId, { power: 90, completed: 20, correct: 18 });
    expect(
      await withTransaction((tx) => rankingService.evaluateBadges(tx, emir.userId)),
    ).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('gündem', () => {
  it('hareketli etkinlik üstte sıralanır ve üretim tekrarlanabilir', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const sessiz = await createEvent();
    const hareketli = await createEvent();

    // Hareketli etkinliğe iki tahmin, sessize hiç.
    await predictionService.create({
      userId: emir.userId,
      eventId: hareketli.eventId,
      outcomeId: hareketli.outcomes[0]!.id,
    });
    await predictionService.create({
      userId: mert.userId,
      eventId: hareketli.eventId,
      outcomeId: hareketli.outcomes[1]!.id,
    });

    const first = await rankingService.generateTrending();
    expect(first.ranked).toBe(2);

    const trending = await rankingService.getTrending();
    expect(trending[0]!.eventId).toBe(hareketli.eventId);
    expect(trending[1]!.eventId).toBe(sessiz.eventId);

    // İkinci üretim kopya satır bırakmaz.
    const second = await rankingService.generateTrending();
    expect(second.ranked).toBe(2);
    const rows = await sql`SELECT count(*)::int AS n FROM trending_snapshot`;
    expect(rows[0]?.n).toBe(2);
  });

  it('etkinlik yokken boş sonuç döner, hata fırlatmaz', async () => {
    const result = await rankingService.generateTrending();
    expect(result.ranked).toBe(0);
    expect(await rankingService.getTrending()).toHaveLength(0);
  });
});
