import { and, desc, eq, lte, inArray, sql } from 'drizzle-orm';
import { db, withTransaction } from '@/server/db';
import { challenges, events, jobRuns } from '@/server/db/schema';
import { coinService, ledgerKeys } from '@/server/modules/economy/service';
import { catalogService } from '@/server/modules/catalog/service';
import { recurringService } from '@/server/modules/catalog/recurring.service';
import { featuredService } from '@/server/modules/catalog/featured.service';
import { fixturesService } from '@/server/modules/catalog/fixtures.service';
import { rankingService } from '@/server/modules/ranking/service';
import {
  notificationService,
  notificationKeys,
} from '@/server/modules/social/notification.service';
import { log, logEvents, newCorrelationId } from '@/server/observability/logger';
import { pruneRateLimitCounters } from '@/server/security/shared-rate-limit';
import { auditService } from './audit.service';

/**
 * İş adından deterministik bir advisory lock anahtarı üretir.
 *
 * PostgreSQL advisory lock 64-bit tamsayı ister. Basit bir FNV-1a türevi
 * kullanılıyor: kriptografik güç gerekmez, yalnızca farklı iş adlarının
 * çakışmaması yeterlidir.
 */
function advisoryKey(jobName: string): number {
  let hash = 2166136261;
  for (let i = 0; i < jobName.length; i += 1) {
    hash ^= jobName.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // 32-bit işaretli aralığa indirgenir; pg_try_advisory_lock(bigint) kabul eder.
  return hash | 0;
}

/**
 * Zamanlı bakım işleri.
 *
 * Faz 3'te bilinen açıktı: kabul edilmemiş Meydan Okumalar yalnızca etkinlik
 * sonuçlandığında iade ediliyordu. Artık süresi dolan Meydan Okuma, etkinlik
 * sonuçlanmasa bile iade edilir.
 *
 * TÜM İŞLER İDEMPOTENTTİR. Aynı iş dakikada bir çalıştırılabilir; ikinci
 * çalıştırma hiçbir yan etki üretmez. Bunu şu üç şey garanti eder:
 *   1. Koşullu UPDATE (yalnızca beklenen durumdaki satır güncellenir),
 *   2. Ledger idempotency key (aynı iade iki kez yazılamaz),
 *   3. Bildirim dedupeKey (aynı bildirim iki kez düşmez).
 *
 * Bu dosya HTTP bilmez; hem CLI (`npm run jobs`) hem de ileride bir zamanlayıcı
 * aynı fonksiyonları çağırır.
 */

export type JobReport = {
  readonly expiredChallenges: number;
  readonly closedEvents: number;
  readonly generatedEvents: number;
  readonly skippedEvents: number;
  /** Silinen süresi dolmuş oran sınırlama sayacı. */
  readonly prunedCounters: number;
  /** Bugüne Günün Meydanı seçildi mi (zaten varsa false). */
  readonly featuredSelected: boolean;
  /** Fikstürden açılan maç etkinliği (FOOTBALL_DATA_TOKEN yoksa 0). */
  readonly importedFixtures: number;
  /** Skoru gelip kendiliğinden sonuçlanan maç. */
  readonly resolvedFixtures: number;
};

export const jobsService = {
  /**
   * Süresi dolmuş, kimsenin kabul etmediği Meydan Okumaları kapatır ve
   * oluşturanın çipini iade eder.
   */
  async expireStaleChallenges(now: Date = new Date()): Promise<number> {
    const stale = await db
      .select({
        id: challenges.id,
        creatorId: challenges.creatorId,
        stakeAmount: challenges.stakeAmount,
        eventTitle: events.title,
      })
      .from(challenges)
      .innerJoin(events, eq(events.id, challenges.eventId))
      .where(and(eq(challenges.status, 'PENDING'), lte(challenges.expiresAt, now)))
      .limit(500);

    let expired = 0;

    for (const challenge of stale) {
      await withTransaction(async (tx) => {
        // Koşullu UPDATE: satır bu arada kabul edildiyse hiçbir şey olmaz.
        const updated = await tx
          .update(challenges)
          .set({
            status: 'EXPIRED',
            settlement: 'REFUND_CREATOR',
            settledAt: now,
            completedAt: now,
          })
          .where(and(eq(challenges.id, challenge.id), eq(challenges.status, 'PENDING')))
          .returning({ id: challenges.id });

        if (updated.length === 0) return;

        await coinService.post(tx, {
          ownerId: challenge.creatorId,
          amount: challenge.stakeAmount,
          type: 'CHALLENGE_REFUND',
          idempotencyKey: ledgerKeys.challengeRefund(challenge.id, challenge.creatorId),
          referenceType: 'challenge',
          referenceId: challenge.id,
        });

        await notificationService.create(tx, {
          userId: challenge.creatorId,
          type: 'CHALLENGE_EXPIRED',
          body: `"${challenge.eventTitle}" için kimse Meydan Okumanı kabul etmedi. ${challenge.stakeAmount} Gümüş Çipin iade edildi.`,
          href: `/app/challenges/${challenge.id}`,
          dedupeKey: notificationKeys.challengeExpired(challenge.id),
        });

        expired += 1;
      });

      /*
       * DENETİM KAYDI — sistem kaynaklı PARA HAREKETİ.
       *
       * Kullanıcının başlattığı Meydan Okuma/kabul işlemleri denetim kaydına
       * ayrıca YAZILMAZ: bunların kim-ne-zaman bilgisi zaten `challenge` ve
       * (Faz 6'dan beri veritabanınca değişmez olan) `coin_ledger` içindedir;
       * ikinci bir kopya hesap verebilirlik eklemez, yalnızca maliyet ekler.
       *
       * Buradaki iade ise İNSAN AKTÖRÜ OLMAYAN bir para hareketidir. "Bu çip
       * neden geri geldi?" sorusunun yanıtı, sistemin kendi kararıdır ve o
       * karar kayıt altında olmalıdır.
       */
      await auditService.record({
        actorId: null,
        action: 'CHALLENGE_REFUNDED',
        targetType: 'challenge',
        targetId: challenge.id,
        metadata: { reason: 'expired', amount: challenge.stakeAmount },
      });
    }

    return expired;
  },

  /** Kapanış saati geçmiş etkinliklerde tahminleri kapatır (dağılımı dondurur). */
  async closeDueEvents(now: Date = new Date()): Promise<number> {
    const due = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.status, 'OPEN'), lte(events.closesAt, now)))
      .limit(200);

    for (const event of due) {
      await catalogService.closeEvent(event.id);
    }
    return due.length;
  },

  /** Tüm bakım işlerini sırayla çalıştırır — KİLİTSİZ, iç kullanım. */
  async runAll(now: Date = new Date()): Promise<JobReport> {
    const expiredChallenges = await jobsService.expireStaleChallenges(now);
    const closedEvents = await jobsService.closeDueEvents(now);
    const generation = await recurringService.generate(now);

    await rankingService.generateTrending();

    // Süresi dolmuş oran sınırlama sayaçları temizlenir; tablo aksi hâlde
    // süresiz büyür ve geçmiş sayaçlar hiçbir işe yaramaz.
    const prunedCounters = await pruneRateLimitCounters(now);

    // Fikstür işi EN SONA konur ve kendi hatasını yutar: dış bir servisin
    // erişilemez olması, iade ve kapanış gibi kritik işleri geriye almamalı.
    // Onlar bu satıra gelindiğinde çoktan tamamlanmıştır.
    let importedFixtures = 0;
    let resolvedFixtures = 0;
    try {
      const fixtures = await fixturesService.run();
      importedFixtures = fixtures.imported;
      resolvedFixtures = fixtures.resolved;
    } catch (error) {
      log.error(logEvents.jobFailed, { job: 'fixtures', error });
    }

    /*
     * GÜNÜN MEYDANI — fikstür içe aktarmadan SONRA seçilir.
     *
     * Sıra önemli: yeni maçlar akışa girmeden seçim yapılsaydı, sabahın ilk
     * koşusunda aday havuzu dünkü etkinliklerden ibaret olurdu ve o günün
     * Meydanı hep bayat içerikten seçilirdi.
     *
     * Hata yutulur: Günün Meydanı seçilememesi, iade ve kapanış gibi kritik
     * işlerin sonucunu geçersiz kılmamalı.
     */
    let featuredSelected = false;
    try {
      featuredSelected = (await featuredService.ensureDaily(now)) !== null;
    } catch (error) {
      log.error(logEvents.jobFailed, { job: 'featured', error });
    }

    return {
      expiredChallenges,
      closedEvents,
      generatedEvents: generation.created,
      skippedEvents: generation.skipped,
      prunedCounters,
      featuredSelected,
      importedFixtures,
      resolvedFixtures,
    };
  },

  /**
   * ÜRETİM GİRİŞİ — kilitli, kayıtlı, gözlemlenebilir çalıştırma (Faz 6).
   *
   * ÇİFT ÇALIŞTIRMA KORUMASI: PostgreSQL **advisory lock**. Zamanlayıcı iki kez
   * tetiklerse ya da iki instance aynı anda uyanırsa yalnızca biri kilidi alır,
   * diğeri `skipped: true` ile hemen döner. Bu koruma için ek altyapı (Redis,
   * kuyruk) GEREKMEZ — kilit zaten sahip olduğumuz veritabanındadır ve
   * bağlantı düşerse otomatik serbest kalır, yani "ölü kilit" bırakmaz.
   *
   * NOT: işlerin kendisi ZATEN idempotenttir (koşullu UPDATE + ledger
   * idempotency anahtarı + bildirim dedupeKey). Kilit doğruluk için değil,
   * boş yere iki kez çalışıp günlüğü ve veritabanını meşgul etmemek içindir.
   *
   * Her çalıştırma `job_run` tablosuna yazılır: en son ne zaman çalıştığı ve
   * sonucunun ne olduğu yönetim ekranından görülebilir. Hata YUTULMAZ; kayda
   * geçer ve yukarı fırlatılır ki zamanlayıcı da başarısızlığı görsün.
   */
  async runScheduled(
    options: { readonly jobName?: string; readonly correlationId?: string } = {},
  ): Promise<{
    readonly skipped: boolean;
    readonly report: JobReport | null;
    readonly runId: string | null;
  }> {
    const jobName = options.jobName ?? 'maintenance';
    const correlationId = options.correlationId ?? newCorrelationId();
    const startedAt = Date.now();

    // Kilit anahtarı iş adından türetilir: farklı işler birbirini bloklamaz.
    const lockKey = advisoryKey(jobName);
    const lockRows = await db.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_lock(${lockKey}) AS locked`,
    );

    if (!lockRows[0]?.locked) {
      log.warn(logEvents.jobSkipped, { job: jobName, correlationId, reason: 'lock_busy' });
      return { skipped: true, report: null, runId: null };
    }

    const inserted = await db
      .insert(jobRuns)
      .values({ jobName, status: 'RUNNING', correlationId })
      .returning({ id: jobRuns.id });
    const runId = inserted[0]?.id ?? null;

    try {
      const report = await jobsService.runAll();
      const durationMs = Date.now() - startedAt;

      if (runId) {
        await db
          .update(jobRuns)
          .set({
            status: 'SUCCEEDED',
            finishedAt: new Date(),
            durationMs,
            report: { ...report },
          })
          .where(eq(jobRuns.id, runId));
      }

      log.info(logEvents.jobSucceeded, { job: jobName, correlationId, durationMs, ...report });
      return { skipped: false, report, runId };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : 'bilinmeyen hata';

      if (runId) {
        await db
          .update(jobRuns)
          .set({
            status: 'FAILED',
            finishedAt: new Date(),
            durationMs,
            error: message.slice(0, 500),
          })
          .where(eq(jobRuns.id, runId));
      }

      log.error(logEvents.jobFailed, { job: jobName, correlationId, durationMs, error });
      throw error;
    } finally {
      // Kilit HER durumda bırakılır; bağlantı düşse bile PostgreSQL kendisi
      // serbest bırakır, ama açıkça bırakmak beklemeyi kısaltır.
      await db.execute(sql`SELECT pg_advisory_unlock(${lockKey})`);
    }
  },

  /** Yönetim ekranı: son çalıştırmalar. */
  async recentRuns(limit = 20) {
    return db
      .select({
        id: jobRuns.id,
        jobName: jobRuns.jobName,
        status: jobRuns.status,
        startedAt: jobRuns.startedAt,
        finishedAt: jobRuns.finishedAt,
        durationMs: jobRuns.durationMs,
        report: jobRuns.report,
        error: jobRuns.error,
      })
      .from(jobRuns)
      .orderBy(desc(jobRuns.startedAt))
      .limit(limit);
  },

  /**
   * Zamanlayıcı sağlığı: son başarılı çalıştırmadan bu yana geçen dakika.
   *
   * Hiç çalışmamışsa `null` döner. Yönetim ekranı bu değeri eşikle
   * karşılaştırıp "zamanlayıcı durmuş olabilir" uyarısı gösterir — sessiz
   * ölüm en tehlikeli arıza türüdür.
   */
  async minutesSinceLastSuccess(jobName = 'maintenance'): Promise<number | null> {
    const rows = await db
      .select({ finishedAt: jobRuns.finishedAt })
      .from(jobRuns)
      .where(and(eq(jobRuns.jobName, jobName), eq(jobRuns.status, 'SUCCEEDED')))
      .orderBy(desc(jobRuns.finishedAt))
      .limit(1);

    const last = rows[0]?.finishedAt;
    if (!last) return null;
    return Math.floor((Date.now() - last.getTime()) / 60_000);
  },

  /** Yönetim ekranı: ledger toplamı sıfır mı? */
  async ledgerHealth() {
    const rows = await db.execute<{ total: string | null; entries: string }>(
      sql`SELECT COALESCE(SUM(amount), 0)::text AS total, COUNT(*)::text AS entries FROM coin_ledger`,
    );
    const row = rows[0];
    return {
      total: Number(row?.total ?? 0),
      entries: Number(row?.entries ?? 0),
      balanced: Number(row?.total ?? 0) === 0,
    };
  },

  /**
   * Yönetim ekranı: sonuçlandırılmayı bekleyen etkinlik sayısı.
   *
   * PERFORMANS: satırlar çekilip `length` alınmıyor; sayım veritabanında
   * yapılıyor. Yüz binlerce satırda ikisi arasındaki fark ölçülebilir olur.
   */
  async pendingResolutionCount(): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(events)
      .where(inArray(events.status, ['OPEN', 'CLOSED']));
    return rows[0]?.n ?? 0;
  },
};
