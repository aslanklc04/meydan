import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { events, eventOutcomes, users } from '../../src/server/db/schema';
import { fixturesService } from '../../src/server/modules/catalog/fixtures.service';
import { createUser } from '../factories';

/**
 * FİKSTÜR ENTEGRASYONU — TheSportsDB.
 *
 * Bu modülün VARLIK SEBEBİ, canlıda görülen şu hatadır: takım adı içermeyen
 * "günün maçını ev sahibi mi kazanacak?" soruları ne tahmin edilebiliyor ne
 * sonuçlandırılabiliyordu. Dolayısıyla buradaki en önemli test, EKSİK VERİLİ
 * MAÇTAN ETKİNLİK ÜRETİLMEMESİDİR.
 *
 * İkinci en önemli test KURULUMSUZ ÇALIŞMADIR: önceki sağlayıcı, anahtar
 * tanımlı değilken hata vermeden BOŞ LİSTE döndürüyordu; entegrasyon
 * "çalışıyor" görünüp sonsuza kadar sıfır maç getiriyordu. Artık hiçbir ortam
 * değişkeni tanımlı olmasa bile istek atılmalı ve maç açılmalıdır.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE notification, feed_item, coin_ledger, coin_account, challenge,
                           prediction, event_outcome, event, category, "user" CASCADE`;
  await sql`INSERT INTO category (id, slug, name, icon, kind, sort_order)
            VALUES ('cat-spor', 'spor', 'Spor', '⚽', 'GENERAL', 0)`;
  delete process.env.THESPORTSDB_KEY;
  process.env.THESPORTSDB_LEAGUES = '4339';
});

afterEach(() => {
  delete process.env.THESPORTSDB_KEY;
  delete process.env.THESPORTSDB_LEAGUES;
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await sql.end();
});

async function makeAdmin(): Promise<string> {
  const { userId } = await createUser('yonetici');
  await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, userId));
  return userId;
}

/** TheSportsDB yanıtını taklit eder; uca göre farklı liste döndürür. */
function stubApi(byEndpoint: { next?: unknown[]; past?: unknown[]; lookup?: unknown[] }): {
  calls: string[];
} {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const address = String(url);
    calls.push(address);
    const list = address.includes('eventsnextleague')
      ? byEndpoint.next
      : address.includes('eventspastleague')
        ? byEndpoint.past
        : byEndpoint.lookup;
    return {
      ok: true,
      status: 200,
      json: async () => ({ events: list ?? null }),
    } as unknown as Response;
  });
  return { calls };
}

const future = (hours: number) =>
  new Date(Date.now() + hours * 3600_000).toISOString().slice(0, 19);

describe('maç içe aktarma', () => {
  it('yaklaşan maçtan TAKIM ADLARIYLA etkinlik açar', async () => {
    await makeAdmin();
    stubApi({
      next: [
        {
          idEvent: '2527749',
          strHomeTeam: 'Galatasaray',
          strAwayTeam: 'Fenerbahçe',
          strTimestamp: future(30),
          strStatus: 'NS',
        },
      ],
    });

    expect((await fixturesService.importUpcoming()).imported).toBe(1);

    const rows = await db.select().from(events).where(eq(events.slug, 'mac-2527749'));
    // Asıl mesele bu: başlık HANGİ MAÇ olduğunu söylüyor.
    expect(rows[0]!.title).toBe('Galatasaray — Fenerbahçe');
    expect(rows[0]!.status).toBe('OPEN');
  });

  it('HİÇBİR ortam değişkeni yokken de çalışır — kurulum gerektirmez', async () => {
    delete process.env.THESPORTSDB_LEAGUES;
    await makeAdmin();
    const { calls } = stubApi({
      next: [
        {
          idEvent: '900',
          strHomeTeam: 'Beşiktaş',
          strAwayTeam: 'Trabzonspor',
          strTimestamp: future(20),
        },
      ],
    });

    const result = await fixturesService.importUpcoming();

    // Önceki sağlayıcının sessiz boşluğu burada yakalanır: istek ATILMALI.
    expect(calls.length).toBeGreaterThan(0);
    expect(result.imported).toBeGreaterThan(0);
    // Varsayılan ligler arasında Süper Lig (4339) olmalı.
    expect(calls.some((c) => c.includes('id=4339'))).toBe(true);
  });

  it('YALNIZCA üç sonuç üretir — bahis kuponu türü YOK', async () => {
    await makeAdmin();
    stubApi({
      next: [
        {
          idEvent: '777',
          strHomeTeam: 'Arsenal',
          strAwayTeam: 'Chelsea',
          strTimestamp: future(20),
        },
      ],
    });
    await fixturesService.importUpcoming();

    const rows = await db.select().from(events).where(eq(events.slug, 'mac-777'));
    const outcomes = await db
      .select()
      .from(eventOutcomes)
      .where(eq(eventOutcomes.eventId, rows[0]!.id));

    expect(outcomes).toHaveLength(3);
    expect(outcomes.map((o) => o.key).sort()).toEqual(['AWAY', 'DRAW', 'HOME']);
    const labels = outcomes.map((o) => o.label.toLowerCase()).join(' ');
    for (const banned of ['alt', 'üst', 'çifte', 'karşılıklı', 'handikap', 'toplam gol']) {
      expect(labels.includes(banned)).toBe(false);
    }
  });

  it('TAKIM ADI EKSİK maçtan etkinlik AÇMAZ — bu modülün varlık sebebi', async () => {
    await makeAdmin();
    stubApi({
      next: [
        { idEvent: '1', strHomeTeam: '', strAwayTeam: '', strTimestamp: future(10) },
        { idEvent: '2', strHomeTeam: 'Barcelona', strAwayTeam: null, strTimestamp: future(10) },
        { idEvent: '3', strHomeTeam: 'Porto', strAwayTeam: 'Benfica', strTimestamp: null },
      ],
    });

    const result = await fixturesService.importUpcoming();
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(3);
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it('SAAT KAYMASI YOK: zaman dilimsiz damga UTC sayılır', async () => {
    await makeAdmin();
    // Tam 30 saat sonrası; 'Z' eki olmadan gelir.
    const stamp = new Date(Date.now() + 30 * 3600_000).toISOString().slice(0, 19);
    stubApi({
      next: [{ idEvent: '55', strHomeTeam: 'Roma', strAwayTeam: 'Lazio', strTimestamp: stamp }],
    });
    await fixturesService.importUpcoming();

    const rows = await db.select().from(events).where(eq(events.slug, 'mac-55'));
    const drift = Math.abs(rows[0]!.closesAt.getTime() - new Date(`${stamp}Z`).getTime());
    // Yerel saate göre yorumlansaydı fark saatlerce olurdu.
    expect(drift).toBeLessThan(1000);
  });

  it('başlamış maç açılmaz', async () => {
    await makeAdmin();
    stubApi({
      next: [
        {
          idEvent: '3',
          strHomeTeam: 'Inter',
          strAwayTeam: 'Milan',
          strTimestamp: new Date(Date.now() - 3600_000).toISOString().slice(0, 19),
        },
      ],
    });
    expect((await fixturesService.importUpcoming()).imported).toBe(0);
  });

  it('İDEMPOTENT: aynı maç iki kez açılmaz', async () => {
    await makeAdmin();
    stubApi({
      next: [
        {
          idEvent: '999',
          strHomeTeam: 'Porto',
          strAwayTeam: 'Benfica',
          strTimestamp: future(40),
        },
      ],
    });

    expect((await fixturesService.importUpcoming()).imported).toBe(1);
    expect((await fixturesService.importUpcoming()).imported).toBe(0);
    expect(await db.select().from(events)).toHaveLength(1);
  });

  it('yönetici yoksa hiç etkinlik açılmaz', async () => {
    stubApi({
      next: [{ idEvent: '5', strHomeTeam: 'Ajax', strAwayTeam: 'PSV', strTimestamp: future(12) }],
    });
    expect((await fixturesService.importUpcoming()).imported).toBe(0);
  });
});

describe('sonuçlandırma', () => {
  async function openMatch(id: string): Promise<void> {
    await makeAdmin();
    stubApi({
      next: [
        {
          idEvent: id,
          strHomeTeam: 'Galatasaray',
          strAwayTeam: 'Fenerbahçe',
          strTimestamp: future(30),
        },
      ],
    });
    await fixturesService.importUpcoming();
    vi.unstubAllGlobals();
  }

  it('skoru okuyup KAZANANI yazar', async () => {
    await openMatch('4242');
    stubApi({
      past: [{ idEvent: '4242', strStatus: 'FT', intHomeScore: '3', intAwayScore: '1' }],
    });

    expect(await fixturesService.resolveFinished()).toBe(1);

    const rows = await db.select().from(events).where(eq(events.slug, 'mac-4242'));
    expect(rows[0]!.status).toBe('RESOLVED');
    const outcomes = await db
      .select()
      .from(eventOutcomes)
      .where(eq(eventOutcomes.id, rows[0]!.resolvedOutcomeId!));
    expect(outcomes[0]!.key).toBe('HOME');
  });

  it('beraberlikte BERABERLİK kazanır', async () => {
    await openMatch('4243');
    stubApi({
      past: [{ idEvent: '4243', strStatus: 'FT', intHomeScore: '2', intAwayScore: '2' }],
    });
    await fixturesService.resolveFinished();

    const rows = await db.select().from(events).where(eq(events.slug, 'mac-4243'));
    const outcomes = await db
      .select()
      .from(eventOutcomes)
      .where(eq(eventOutcomes.id, rows[0]!.resolvedOutcomeId!));
    expect(outcomes[0]!.key).toBe('DRAW');
  });

  it('SKOR OKUNAMAZSA iade eder — kimse haksız kaybetmez', async () => {
    await openMatch('4244');
    stubApi({
      past: [{ idEvent: '4244', strStatus: 'FT', intHomeScore: null, intAwayScore: null }],
    });

    expect(await fixturesService.resolveFinished()).toBe(1);
    const rows = await db.select().from(events).where(eq(events.slug, 'mac-4244'));
    expect(rows[0]!.status).toBe('VOID');
  });

  it('BİTMEMİŞ maça DOKUNMAZ', async () => {
    await openMatch('4245');
    stubApi({
      past: [{ idEvent: '4245', strStatus: 'NS', intHomeScore: null, intAwayScore: null }],
    });

    expect(await fixturesService.resolveFinished()).toBe(0);
    const rows = await db.select().from(events).where(eq(events.slug, 'mac-4245'));
    expect(rows[0]!.status).toBe('OPEN');
  });

  it('OYNANMAKTA olan maça DOKUNMAZ — çip maç sürerken alınmaz', async () => {
    await openMatch('4246');
    // Devam eden maçta skor alanları DOLUDUR; durum bitmiş değildir.
    stubApi({
      past: [{ idEvent: '4246', strStatus: '2H', intHomeScore: '1', intAwayScore: '0' }],
    });

    expect(await fixturesService.resolveFinished()).toBe(0);
    const rows = await db.select().from(events).where(eq(events.slug, 'mac-4246'));
    expect(rows[0]!.status).toBe('OPEN');
  });

  it('ERTELENEN maç iade edilir — çip aylarca askıda kalmaz', async () => {
    await openMatch('4247');
    stubApi({
      past: [{ idEvent: '4247', strStatus: 'PST', intHomeScore: null, intAwayScore: null }],
    });

    expect(await fixturesService.resolveFinished()).toBe(1);
    const rows = await db.select().from(events).where(eq(events.slug, 'mac-4247'));
    expect(rows[0]!.status).toBe('VOID');
  });

  it('ELLE açılmış etkinliğe DOKUNMAZ', async () => {
    const adminId = await makeAdmin();
    await db.insert(events).values({
      categoryId: 'cat-spor',
      slug: 'elle-acilmis-etkinlik',
      title: 'Elle açılmış',
      question: 'Ne olacak?',
      status: 'OPEN',
      closesAt: new Date(Date.now() + 3600_000),
      resolvesAt: new Date(Date.now() + 7200_000),
      createdById: adminId,
    });
    stubApi({ past: [{ idEvent: '1', strStatus: 'FT', intHomeScore: '1', intAwayScore: '0' }] });

    expect(await fixturesService.resolveFinished()).toBe(0);
    const rows = await db.select().from(events).where(eq(events.slug, 'elle-acilmis-etkinlik'));
    expect(rows[0]!.status).toBe('OPEN');
  });
});

describe('istek biçimi', () => {
  it('ücretsiz anahtar adreste kullanılır, ayar gerekmez', async () => {
    await makeAdmin();
    const { calls } = stubApi({ next: [] });
    await fixturesService.importUpcoming();

    expect(calls[0]).toContain('thesportsdb.com/api/v1/json/123/');
  });

  it('ücretli anahtar ayarlanırsa varsayılanı ezer', async () => {
    process.env.THESPORTSDB_KEY = 'ozel-anahtar';
    await makeAdmin();
    const { calls } = stubApi({ next: [] });
    await fixturesService.importUpcoming();

    expect(calls[0]).toContain('/ozel-anahtar/');
    expect(calls[0]).not.toContain('/123/');
  });

  it('lig başına TEK istek atılır (dakikada 30 istek sınırı)', async () => {
    process.env.THESPORTSDB_LEAGUES = '4339,4480,4328';
    await makeAdmin();
    const { calls } = stubApi({ next: [] });
    await fixturesService.importUpcoming();

    expect(calls).toHaveLength(3);
  });
});
