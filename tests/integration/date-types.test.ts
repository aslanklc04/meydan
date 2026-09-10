import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrateTestDatabase } from './setup';
import { catalogService } from '../../src/server/modules/catalog/service';
import { gazetteService } from '../../src/server/modules/gazette/service';
import { resolutionService } from '../../src/server/modules/resolution/service';
import { predictionService } from '../../src/server/modules/prediction/service';
import { createEvent, createUser, forceCloseDeadline } from '../factories';
import { timeAgo, timeRemaining } from '../../src/features/predictions/labels';

/**
 * EKRANA ÇIKAN TARİHLER GERÇEKTEN `Date` MİDİR?
 *
 * ── BU TESTİN VAR OLMA SEBEBİ ──────────────────────────────────────────────
 * Canlıda ana sayfa TAMAMEN açılmaz oldu. Sebep şuydu: hesaplanmış bir SQL
 * sütunu (`coalesce(resolved_at, updated_at)`) sürücünün tarih
 * dönüştürücüsünden geçmez ve geriye `Date` değil METİN döner. Kodda tür
 * `sql<Date>` yazıyordu — yani derleyiciye söylenmiş bir yalan. TypeScript
 * inandı, testler geçti, ürün açılmadı.
 *
 * Tür denetimi burada hiçbir şey yakalayamaz: yalan, denetimin kendisine
 * söylenmiştir. Yakalayabilecek tek şey, DEĞERİ ÇALIŞMA ANINDA görmektir.
 *
 * Bu yüzden aşağıdaki testler yalnızca "alan dolu mu"ya bakmaz; alanın
 * gerçekten `Date` olduğunu ve ekranda kullanılan biçimlendiricinin
 * patlamadığını sınar.
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

describe('sonuç tahtası tarihleri', () => {
  it('`resolvedAt` gerçekten Date ve biçimlendirici PATLAMIYOR', async () => {
    const admin = await createUser('yonetici');
    const e = await createEvent();
    await forceCloseDeadline(e.eventId);
    await resolutionService.resolve({
      eventId: e.eventId,
      outcomeId: e.outcomes[0]!.id,
      decision: 'RESOLVED',
      resolvedById: admin.userId,
    });

    const row = (await catalogService.resultsBoard())[0]!;
    expect(row.resolvedAt).toBeInstanceOf(Date);
    // Ekranın yaptığı çağrının aynısı: canlıda tam burada patlamıştı.
    expect(() => timeAgo(row.resolvedAt!)).not.toThrow();
    expect(timeAgo(row.resolvedAt!)).not.toBe('');
  });

  it('İPTALDE de Date döner', async () => {
    const admin = await createUser('yonetici');
    const e = await createEvent();
    await forceCloseDeadline(e.eventId);
    await resolutionService.resolve({
      eventId: e.eventId,
      outcomeId: null,
      decision: 'VOID',
      resolvedById: admin.userId,
    });

    const row = (await catalogService.resultsBoard())[0]!;
    expect(row.resolvedAt).toBeInstanceOf(Date);
  });
});

describe('gazete rafı tarihleri', () => {
  it('`nextResolvesAt` Date ve biçimlendirici patlamıyor', async () => {
    /*
     * Raf sorgusu da ham SQL. Orada dönüşüm zaten yapılmıştı; bu test onun
     * sessizce kaybolmamasını sağlar — aynı hata iki modülde iki kez
     * yapıldığına göre üçüncüsü de mümkündür.
     */
    const kisi = await createUser('kisi');
    const e = await createEvent();
    const { predictionId } = await predictionService.create({
      userId: kisi.userId,
      eventId: e.eventId,
      outcomeId: e.outcomes[0]!.id,
    });
    await gazetteService.create({
      ownerId: kisi.userId,
      title: 'Bu hafta üç iddia',
      predictionIds: [predictionId],
      isPublic: true,
    });

    const rows = await gazetteService.shelfResolvingToday();
    for (const r of rows) {
      if (r.nextResolvesAt !== null) {
        expect(r.nextResolvesAt).toBeInstanceOf(Date);
        expect(() => timeRemaining(r.nextResolvesAt!)).not.toThrow();
      }
    }
  });
});

describe('biçimlendiriciler sayfayı düşürmez', () => {
  it('metin verilse bile patlamaz', () => {
    expect(() => timeAgo('2026-09-10 18:35:57.808+00')).not.toThrow();
    expect(() => timeRemaining('2026-09-10 18:35:57.808+00')).not.toThrow();
  });

  it('geçersiz değerde boş döner — beyaz ekran yerine eksik satır', () => {
    expect(timeAgo('bozuk')).toBe('');
    expect(timeRemaining('bozuk')).toBe('');
  });
});
