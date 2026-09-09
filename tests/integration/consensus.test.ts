import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { events, eventOutcomes, predictions, users } from '../../src/server/db/schema';
import { consensusService } from '../../src/server/modules/catalog/consensus.service';
import { catalogService } from '../../src/server/modules/catalog/service';
import { createUser } from '../factories';
import { socialProof } from '../../src/config/social-proof';

/**
 * KONSENSÜS — ürünün en kolay sessizce bozulacak kuralı.
 *
 * "Önce sen söyle" bir arayüz tercihi değil, ölçüm bütünlüğü meselesidir:
 * kalabalığı önce gösterirsen topladığın veri "insanlar ne düşünüyor" değil
 * "insanlar çoğunluğa ne kadar uyuyor" olur. Bu yüzden buradaki en kritik
 * test, dağılımın tahmin yapmamış kullanıcıya HİÇ GÖNDERİLMEMESİDİR —
 * gizlenmesi değil, gönderilmemesi.
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
});

afterAll(async () => {
  await sql.end();
});

/** Etkinlik + N tahmin üretir; dağılımı çağıran belirler. */
async function seedEvent(distribution: Record<string, number>) {
  const { userId: adminId } = await createUser('kurucu');
  await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, adminId));

  const { eventId } = await catalogService.createEvent({
    categorySlug: 'spor',
    title: 'Takım A — Takım B',
    question: 'Bu maçı kim kazanacak?',
    slug: 'mac-test',
    closesAt: new Date(Date.now() + 3600_000),
    resolvesAt: new Date(Date.now() + 9000_000),
    outcomes: [
      { key: 'HOME', label: 'Takım A' },
      { key: 'DRAW', label: 'Beraberlik' },
      { key: 'AWAY', label: 'Takım B' },
    ],
    createdById: adminId,
    status: 'OPEN',
  });

  const outcomes = await db.select().from(eventOutcomes).where(eq(eventOutcomes.eventId, eventId));
  const byKey = Object.fromEntries(outcomes.map((o) => [o.key, o.id]));

  let n = 0;
  for (const [key, count] of Object.entries(distribution)) {
    for (let i = 0; i < count; i++) {
      const { userId } = await createUser(`tahminci${n++}`);
      await db.insert(predictions).values({
        userId,
        eventId,
        outcomeId: byKey[key]!,
        categoryId: 'cat-spor',
      });
    }
  }
  return { eventId, byKey };
}

describe('önce sen söyle', () => {
  it('TAHMİN YAPMAMIŞ kullanıcıya dağılım GÖNDERİLMEZ', async () => {
    const { eventId } = await seedEvent({ HOME: 40, AWAY: 10 });

    const view = await consensusService.view(eventId, null);

    expect(view.revealed).toBe(false);
    // Nesnenin İÇİNDE dağılım olmamalı — gizlenmiş değil, yok.
    expect(Object.keys(view)).toEqual(['revealed', 'total']);
    expect(JSON.stringify(view)).not.toContain('share');
  });

  it('toplam katılımcı sayısı gösterilebilir (yön göstermez)', async () => {
    const { eventId } = await seedEvent({ HOME: 40, AWAY: 10 });
    const view = await consensusService.view(eventId, null);
    expect(view.total).toBe(50);
  });

  it('tahmin yapan kullanıcı dağılımı GÖRÜR', async () => {
    const { eventId, byKey } = await seedEvent({ HOME: 40, AWAY: 10 });

    const view = await consensusService.view(eventId, byKey.HOME!);
    if (!view.revealed) throw new Error('dağılım açılmalıydı');

    expect(view.total).toBe(50);
    expect(view.shares).not.toBeNull();
    expect(view.userShare).toBeCloseTo(0.8, 5);
  });
});

describe('düşük örneklem koruması', () => {
  it('eşiğin ALTINDA yüzde ÜRETİLMEZ — sahte sosyal kanıt yok', async () => {
    const { eventId, byKey } = await seedEvent({ HOME: 2, AWAY: 1 });

    const view = await consensusService.view(eventId, byKey.HOME!);
    if (!view.revealed) throw new Error('açılmalıydı');

    // 2/3 = %67 diye gösterilseydi, arkasında üç kişi olduğu görünmezdi.
    expect(view.shares).toBeNull();
    expect(view.userShare).toBeNull();
    expect(view.position).toBeNull();
    // Ama sayının kendisi dürüstçe gösterilir.
    expect(view.total).toBe(3);
  });

  it('eşikte yüzde açılır', async () => {
    const n = socialProof.minSampleForPercentage;
    const { eventId, byKey } = await seedEvent({ HOME: n - 5, AWAY: 5 });

    const view = await consensusService.view(eventId, byKey.HOME!);
    if (!view.revealed) throw new Error('açılmalıydı');
    expect(view.total).toBe(n);
    expect(view.shares).not.toBeNull();
  });
});

describe('azınlık / çoğunluk', () => {
  it('azınlıktaki kullanıcıyı AZINLIK olarak işaretler', async () => {
    const { eventId, byKey } = await seedEvent({ HOME: 45, AWAY: 5 });
    const view = await consensusService.view(eventId, byKey.AWAY!);
    if (!view.revealed) throw new Error('açılmalıydı');
    expect(view.position).toBe('MINORITY');
  });

  it('çoğunluktaki kullanıcıyı ÇOĞUNLUK olarak işaretler', async () => {
    const { eventId, byKey } = await seedEvent({ HOME: 45, AWAY: 5 });
    const view = await consensusService.view(eventId, byKey.HOME!);
    if (!view.revealed) throw new Error('açılmalıydı');
    expect(view.position).toBe('MAJORITY');
  });

  it('başa baş dağılımda taraf tutmaz', async () => {
    const { eventId, byKey } = await seedEvent({ HOME: 20, AWAY: 20 });
    const view = await consensusService.view(eventId, byKey.HOME!);
    if (!view.revealed) throw new Error('açılmalıydı');
    expect(view.position).toBe('SPLIT');
  });
});

describe('dondurulmuş konsensüs', () => {
  it('donduktan SONRA yeni tahminler geçmişi DEĞİŞTİRMEZ', async () => {
    const { eventId, byKey } = await seedEvent({ HOME: 40, AWAY: 10 });

    await consensusService.freeze(eventId);
    const before = await consensusService.view(eventId, byKey.AWAY!);
    if (!before.revealed) throw new Error('açılmalıydı');
    expect(before.userShare).toBeCloseTo(0.2, 5);
    expect(before.frozen).toBe(true);

    // Kapanıştan sonra 100 kişi daha AWAY dese bile paylaşılmış kart değişmez.
    for (let i = 0; i < 100; i++) {
      const { userId } = await createUser(`sonradan${i}`);
      await db
        .insert(predictions)
        .values({ userId, eventId, outcomeId: byKey.AWAY!, categoryId: 'cat-spor' });
    }

    const after = await consensusService.view(eventId, byKey.AWAY!);
    if (!after.revealed) throw new Error('açılmalıydı');
    expect(after.total).toBe(50);
    expect(after.userShare).toBeCloseTo(0.2, 5);
  });

  it('İDEMPOTENT: ikinci dondurma geçmişi EZMEZ', async () => {
    const { eventId, byKey } = await seedEvent({ HOME: 40, AWAY: 10 });
    const first = await consensusService.freeze(eventId);
    expect(first).not.toBeNull();

    const { userId } = await createUser('gec_kalan');
    await db
      .insert(predictions)
      .values({ userId, eventId, outcomeId: byKey.AWAY!, categoryId: 'cat-spor' });

    // Bakım işi iki kez çalışsa bile ilk yazan kazanır.
    const second = await consensusService.freeze(eventId);
    expect(second).toBeNull();

    const rows = await db.select().from(events).where(eq(events.id, eventId));
    expect(rows[0]!.consensusSnapshot!.total).toBe(50);
  });
});

describe('yalnız kurt', () => {
  it('kalabalık etkinlikte GERÇEK azınlık kazanınca verilir', async () => {
    const { eventId, byKey } = await seedEvent({ HOME: 95, AWAY: 5 });
    await consensusService.freeze(eventId);
    expect(await consensusService.isLoneWolf(eventId, byKey.AWAY!)).toBe(true);
  });

  it('çoğunluk kazanınca VERİLMEZ', async () => {
    const { eventId, byKey } = await seedEvent({ HOME: 95, AWAY: 5 });
    await consensusService.freeze(eventId);
    expect(await consensusService.isLoneWolf(eventId, byKey.HOME!)).toBe(false);
  });

  it('KÜÇÜK etkinlikte VERİLMEZ — rozet değersizleşmesin', async () => {
    const { eventId, byKey } = await seedEvent({ HOME: 3, AWAY: 1 });
    await consensusService.freeze(eventId);
    // Payı %25, eşiğin altında görünüyor ama katılım 4 kişi.
    expect(await consensusService.isLoneWolf(eventId, byKey.AWAY!)).toBe(false);
  });

  it('DONDURULMAMIŞ etkinlikte VERİLMEZ', async () => {
    const { eventId, byKey } = await seedEvent({ HOME: 95, AWAY: 5 });
    expect(await consensusService.isLoneWolf(eventId, byKey.AWAY!)).toBe(false);
  });
});

describe('kimler sayılır', () => {
  it('silinmiş hesabın tahmini konsensüse GİRMEZ', async () => {
    const { eventId, byKey } = await seedEvent({ HOME: 40, AWAY: 10 });

    const { userId } = await createUser('silinen');
    await db
      .insert(predictions)
      .values({ userId, eventId, outcomeId: byKey.AWAY!, categoryId: 'cat-spor' });
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId));

    const view = await consensusService.view(eventId, byKey.HOME!);
    expect(view.total).toBe(50);
  });
});

describe('kapanış konsensüsü dondurur', () => {
  it('etkinlik KAPANDIĞINDA dondurma kendiliğinden olur', async () => {
    const { eventId, byKey } = await seedEvent({ HOME: 40, AWAY: 10 });

    // Bakım işi değil, kapatma işleminin KENDİSİ dondurmalı — yönetici elle
    // kapattığında da geçmiş sabitlenmiş olsun.
    await catalogService.closeEvent(eventId);

    const rows = await db.select().from(events).where(eq(events.id, eventId));
    expect(rows[0]!.status).toBe('CLOSED');
    expect(rows[0]!.consensusFrozenAt).not.toBeNull();
    expect(rows[0]!.consensusSnapshot!.total).toBe(50);

    const view = await consensusService.view(eventId, byKey.AWAY!);
    if (!view.revealed) throw new Error('açılmalıydı');
    expect(view.frozen).toBe(true);
  });
});
