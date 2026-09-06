import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, withTransaction, type Tx } from '@/server/db';
import { categories, profiles, userInterests } from '@/server/db/schema';

/**
 * Karşılama akışı — Faz 5.
 *
 * İki karar burada saklanır:
 *   1. Kullanıcı karşılama ekranını gördü mü (`profile.onboardedAt`)?
 *   2. Hangi kategorileri seçti (`user_interest`)?
 *
 * "Atla" da `onboardedAt` yazar. Sebep: karşılama ekranı BİR KEZ gösterilir;
 * atlayan kullanıcıyı her girişte aynı ekranla karşılamak saygısızlıktır.
 * İlgi alanı seçmemek geçerli bir tercihtir — o durumda akış tüm kategorileri
 * gösterir.
 */

type Ctx = Tx | typeof db;

export const onboardingService = {
  /** Karşılama ekranı gösterilmeli mi? */
  async needsOnboarding(userId: string, ctx: Ctx = db): Promise<boolean> {
    const rows = await ctx
      .select({ onboardedAt: profiles.onboardedAt })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    return rows[0]?.onboardedAt == null;
  },

  /** Seçilebilir kategoriler — yönetimde pasifleştirilenler gelmez. */
  async selectableCategories(ctx: Ctx = db) {
    return ctx
      .select({
        id: categories.id,
        slug: categories.slug,
        name: categories.name,
        icon: categories.icon,
      })
      .from(categories)
      .where(eq(categories.active, true))
      .orderBy(asc(categories.sortOrder));
  },

  /** Kullanıcının seçtiği kategori slug'ları. */
  async interestSlugs(userId: string, ctx: Ctx = db): Promise<string[]> {
    const rows = await ctx
      .select({ slug: categories.slug })
      .from(userInterests)
      .innerJoin(categories, eq(categories.id, userInterests.categoryId))
      .where(eq(userInterests.userId, userId));
    return rows.map((r) => r.slug);
  },

  /** Kullanıcının seçtiği kategori kimlikleri — akış filtresi için. */
  async interestCategoryIds(userId: string, ctx: Ctx = db): Promise<string[]> {
    const rows = await ctx
      .select({ categoryId: userInterests.categoryId })
      .from(userInterests)
      .where(eq(userInterests.userId, userId));
    return rows.map((r) => r.categoryId);
  },

  /**
   * İlgi alanlarını kaydeder ve karşılamayı tamamlar.
   *
   * Tam değiştirme (sil-yaz) yapılır: kullanıcı seçimini her zaman baştan
   * belirler; artımlı birleştirme "kaldırdığım kategori neden geri geldi?"
   * sorusunu doğurur.
   */
  async complete(userId: string, slugs: readonly string[]): Promise<{ saved: number }> {
    return withTransaction(async (tx) => {
      const unique = [...new Set(slugs.map((s) => s.trim().toLowerCase()).filter(Boolean))];

      await tx.delete(userInterests).where(eq(userInterests.userId, userId));

      let saved = 0;
      if (unique.length > 0) {
        const rows = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(and(inArray(categories.slug, unique), eq(categories.active, true)));

        if (rows.length > 0) {
          await tx
            .insert(userInterests)
            .values(rows.map((r) => ({ userId, categoryId: r.id })))
            .onConflictDoNothing();
          saved = rows.length;
        }
      }

      await tx
        .update(profiles)
        .set({ onboardedAt: new Date(), updatedAt: new Date() })
        .where(eq(profiles.userId, userId));

      return { saved };
    });
  },
};
