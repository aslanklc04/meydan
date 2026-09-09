import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { events, users } from '../../src/server/db/schema';
import { featuredService } from '../../src/server/modules/catalog/featured.service';
import { catalogService } from '../../src/server/modules/catalog/service';
import { createUser } from '../factories';
import { productDay } from '../../src/config/time';

/**
 * GÜNÜN MEYDANI.
 *
 * En kritik iki güvence: günde YALNIZCA BİR tane olması ve seçimin
 * DETERMİNİSTİK olması. Birincisi olmadan ana sayfa hangisini göstereceğini
 * bilemez; ikincisi olmadan "bu soru neden seçildi" sorusuna cevap verilemez.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE notification, feed_item, coin_ledger, coin_account, challenge,
                           prediction, event_outcome, event, category, "user" CASCADE`;
  await sql`INSERT INTO category (id, slug, name, icon, kind, sort_order)
            VALUES ('cat-spor', 'spor', 'Spor', '⚽', 'GENERAL', 0),
                   ('cat-dunya', 'dunya', 'Dünya', '🌍', 'GENERAL', 1)`;
});

afterAll(async () => {
  await sql.end();
});

async function admin(): Promise<string> {
  const { userId } = await createUser('kurucu');
  await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, userId));
  return userId;
}

/** `hours` saat sonra kapanan bir etkinlik üretir. */
async function makeEvent(
  slug: string,
  hours: number,
  categorySlug = 'spor',
  ownerId?: string,
): Promise<string> {
  const owner = ownerId ?? (await admin());
  const closesAt = new Date(Date.now() + hours * 3600_000);
  const { eventId } = await catalogService.createEvent({
    categorySlug,
    title: `Etkinlik ${slug}`,
    question: 'Ne olacak?',
    slug,
    closesAt,
    resolvesAt: new Date(closesAt.getTime() + 3600_000),
    outcomes: [
      { key: 'YES', label: 'Evet' },
      { key: 'NO', label: 'Hayır' },
    ],
    createdById: owner,
    status: 'OPEN',
  });
  return eventId;
}

describe('otomatik seçim', () => {
  it('uygun aday varsa GÜNÜN MEYDANI seçer', async () => {
    const owner = await admin();
    await makeEvent('mac-yarin', 24, 'spor', owner);

    const chosen = await featuredService.ensureDaily();
    expect(chosen).not.toBeNull();

    const today = await featuredService.today();
    expect(today?.slug).toBe('mac-yarin');
  });

  it('İDEMPOTENT: ikinci çalıştırma yeni seçim YAPMAZ', async () => {
    const owner = await admin();
    await makeEvent('mac-a', 24, 'spor', owner);
    await makeEvent('mac-b', 30, 'spor', owner);

    expect(await featuredService.ensureDaily()).not.toBeNull();
    // Bakım işi saatte bir çalışıyor; her koşuda Meydan değişseydi
    // kullanıcı sabah baktığı soruyu öğlen bulamazdı.
    expect(await featuredService.ensureDaily()).toBeNull();

    const rows = await db.select().from(events).where(eq(events.featuredType, 'DAILY_PRIMARY'));
    expect(rows).toHaveLength(1);
  });

  it('SPOR öncelikli seçer', async () => {
    const owner = await admin();
    // Dünya etkinliği daha yakında kapanıyor ama spor önceliklidir.
    await makeEvent('dunya-olay', 5, 'dunya', owner);
    await makeEvent('mac-olay', 30, 'spor', owner);

    await featuredService.ensureDaily();
    expect((await featuredService.today())?.slug).toBe('mac-olay');
  });

  it('aynı kategoride EN YAKINDA kapanan seçilir', async () => {
    const owner = await admin();
    await makeEvent('mac-uzak', 60, 'spor', owner);
    await makeEvent('mac-yakin', 10, 'spor', owner);

    await featuredService.ensureDaily();
    expect((await featuredService.today())?.slug).toBe('mac-yakin');
  });

  it('ÇOK YAKINDA kapanan seçilmez — kimse yetişemez', async () => {
    const owner = await admin();
    // 1 saat sonra kapanıyor: gün içinde görecek çoğu kişi kaçırır.
    await makeEvent('mac-birazdan', 1, 'spor', owner);

    expect(await featuredService.ensureDaily()).toBeNull();
    expect(await featuredService.today()).toBeNull();
  });

  it('ÇOK UZAKTA kapanan seçilmez — geri bildirim döngüsü uzar', async () => {
    const owner = await admin();
    await makeEvent('mac-gelecek-ay', 24 * 30, 'spor', owner);

    expect(await featuredService.ensureDaily()).toBeNull();
  });

  it('DAHA ÖNCE öne çıkmış etkinlik tekrar seçilmez', async () => {
    const owner = await admin();
    const id = await makeEvent('mac-dun', 24, 'spor', owner);

    // Dün öne çıkmış gibi işaretle.
    await db
      .update(events)
      .set({ featuredType: 'DAILY_PRIMARY', featuredDate: '2020-01-01' })
      .where(eq(events.id, id));

    // Aynı soruyu iki gün üst üste göstermek günlük ritüeli anlamsızlaştırır.
    expect(await featuredService.ensureDaily()).toBeNull();
  });

  it('aday yoksa sessizce geçer, patlamaz', async () => {
    expect(await featuredService.ensureDaily()).toBeNull();
    expect(await featuredService.today()).toBeNull();
  });
});

describe('yönetici seçimi', () => {
  it('elle seçilen Meydan otomatik seçimle EZİLMEZ', async () => {
    const owner = await admin();
    await makeEvent('mac-yakin', 5, 'spor', owner);
    const secilen = await makeEvent('mac-yonetici', 48, 'spor', owner);

    await featuredService.setDaily(secilen, productDay());
    // Otomatik seçim çalışsa "mac-yakin"i seçerdi; ama gün zaten dolu.
    expect(await featuredService.ensureDaily()).toBeNull();
    expect((await featuredService.today())?.slug).toBe('mac-yonetici');
  });

  it('aynı güne İKİNCİ Meydan seçilemez — anlaşılır hata verir', async () => {
    const owner = await admin();
    const a = await makeEvent('mac-a', 24, 'spor', owner);
    const b = await makeEvent('mac-b', 30, 'spor', owner);

    await featuredService.setDaily(a, productDay());
    await expect(featuredService.setDaily(b, productDay())).rejects.toThrow(
      /zaten bir Günün Meydanı/,
    );
  });

  it('kapanmış etkinlik Meydan olamaz', async () => {
    const owner = await admin();
    const id = await makeEvent('mac-gecmis', 24, 'spor', owner);
    await db
      .update(events)
      .set({ closesAt: new Date(Date.now() - 3600_000) })
      .where(eq(events.id, id));

    await expect(featuredService.setDaily(id, productDay())).rejects.toThrow(/kapanmış/);
  });

  it('kaldırılan Meydanın yerine otomatik seçim yapılabilir', async () => {
    const owner = await admin();
    const a = await makeEvent('mac-a', 24, 'spor', owner);
    await makeEvent('mac-b', 30, 'spor', owner);

    await featuredService.setDaily(a, productDay());
    await featuredService.clearDaily(productDay());

    expect(await featuredService.ensureDaily()).not.toBeNull();
    expect(await featuredService.today()).not.toBeNull();
  });
});
