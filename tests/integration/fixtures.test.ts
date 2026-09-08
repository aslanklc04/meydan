import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { events, eventOutcomes, users } from '../../src/server/db/schema';
import { fixturesService } from '../../src/server/modules/catalog/fixtures.service';
import { createUser } from '../factories';

/**
 * FİKSTÜR ENTEGRASYONU — football-data.org.
 *
 * Bu modülün VARLIK SEBEBİ, canlıda görülen şu hatadır: takım adı içermeyen
 * "günün maçını ev sahibi mi kazanacak?" soruları ne tahmin edilebiliyor ne
 * sonuçlandırılabiliyordu. Dolayısıyla buradaki en önemli test, EKSİK VERİLİ
 * MAÇTAN ETKİNLİK ÜRETİLMEMESİDİR — aynı hatanın başka kılıkta dönmemesi
 * için.
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
  process.env.FOOTBALL_DATA_TOKEN = 'test-anahtari';
});

afterEach(() => {
  delete process.env.FOOTBALL_DATA_TOKEN;
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

/** football-data.org yanıtını taklit eder ve atılan isteği kaydeder. */
function stubApi(matches: unknown[]): { calls: { url: string; token: string | null }[] } {
  const calls: { url: string; token: string | null }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), token: headers['X-Auth-Token'] ?? null });
    return {
      ok: true,
      status: 200,
      json: async () => ({ matches }),
    } as unknown as Response;
  });
  return { calls };
}

const future = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();

describe('maç içe aktarma', () => {
  it('planlanmış maçtan TAKIM ADLARIYLA etkinlik açar', async () => {
    await makeAdmin();
    stubApi([
      {
        id: 12345,
        utcDate: future(30),
        status: 'SCHEDULED',
        homeTeam: { name: 'Galatasaray SK', shortName: 'Galatasaray' },
        awayTeam: { name: 'Real Madrid CF', shortName: 'Real Madrid' },
      },
    ]);

    const result = await fixturesService.importUpcoming();
    expect(result.imported).toBe(1);

    const rows = await db.select().from(events).where(eq(events.slug, 'mac-12345'));
    const event = rows[0]!;
    // Asıl mesele bu: başlık HANGİ MAÇ olduğunu söylüyor.
    expect(event.title).toBe('Galatasaray — Real Madrid');
    expect(event.status).toBe('OPEN');
  });

  it('YALNIZCA üç sonuç üretir — bahis kuponu türü YOK', async () => {
    await makeAdmin();
    stubApi([
      {
        id: 777,
        utcDate: future(20),
        status: 'TIMED',
        homeTeam: { shortName: 'Arsenal' },
        awayTeam: { shortName: 'Chelsea' },
      },
    ]);
    await fixturesService.importUpcoming();

    const rows = await db.select().from(events).where(eq(events.slug, 'mac-777'));
    const outcomes = await db
      .select()
      .from(eventOutcomes)
      .where(eq(eventOutcomes.eventId, rows[0]!.id));

    expect(outcomes).toHaveLength(3);
    expect(outcomes.map((o) => o.key).sort()).toEqual(['AWAY', 'DRAW', 'HOME']);
    // Alt/üst, çifte şans, karşılıklı gol gibi türler ÜRETİLMEZ.
    const labels = outcomes.map((o) => o.label.toLowerCase()).join(' ');
    for (const banned of ['alt', 'üst', 'çifte', 'karşılıklı', 'handikap', 'toplam gol']) {
      expect(labels.includes(banned)).toBe(false);
    }
  });

  it('TAKIM ADI EKSİK maçtan etkinlik AÇMAZ — bu modülün varlık sebebi', async () => {
    await makeAdmin();
    stubApi([
      { id: 1, utcDate: future(10), status: 'SCHEDULED', homeTeam: {}, awayTeam: {} },
      { id: 2, utcDate: future(10), status: 'SCHEDULED', homeTeam: { shortName: 'Barcelona' } },
    ]);

    const result = await fixturesService.importUpcoming();
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(2);
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it('başlamış ya da bitmiş maç açılmaz', async () => {
    await makeAdmin();
    stubApi([
      {
        id: 3,
        utcDate: new Date(Date.now() - 3600_000).toISOString(),
        status: 'SCHEDULED',
        homeTeam: { shortName: 'Inter' },
        awayTeam: { shortName: 'Milan' },
      },
      {
        id: 4,
        utcDate: future(5),
        status: 'FINISHED',
        homeTeam: { shortName: 'Bayern' },
        awayTeam: { shortName: 'Dortmund' },
      },
    ]);

    const result = await fixturesService.importUpcoming();
    expect(result.imported).toBe(0);
  });

  it('İDEMPOTENT: aynı maç iki kez açılmaz', async () => {
    await makeAdmin();
    const match = {
      id: 999,
      utcDate: future(40),
      status: 'SCHEDULED',
      homeTeam: { shortName: 'Porto' },
      awayTeam: { shortName: 'Benfica' },
    };
    stubApi([match]);

    expect((await fixturesService.importUpcoming()).imported).toBe(1);
    expect((await fixturesService.importUpcoming()).imported).toBe(0);
    expect(await db.select().from(events)).toHaveLength(1);
  });

  it('yönetici yoksa hiç etkinlik açılmaz', async () => {
    stubApi([
      {
        id: 5,
        utcDate: future(12),
        status: 'SCHEDULED',
        homeTeam: { shortName: 'Ajax' },
        awayTeam: { shortName: 'PSV' },
      },
    ]);
    expect((await fixturesService.importUpcoming()).imported).toBe(0);
  });
});

describe('anahtar yokken', () => {
  it('hiç istek atılmaz ve iş DURMAZ', async () => {
    delete process.env.FOOTBALL_DATA_TOKEN;
    const { calls } = stubApi([]);

    const report = await fixturesService.run();

    expect(calls).toHaveLength(0);
    expect(report).toEqual({ imported: 0, resolved: 0, skipped: 0 });
  });
});

describe('istek biçimi', () => {
  it('anahtar X-Auth-Token başlığında gider, adreste GÖRÜNMEZ', async () => {
    await makeAdmin();
    const { calls } = stubApi([]);
    await fixturesService.importUpcoming();

    expect(calls[0]!.token).toBe('test-anahtari');
    // Anahtarın adrese kaçması, günlüklere ve tarayıcı geçmişine sızması demektir.
    expect(calls[0]!.url).not.toContain('test-anahtari');
    expect(calls[0]!.url).toContain('api.football-data.org/v4/matches');
  });

  it('bütün turnuvalar TEK istekte sorgulanır (dakikada 10 istek sınırı)', async () => {
    await makeAdmin();
    const { calls } = stubApi([]);
    await fixturesService.importUpcoming();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('competitions=');
  });
});
