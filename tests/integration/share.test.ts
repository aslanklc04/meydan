import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { eventOutcomes, events, predictions, users } from '../../src/server/db/schema';
import { catalogService } from '../../src/server/modules/catalog/service';
import { shareService } from '../../src/server/modules/share/service';
import { createUser } from '../factories';

/**
 * TEK SORULUK MEYDAN OKUMA.
 *
 * Buradaki testlerin ağırlık merkezi tek bir kuralda: GÖNDERENİN CEVABI,
 * ALICI KENDİ CEVABINI VERMEDEN GÖRÜNMEZ.
 *
 * Bu bir sürpriz efekti değil, ölçüm bütünlüğü meselesidir. Gönderenin cevabı
 * önce görünürse alıcının verdiği cevap kendi görüşü olmaktan çıkar,
 * "arkadaşıma katılıyorum" ya da "ona inat" kararına dönüşür. Ürünün
 * topladığı veri o an anlamını kaybeder.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE prediction_share, gazette_item, gazette, notification, feed_item,
                           coin_ledger, coin_account, challenge, prediction, event_outcome,
                           event, category, "user" CASCADE`;
  await sql`INSERT INTO category (id, slug, name, icon, kind, sort_order)
            VALUES ('cat-spor', 'spor', 'Spor', '⚽', 'GENERAL', 0)`;
});

afterAll(async () => {
  await sql.end();
});

let seq = 0;

async function makeEvent(opts?: { closesInMs?: number }) {
  const { userId: adminId } = await createUser(`kurucu${seq}`);
  await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, adminId));

  const n = seq++;
  const { eventId } = await catalogService.createEvent({
    categorySlug: 'spor',
    title: `Takım A${n} — Takım B${n}`,
    question: 'Bu maçı kim kazanacak?',
    slug: `mac-paylas-${n}`,
    closesAt: new Date(Date.now() + (opts?.closesInMs ?? 3600_000)),
    resolvesAt: new Date(Date.now() + 9000_000),
    outcomes: [
      { key: 'HOME', label: `Takım A${n}` },
      { key: 'DRAW', label: 'Beraberlik' },
      { key: 'AWAY', label: `Takım B${n}` },
    ],
    createdById: adminId,
    status: 'OPEN',
  });

  const outcomes = await db.select().from(eventOutcomes).where(eq(eventOutcomes.eventId, eventId));
  return { eventId, byKey: Object.fromEntries(outcomes.map((o) => [o.key, o.id])) };
}

async function predict(userId: string, eventId: string, outcomeId: string) {
  const rows = await db
    .insert(predictions)
    .values({ userId, eventId, outcomeId, categoryId: 'cat-spor' })
    .returning({ id: predictions.id });
  return rows[0]!.id;
}

describe('bağlantı üretme', () => {
  it('tahmin için paylaşılabilir bir jeton üretir', async () => {
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const p = await predict(userId, e.eventId, e.byKey.HOME!);

    const token = await shareService.createForPrediction(p, userId);
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(token).not.toContain(userId);
    expect(token).not.toContain(p);
  });

  it('İDEMPOTENT: ikinci çağrı AYNI jetonu döner', async () => {
    // Her basışta yeni jeton üretilseydi sayaçlar adreslere bölünür ve
    // hangisinin işe yaradığı söylenemezdi.
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const p = await predict(userId, e.eventId, e.byKey.HOME!);

    const first = await shareService.createForPrediction(p, userId);
    const second = await shareService.createForPrediction(p, userId);
    expect(second).toBe(first);
  });

  it('BAŞKASININ tahmini paylaşılamaz', async () => {
    const { userId: mine } = await createUser('aslan');
    const { userId: other } = await createUser('baskasi');
    const e = await makeEvent();
    const theirs = await predict(other, e.eventId, e.byKey.HOME!);

    await expect(shareService.createForPrediction(theirs, mine)).rejects.toThrow();
  });
});

describe('ÖNCE SEN SÖYLE — gönderenin cevabı', () => {
  async function setup() {
    const { userId: sender } = await createUser('gonderen');
    const { userId: viewer } = await createUser('alici');
    const e = await makeEvent();
    const p = await predict(sender, e.eventId, e.byKey.HOME!);
    const token = await shareService.createForPrediction(p, sender);
    return { sender, viewer, e, token };
  }

  it('MİSAFİRE gönderenin cevabı GÖNDERİLMEZ', async () => {
    const { token } = await setup();
    const view = await shareService.byToken(token, null);

    expect(view).not.toBeNull();
    expect(view!.senderOutcomeId).toBeNull();
    // Nesnenin İÇİNDE de yok — gizlenmiş değil, gönderilmemiş.
    expect(JSON.stringify(view)).not.toContain('"senderOutcomeId":"');
  });

  it('TAHMİN YAPMAMIŞ üyeye de GÖNDERİLMEZ', async () => {
    const { viewer, token } = await setup();
    const view = await shareService.byToken(token, viewer);
    expect(view!.senderOutcomeId).toBeNull();
  });

  it('alıcı KENDİ tahminini yapınca AÇILIR', async () => {
    const { viewer, e, token } = await setup();
    await predict(viewer, e.eventId, e.byKey.AWAY!);

    const view = await shareService.byToken(token, viewer);
    expect(view!.senderOutcomeId).toBe(e.byKey.HOME);
    expect(view!.viewerOutcomeId).toBe(e.byKey.AWAY);
  });

  it('etkinlik SONUÇLANDIYSA gizlemenin anlamı kalmaz — açılır', async () => {
    const { token, e } = await setup();
    await db
      .update(events)
      .set({ status: 'RESOLVED', resolvedOutcomeId: e.byKey.HOME!, resolvedAt: new Date() })
      .where(eq(events.id, e.eventId));

    const view = await shareService.byToken(token, null);
    expect(view!.senderOutcomeId).toBe(e.byKey.HOME);
    expect(view!.resolvedOutcomeLabel).not.toBeNull();
  });

  it('soru ve seçenekler HERKESE görünür — cevap verebilmek için gerekli', async () => {
    const { token } = await setup();
    const view = await shareService.byToken(token, null);
    expect(view!.question).toBe('Bu maçı kim kazanacak?');
    expect(view!.outcomes).toHaveLength(3);
    // Sıra bozulmamalı: ev sahibi · beraberlik · deplasman.
    expect(view!.outcomes[1]!.label).toBe('Beraberlik');
  });

  it('ziyaretçiye KALABALIK DAĞILIMI hiç gönderilmez', async () => {
    const { token } = await setup();
    const json = JSON.stringify(await shareService.byToken(token, null));
    expect(json).not.toContain('share');
    expect(json).not.toContain('consensus');
    expect(json).not.toContain('count');
  });
});

describe('görünürlük', () => {
  it('bilinmeyen jeton null döner (hata değil)', async () => {
    expect(await shareService.byToken('yok-boyle-jeton', null)).toBeNull();
  });

  it('hesabını SİLMİŞ kullanıcının meydan okuması yayından kalkar', async () => {
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const p = await predict(userId, e.eventId, e.byKey.HOME!);
    const token = await shareService.createForPrediction(p, userId);

    expect(await shareService.byToken(token, null)).not.toBeNull();
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId));
    expect(await shareService.byToken(token, null)).toBeNull();
  });

  it('KAPANMIŞ soruda bağlantı açılır ama artık cevap alınmaz', async () => {
    // Bağlantı ölmemeli: alıcı sonucu görmek için geri gelebilmeli.
    const { userId } = await createUser('aslan');
    const e = await makeEvent({ closesInMs: -1000 });
    const p = await predict(userId, e.eventId, e.byKey.HOME!);
    const token = await shareService.createForPrediction(p, userId);

    const view = await shareService.byToken(token, null);
    expect(view).not.toBeNull();
    expect(view!.isOpen).toBe(false);
  });
});

describe('atıf sayaçları', () => {
  it('görüntülenme, cevap ve kayıt AYRI sayılır', async () => {
    // Yalnız görüntülenmeyi saymak, paylaşımın işe yaradığı yanılgısını verir.
    const { userId } = await createUser('aslan');
    const e = await makeEvent();
    const p = await predict(userId, e.eventId, e.byKey.HOME!);
    const token = await shareService.createForPrediction(p, userId);

    await shareService.countView(token);
    await shareService.countView(token);
    await shareService.countView(token);
    await shareService.countAnswer(token);
    await shareService.countSignup(token);

    const mine = await shareService.listMine(userId);
    expect(mine[0]!.viewCount).toBe(3);
    expect(mine[0]!.answerCount).toBe(1);
    expect(mine[0]!.signupCount).toBe(1);
  });

  it('bilinmeyen jetonda sayaçlar SESSİZ kalır', async () => {
    await expect(shareService.countView('yok')).resolves.toBeUndefined();
    await expect(shareService.countAnswer('yok')).resolves.toBeUndefined();
    await expect(shareService.countSignup('yok')).resolves.toBeUndefined();
  });
});
