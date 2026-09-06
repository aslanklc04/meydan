import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { eventTemplates, events } from '../../src/server/db/schema';
import { recurringService } from '../../src/server/modules/catalog/recurring.service';
import { ensureCategory } from '../factories';

/**
 * Tekrarlayan etkinlik üretimi — ADR-16.
 *
 * En kritik davranış: İDEMPOTENCY. Bir zamanlayıcı aynı işi gün içinde birçok
 * kez çalıştırabilir; kopya etkinlik üretmemesi gerekir.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE event_outcome, event, event_template, category, "user" CASCADE`;
});

afterAll(async () => {
  await sql.end();
});

async function createTemplate(overrides: Partial<typeof eventTemplates.$inferInsert> = {}) {
  const categoryId = await ensureCategory('spor');
  const inserted = await db
    .insert(eventTemplates)
    .values({
      slug: 'gunluk-derbi',
      categoryId,
      titlePattern: 'Günün maçı — {tarih}',
      questionPattern: '{tarih} tarihli maçı kim kazanacak?',
      slugPattern: 'gunun-maci-{tarih}',
      outcomes: [
        { key: 'HOME', label: 'Ev sahibi' },
        { key: 'AWAY', label: 'Deplasman' },
      ],
      recurrence: 'DAILY',
      closesAtLocal: '20:00',
      resolvesAtLocal: '23:00',
      generateAheadDays: 2,
      ...overrides,
    })
    .returning({ id: eventTemplates.id });
  return inserted[0]!.id;
}

/** Sabit bir referans an — testin bugüne bağlı olmaması için. */
const NOW = new Date('2026-06-10T08:00:00.000Z');

describe('tekrarlayan etkinlik', () => {
  it('şablondan ileri günler için etkinlik üretir', async () => {
    await createTemplate();

    const result = await recurringService.generate(NOW);

    // Bugün + 2 gün ileri = 3 etkinlik (hepsinin kapanışı 20:00, hepsi gelecekte).
    expect(result.created).toBe(3);

    const rows = await db.select().from(events);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.slug).sort()).toEqual([
      'gunun-maci-2026-06-10',
      'gunun-maci-2026-06-11',
      'gunun-maci-2026-06-12',
    ]);
    // Desen değişkeni gerçekten dolduruluyor mu?
    expect(rows.some((r) => r.title === 'Günün maçı — 2026-06-11')).toBe(true);
  });

  it('İKİNCİ çalıştırma KOPYA üretmez', async () => {
    await createTemplate();

    const first = await recurringService.generate(NOW);
    const second = await recurringService.generate(NOW);

    expect(first.created).toBe(3);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(3);

    const rows = await db.select().from(events);
    expect(rows).toHaveLength(3);
  });

  it('her etkinliğe şablondaki sonuçlar eklenir', async () => {
    await createTemplate();
    await recurringService.generate(NOW);

    const rows = await sql`
      SELECT e.slug, count(o.id)::int AS n
        FROM event e JOIN event_outcome o ON o.event_id = e.id
       GROUP BY e.slug`;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.n === 2)).toBe(true);
  });

  it('pasif şablon etkinlik üretmez', async () => {
    await createTemplate({ active: false });
    const result = await recurringService.generate(NOW);
    expect(result.created).toBe(0);
    expect(result.templates).toBe(0);
  });

  it('HAFTA İÇİ kuralı hafta sonunu atlar', async () => {
    // 2026-06-13 Cumartesi, 2026-06-14 Pazar.
    await createTemplate({ recurrence: 'WEEKDAYS', generateAheadDays: 3 });

    const friday = new Date('2026-06-12T08:00:00.000Z');
    const result = await recurringService.generate(friday);

    const rows = await db.select({ slug: events.slug }).from(events);
    expect(rows.map((r) => r.slug).sort()).toEqual([
      'gunun-maci-2026-06-12',
      'gunun-maci-2026-06-15',
    ]);
    expect(result.created).toBe(2);
  });

  it('kapanış saati geçmiş gün için etkinlik ÜRETİLMEZ', async () => {
    await createTemplate({ generateAheadDays: 0 });

    // Saat 21:00 — o günün 20:00 kapanışı çoktan geçti.
    const late = new Date('2026-06-10T21:00:00.000Z');
    const result = await recurringService.generate(late);

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('iki sonuçtan az tanımlanmış şablon atlanır (ürün kuralı)', async () => {
    await createTemplate({ outcomes: [{ key: 'ONLY', label: 'Tek seçenek' }] });
    const result = await recurringService.generate(NOW);
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('üretilen etkinlik şablona bağlanır', async () => {
    const templateId = await createTemplate({ generateAheadDays: 0 });
    await recurringService.generate(NOW);

    const rows = await db
      .select({ templateId: events.templateId })
      .from(events)
      .where(eq(events.templateId, templateId));
    expect(rows).toHaveLength(1);
  });
});
