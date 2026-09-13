import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { eventComments, notifications } from '../../src/server/db/schema';
import { commentService } from '../../src/server/modules/comment/service';
import { predictionService } from '../../src/server/modules/prediction/service';
import { createEvent, createUser } from '../factories';

/**
 * MEYDAN SOHBETİ.
 *
 * ── KORUNAN ASIL KURAL ─────────────────────────────────────────────────────
 * Tahmin yapmadan sohbet NE OKUNUR NE YAZILIR. Bu bir erişim ayrıntısı değil,
 * ürünün temel mekaniğinin devamı: MEYDAN dağılımı da tahminden önce
 * göstermiyor ("önce sen söyle"). Sohbet serbest okunsaydı aynı bilgi
 * yorumlardan sızar ve konsensüs dürüstlüğü için kurulan her şey işlevsiz
 * kalırdı.
 *
 * Kilidin SUNUCUDA olması şart: arayüzde gizlemek, metni sayfa kaynağında
 * bırakır ve bakan okur. Aşağıdaki testler tam olarak bunu sınıyor —
 * "ekranda görünmüyor" değil, "veri hiç gelmiyor".
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE event_comment, prediction_share, gazette_item, gazette, notification,
                           feed_item, coin_ledger, coin_account, challenge, prediction,
                           event_outcome, event, category, "user" CASCADE`;
});

afterAll(async () => {
  await sql.end();
});

/** Tahmin yapmış bir kullanıcı üretir — sohbetin ön şartı. */
async function tahminYapmis(name: string, e: Awaited<ReturnType<typeof createEvent>>, i = 0) {
  const u = await createUser(name);
  await predictionService.create({
    userId: u.userId,
    eventId: e.eventId,
    outcomeId: e.outcomes[i]!.id,
  });
  return u;
}

describe('kilit: tahmin yapmadan sohbet yok', () => {
  it('tahmin YAPMAMIŞ kullanıcıya yorum METNİ GÖNDERİLMEZ', async () => {
    const e = await createEvent();
    const yazan = await tahminYapmis('emir', e);
    await commentService.create({
      eventId: e.eventId,
      authorId: yazan.userId,
      body: 'Ev sahibi bu maçı alır, savunması çok iyi.',
    });

    const merakli = await createUser('merakli');
    const view = await commentService.view(e.eventId, merakli.userId);

    expect(view.locked).toBe(true);
    // Metin nesnenin HİÇBİR yerinde olmamalı: arayüzde gizlemek yetmez.
    expect(JSON.stringify(view)).not.toContain('savunması');
  });

  it('giriş yapmamış ziyaretçiye de kilitli', async () => {
    const e = await createEvent();
    const yazan = await tahminYapmis('emir', e);
    await commentService.create({
      eventId: e.eventId,
      authorId: yazan.userId,
      body: 'Deplasman şaşırtır bence.',
    });

    const view = await commentService.view(e.eventId, null);
    expect(view.locked).toBe(true);
    expect(JSON.stringify(view)).not.toContain('şaşırtır');
  });

  it('SAYI kilitliyken de görünür — bu bir sızıntı değil, davettir', async () => {
    /*
     * "12 yorum var" demek kimin ne dediğini söylemez ama tahmin yapmak için
     * bir sebep verir. Boş bir kilit hiçbir şey anlatmaz.
     */
    const e = await createEvent();
    const yazan = await tahminYapmis('emir', e);
    await commentService.create({ eventId: e.eventId, authorId: yazan.userId, body: 'Bir.' });
    await commentService.create({ eventId: e.eventId, authorId: yazan.userId, body: 'İki.' });

    const merakli = await createUser('merakli');
    const view = await commentService.view(e.eventId, merakli.userId);
    expect(view.locked).toBe(true);
    expect(view.total).toBe(2);
  });

  it('tahmin YAPINCA sohbet açılır', async () => {
    const e = await createEvent();
    const yazan = await tahminYapmis('emir', e);
    await commentService.create({
      eventId: e.eventId,
      authorId: yazan.userId,
      body: 'Ev sahibi alır.',
    });

    const gelen = await tahminYapmis('zeynep', e, 1);
    const view = await commentService.view(e.eventId, gelen.userId);
    expect(view.locked).toBe(false);
    if (view.locked) throw new Error('kilitli olmamalı');
    expect(view.items).toHaveLength(1);
    expect(view.items[0]!.body).toBe('Ev sahibi alır.');
  });

  it('tahmin yapmadan YAZILAMAZ', async () => {
    const e = await createEvent();
    const yabanci2 = await createUser('yabanci');
    await expect(
      commentService.create({ eventId: e.eventId, authorId: yabanci2.userId, body: 'Selam.' }),
    ).rejects.toThrow(/önce tahminini yap/i);
  });
});

describe('metin kuralları', () => {
  it('bağlantı içeren yorum reddedilir', async () => {
    const e = await createEvent();
    const u = await tahminYapmis('emir', e);
    await expect(
      commentService.create({
        eventId: e.eventId,
        authorId: u.userId,
        body: 'Detaylar burada: bahissitesi.com',
      }),
    ).rejects.toThrow();
  });

  it('boş yorum yazılamaz', async () => {
    const e = await createEvent();
    const u = await tahminYapmis('emir', e);
    await expect(
      commentService.create({ eventId: e.eventId, authorId: u.userId, body: '   ' }),
    ).rejects.toThrow();
  });

  it('sınırın üstündeki yorum reddedilir', async () => {
    const e = await createEvent();
    const u = await tahminYapmis('emir', e);
    await expect(
      commentService.create({ eventId: e.eventId, authorId: u.userId, body: 'a'.repeat(501) }),
    ).rejects.toThrow();
  });
});

describe('tek seviye cevap', () => {
  it('cevaba cevap YAZILAMAZ', async () => {
    /*
     * Derin ağaçlar telefonda okunamaz ve tartışmayı konudan koparır.
     * Kural veritabanında ifade edilemediği için (PostgreSQL kısmi yabancı
     * anahtarı desteklemiyor) serviste duruyor — bu test onun bekçisi.
     */
    const e = await createEvent();
    const a = await tahminYapmis('emir', e);
    const b = await tahminYapmis('zeynep', e, 1);

    const kok = await commentService.create({
      eventId: e.eventId,
      authorId: a.userId,
      body: 'Ev sahibi alır.',
    });
    const cevap = await commentService.create({
      eventId: e.eventId,
      authorId: b.userId,
      body: 'Katılmıyorum.',
      parentId: kok.commentId,
    });

    await expect(
      commentService.create({
        eventId: e.eventId,
        authorId: a.userId,
        body: 'Neden?',
        parentId: cevap.commentId,
      }),
    ).rejects.toThrow(/Cevaba cevap/i);
  });

  it('BAŞKA etkinliğin yorumuna cevap yazılamaz', async () => {
    const e1 = await createEvent();
    const e2 = await createEvent();
    const a = await tahminYapmis('emir', e1);
    await predictionService.create({
      userId: a.userId,
      eventId: e2.eventId,
      outcomeId: e2.outcomes[0]!.id,
    });

    const kok = await commentService.create({
      eventId: e1.eventId,
      authorId: a.userId,
      body: 'Birinci maç.',
    });

    await expect(
      commentService.create({
        eventId: e2.eventId,
        authorId: a.userId,
        body: 'İkinci maça bağlanmaz.',
        parentId: kok.commentId,
      }),
    ).rejects.toThrow();
  });

  it('cevaplar kök yorumun altında toplanır', async () => {
    const e = await createEvent();
    const a = await tahminYapmis('emir', e);
    const b = await tahminYapmis('zeynep', e, 1);

    const kok = await commentService.create({
      eventId: e.eventId,
      authorId: a.userId,
      body: 'Ev sahibi alır.',
    });
    await commentService.create({
      eventId: e.eventId,
      authorId: b.userId,
      body: 'Katılmıyorum.',
      parentId: kok.commentId,
    });

    const view = await commentService.view(e.eventId, a.userId);
    if (view.locked) throw new Error('kilitli olmamalı');
    expect(view.items).toHaveLength(1);
    expect(view.items[0]!.replies).toHaveLength(1);
    expect(view.items[0]!.replies[0]!.body).toBe('Katılmıyorum.');
  });
});

describe('silme ve gizleme', () => {
  it('yazar kendi yorumunu siler: METİN gider, SATIR kalır', async () => {
    /*
     * Satır da silinseydi o yoruma verilmiş cevaplar öksüz kalır ve okuyucu
     * neye cevap verildiğini anlayamazdı.
     */
    const e = await createEvent();
    const a = await tahminYapmis('emir', e);
    const b = await tahminYapmis('zeynep', e, 1);

    const kok = await commentService.create({
      eventId: e.eventId,
      authorId: a.userId,
      body: 'Silinecek söz.',
    });
    await commentService.create({
      eventId: e.eventId,
      authorId: b.userId,
      body: 'Cevap yerinde kalmalı.',
      parentId: kok.commentId,
    });

    await commentService.removeOwn(kok.commentId, a.userId);

    const view = await commentService.view(e.eventId, a.userId);
    if (view.locked) throw new Error('kilitli olmamalı');
    expect(view.items).toHaveLength(1);
    expect(view.items[0]!.deleted).toBe(true);
    expect(view.items[0]!.body).toBeNull();
    expect(view.items[0]!.replies[0]!.body).toBe('Cevap yerinde kalmalı.');
  });

  it('BAŞKASININ yorumu silinemez', async () => {
    const e = await createEvent();
    const a = await tahminYapmis('emir', e);
    const b = await tahminYapmis('zeynep', e, 1);
    const c = await commentService.create({
      eventId: e.eventId,
      authorId: a.userId,
      body: 'Benim sözüm.',
    });
    await expect(commentService.removeOwn(c.commentId, b.userId)).rejects.toThrow(
      /kendi yorumunu/i,
    );
  });

  it('gizlenen yorumun METNİ hiç gönderilmez', async () => {
    const e = await createEvent();
    const a = await tahminYapmis('emir', e);
    const mod = await createUser('moderator');
    const c = await commentService.create({
      eventId: e.eventId,
      authorId: a.userId,
      body: 'Kurallara aykırı bir cümle.',
    });

    await commentService.hide(c.commentId, mod.userId);

    const view = await commentService.view(e.eventId, a.userId);
    if (view.locked) throw new Error('kilitli olmamalı');
    expect(view.items[0]!.hidden).toBe(true);
    expect(view.items[0]!.body).toBeNull();
    expect(JSON.stringify(view)).not.toContain('aykırı');
  });

  it('silinen ve gizlenen yorum SAYIYA girmez', async () => {
    const e = await createEvent();
    const a = await tahminYapmis('emir', e);
    const mod = await createUser('moderator');
    const bir = await commentService.create({
      eventId: e.eventId,
      authorId: a.userId,
      body: 'Bir.',
    });
    const iki = await commentService.create({
      eventId: e.eventId,
      authorId: a.userId,
      body: 'İki.',
    });
    await commentService.create({ eventId: e.eventId, authorId: a.userId, body: 'Üç.' });

    await commentService.removeOwn(bir.commentId, a.userId);
    await commentService.hide(iki.commentId, mod.userId);

    expect(await commentService.count(e.eventId)).toBe(1);
  });

  it('gizli yoruma cevap yazılamaz', async () => {
    const e = await createEvent();
    const a = await tahminYapmis('emir', e);
    const mod = await createUser('moderator');
    const c = await commentService.create({
      eventId: e.eventId,
      authorId: a.userId,
      body: 'Gizlenecek.',
    });
    await commentService.hide(c.commentId, mod.userId);

    await expect(
      commentService.create({
        eventId: e.eventId,
        authorId: a.userId,
        body: 'Cevap',
        parentId: c.commentId,
      }),
    ).rejects.toThrow();
  });

  it('gizleme kaydı EKSİK OLAMAZ — kim gizledi yazılır', async () => {
    const e = await createEvent();
    const a = await tahminYapmis('emir', e);
    const mod = await createUser('moderator');
    const c = await commentService.create({
      eventId: e.eventId,
      authorId: a.userId,
      body: 'Gizlenecek.',
    });
    await commentService.hide(c.commentId, mod.userId);

    const row = (
      await db.select().from(eventComments).where(eq(eventComments.id, c.commentId))
    )[0]!;
    expect(row.hiddenAt).not.toBeNull();
    expect(row.hiddenById).toBe(mod.userId);
  });
});

describe('cevap bildirimi', () => {
  it('cevap alan kişiye bildirim gider', async () => {
    const e = await createEvent();
    const a = await tahminYapmis('emir', e);
    const b = await tahminYapmis('zeynep', e, 1);
    const kok = await commentService.create({
      eventId: e.eventId,
      authorId: a.userId,
      body: 'Ev sahibi alır.',
    });
    await commentService.create({
      eventId: e.eventId,
      authorId: b.userId,
      body: 'Katılmıyorum.',
      parentId: kok.commentId,
    });

    const rows = await db.select().from(notifications).where(eq(notifications.userId, a.userId));
    expect(rows.some((r) => r.type === 'COMMENT_REPLY')).toBe(true);
  });

  it('KENDİ yorumuna cevap yazana bildirim GİTMEZ', async () => {
    // Kendi kendine bildirim, bildirimleri değersizleştirir.
    const e = await createEvent();
    const a = await tahminYapmis('emir', e);
    const kok = await commentService.create({
      eventId: e.eventId,
      authorId: a.userId,
      body: 'Ev sahibi alır.',
    });
    await commentService.create({
      eventId: e.eventId,
      authorId: a.userId,
      body: 'Ekleme yapayım.',
      parentId: kok.commentId,
    });

    const rows = await db.select().from(notifications).where(eq(notifications.userId, a.userId));
    expect(rows.filter((r) => r.type === 'COMMENT_REPLY')).toHaveLength(0);
  });
});

describe('sohbet PUAN KAZANDIRMAZ', () => {
  it('yorum yazmak Tahmin Gücünü ve çipi değiştirmez', async () => {
    /*
     * Ürün kuralı 41-42. Kazandırsaydı sohbet, konuşmak için değil puan
     * toplamak için kullanılırdı ve ürün kendi ölçüsünü bozardı.
     */
    const { reputationService } = await import('../../src/server/modules/reputation/service');
    const { coinService } = await import('../../src/server/modules/economy/service');

    const e = await createEvent();
    const a = await tahminYapmis('emir', e);

    const oncePower = (await reputationService.getSummary(a.userId)).power;
    const onceBalance = await coinService.getBalance(a.userId);

    for (let i = 0; i < 3; i += 1) {
      await commentService.create({
        eventId: e.eventId,
        authorId: a.userId,
        body: `Yorum ${i}`,
      });
    }

    expect((await reputationService.getSummary(a.userId)).power).toBe(oncePower);
    expect(await coinService.getBalance(a.userId)).toBe(onceBalance);
  });
});
