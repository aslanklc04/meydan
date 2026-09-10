import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { events } from '../../src/server/db/schema';
import { catalogService } from '../../src/server/modules/catalog/service';
import { predictionService } from '../../src/server/modules/prediction/service';
import { resolutionService } from '../../src/server/modules/resolution/service';
import { createEvent, createUser, forceCloseDeadline } from '../factories';

/**
 * SONUÇ TAHTASI — herkese açık sonuç listesi.
 *
 * Buradaki testlerin koruduğu şey bir sayı değil, bir SÖZ: "sonucu
 * göreceksin". Sonuçlar hesaplanıyordu ama kimsenin görebileceği bir yerde
 * durmuyordu; bu testler o yerin var olmaya devam etmesini sağlar.
 *
 * En kritik iki kural:
 *   • Pencere dışındaki sonuç listede DURMAZ (arşiv değil, "bu hafta").
 *   • İptal edilen etkinlikte "0 kişi bildi" DENMEZ; sayılmadığı söylenir.
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

/** Sonuç anını geriye iter — pencere sınırını sınamak için. */
async function ageResolution(eventId: string, hoursAgo: number) {
  await db
    .update(events)
    .set({ resolvedAt: new Date(Date.now() - hoursAgo * 3600_000) })
    .where(eq(events.id, eventId));
}

async function resolveWith(
  eventId: string,
  outcomeId: string | null,
  adminId: string,
  decision: 'RESOLVED' | 'VOID' = 'RESOLVED',
) {
  await forceCloseDeadline(eventId);
  await resolutionService.resolve({ eventId, outcomeId, decision, resolvedById: adminId });
}

describe('sonuç tahtası', () => {
  it('boş sistemde boş liste döner — uydurma satır yok', async () => {
    expect(await catalogService.resultsBoard()).toHaveLength(0);
  });

  it('sonuçlanan etkinlik listeye düşer ve KAZANAN sonucu taşır', async () => {
    const admin = await createUser('yonetici');
    const e = await createEvent();
    await resolveWith(e.eventId, e.outcomes[0]!.id, admin.userId);

    const rows = await catalogService.resultsBoard();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(e.eventId);
    expect(rows[0]!.winnerLabel).toBe(e.outcomes[0]!.label);
    expect(rows[0]!.voided).toBe(false);
  });

  it('AÇIK etkinlik listeye GİRMEZ', async () => {
    await createEvent();
    expect(await catalogService.resultsBoard()).toHaveLength(0);
  });

  it('pencerenin DIŞINDA kalan sonuç listede durmaz', async () => {
    /*
     * Sonsuz arşiv, ürünün canlı olduğunu değil eskidiğini gösterir. Sekiz
     * gün önceki maç "bu hafta ne oldu" sorusunun cevabı değildir.
     */
    const admin = await createUser('yonetici');
    const e = await createEvent();
    await resolveWith(e.eventId, e.outcomes[0]!.id, admin.userId);
    await ageResolution(e.eventId, 8 * 24);

    expect(await catalogService.resultsBoard(7)).toHaveLength(0);
    // Aynı kayıt, pencere genişletilince yine oradadır: silinmiyor, gizleniyor.
    expect(await catalogService.resultsBoard(30)).toHaveLength(1);
  });

  it('en yeni sonuç en üstte durur', async () => {
    const admin = await createUser('yonetici');
    const eski = await createEvent();
    const yeni = await createEvent();
    await resolveWith(eski.eventId, eski.outcomes[0]!.id, admin.userId);
    await resolveWith(yeni.eventId, yeni.outcomes[0]!.id, admin.userId);
    await ageResolution(eski.eventId, 100);

    const rows = await catalogService.resultsBoard();
    expect(rows[0]!.id).toBe(yeni.eventId);
    expect(rows[1]!.id).toBe(eski.eventId);
  });

  it('doğru bilenlerin SAYISINI verir, kimliklerini değil', async () => {
    /*
     * Herkese açık bir listede "kim bildi" yazmak, tahmini bir performans
     * gösterisine çevirir ve bilemeyenleri de aynı listede teşhir eder.
     * Dışarı çıkan tek şey sayıdır.
     */
    const admin = await createUser('yonetici');
    const bilen = await createUser('bilen');
    const bilmeyen = await createUser('bilmeyen');
    const e = await createEvent();

    await predictionService.create({
      userId: bilen.userId,
      eventId: e.eventId,
      outcomeId: e.outcomes[0]!.id,
    });
    await predictionService.create({
      userId: bilmeyen.userId,
      eventId: e.eventId,
      outcomeId: e.outcomes[1]!.id,
    });
    await resolveWith(e.eventId, e.outcomes[0]!.id, admin.userId);

    const row = (await catalogService.resultsBoard())[0]!;
    expect(row.predictionCount).toBe(2);
    expect(row.correctCount).toBe(1);
    expect(JSON.stringify(row)).not.toContain(bilen.username);
    expect(JSON.stringify(row)).not.toContain(bilen.userId);
  });

  it('İPTALDE "kimse bilemedi" değil "sayılmadı" bilgisi döner', async () => {
    /*
     * `correctCount` sıfıra düşürülseydi ekran "0 kişi bildi" derdi ve bu,
     * kimsenin hatası olmayan bir şeyi kullanıcıların başarısızlığı gibi
     * gösterirdi. Sıfır bir ölçümdür; null ölçüm olmadığını söyler.
     */
    const admin = await createUser('yonetici');
    const kisi = await createUser('kisi');
    const e = await createEvent();
    await predictionService.create({
      userId: kisi.userId,
      eventId: e.eventId,
      outcomeId: e.outcomes[0]!.id,
    });
    await resolveWith(e.eventId, null, admin.userId, 'VOID');

    const row = (await catalogService.resultsBoard())[0]!;
    expect(row.voided).toBe(true);
    expect(row.correctCount).toBeNull();
    expect(row.winnerLabel).toBeNull();
  });

  it('İPTAL edilen etkinlik listeden DÜŞMEZ', async () => {
    /*
     * İptalde `resolved_at` boş kalır. Liste yalnızca o alana baksaydı
     * iptaller hiç görünmezdi — yani kullanıcının en çok merak ettiği satır,
     * "maçım ne oldu?" sorusunun cevabı, sessizce yok olurdu.
     */
    const admin = await createUser('yonetici');
    const e = await createEvent();
    await resolveWith(e.eventId, null, admin.userId, 'VOID');

    const rows = await catalogService.resultsBoard();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.resolvedAt).not.toBeNull();
  });

  it('sınır sayısına uyar', async () => {
    const admin = await createUser('yonetici');
    for (let i = 0; i < 3; i += 1) {
      const e = await createEvent();
      await resolveWith(e.eventId, e.outcomes[0]!.id, admin.userId);
    }
    expect(await catalogService.resultsBoard(7, 2)).toHaveLength(2);
  });
});
