import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql as dsql } from 'drizzle-orm';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { events, predictions } from '../../src/server/db/schema';
import { funnelService } from '../../src/server/modules/governance/funnel.service';
import { predictionService } from '../../src/server/modules/prediction/service';
import { createEvent, createUser, forceCloseDeadline } from '../factories';
import { resolutionService } from '../../src/server/modules/resolution/service';

/**
 * ÖLÇÜM HUNİSİ.
 *
 * Buradaki testlerin çoğu bir sayıyı değil, bir PAYDAYI korur. Yanlış payda,
 * yanlış sayıdan tehlikelidir: oranı sistematik olarak bozar ve kimse fark
 * etmez. En sık yapılan hata, penceresi HENÜZ DOLMAMIŞ kullanıcıyı paydaya
 * koymaktır — yaşanmamış bir şeyi "olmadı" diye saymak.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE prediction_share, gazette_item, gazette, notification, feed_item,
                           coin_ledger, coin_account, challenge, prediction, event_outcome,
                           event, category, "user" CASCADE`;
});

afterAll(async () => {
  await sql.end();
});

/** Tahminin yaşını geriye iter — pencere sınırlarını sınamak için. */
async function agePrediction(predictionId: string, hoursAgo: number) {
  await db
    .update(predictions)
    .set({ createdAt: new Date(Date.now() - hoursAgo * 3600_000) })
    .where(eq(predictions.id, predictionId));
}

describe('temel sayımlar', () => {
  it('boş sistemde her şey sıfır ve HİÇBİR ORAN uydurulmaz', async () => {
    const s = await funnelService.snapshot();
    expect(s.users).toBe(0);
    expect(s.predictions).toBe(0);
    // Payda sıfır: "0%" değil, ölçülemez.
    expect(s.y7.eligible).toBe(0);
    expect(s.resultCycle.eligible).toBe(0);
  });

  it('kullanıcı ve tahmin sayılarını doğru okur', async () => {
    const a = await createUser('emir');
    await createUser('mert');
    const e = await createEvent();
    await predictionService.create({
      userId: a.userId,
      eventId: e.eventId,
      outcomeId: e.outcomes[0]!.id,
    });

    const s = await funnelService.snapshot();
    expect(s.users).toBe(2);
    expect(s.predictors).toBe(1);
    expect(s.predictions).toBe(1);
  });
});

describe('Y7 penceresi', () => {
  it('penceresi DOLMAMIŞ kullanıcı PAYDAYA GİRMEZ', async () => {
    /*
     * En sık yapılan ölçüm hatası bu. Dün kaydolan biri paydaya konursa
     * "dönmedi" sayılır; oysa dönmesi için daha altı günü vardır. Oran
     * sistematik olarak düşük çıkar ve ürün olduğundan kötü görünür.
     */
    const a = await createUser('emir');
    const e = await createEvent();
    await predictionService.create({
      userId: a.userId,
      eventId: e.eventId,
      outcomeId: e.outcomes[0]!.id,
    });

    const s = await funnelService.snapshot();
    expect(s.y7.eligible).toBe(0);
    expect(s.y7.hit).toBe(0);
  });

  it('penceresi DOLMUŞ ama dönmemiş kullanıcı paydaya girer, paya girmez', async () => {
    const a = await createUser('emir');
    const e = await createEvent();
    const { predictionId } = await predictionService.create({
      userId: a.userId,
      eventId: e.eventId,
      outcomeId: e.outcomes[0]!.id,
    });
    await agePrediction(predictionId, 200); // 192 saati geçti

    const s = await funnelService.snapshot();
    expect(s.y7.eligible).toBe(1);
    expect(s.y7.hit).toBe(0);
  });

  it('24 saatten ÖNCE yapılan ikinci tahmin Y7 SAYILMAZ', async () => {
    /*
     * Alt sınır bilinçli: aynı oturumda arka arkaya yapılan tahminler
     * "geri döndü" demek değildir. Ölçmek istediğimiz şey AYRILIP GERİ
     * GELMEK; ilk oturumun uzunluğu değil.
     */
    const a = await createUser('emir');
    const e1 = await createEvent();
    const e2 = await createEvent();

    const first = await predictionService.create({
      userId: a.userId,
      eventId: e1.eventId,
      outcomeId: e1.outcomes[0]!.id,
    });
    const second = await predictionService.create({
      userId: a.userId,
      eventId: e2.eventId,
      outcomeId: e2.outcomes[0]!.id,
    });

    await agePrediction(first.predictionId, 200);
    await agePrediction(second.predictionId, 199); // ilkten 1 saat sonra

    const s = await funnelService.snapshot();
    expect(s.y7.eligible).toBe(1);
    expect(s.y7.hit).toBe(0);
  });

  it('pencere İÇİNDE dönen kullanıcı sayılır', async () => {
    const a = await createUser('emir');
    const e1 = await createEvent();
    const e2 = await createEvent();

    const first = await predictionService.create({
      userId: a.userId,
      eventId: e1.eventId,
      outcomeId: e1.outcomes[0]!.id,
    });
    const second = await predictionService.create({
      userId: a.userId,
      eventId: e2.eventId,
      outcomeId: e2.outcomes[0]!.id,
    });

    await agePrediction(first.predictionId, 200);
    await agePrediction(second.predictionId, 150); // ilkten 50 saat sonra

    const s = await funnelService.snapshot();
    expect(s.y7.eligible).toBe(1);
    expect(s.y7.hit).toBe(1);
  });
});

describe('sonuç döngüsü', () => {
  it('sonucun üstünden 72 saat GEÇMEDİYSE kişi paydaya girmez', async () => {
    // Sonuç dün geldiyse kişinin daha üç günü var; onu "dönmedi" saymak
    // yaşanmamış bir şeyi ölçmektir.
    const a = await createUser('emir');
    const e = await createEvent();
    await predictionService.create({
      userId: a.userId,
      eventId: e.eventId,
      outcomeId: e.outcomes[0]!.id,
    });
    await forceCloseDeadline(e.eventId);
    await resolutionService.resolve({
      eventId: e.eventId,
      outcomeId: e.outcomes[0]!.id,
      decision: 'RESOLVED',
      resolvedById: a.userId,
    });

    const s = await funnelService.snapshot();
    expect(s.resultCycle.eligible).toBe(0);
  });

  it('72 saat geçmiş ve DÖNMEMİŞ kişi paydada, payda değil', async () => {
    const a = await createUser('emir');
    const e = await createEvent();
    await predictionService.create({
      userId: a.userId,
      eventId: e.eventId,
      outcomeId: e.outcomes[0]!.id,
    });
    await forceCloseDeadline(e.eventId);
    await resolutionService.resolve({
      eventId: e.eventId,
      outcomeId: e.outcomes[0]!.id,
      decision: 'RESOLVED',
      resolvedById: a.userId,
    });
    // Sonucu geriye it.
    await db
      .update(events)
      .set({ resolvedAt: new Date(Date.now() - 100 * 3600_000) })
      .where(eq(events.id, e.eventId));

    const s = await funnelService.snapshot();
    expect(s.resultCycle.eligible).toBe(1);
    expect(s.resultCycle.hit).toBe(0);
  });

  it('sonuçtan SONRA yeni tahmin yapan kişi sayılır', async () => {
    const a = await createUser('emir');
    const e1 = await createEvent();
    const e2 = await createEvent();

    await predictionService.create({
      userId: a.userId,
      eventId: e1.eventId,
      outcomeId: e1.outcomes[0]!.id,
    });
    await forceCloseDeadline(e1.eventId);
    await resolutionService.resolve({
      eventId: e1.eventId,
      outcomeId: e1.outcomes[0]!.id,
      decision: 'RESOLVED',
      resolvedById: a.userId,
    });
    await db
      .update(events)
      .set({ resolvedAt: new Date(Date.now() - 100 * 3600_000) })
      .where(eq(events.id, e1.eventId));

    // Sonuçtan 10 saat sonra yeni tahmin.
    const second = await predictionService.create({
      userId: a.userId,
      eventId: e2.eventId,
      outcomeId: e2.outcomes[0]!.id,
    });
    await agePrediction(second.predictionId, 90);

    const s = await funnelService.snapshot();
    expect(s.resultCycle.eligible).toBe(1);
    expect(s.resultCycle.hit).toBe(1);
  });
});

describe('huni ayrı bir izleme tablosu KULLANMAZ', () => {
  it('sistemde olay akışı tablosu yok', async () => {
    /*
     * Her tıklamayı yazan bir tablo hızla en büyük tablo olur, korunması
     * gereken yeni kişisel veri üretir ve gerçek tablolarla er ya da geç
     * çelişir. Huni türetilir, biriktirilmez.
     */
    const rows = (await db.execute(dsql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND (table_name LIKE '%analytics%' OR table_name LIKE '%tracking%'
             OR table_name LIKE '%pageview%')
    `)) as unknown as { table_name: string }[];
    expect(rows).toHaveLength(0);
  });
});
