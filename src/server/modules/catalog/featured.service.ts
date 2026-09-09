import { and, asc, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { categories, events } from '@/server/db/schema';
import { log } from '@/server/observability/logger';
import { productDay } from '@/config/time';
import { BusinessRuleError } from '@/server/errors';

/**
 * GÜNÜN MEYDANI (Faz 8).
 *
 * ── NEDEN OTOMATİK SEÇİLİYOR ───────────────────────────────────────────────
 * Günlük ritüelin tek şartı HER GÜN OLMASIDIR. Seçimi tamamen elle bıraksak,
 * ürün ilk unutulan günde susar; kullanıcı boş bir ana sayfa görür ve günlük
 * alışkanlık daha kurulmadan kırılır. Bu yüzden yönetici seçmediyse sistem
 * kendisi seçer.
 *
 * Yönetici seçimi her zaman üstündür: elle konan Günün Meydanı otomatik
 * seçimle EZİLMEZ.
 *
 * ── NEDEN GÜNDE TEK TANE ───────────────────────────────────────────────────
 * Ürünün merkezî mekanikleri — konsensüs, azınlık göstergesi, Yalnız Kurt —
 * hepsi ÖRNEKLEM ister. Günde beş soru açmak, mevcut kalabalığı beşe bölüp
 * her birini eşiğin altında bırakır; sonuçta hiçbir soruda yüzde
 * gösterilemez. Erken aşamada içerik üretmek kolay, kalabalık üretmek zordur.
 * Bu yüzden soru sayısı bir kapasite değil, bir YOĞUNLUK kararıdır.
 *
 * ── SEÇİM KURALI: BASİT VE DETERMİNİSTİK ───────────────────────────────────
 * Öneri motoru YOK. Kural okunabilir ve tekrarlanabilir olmalı ki bir gün
 * "neden bu soru seçildi" diye sorulduğunda cevap verilebilsin:
 *
 *   1. Açık ve henüz kapanmamış olacak
 *   2. Kısa geri bildirim döngüsü — belirlenen saat aralığında kapanacak
 *   3. Daha önce hiç öne çıkarılmamış olacak
 *   4. Spor öncelikli (ilk aşama kararı)
 *   5. Eşitlikte en yakında kapanan, sonra kimliğe göre
 *
 * Son iki kural sıralamayı TAM olarak belirler: aynı veriyle iki kez
 * çalıştırıldığında aynı sonucu verir.
 */

/** Kısa geri bildirim döngüsü: bu aralıkta kapanan etkinlikler aday. */
const MIN_HOURS_AHEAD = 2;
const MAX_HOURS_AHEAD = 72;

/** İlk aşamada öne çıkan içerik ağırlığı bu kategoride. */
const PREFERRED_CATEGORY = 'spor';

export type DailyFeatured = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly question: string;
  readonly closesAt: Date;
  readonly categoryName: string;
  readonly categoryIcon: string;
  readonly isFinancial: boolean;
  readonly predictionCount: number;
};

async function readFeatured(day: string): Promise<DailyFeatured | null> {
  const rows = await db
    .select({
      id: events.id,
      slug: events.slug,
      title: events.title,
      question: events.question,
      closesAt: events.closesAt,
      status: events.status,
      predictionCount: events.predictionCount,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      categoryKind: categories.kind,
    })
    .from(events)
    .innerJoin(categories, eq(categories.id, events.categoryId))
    .where(and(eq(events.featuredDate, day), eq(events.featuredType, 'DAILY_PRIMARY')))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    question: row.question,
    closesAt: row.closesAt,
    categoryName: row.categoryName,
    categoryIcon: row.categoryIcon,
    isFinancial: row.categoryKind === 'FINANCIAL',
    predictionCount: row.predictionCount,
  };
}

export const featuredService = {
  /** Bugünün Meydanı — yoksa null. Ana sayfanın okuduğu tek yol. */
  async today(now: Date = new Date()): Promise<DailyFeatured | null> {
    return readFeatured(productDay(now));
  },

  /**
   * Yöneticinin elle seçmesi.
   *
   * Tekillik kuralı veritabanındadır; burada yalnızca ANLAŞILIR HATA üretilir.
   * Kısıt ihlali kullanıcıya ham veritabanı mesajı olarak sızmamalı.
   */
  async setDaily(eventId: string, day: string): Promise<void> {
    const rows = await db
      .select({ status: events.status, closesAt: events.closesAt })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    const event = rows[0];
    if (!event) throw new BusinessRuleError('FEATURED_NOT_FOUND', 'Etkinlik bulunamadı.');
    if (event.status !== 'OPEN') {
      throw new BusinessRuleError(
        'FEATURED_NOT_OPEN',
        'Yalnızca açık bir etkinlik Günün Meydanı olabilir.',
      );
    }
    if (event.closesAt <= new Date()) {
      throw new BusinessRuleError(
        'FEATURED_CLOSED',
        'Tahminleri kapanmış bir etkinlik Günün Meydanı olamaz.',
      );
    }

    const existing = await readFeatured(day);
    if (existing && existing.id !== eventId) {
      throw new BusinessRuleError(
        'FEATURED_DAY_TAKEN',
        'Bu güne zaten bir Günün Meydanı seçilmiş. Önce onu kaldırman gerekiyor.',
      );
    }

    await db
      .update(events)
      .set({ featuredType: 'DAILY_PRIMARY', featuredDate: day, updatedAt: new Date() })
      .where(eq(events.id, eventId));
  },

  /** Öne çıkarmayı kaldırır — yönetici yanlış seçtiyse geri alabilsin. */
  async clearDaily(day: string): Promise<void> {
    await db
      .update(events)
      .set({ featuredType: null, featuredDate: null, updatedAt: new Date() })
      .where(and(eq(events.featuredDate, day), eq(events.featuredType, 'DAILY_PRIMARY')));
  },

  /**
   * Bugüne Meydan seçilmemişse otomatik seçer. İDEMPOTENT.
   *
   * Dönüş: seçilen etkinliğin kimliği, ya da seçim yapılmadıysa null
   * (zaten seçilmiş ya da uygun aday yok).
   */
  async ensureDaily(now: Date = new Date()): Promise<string | null> {
    const day = productDay(now);

    const already = await readFeatured(day);
    if (already) return null;

    const earliest = new Date(now.getTime() + MIN_HOURS_AHEAD * 3600_000);
    const latest = new Date(now.getTime() + MAX_HOURS_AHEAD * 3600_000);

    const candidates = await db
      .select({ id: events.id, categorySlug: categories.slug, closesAt: events.closesAt })
      .from(events)
      .innerJoin(categories, eq(categories.id, events.categoryId))
      .where(
        and(
          eq(events.status, 'OPEN'),
          gt(events.closesAt, earliest),
          lte(events.closesAt, latest),
          // Bir etkinlik yalnızca bir kez öne çıkar: aynı soruyu iki gün
          // üst üste göstermek günlük ritüeli anlamsızlaştırır.
          isNull(events.featuredType),
        ),
      )
      .orderBy(
        // Spor önce (ilk aşama kararı), sonra en yakında kapanan, sonra kimlik.
        // Üç ölçüt sıralamayı TAM belirler; aynı veride aynı sonuç çıkar.
        asc(sql`CASE WHEN ${categories.slug} = ${PREFERRED_CATEGORY} THEN 0 ELSE 1 END`),
        asc(events.closesAt),
        asc(events.id),
      )
      .limit(1);

    const chosen = candidates[0];
    if (!chosen) {
      log.warn('featured.no_candidate', { operation: 'featured.ensure', day });
      return null;
    }

    /*
     * Yarış koşulu: iki örnek aynı anda seçmeye kalkarsa kısmi tekil index
     * ikincisini reddeder. Bu bir ARIZA DEĞİLDİR — biri kazandı demektir.
     * Hata yutulur ve null dönülür; ana sayfa yine de bir Meydan bulur.
     */
    try {
      await db
        .update(events)
        .set({ featuredType: 'DAILY_PRIMARY', featuredDate: day, updatedAt: new Date() })
        .where(and(eq(events.id, chosen.id), isNull(events.featuredType)));
    } catch (error) {
      log.warn('featured.race_lost', { operation: 'featured.ensure', day, error });
      return null;
    }

    log.info('featured.selected', {
      operation: 'featured.ensure',
      day,
      category: chosen.categorySlug,
    });
    return chosen.id;
  },
};
