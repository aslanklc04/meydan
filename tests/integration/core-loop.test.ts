import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql as raw } from 'drizzle-orm';
import { createSql, migrateTestDatabase } from './setup';
import { db, withTransaction } from '../../src/server/db';
import { challenges, events, predictions, userCategoryStats } from '../../src/server/db/schema';
import { predictionService } from '../../src/server/modules/prediction/service';
import { challengeService } from '../../src/server/modules/challenge/service';
import { coinService } from '../../src/server/modules/economy/service';
import { catalogService } from '../../src/server/modules/catalog/service';
import { resolutionService } from '../../src/server/modules/resolution/service';
import { reputationService } from '../../src/server/modules/reputation/service';
import { rankingService } from '../../src/server/modules/ranking/service';
import { notificationService } from '../../src/server/modules/social/notification.service';
import { auditService } from '../../src/server/modules/governance/audit.service';
import { jobsService } from '../../src/server/modules/governance/jobs.service';
import { economy, rating } from '../../src/config';
import { acceptChallenge, createEvent, createUser } from '../factories';

/**
 * ÇEKİRDEK DÖNGÜ — GERÇEK PostgreSQL ÜZERİNDE UÇTAN UCA (Faz 6).
 *
 * Bu dosya tek bir soruyu yanıtlar: "Ürünün ana döngüsü gerçek bir
 * veritabanında, gerçek transaction davranışıyla baştan sona çalışıyor mu?"
 *
 * SAHTE (mock) HİÇBİR KATMANDA YOKTUR. Ne veritabanı, ne saat, ne servis.
 * Yalnızca HTTP/tarayıcı katmanı dışarıdadır — o da E2E ile kapsanır.
 *
 * Sahte veritabanıyla sınanamayacak şeyler tam olarak burada sınanır:
 * satır kilidi, kısmi tekil index, CHECK kısıtı, transaction geri alma,
 * eşzamanlılık ve idempotency.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE audit_log, job_run, rate_limit_counter, user_interest,
                           leaderboard_entry, leaderboard_snapshot, trending_snapshot,
                           user_badge, badge, season, notification, feed_item, follow, block,
                           report, reaction, rating_history, user_category_stat, user_rating,
                           event_resolution, coin_ledger, coin_account, challenge, prediction,
                           event_outcome, event, category, "user" CASCADE`;
});

afterAll(async () => {
  await sql.end();
});

/** Ledger değişmezi: çift kayıtlı defterde tüm hareketlerin toplamı SIFIRDIR. */
async function assertLedgerBalanced() {
  const health = await jobsService.ledgerHealth();
  expect(health.total, 'ledger toplamı sıfır olmalı').toBe(0);
  expect(health.balanced).toBe(true);
}

// ═══════════════════════════════════════════════════════════════════════════
describe('23 ADIMLIK TAM DÖNGÜ', () => {
  it('kayıt → tahmin → Meydan Okuma → kabul → sonuç → çip → itibar → liderlik', async () => {
    // ── 1–4. İki kullanıcı ────────────────────────────────────────────────
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const admin = await createUser('yonetici');

    // ── 5. Başlangıç Gümüş Çipi ───────────────────────────────────────────
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);
    expect(await coinService.getBalance(mert.userId)).toBe(economy.initialGrant);
    await assertLedgerBalanced();

    // ── 6–7. Etkinlik ve sonuçları ────────────────────────────────────────
    const event = await createEvent({ adminId: admin.userId });
    expect(event.outcomes).toHaveLength(3);

    // ── 8. Emir tahmin yapar (çip harcamaz) ───────────────────────────────
    const { predictionId } = await predictionService.create({
      userId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
    });
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);

    // ── 9. Aynı tahminle Meydan Okuma açar ────────────────────────────────
    const stake = economy.stakePresets[2]!;
    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: stake,
      opponentUsername: mert.username,
    });

    // Var olan tahmin YENİDEN KULLANILDI; ikinci satır açılmadı (ADR-27).
    const emirPredictions = await db
      .select()
      .from(predictions)
      .where(eq(predictions.userId, emir.userId));
    expect(emirPredictions).toHaveLength(1);
    expect(emirPredictions[0]!.id).toBe(predictionId);

    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant - stake);
    await assertLedgerBalanced();

    // ── 10. Mert Meydan Okumayı görür ─────────────────────────────────────
    const incoming = await challengeService.listIncoming(mert.userId);
    expect(incoming.map((c) => c.id)).toContain(challengeId);
    expect(await notificationService.unreadCount(mert.userId)).toBeGreaterThan(0);

    // ── 11–12. Kabul eder; çip hareketleri gerçekleşir ────────────────────
    await acceptChallenge(challengeId, mert.userId);
    expect(await coinService.getBalance(mert.userId)).toBe(economy.initialGrant - stake);
    await assertLedgerBalanced();

    const accepted = await db.select().from(challenges).where(eq(challenges.id, challengeId));
    expect(accepted[0]!.status).toBe('ACCEPTED');
    // Karşı taraf ADR-18 uyarınca otomatik atandı ve KARŞIT sonuçtur.
    expect(accepted[0]!.opponentOutcomeId).not.toBe(accepted[0]!.creatorOutcomeId);

    // ── 13. Etkinlik kapanır (dağılım DONDURULUR) ─────────────────────────
    await catalogService.closeEvent(event.eventId);
    const closed = await db.select().from(events).where(eq(events.id, event.eventId));
    expect(closed[0]!.status).toBe('CLOSED');

    const frozen = await sql`
      SELECT consensus_share FROM event_outcome
       WHERE event_id = ${event.eventId} AND consensus_share IS NOT NULL`;
    expect(frozen.length).toBeGreaterThan(0);

    // ── 14–17. Admin sonucu girer; kazanan belirlenir ─────────────────────
    const result = await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      decision: 'RESOLVED',
      resolvedById: admin.userId,
    });

    expect(result.alreadyResolved).toBe(false);
    expect(result.predictionsResolved).toBe(2);
    expect(result.challengesSettled).toBe(1);

    const settled = await db.select().from(challenges).where(eq(challenges.id, challengeId));
    expect(settled[0]!.status).toBe('COMPLETED');
    expect(settled[0]!.settlement).toBe('WIN_LOSS');
    expect(settled[0]!.winnerUserId).toBe(emir.userId);

    // ── 18. Gümüş Çip uzlaşımı ────────────────────────────────────────────
    // Emir: −stake +2·stake = net +stake · Mert: net −stake
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant + stake);
    expect(await coinService.getBalance(mert.userId)).toBe(economy.initialGrant - stake);
    await assertLedgerBalanced();

    // ── 19. İtibar güncellendi ────────────────────────────────────────────
    const emirRating = await reputationService.getSummary(emir.userId);
    const mertRating = await reputationService.getSummary(mert.userId);

    expect(emirRating.completed).toBe(1);
    expect(emirRating.correct).toBe(1);
    expect(mertRating.completed).toBe(1);
    expect(mertRating.correct).toBe(0);

    // SÜRÜM 2 DEĞİŞMEZİ: doğru bilen yukarı, yanılan AŞAĞI gider.
    expect(emirRating.power).toBeGreaterThan(rating.coldStartPower);
    expect(mertRating.power).toBeLessThan(rating.coldStartPower);

    // ── 20. Kategori istatistiği güncellendi ve GENELDEN AYRI tutuluyor ───
    const catStats = await db
      .select()
      .from(userCategoryStats)
      .where(eq(userCategoryStats.userId, emir.userId));
    expect(catStats).toHaveLength(1);
    expect(catStats[0]!.completedPredictions).toBe(1);
    expect(catStats[0]!.correctPredictions).toBe(1);

    // ── 21. Liderlik etkilenir ────────────────────────────────────────────
    await rankingService.generateLeaderboard({ period: 'ALL_TIME' });
    const board = await rankingService.getLeaderboard({ period: 'ALL_TIME' });
    // Eşik nedeniyle liste boş olabilir; önemli olan üretimin ÇALIŞMASI ve
    // eşiğin kayıt altına alınmasıdır.
    expect(board.minPredictions).toBeGreaterThan(0);

    // ── 22. Bildirim oluşturuldu ──────────────────────────────────────────
    const emirNotifications = await notificationService.list(emir.userId);
    const bodies = emirNotifications.items.map((n) => n.body).join(' ');
    expect(bodies).toMatch(/kazandın/i);

    const mertNotifications = await notificationService.list(mert.userId);
    expect(mertNotifications.items.length).toBeGreaterThan(0);

    // ── 23. Denetim kaydı ─────────────────────────────────────────────────
    await auditService.record({
      actorId: admin.userId,
      action: 'EVENT_RESOLVED',
      targetType: 'event',
      targetId: event.eventId,
      metadata: { predictionsResolved: result.predictionsResolved },
    });

    const auditRows = await auditService.list(10, {});
    expect(auditRows[0]!.action).toBe('EVENT_RESOLVED');
    expect(auditRows[0]!.actorUsername).toBe(admin.username);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('İDEMPOTENCY — aynı işlem iki kez', () => {
  async function settledChallenge() {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const admin = await createUser('yonetici');
    const event = await createEvent({ adminId: admin.userId });
    const stake = economy.stakePresets[0]!;

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: stake,
      opponentUsername: mert.username,
    });
    await acceptChallenge(challengeId, mert.userId);

    return { emir, mert, admin, event, challengeId, stake };
  }

  it('AYNI etkinlik iki kez sonuçlandırılırsa ikinci işlem para/itibar DAĞITMAZ', async () => {
    const { emir, mert, event, admin, stake } = await settledChallenge();

    const first = await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      decision: 'RESOLVED',
      resolvedById: admin.userId,
    });
    const emirAfterFirst = await coinService.getBalance(emir.userId);
    const emirRatingAfterFirst = await reputationService.getSummary(emir.userId);

    const second = await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      decision: 'RESOLVED',
      resolvedById: admin.userId,
    });

    expect(first.alreadyResolved).toBe(false);
    expect(second.alreadyResolved).toBe(true);
    // İkinci çağrı İLK çağrının kayıtlı sayılarını döndürür — yeni iş yapmaz.
    // (Sıfır döndürmek "hiç tahmin sonuçlanmadı" gibi yanlış okunurdu.)
    expect(second.predictionsResolved).toBe(first.predictionsResolved);
    expect(second.challengesSettled).toBe(first.challengesSettled);

    // Sonuç kaydı TEK satırdır: ikinci çağrı yeni kayıt açmadı.
    const resolutionRows = await sql`SELECT count(*)::int AS n FROM event_resolution`;
    expect(resolutionRows[0]?.n).toBe(1);

    expect(await coinService.getBalance(emir.userId)).toBe(emirAfterFirst);
    expect(await coinService.getBalance(mert.userId)).toBe(economy.initialGrant - stake);

    const ratingAfterSecond = await reputationService.getSummary(emir.userId);
    expect(ratingAfterSecond.completed).toBe(emirRatingAfterFirst.completed);
    expect(ratingAfterSecond.power).toBe(emirRatingAfterFirst.power);

    await assertLedgerBalanced();
  });

  it('AYNI Meydan Okuma iki kez kabul edilemez', async () => {
    const { challengeId, mert } = await settledChallenge();
    await expect(acceptChallenge(challengeId, mert.userId)).rejects.toThrow(
      /artık geçerli değil|kabul edildi/i,
    );
  });

  it('EŞZAMANLI kabul denemesinde YALNIZCA BİRİ kazanır', async () => {
    const emir = await createUser('emir');
    const a = await createUser('acan');
    const b = await createUser('bcan');
    const event = await createEvent();

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: economy.stakePresets[0]!,
    });

    // İki istek AYNI ANDA: uygulama kontrolü ikisini de geçebilir, satır
    // kilidi ve koşullu UPDATE geçemez.
    const results = await Promise.allSettled([
      acceptChallenge(challengeId, a.userId),
      acceptChallenge(challengeId, b.userId),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    const rows = await db.select().from(challenges).where(eq(challenges.id, challengeId));
    expect(rows[0]!.status).toBe('ACCEPTED');
    expect(rows[0]!.opponentId).not.toBeNull();
    await assertLedgerBalanced();
  });

  it('VOID iki kez iade ÜRETMEZ', async () => {
    const { emir, mert, event, admin } = await settledChallenge();

    await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: null,
      decision: 'VOID',
      resolvedById: admin.userId,
    });

    // İki tarafa da iade edildi.
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);
    expect(await coinService.getBalance(mert.userId)).toBe(economy.initialGrant);

    const again = await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: null,
      decision: 'VOID',
      resolvedById: admin.userId,
    });
    expect(again.alreadyResolved).toBe(true);

    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);
    expect(await coinService.getBalance(mert.userId)).toBe(economy.initialGrant);
    await assertLedgerBalanced();
  });

  it('VOID edilen tahmin İTİBARA GİRMEZ', async () => {
    const { emir, event, admin } = await settledChallenge();

    await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: null,
      decision: 'VOID',
      resolvedById: admin.userId,
    });

    const summary = await reputationService.getSummary(emir.userId);
    expect(summary.completed).toBe(0);
    expect(summary.power).toBe(rating.coldStartPower);
  });

  it('bakım işi iki kez çalıştırılırsa ikinci çalıştırma ATLANIR ya da etkisizdir', async () => {
    const first = await jobsService.runScheduled({ jobName: 'test-maintenance' });
    expect(first.skipped).toBe(false);

    const second = await jobsService.runScheduled({ jobName: 'test-maintenance' });
    // Kilit serbest bırakıldığı için ikinci çalıştırma da yürür; ama
    // İDEMPOTENT olduğu için hiçbir yan etki üretmez.
    expect(second.report?.expiredChallenges ?? 0).toBe(0);

    const runs = await jobsService.recentRuns(10);
    expect(runs.filter((r) => r.jobName === 'test-maintenance')).toHaveLength(2);
    expect(runs.every((r) => r.status === 'SUCCEEDED')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('İADE VE İPTAL YOLLARI', () => {
  it('REDDEDİLEN Meydan Okumada çip oluşturana iade edilir', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const event = await createEvent();
    const stake = economy.stakePresets[0]!;

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: stake,
      opponentUsername: mert.username,
    });
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant - stake);

    await challengeService.decline(challengeId, mert.userId);

    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);
    expect(await coinService.getBalance(mert.userId)).toBe(economy.initialGrant);
    await assertLedgerBalanced();
  });

  it('SÜRESİ DOLAN açık Meydan Okumada çip iade edilir ve tekrarlanmaz', async () => {
    const emir = await createUser('emir');
    const event = await createEvent();
    const stake = economy.stakePresets[0]!;

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: stake,
    });

    await db.execute(
      raw`UPDATE challenge SET expires_at = now() - interval '1 hour' WHERE id = ${challengeId}`,
    );

    expect(await jobsService.expireStaleChallenges()).toBe(1);
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);

    expect(await jobsService.expireStaleChallenges()).toBe(0);
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);
    await assertLedgerBalanced();
  });

  it('İPTAL edilen Meydan Okumada çip iade edilir', async () => {
    const emir = await createUser('emir');
    const event = await createEvent();
    const stake = economy.stakePresets[0]!;

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: stake,
    });
    await challengeService.cancel(challengeId, emir.userId);

    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);
    await assertLedgerBalanced();
  });

  it('KABUL EDİLMEMİŞ Meydan Okuma etkinlik sonuçlanınca yalnızca OLUŞTURANA iade edilir', async () => {
    const emir = await createUser('emir');
    const admin = await createUser('yonetici');
    const event = await createEvent({ adminId: admin.userId });
    const stake = economy.stakePresets[0]!;

    await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: stake,
    });

    await resolutionService.resolve({
      eventId: event.eventId,
      outcomeId: event.outcomes[1]!.id,
      decision: 'RESOLVED',
      resolvedById: admin.userId,
    });

    const rows =
      await sql`SELECT status, settlement FROM challenge WHERE creator_id = ${emir.userId}`;
    expect(rows[0]?.status).toBe('EXPIRED');
    expect(rows[0]?.settlement).toBe('REFUND_CREATOR');
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);
    await assertLedgerBalanced();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('EKONOMİ DEĞİŞMEZLERİ', () => {
  it('YETERSİZ BAKİYE ile Meydan Okuma açılamaz', async () => {
    const fakir = await createUser('fakir');
    const event = await createEvent();

    await db.execute(raw`UPDATE coin_account SET balance = 3 WHERE owner_id = ${fakir.userId}`);

    await expect(
      challengeService.create({
        creatorId: fakir.userId,
        eventId: event.eventId,
        outcomeId: event.outcomes[0]!.id,
        stakeAmount: economy.stakePresets[3]!,
      }),
    ).rejects.toThrow(/yeterli|çip/i);
  });

  it('BAKİYE NEGATİFE düşemez — veritabanı kısıtı son savunmadır', async () => {
    const emir = await createUser('emir');
    await expect(
      db.execute(raw`UPDATE coin_account SET balance = -1 WHERE owner_id = ${emir.userId}`),
    ).rejects.toThrow();
  });

  it('LEDGER DEĞİŞMEZDİR — güncelleme ve silme veritabanınca reddedilir', async () => {
    const emir = await createUser('emir');
    const rows = await sql`SELECT id FROM coin_ledger WHERE owner_id = ${emir.userId} LIMIT 1`;
    const id = rows[0]?.id as string;
    expect(id).toBeTruthy();

    // Sürücüye DOĞRUDAN gidilir: Drizzle hatayı kendi tipine sardığı için
    // tetikleyicinin mesajı üst seviyede görünmez.
    await expect(sql`UPDATE coin_ledger SET amount = 1 WHERE id = ${id}`).rejects.toThrow(
      /yalnızca eklenebilir/i,
    );
    await expect(sql`DELETE FROM coin_ledger WHERE id = ${id}`).rejects.toThrow(
      /yalnızca eklenebilir/i,
    );

    // Satır olduğu gibi duruyor.
    const after = await sql`SELECT count(*)::int AS n FROM coin_ledger WHERE id = ${id}`;
    expect(after[0]?.n).toBe(1);
  });

  it('DENETİM KAYDI DEĞİŞMEZDİR', async () => {
    const admin = await createUser('yonetici');
    await auditService.record({ actorId: admin.userId, action: 'JOBS_RUN' });

    const rows = await sql`SELECT id FROM audit_log LIMIT 1`;
    const id = rows[0]?.id as string;

    await expect(
      sql`UPDATE audit_log SET action = 'EVENT_VOIDED' WHERE id = ${id}`,
    ).rejects.toThrow(/yalnızca eklenebilir/i);
    await expect(sql`DELETE FROM audit_log WHERE id = ${id}`).rejects.toThrow(
      /yalnızca eklenebilir/i,
    );
  });

  it('AYNI idempotency anahtarı ikinci kez para hareketi üretmez', async () => {
    const emir = await createUser('emir');
    const before = await coinService.getBalance(emir.userId);

    // `coinService.post` bir transaction bekler: para hareketi tek başına
    // yazılmaz, her zaman bir işin parçasıdır.
    const post = () =>
      withTransaction((tx) =>
        coinService.post(tx, {
          ownerId: emir.userId,
          amount: -10,
          type: 'CHALLENGE_STAKE',
          idempotencyKey: 'test:tekrar:1',
          referenceType: 'test',
          referenceId: 'test',
        }),
      );

    await post();
    await post();

    expect(await coinService.getBalance(emir.userId)).toBe(before - 10);
    await assertLedgerBalanced();
  });

  it('UZLAŞIM TUTARSIZ bir Meydan Okuma satırı yazılamaz', async () => {
    const emir = await createUser('emir');
    const event = await createEvent();
    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: economy.stakePresets[0]!,
    });

    // "Tamamlandı" ama uzlaşımı yok: Faz 6'da eklenen kısıt bunu reddeder.
    await expect(
      db.execute(raw`UPDATE challenge SET status = 'COMPLETED' WHERE id = ${challengeId}`),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('TRANSACTION GERİ ALMA', () => {
  it('sonuçlandırma ortasında hata olursa HİÇBİR yan etki kalmaz', async () => {
    const emir = await createUser('emir');
    const admin = await createUser('yonetici');
    const event = await createEvent({ adminId: admin.userId });

    await predictionService.create({
      userId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
    });

    // Başka bir etkinliğe ait sonuç kimliğiyle çağrı: doğrulama hata verir.
    const other = await createEvent({ adminId: admin.userId });
    await expect(
      resolutionService.resolve({
        eventId: event.eventId,
        outcomeId: other.outcomes[0]!.id,
        decision: 'RESOLVED',
        resolvedById: admin.userId,
      }),
    ).rejects.toThrow();

    // Etkinlik hâlâ açık, tahmin hâlâ sonuçsuz, itibar dokunulmamış.
    const rows = await db.select().from(events).where(eq(events.id, event.eventId));
    expect(rows[0]!.status).toBe('OPEN');

    const pred = await db
      .select()
      .from(predictions)
      .where(and(eq(predictions.userId, emir.userId), eq(predictions.eventId, event.eventId)));
    expect(pred[0]!.result).toBeNull();

    expect((await reputationService.getSummary(emir.userId)).completed).toBe(0);
    await assertLedgerBalanced();
  });
});
