import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { eventOutcomes, events, gazettes, predictions, users } from '../../src/server/db/schema';
import { catalogService } from '../../src/server/modules/catalog/service';
import { gazetteService } from '../../src/server/modules/gazette/service';
import { createUser } from '../factories';

/**
 * GELECEK GAZETESİ — buradaki testlerin çoğu bir ÖZELLİĞİ değil, bir AÇIĞI
 * kapatır.
 *
 * Gazetenin tek değeri, kullanıcının kaybettiği manşeti de taşımasıdır. O
 * kural delinirse gazete bir iddia belgesi olmaktan çıkıp bir övünme kartına
 * dönüşür ve kimse ona inanmaz. Aşağıdaki testler tam olarak o deliği
 * kapatan üç kilidi sınar: kapanmış tahmin eklenemez, aynı tahmin iki
 * kapağa giremez, kısmi yazma olamaz.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE gazette_item, gazette, notification, feed_item, coin_ledger,
                           coin_account, challenge, prediction, event_outcome, event,
                           category, "user" CASCADE`;
  await sql`INSERT INTO category (id, slug, name, icon, kind, sort_order)
            VALUES ('cat-spor', 'spor', 'Spor', '⚽', 'GENERAL', 0)`;
});

afterAll(async () => {
  await sql.end();
});

let seq = 0;

async function makeEvent(opts?: { closesInMs?: number; status?: 'DRAFT' | 'OPEN' }) {
  const { userId: adminId } = await createUser(`kurucu${seq}`);
  await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, adminId));

  const n = seq++;
  const { eventId } = await catalogService.createEvent({
    categorySlug: 'spor',
    title: `Takım A${n} — Takım B${n}`,
    question: 'Bu maçı kim kazanacak?',
    slug: `mac-test-${n}`,
    closesAt: new Date(Date.now() + (opts?.closesInMs ?? 3600_000)),
    resolvesAt: new Date(Date.now() + 9000_000),
    outcomes: [
      { key: 'HOME', label: `Takım A${n}` },
      { key: 'DRAW', label: 'Beraberlik' },
      { key: 'AWAY', label: `Takım B${n}` },
    ],
    createdById: adminId,
    status: opts?.status ?? 'OPEN',
  });

  const outcomes = await db.select().from(eventOutcomes).where(eq(eventOutcomes.eventId, eventId));
  const byKey = Object.fromEntries(outcomes.map((o) => [o.key, o.id]));
  return { eventId, byKey };
}

async function predict(userId: string, eventId: string, outcomeId: string) {
  const rows = await db
    .insert(predictions)
    .values({ userId, eventId, outcomeId, categoryId: 'cat-spor' })
    .returning({ id: predictions.id });
  return rows[0]!.id;
}

describe('gazete kurma', () => {
  it('üç tahminden bir kapak kurar ve paylaşım jetonu döner', async () => {
    const { userId, username } = await createUser('aslan');
    const a = await makeEvent();
    const b = await makeEvent();
    const c = await makeEvent();
    const ids = [
      await predict(userId, a.eventId, a.byKey.HOME!),
      await predict(userId, b.eventId, b.byKey.AWAY!),
      await predict(userId, c.eventId, c.byKey.DRAW!),
    ];

    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'Bu hafta üç iddia',
      predictionIds: ids,
    });

    const view = await gazetteService.byToken(publicToken);
    expect(view).not.toBeNull();
    expect(view!.headlines).toHaveLength(3);
    expect(view!.title).toBe('Bu hafta üç iddia');
    expect(view!.ownerUsername).toBe(username);
  });

  it('paylaşım jetonu iç kimliği SIZDIRMAZ', async () => {
    const { userId } = await createUser('aslan');
    const a = await makeEvent();
    const id = await predict(userId, a.eventId, a.byKey.HOME!);

    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'Tek manşet',
      predictionIds: [id],
    });

    // Jeton; kullanıcı kimliği, tahmin kimliği veya etkinlik kimliği içermez.
    expect(publicToken).not.toContain(userId);
    expect(publicToken).not.toContain(id);
    expect(publicToken).not.toContain(a.eventId);
    // Tarayıcıda denenerek bulunamayacak kadar uzun.
    expect(publicToken.length).toBeGreaterThanOrEqual(20);
    // Adres çubuğunda kaçış gerektiren karakter yok.
    expect(publicToken).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('her gazetenin jetonu FARKLIDIR', async () => {
    const { userId } = await createUser('aslan');
    const tokens = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const e = await makeEvent();
      const id = await predict(userId, e.eventId, e.byKey.HOME!);
      const { publicToken } = await gazetteService.create({
        ownerId: userId,
        title: `Kapak ${i}`,
        predictionIds: [id],
      });
      tokens.add(publicToken);
    }
    expect(tokens.size).toBe(5);
  });
});

describe('seçici sunuma karşı kilitler', () => {
  it('KAPANMIŞ etkinliğin tahmini kapağa KONAMAZ', async () => {
    // Bu kural olmasaydı gazete bir tahmin değil, bir özet olurdu: kullanıcı
    // sonucu bildiği maçları kapağa koyup kusursuz görünürdü.
    const { userId } = await createUser('aslan');
    const e = await makeEvent({ closesInMs: -1000 });
    const id = await predict(userId, e.eventId, e.byKey.HOME!);

    await expect(
      gazetteService.create({ ownerId: userId, title: 'Geçmişi yazdım', predictionIds: [id] }),
    ).rejects.toThrow(/kapağa konamıyor/);
  });

  it('AYNI TAHMİN ikinci bir kapağa GİREMEZ', async () => {
    // Asıl kilit budur: "manşet silinemez" kuralı, ikinci kapak serbest
    // olsaydı hiçbir işe yaramazdı.
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);

    await gazetteService.create({ ownerId: userId, title: 'Birinci', predictionIds: [id] });
    await expect(
      gazetteService.create({ ownerId: userId, title: 'İkinci', predictionIds: [id] }),
    ).rejects.toThrow();
  });

  it('kullanılmış tahmin uygun listede GÖRÜNMEZ', async () => {
    const { userId } = await createUser('aslan');
    const a = await makeEvent();
    const b = await makeEvent();
    const idA = await predict(userId, a.eventId, a.byKey.HOME!);
    const idB = await predict(userId, b.eventId, b.byKey.HOME!);

    await gazetteService.create({ ownerId: userId, title: 'Kapak', predictionIds: [idA] });

    const eligible = await gazetteService.eligible(userId);
    const ids = eligible.map((r) => r.predictionId);
    expect(ids).toContain(idB);
    expect(ids).not.toContain(idA);
  });

  it('BAŞKASININ tahmini kapağa konamaz', async () => {
    const { userId: mine } = await createUser('aslan');
    const { userId: other } = await createUser('baskasi');
    const e = await makeEvent();
    const theirs = await predict(other, e.eventId, e.byKey.HOME!);

    await expect(
      gazetteService.create({ ownerId: mine, title: 'Çalıntı', predictionIds: [theirs] }),
    ).rejects.toThrow(/kapağa konamıyor/);
  });

  it('servis manşet SİLME yolu SUNMAZ', () => {
    // Kural koda değil, arayüzün yokluğuna yazılmıştır: silme fonksiyonu
    // yoksa yanlışlıkla çağrılamaz.
    const names = Object.keys(gazetteService);
    expect(names.some((n) => /remove|delete|drop/i.test(n))).toBe(false);
  });
});

describe('kısmi yazma olmaz', () => {
  it('üçüncü manşet reddedilirse İLK İKİSİ DE yazılmaz', async () => {
    const { userId } = await createUser('aslan');
    const a = await makeEvent();
    const b = await makeEvent();
    const kapali = await makeEvent({ closesInMs: -1000 });

    const idA = await predict(userId, a.eventId, a.byKey.HOME!);
    const idB = await predict(userId, b.eventId, b.byKey.HOME!);
    const idKapali = await predict(userId, kapali.eventId, kapali.byKey.HOME!);

    await expect(
      gazetteService.create({
        ownerId: userId,
        title: 'Üç manşet',
        predictionIds: [idA, idB, idKapali],
      }),
    ).rejects.toThrow();

    // Yarım gazete kalmamalı.
    const mine = await gazetteService.listMine(userId);
    expect(mine).toHaveLength(0);

    // İlk iki tahmin hâlâ kullanılabilir olmalı.
    const eligible = await gazetteService.eligible(userId);
    const ids = eligible.map((r) => r.predictionId);
    expect(ids).toContain(idA);
    expect(ids).toContain(idB);
  });
});

describe('sınırlar', () => {
  it('ÜÇTEN FAZLA manşet kabul edilmez', async () => {
    const { userId } = await createUser('aslan');
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const e = await makeEvent();
      ids.push(await predict(userId, e.eventId, e.byKey.HOME!));
    }
    await expect(
      gazetteService.create({ ownerId: userId, title: 'Dört manşet', predictionIds: ids }),
    ).rejects.toThrow(/en çok 3/);
  });

  it('BOŞ kapak kurulamaz', async () => {
    const { userId } = await createUser('aslan');
    await expect(
      gazetteService.create({ ownerId: userId, title: 'Boş', predictionIds: [] }),
    ).rejects.toThrow(/en az bir tahmin/);
  });

  it('BOŞ BAŞLIK kabul edilmez', async () => {
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    await expect(
      gazetteService.create({ ownerId: userId, title: '   ', predictionIds: [id] }),
    ).rejects.toThrow(/başlık ver/i);
  });

  it('ÇOK UZUN başlık kabul edilmez', async () => {
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    await expect(
      gazetteService.create({ ownerId: userId, title: 'a'.repeat(71), predictionIds: [id] }),
    ).rejects.toThrow(/en çok 70/);
  });

  it('aynı tahmin iki kez verilirse TEK manşet olur', async () => {
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'Tekrarlı',
      predictionIds: [id, id, id],
    });
    const view = await gazetteService.byToken(publicToken);
    expect(view!.headlines).toHaveLength(1);
  });
});

describe('sonuç gösterimi', () => {
  it('KAYBEDEN manşet kapakta KALIR ve kaybettiği görünür', async () => {
    const { userId } = await createUser('aslan');
    const { userId: adminId } = await createUser('yonetici');
    await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, adminId));

    const a = await makeEvent();
    const b = await makeEvent();
    const idA = await predict(userId, a.eventId, a.byKey.HOME!);
    const idB = await predict(userId, b.eventId, b.byKey.HOME!);

    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'İki iddia',
      predictionIds: [idA, idB],
    });

    // Biri tuttu, biri tutmadı.
    await db
      .update(events)
      .set({ status: 'RESOLVED', resolvedOutcomeId: a.byKey.HOME!, resolvedAt: new Date() })
      .where(eq(events.id, a.eventId));
    await db
      .update(events)
      .set({ status: 'RESOLVED', resolvedOutcomeId: b.byKey.AWAY!, resolvedAt: new Date() })
      .where(eq(events.id, b.eventId));

    const view = await gazetteService.byToken(publicToken);
    expect(view!.headlines).toHaveLength(2);
    expect(view!.settled).toBe(2);
    expect(view!.hits).toBe(1);
    const sorted = [...view!.headlines].sort((x, y) => x.slot - y.slot);
    expect(sorted[0]!.correct).toBe(true);
    expect(sorted[1]!.correct).toBe(false);
  });

  it('İPTAL edilen manşet GÖRÜNÜR ama SAYILMAZ', async () => {
    const { userId } = await createUser('aslan');
    const a = await makeEvent();
    const b = await makeEvent();
    const idA = await predict(userId, a.eventId, a.byKey.HOME!);
    const idB = await predict(userId, b.eventId, b.byKey.HOME!);

    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'İki iddia',
      predictionIds: [idA, idB],
    });

    await db
      .update(events)
      .set({ status: 'RESOLVED', resolvedOutcomeId: a.byKey.HOME!, resolvedAt: new Date() })
      .where(eq(events.id, a.eventId));
    await db.update(events).set({ status: 'VOID' }).where(eq(events.id, b.eventId));

    const view = await gazetteService.byToken(publicToken);
    expect(view!.headlines).toHaveLength(2); // görünür
    expect(view!.settled).toBe(1); // sayılmaz
    expect(view!.hits).toBe(1);
    const sorted = [...view!.headlines].sort((x, y) => x.slot - y.slot);
    expect(sorted[1]!.voided).toBe(true);
    expect(sorted[1]!.correct).toBeNull();
  });

  it('sonuçlanmamış manşette sonuç ALANI BOŞTUR', async () => {
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'Bekleyen',
      predictionIds: [id],
    });

    const view = await gazetteService.byToken(publicToken);
    expect(view!.headlines[0]!.correct).toBeNull();
    expect(view!.headlines[0]!.resolvedOutcomeLabel).toBeNull();
    expect(view!.settled).toBe(0);
  });
});

describe('görünürlük', () => {
  it('bilinmeyen jeton null döner (hata değil)', async () => {
    expect(await gazetteService.byToken('boyle-bir-jeton-yok')).toBeNull();
  });

  it('hesabını SİLMİŞ kullanıcının gazetesi yayından kalkar', async () => {
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'Kapak',
      predictionIds: [id],
    });

    expect(await gazetteService.byToken(publicToken)).not.toBeNull();
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId));
    expect(await gazetteService.byToken(publicToken)).toBeNull();
  });

  it('gazete ZİYARETÇİYE dağılım göndermez', async () => {
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'Kapak',
      predictionIds: [id],
    });

    const view = await gazetteService.byToken(publicToken);
    const json = JSON.stringify(view);
    expect(json).not.toContain('share');
    expect(json).not.toContain('consensus');
  });
});

describe('atıf sayaçları', () => {
  it('görüntülenme sayılır', async () => {
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'Kapak',
      predictionIds: [id],
    });

    await gazetteService.countView(publicToken);
    await gazetteService.countView(publicToken);
    const view = await gazetteService.byToken(publicToken);
    expect(view!.viewCount).toBe(2);
  });

  it('bilinmeyen jetonda sayaç SESSİZ kalır — hata fırlatmaz', async () => {
    await expect(gazetteService.countView('yok-boyle-jeton')).resolves.toBeUndefined();
    await expect(gazetteService.countSignup('yok-boyle-jeton')).resolves.toBeUndefined();
  });

  it('kayıt sayacı sahibin ekranında görünür', async () => {
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'Kapak',
      predictionIds: [id],
    });

    await gazetteService.countSignup(publicToken);
    const mine = await gazetteService.listMine(userId);
    expect(mine[0]!.signupCount).toBe(1);
  });
});

describe('görünürlük tercihi', () => {
  it('varsayılan GİZLİDİR — sorulmadan rafa konmaz', async () => {
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);

    // `isPublic` hiç verilmedi.
    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'Sessiz kapak',
      predictionIds: [id],
    });

    const view = await gazetteService.byToken(publicToken);
    expect(view!.isPublic).toBe(false);
    expect(await gazetteService.shelfToday()).toHaveLength(0);
  });

  it('açıkça istenirse rafta görünür', async () => {
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);

    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'Açık kapak',
      predictionIds: [id],
      isPublic: true,
    });

    const shelf = await gazetteService.shelfToday();
    expect(shelf.map((g) => g.publicToken)).toContain(publicToken);
    expect(shelf[0]!.headlineCount).toBe(1);
  });

  it('GİZLİ kapağın BAĞLANTISI çalışmaya devam eder', async () => {
    // Gizli demek "silinmiş" demek değil: kullanıcı bağlantıyı istediğine
    // gönderebilmeli.
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'Gizli ama paylaşılabilir',
      predictionIds: [id],
    });
    expect(await gazetteService.byToken(publicToken)).not.toBeNull();
  });

  it('sahibi kapağı raftan çekebilir', async () => {
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'Açık kapak',
      predictionIds: [id],
      isPublic: true,
    });

    await gazetteService.makePrivate(publicToken, userId);
    expect(await gazetteService.shelfToday()).toHaveLength(0);
    // Bağlantı hâlâ çalışır.
    expect(await gazetteService.byToken(publicToken)).not.toBeNull();
  });

  it('raftan çekilen kapak GERİ KONAMAZ — veritabanı reddeder', async () => {
    // Serbest olsaydı: aç, tutmazsa gizle, tutunca yeniden aç. Raf o zaman
    // gerçeği değil herkesin en iyi gününü gösterirdi.
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'Açık kapak',
      predictionIds: [id],
      isPublic: true,
    });
    await gazetteService.makePrivate(publicToken, userId);

    // Kural kodda değil, kısıtta: doğrudan veritabanına yazmayı deniyoruz.
    await expect(
      db
        .update(gazettes)
        .set({ visibility: 'PUBLIC' })
        .where(eq(gazettes.publicToken, publicToken)),
    ).rejects.toThrow();
  });

  it('BAŞKASI kapağı raftan çekemez', async () => {
    const { userId } = await createUser('aslan');
    const { userId: other } = await createUser('baskasi');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'Açık kapak',
      predictionIds: [id],
      isPublic: true,
    });

    await expect(gazetteService.makePrivate(publicToken, other)).rejects.toThrow();
    expect(await gazetteService.shelfToday()).toHaveLength(1);
  });
});

describe('moderasyon gizlemesi', () => {
  it('gizlenen kapak hem RAFTAN hem BAĞLANTIDAN düşer', async () => {
    // Yalnızca raftan düşseydi gizleme bir gösteriden ibaret olurdu:
    // içerik, asıl yayıldığı yerde okunmaya devam ederdi.
    const { userId } = await createUser('aslan');
    const { userId: modId } = await createUser('yonetici');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'Sorunlu kapak',
      predictionIds: [id],
      isPublic: true,
    });

    await gazetteService.hideByModerator(publicToken, modId);

    expect(await gazetteService.shelfToday()).toHaveLength(0);
    expect(await gazetteService.byToken(publicToken)).toBeNull();
  });

  it('gizleme MANŞETLERİ SİLMEZ', async () => {
    // Gizleme bir sunum kararıdır; tahmin geçmişini yok etmek bambaşka ve
    // çok daha ağır bir yaptırımdır.
    const { userId } = await createUser('aslan');
    const { userId: modId } = await createUser('yonetici');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'Sorunlu kapak',
      predictionIds: [id],
      isPublic: true,
    });

    await gazetteService.hideByModerator(publicToken, modId);

    const stillThere = await db.select().from(predictions).where(eq(predictions.id, id));
    expect(stillThere).toHaveLength(1);
  });

  it('ikinci gizleme reddedilir — ilk kararın sahibi korunur', async () => {
    const { userId } = await createUser('aslan');
    const { userId: modId } = await createUser('yonetici');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    const { publicToken } = await gazetteService.create({
      ownerId: userId,
      title: 'Kapak',
      predictionIds: [id],
      isPublic: true,
    });

    await gazetteService.hideByModerator(publicToken, modId);
    await expect(gazetteService.hideByModerator(publicToken, modId)).rejects.toThrow();
  });
});

describe('küfür süzgeci gazete başlığında', () => {
  it('kaba başlık REDDEDİLİR — kapak hiç kurulmaz', async () => {
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);

    await expect(
      gazetteService.create({ ownerId: userId, title: 'siktir git', predictionIds: [id] }),
    ).rejects.toThrow();

    expect(await gazetteService.listMine(userId)).toHaveLength(0);
    // Tahmin serbest kalmalı: reddedilen kapak tahmini tüketmez.
    const eligible = await gazetteService.eligible(userId);
    expect(eligible.map((r) => r.predictionId)).toContain(id);
  });

  it('GİZLİ kapakta da süzgeç çalışır', async () => {
    // "Nasılsa gizli" demek yanlış: bağlantı paylaşılır ve metin başkasının
    // ekranında belirir.
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    await expect(
      gazetteService.create({
        ownerId: userId,
        title: 'amk bu maç',
        predictionIds: [id],
        isPublic: false,
      }),
    ).rejects.toThrow();
  });

  it('başlıkta BAĞLANTI kabul edilmez', async () => {
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    await expect(
      gazetteService.create({
        ownerId: userId,
        title: 'kazanc icin www.kotu.example',
        predictionIds: [id],
      }),
    ).rejects.toThrow(/bağlantı/i);
  });
});

describe('raf sıralaması', () => {
  it('"Tuttu" rafı yalnızca SONUÇLANMIŞ ve İSABETLİ kapakları alır', async () => {
    const { userId } = await createUser('aslan');

    const bekleyen = await makeEvent();
    const tutan = await makeEvent();
    const tutmayan = await makeEvent();

    const idBekleyen = await predict(userId, bekleyen.eventId, bekleyen.byKey.HOME!);
    const idTutan = await predict(userId, tutan.eventId, tutan.byKey.HOME!);
    const idTutmayan = await predict(userId, tutmayan.eventId, tutmayan.byKey.HOME!);

    const a = await gazetteService.create({
      ownerId: userId,
      title: 'Bekleyen kapak',
      predictionIds: [idBekleyen],
      isPublic: true,
    });
    const b = await gazetteService.create({
      ownerId: userId,
      title: 'Tutan kapak',
      predictionIds: [idTutan],
      isPublic: true,
    });
    const c = await gazetteService.create({
      ownerId: userId,
      title: 'Tutmayan kapak',
      predictionIds: [idTutmayan],
      isPublic: true,
    });

    await db
      .update(events)
      .set({ status: 'RESOLVED', resolvedOutcomeId: tutan.byKey.HOME!, resolvedAt: new Date() })
      .where(eq(events.id, tutan.eventId));
    await db
      .update(events)
      .set({ status: 'RESOLVED', resolvedOutcomeId: tutmayan.byKey.AWAY!, resolvedAt: new Date() })
      .where(eq(events.id, tutmayan.eventId));

    const hits = await gazetteService.shelfHits();
    const tokens = hits.map((g) => g.publicToken);
    expect(tokens).toContain(b.publicToken);
    expect(tokens).not.toContain(a.publicToken);
    expect(tokens).not.toContain(c.publicToken);
  });

  it('"Tuttu" rafı KARNENİN TAMAMINI taşır', async () => {
    // Yalnızca isabetleri göstermek, kapağın kusursuz olduğu izlenimini
    // verirdi.
    const { userId } = await createUser('aslan');
    const x = await makeEvent();
    const y = await makeEvent();
    const idX = await predict(userId, x.eventId, x.byKey.HOME!);
    const idY = await predict(userId, y.eventId, y.byKey.HOME!);

    await gazetteService.create({
      ownerId: userId,
      title: 'İki manşet',
      predictionIds: [idX, idY],
      isPublic: true,
    });

    await db
      .update(events)
      .set({ status: 'RESOLVED', resolvedOutcomeId: x.byKey.HOME!, resolvedAt: new Date() })
      .where(eq(events.id, x.eventId));
    await db
      .update(events)
      .set({ status: 'RESOLVED', resolvedOutcomeId: y.byKey.AWAY!, resolvedAt: new Date() })
      .where(eq(events.id, y.eventId));

    const hits = await gazetteService.shelfHits();
    expect(hits).toHaveLength(1);
    expect(hits[0]!.settled).toBe(2);
    expect(hits[0]!.hits).toBe(1);
  });

  it('SİLİNMİŞ hesabın kapağı hiçbir rafta görünmez', async () => {
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const id = await predict(userId, e.eventId, e.byKey.HOME!);
    await gazetteService.create({
      ownerId: userId,
      title: 'Kapak',
      predictionIds: [id],
      isPublic: true,
    });

    expect(await gazetteService.shelfToday()).toHaveLength(1);
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId));
    expect(await gazetteService.shelfToday()).toHaveLength(0);
  });
});

describe('rafta kişi başına sınır', () => {
  /** Bir kullanıcı için N tane herkese açık kapak kurar. */
  async function makeCovers(userId: string, count: number, prefix: string) {
    const tokens: string[] = [];
    for (let i = 0; i < count; i++) {
      const e = await makeEvent();
      const id = await predict(userId, e.eventId, e.byKey.HOME!);
      const { publicToken } = await gazetteService.create({
        ownerId: userId,
        title: `${prefix} kapak ${i}`,
        predictionIds: [id],
        isPublic: true,
      });
      tokens.push(publicToken);
    }
    return tokens;
  }

  it('TEK KİŞİ rafı dolduramaz', async () => {
    // Kötü niyet gerekmiyor: hevesli bir kullanıcı da aynı sonucu üretir.
    const { userId } = await createUser('coskulu');
    await makeCovers(userId, 8, 'Coşkulu');

    const shelf = await gazetteService.shelfToday();
    expect(shelf.length).toBeLessThanOrEqual(2);
  });

  it('sınır kişi BAŞINA — başkalarına yer kalır', async () => {
    const { userId: a, username: nameA } = await createUser('coskulu');
    const { userId: b, username: nameB } = await createUser('sakin');
    await makeCovers(a, 6, 'Coşkulu');
    await makeCovers(b, 1, 'Sakin');

    const shelf = await gazetteService.shelfToday();
    const byOwner = shelf.reduce<Record<string, number>>((acc, g) => {
      acc[g.ownerUsername] = (acc[g.ownerUsername] ?? 0) + 1;
      return acc;
    }, {});

    expect(byOwner[nameA]).toBe(2);
    // Asıl mesele bu: kalabalık kullanıcı, sessiz kullanıcıyı raftan silmiyor.
    expect(byOwner[nameB]).toBe(1);
  });

  it('SINIRLANAN ŞEY kapak sayısı DEĞİL, raftaki görünürlük', async () => {
    // Kullanıcı istediği kadar kapak kurabilmeli ve hepsinin bağlantısı
    // çalışmalı; kısıtlanan yalnızca ana sayfadaki yer.
    const { userId } = await createUser('coskulu');
    const tokens = await makeCovers(userId, 5, 'Coşkulu');

    expect(await gazetteService.listMine(userId)).toHaveLength(5);
    for (const t of tokens) {
      expect(await gazetteService.byToken(t)).not.toBeNull();
    }
  });

  it('sınır ÜÇ RAFTA da geçerli', async () => {
    const { userId } = await createUser('coskulu');
    await makeCovers(userId, 5, 'Coşkulu');

    expect((await gazetteService.shelfToday()).length).toBeLessThanOrEqual(2);
    expect((await gazetteService.shelfResolvingToday()).length).toBeLessThanOrEqual(2);
    expect((await gazetteService.shelfHits()).length).toBeLessThanOrEqual(2);
  });
});
