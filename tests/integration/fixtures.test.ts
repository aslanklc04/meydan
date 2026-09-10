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
function stubApi(byEndpoint: {
  next?: unknown[];
  past?: unknown[];
  lookup?: unknown[];
  /** Hafta ucu: hafta numarasına göre liste. */
  rounds?: Record<string, unknown[]>;
  /** Tekil sorgu: maç kimliğine göre kayıt. Verilirse `lookup` yerine geçer. */
  byId?: Record<string, unknown>;
}): {
  calls: string[];
} {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const address = String(url);
    calls.push(address);

    let list: unknown[] | undefined;
    if (address.includes('eventsnextleague')) {
      list = byEndpoint.next;
    } else if (address.includes('eventspastleague')) {
      list = byEndpoint.past;
    } else if (address.includes('eventsround')) {
      const round = new URL(address).searchParams.get('r') ?? '';
      list = byEndpoint.rounds?.[round];
    } else {
      const id = new URL(address).searchParams.get('id') ?? '';
      const single = byEndpoint.byId?.[id];
      list = single ? [single] : byEndpoint.lookup;
    }

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

describe('takım armaları', () => {
  it('sağlayıcının armalarını doğru tarafa yazar', async () => {
    await makeAdmin();
    stubApi({
      next: [
        {
          idEvent: '8080',
          strHomeTeam: 'Galatasaray',
          strAwayTeam: 'Fenerbahçe',
          strTimestamp: future(30),
          strHomeTeamBadge: 'https://r2.thesportsdb.com/images/media/team/badge/ev.png',
          strAwayTeamBadge: 'https://r2.thesportsdb.com/images/media/team/badge/dep.png',
        },
      ],
    });
    await fixturesService.importUpcoming();

    const rows = await db.select().from(events).where(eq(events.slug, 'mac-8080'));
    const outcomes = await db
      .select()
      .from(eventOutcomes)
      .where(eq(eventOutcomes.eventId, rows[0]!.id));

    const byKey = Object.fromEntries(outcomes.map((o) => [o.key, o.imageUrl]));
    expect(byKey.HOME).toContain('/ev.png');
    expect(byKey.AWAY).toContain('/dep.png');
    // Beraberliğin arması olmaz.
    expect(byKey.DRAW).toBeNull();
  });

  it('YABANCI adresten gelen görseli REDDEDER', async () => {
    await makeAdmin();
    stubApi({
      next: [
        {
          idEvent: '8081',
          strHomeTeam: 'A',
          strAwayTeam: 'B',
          strTimestamp: future(30),
          // Veri kaynağı bir gün ele geçirilirse ya da hatalı veri
          // gönderirse, sayfaya istenmeyen içerik taşınmamalı.
          strHomeTeamBadge: 'https://kotu-site.example/izleme.png',
          strAwayTeamBadge: 'javascript:alert(1)',
        },
      ],
    });
    await fixturesService.importUpcoming();

    const rows = await db.select().from(events).where(eq(events.slug, 'mac-8081'));
    const outcomes = await db
      .select()
      .from(eventOutcomes)
      .where(eq(eventOutcomes.eventId, rows[0]!.id));

    for (const outcome of outcomes) expect(outcome.imageUrl).toBeNull();
  });
});

describe('eski etkinliklere arma tamamlama', () => {
  it('ARMASIZ içeri alınmış maça sonraki turda armayı YAZAR', async () => {
    // Canlıda görülen hata: arma alanı sonradan eklendi, ondan önce içeri
    // alınmış maçlar "zaten var" diye atlanıyor ve ömür boyu armasız
    // kalıyordu. Günün Meydanı'ndaki maçın armaları hiç gelmedi.
    await makeAdmin();

    stubApi({
      next: [
        {
          idEvent: '9100',
          strHomeTeam: 'PSV Eindhoven',
          strAwayTeam: 'Shakhtar Donetsk',
          strTimestamp: future(30),
          // İlk turda sağlayıcı arma vermiyor.
        },
      ],
    });
    expect((await fixturesService.importUpcoming()).imported).toBe(1);

    const rows = await db.select().from(events).where(eq(events.slug, 'mac-9100'));
    const eventId = rows[0]!.id;
    const before = await db.select().from(eventOutcomes).where(eq(eventOutcomes.eventId, eventId));
    expect(Object.fromEntries(before.map((o) => [o.key, o.imageUrl])).HOME).toBeNull();

    // İkinci tur: aynı maç, bu kez armalarla.
    vi.unstubAllGlobals();
    stubApi({
      next: [
        {
          idEvent: '9100',
          strHomeTeam: 'PSV Eindhoven',
          strAwayTeam: 'Shakhtar Donetsk',
          strTimestamp: future(30),
          strHomeTeamBadge: 'https://r2.thesportsdb.com/images/media/team/badge/psv.png',
          strAwayTeamBadge: 'https://r2.thesportsdb.com/images/media/team/badge/shk.png',
        },
      ],
    });
    const second = await fixturesService.importUpcoming();
    // Yeni etkinlik AÇILMAZ — yalnızca eksik alan tamamlanır.
    expect(second.imported).toBe(0);

    const after = await db.select().from(eventOutcomes).where(eq(eventOutcomes.eventId, eventId));
    const byKey = Object.fromEntries(after.map((o) => [o.key, o.imageUrl]));
    expect(byKey.HOME).toContain('/psv.png');
    expect(byKey.AWAY).toContain('/shk.png');
    expect(byKey.DRAW).toBeNull();
  });

  it('VAR OLAN armanın üstüne YAZMAZ', async () => {
    // Tamamlama, güncelleme değildir: kaynaktaki geçici bir bozulma iyi
    // veriyi silmemeli.
    await makeAdmin();
    stubApi({
      next: [
        {
          idEvent: '9101',
          strHomeTeam: 'A',
          strAwayTeam: 'B',
          strTimestamp: future(30),
          strHomeTeamBadge: 'https://r2.thesportsdb.com/images/media/team/badge/iyi.png',
        },
      ],
    });
    await fixturesService.importUpcoming();

    vi.unstubAllGlobals();
    stubApi({
      next: [
        {
          idEvent: '9101',
          strHomeTeam: 'A',
          strAwayTeam: 'B',
          strTimestamp: future(30),
          strHomeTeamBadge: 'https://r2.thesportsdb.com/images/media/team/badge/YENI.png',
        },
      ],
    });
    await fixturesService.importUpcoming();

    const rows = await db.select().from(events).where(eq(events.slug, 'mac-9101'));
    const outcomes = await db
      .select()
      .from(eventOutcomes)
      .where(eq(eventOutcomes.eventId, rows[0]!.id));
    const byKey = Object.fromEntries(outcomes.map((o) => [o.key, o.imageUrl]));
    expect(byKey.HOME).toContain('/iyi.png');
  });

  it('tamamlama sırasında BAŞLIK ve ETİKETLER değişmez', async () => {
    // Kullanıcı tahminini bir etikete bakarak yapar; o etiketin altından
    // değişmesi tahminin neye göre yapıldığını belirsizleştirir.
    await makeAdmin();
    stubApi({
      next: [
        {
          idEvent: '9102',
          strHomeTeam: 'Eski Ad',
          strAwayTeam: 'Rakip',
          strTimestamp: future(30),
        },
      ],
    });
    await fixturesService.importUpcoming();

    vi.unstubAllGlobals();
    stubApi({
      next: [
        {
          idEvent: '9102',
          strHomeTeam: 'YENİ AD',
          strAwayTeam: 'Rakip',
          strTimestamp: future(30),
          strHomeTeamBadge: 'https://r2.thesportsdb.com/images/media/team/badge/x.png',
        },
      ],
    });
    await fixturesService.importUpcoming();

    const rows = await db.select().from(events).where(eq(events.slug, 'mac-9102'));
    expect(rows[0]!.title).toBe('Eski Ad — Rakip');
    const outcomes = await db
      .select()
      .from(eventOutcomes)
      .where(eq(eventOutcomes.eventId, rows[0]!.id));
    expect(Object.fromEntries(outcomes.map((o) => [o.key, o.label])).HOME).toBe('Eski Ad');
  });
});

describe('hafta keşfi — az maç sorununun çözümü', () => {
  it('"yaklaşanlar" ucu TEK maç verse de haftanın tamamını getirir', async () => {
    // Canlıda ölçülen durum buydu: ücretsiz anahtarla lig başına 1 maç.
    // Yedi lig = yedi maç. Hafta ucu ise haftanın tamamını veriyor.
    await makeAdmin();
    stubApi({
      next: [
        {
          idEvent: '5001',
          strHomeTeam: 'Beşiktaş',
          strAwayTeam: 'Erzurumspor',
          strTimestamp: future(24),
          intRound: '5',
          strSeason: '2026-2027',
        },
      ],
      rounds: {
        '5': [{ idEvent: '5001' }, { idEvent: '5002' }, { idEvent: '5003' }, { idEvent: '5004' }],
      },
      byId: {
        '5002': {
          idEvent: '5002',
          strHomeTeam: 'Konyaspor',
          strAwayTeam: 'Trabzonspor',
          strTimestamp: future(26),
        },
        '5003': {
          idEvent: '5003',
          strHomeTeam: 'Galatasaray',
          strAwayTeam: 'Kocaelispor',
          strTimestamp: future(28),
        },
        '5004': {
          idEvent: '5004',
          strHomeTeam: 'Alanyaspor',
          strAwayTeam: 'Göztepe',
          strTimestamp: future(30),
        },
      },
    });

    const result = await fixturesService.importUpcoming();
    expect(result.imported).toBe(4); // 1 yaklaşan + 3 haftadan
    const all = await db.select().from(events);
    expect(all).toHaveLength(4);
  });

  it('SAAT hafta ucundan DEĞİL tekil sorgudan alınır', async () => {
    // Ölçüldü: aynı maç için hafta ucu "13 Eylül 12:00", tekil sorgu
    // "11 Eylül 17:00" diyor. Kapanış saati maçın başlangıcıdır; yanlış saat
    // ya maç başladıktan sonra tahmin alır ya da iki gün erken kapatır.
    await makeAdmin();
    const dogruSaat = future(40);

    stubApi({
      next: [
        {
          idEvent: '6001',
          strHomeTeam: 'A',
          strAwayTeam: 'B',
          strTimestamp: future(20),
          intRound: '3',
          strSeason: '2026-2027',
        },
      ],
      rounds: {
        '3': [
          { idEvent: '6001' },
          // Hafta ucu bu maç için YER TUTUCU saat veriyor.
          { idEvent: '6002', strHomeTeam: 'C', strAwayTeam: 'D', strTimestamp: future(999) },
        ],
      },
      byId: {
        '6002': { idEvent: '6002', strHomeTeam: 'C', strAwayTeam: 'D', strTimestamp: dogruSaat },
      },
    });

    await fixturesService.importUpcoming();

    const rows = await db.select().from(events).where(eq(events.slug, 'mac-6002'));
    expect(rows).toHaveLength(1);
    // Kapanış, tekil sorgudaki saat olmalı — hafta ucundaki değil.
    expect(rows[0]!.closesAt.toISOString().slice(0, 16)).toBe(
      new Date(`${dogruSaat}Z`).toISOString().slice(0, 16),
    );
  });

  it('SEZON ya da HAFTA yoksa hafta keşfi YAPILMAZ — uydurulmaz', async () => {
    // Uydurulan bir sezon dizgisi boş yanıt döndürür ve istek bütçesini
    // boşa harcar.
    await makeAdmin();
    const { calls } = stubApi({
      next: [
        {
          idEvent: '7001',
          strHomeTeam: 'A',
          strAwayTeam: 'B',
          strTimestamp: future(20),
          // intRound ve strSeason YOK.
        },
      ],
    });

    await fixturesService.importUpcoming();
    expect(calls.some((c) => c.includes('eventsround'))).toBe(false);
  });

  it('SİSTEMDE OLAN maç için tekil sorgu YAPILMAZ — bütçe boşa gitmez', async () => {
    await makeAdmin();
    const stub = {
      next: [
        {
          idEvent: '8001',
          strHomeTeam: 'A',
          strAwayTeam: 'B',
          strTimestamp: future(20),
          intRound: '2',
          strSeason: '2026-2027',
        },
      ],
      rounds: { '2': [{ idEvent: '8001' }] },
    };

    stubApi(stub);
    await fixturesService.importUpcoming();

    // İkinci koşu: maç artık sistemde.
    vi.unstubAllGlobals();
    const { calls } = stubApi(stub);
    await fixturesService.importUpcoming();

    expect(calls.some((c) => c.includes('lookupevent'))).toBe(false);
  });

  it('İSTEK BÜTÇESİ aşılmaz — sağlayıcı kapıyı kapatmasın', async () => {
    await makeAdmin();
    // Yedi ligin hepsi açık; her biri kalabalık bir hafta döndürüyor.
    delete process.env.THESPORTSDB_LEAGUES;

    const manyIds = Array.from({ length: 30 }, (_, i) => ({ idEvent: `9${i}` }));
    const byId = Object.fromEntries(
      manyIds.map((e, i) => [
        e.idEvent,
        {
          idEvent: e.idEvent,
          strHomeTeam: `E${i}`,
          strAwayTeam: `D${i}`,
          strTimestamp: future(50),
        },
      ]),
    );

    const { calls } = stubApi({
      next: [
        {
          idEvent: 'anchor',
          strHomeTeam: 'A',
          strAwayTeam: 'B',
          strTimestamp: future(20),
          intRound: '1',
          strSeason: '2026-2027',
        },
      ],
      rounds: { '1': manyIds, '2': manyIds },
      byId,
    });

    await fixturesService.importUpcoming();
    expect(calls.length).toBeLessThanOrEqual(26);
  });
});
