import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { categories } from '../../src/server/db/schema';
import { onboardingService } from '../../src/server/modules/identity/onboarding.service';
import { catalogService } from '../../src/server/modules/catalog/service';
import { createEvent, createUser, ensureCategory } from '../factories';
import { eq } from 'drizzle-orm';

/**
 * Karşılama akışı — Faz 5.
 *
 * Sınanan asıl davranış: karşılama BİR KEZ gösterilir ve ilgi alanı bir
 * FİLTRE değil, SIRALAMA tercihidir. İkincisi bir ürün kararıdır: filtre
 * olsaydı üç kategori seçen yeni kullanıcı boş akışla karşılaşabilirdi.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE user_interest, coin_ledger, coin_account, challenge, prediction,
                           event_outcome, event, category, "user" CASCADE`;
});

afterAll(async () => {
  await sql.end();
});

describe('karşılama', () => {
  it('yeni kullanıcı karşılama ekranını görmelidir', async () => {
    const emir = await createUser('emir');
    expect(await onboardingService.needsOnboarding(emir.userId)).toBe(true);
  });

  it('ilgi alanı seçen kullanıcı karşılamayı BİR DAHA görmez', async () => {
    const emir = await createUser('emir');
    await ensureCategory('spor');

    const { saved } = await onboardingService.complete(emir.userId, ['spor']);

    expect(saved).toBe(1);
    expect(await onboardingService.needsOnboarding(emir.userId)).toBe(false);
    expect(await onboardingService.interestSlugs(emir.userId)).toEqual(['spor']);
  });

  it('ATLAYAN kullanıcı da karşılamayı bir daha görmez', async () => {
    const emir = await createUser('emir');

    // "Şimdilik geç" boş seçimle tamamlar. Atlayan kullanıcıyı her girişte
    // aynı ekranla karşılamak, tercihini yok saymak olurdu.
    await onboardingService.complete(emir.userId, []);

    expect(await onboardingService.needsOnboarding(emir.userId)).toBe(false);
    expect(await onboardingService.interestSlugs(emir.userId)).toEqual([]);
  });

  it('seçim tekrar kaydedilince ESKİ seçim kalmaz', async () => {
    const emir = await createUser('emir');
    await ensureCategory('spor');
    await ensureCategory('kripto');

    await onboardingService.complete(emir.userId, ['spor', 'kripto']);
    await onboardingService.complete(emir.userId, ['kripto']);

    expect(await onboardingService.interestSlugs(emir.userId)).toEqual(['kripto']);
  });

  it('geçersiz ve kopya slug sessizce elenir', async () => {
    const emir = await createUser('emir');
    await ensureCategory('spor');

    const { saved } = await onboardingService.complete(emir.userId, [
      'spor',
      'SPOR',
      'olmayan-kategori',
    ]);

    expect(saved).toBe(1);
    expect(await onboardingService.interestSlugs(emir.userId)).toEqual(['spor']);
  });

  it('pasif kategori seçilemez', async () => {
    const emir = await createUser('emir');
    await ensureCategory('spor');
    await db.update(categories).set({ active: false }).where(eq(categories.slug, 'spor'));

    const { saved } = await onboardingService.complete(emir.userId, ['spor']);
    expect(saved).toBe(0);

    const selectable = await onboardingService.selectableCategories();
    expect(selectable.some((c) => c.slug === 'spor')).toBe(false);
  });
});

describe('akış kişiselleştirmesi', () => {
  it('ilgi alanı SIRALAMAYI değiştirir, içeriği GİZLEMEZ', async () => {
    const emir = await createUser('emir');
    const sporId = await ensureCategory('spor');
    await ensureCategory('kripto');

    // Kripto etkinliği daha ERKEN kapanıyor: sıralama yalnızca kapanışa göre
    // olsaydı önce o gelirdi.
    await createEvent({ categorySlug: 'kripto', closesInMinutes: 60 });
    await createEvent({ categorySlug: 'spor', closesInMinutes: 600 });

    const withoutInterest = await catalogService.listOpenEvents(emir.userId, 20);
    expect(withoutInterest[0]!.categoryName).toBe('Kripto');

    // Spor seçilince spor etkinliği başa geçer ama kripto LİSTEDE KALIR.
    const withInterest = await catalogService.listOpenEvents(emir.userId, 20, undefined, [sporId]);
    expect(withInterest[0]!.categoryName).toBe('Spor');
    expect(withInterest).toHaveLength(2);
  });
});
