import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, withTransaction, type Tx } from '@/server/db';
import { categories, eventOutcomes, events, predictions } from '@/server/db/schema';
import { BusinessRuleError, NotFoundError } from '@/server/errors';
import { consensusService } from './consensus.service';

/**
 * Catalog use-case servisi — etkinlik okuma ve yönetimi.
 *
 * Okuma yolu, kullanıcıya gösterilecek şekli döndürür: teknik kimlikler
 * (kategori id, provider, internal status) UI'ya SIZMAZ. Kullanıcıya gönderilen
 * tek teknik değer, tıklanabilir olması gereken opak `id`'lerdir.
 */

export type FeedOutcome = {
  readonly id: string;
  readonly label: string;
  readonly predictionCount: number;
  /** Maçlarda takım arması; diğer seçeneklerde null. */
  readonly imageUrl: string | null;
};

export type FeedEvent = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly question: string;
  readonly categoryName: string;
  readonly categoryIcon: string;
  readonly isFinancial: boolean;
  readonly closesAt: Date;
  readonly predictionCount: number;
  readonly challengeCount: number;
  readonly outcomes: readonly FeedOutcome[];
  /** Kullanıcının bu etkinlikteki mevcut tahmini (varsa). */
  readonly myOutcomeId: string | null;
};

type Ctx = Tx | typeof db;

async function attachOutcomes(rows: { id: string }[], ctx: Ctx) {
  if (rows.length === 0) return new Map<string, FeedOutcome[]>();
  const ids = rows.map((r) => r.id);
  const outcomeRows = await ctx
    .select({
      id: eventOutcomes.id,
      eventId: eventOutcomes.eventId,
      label: eventOutcomes.label,
      sortOrder: eventOutcomes.sortOrder,
      predictionCount: eventOutcomes.predictionCount,
      imageUrl: eventOutcomes.imageUrl,
    })
    .from(eventOutcomes)
    .where(inArray(eventOutcomes.eventId, ids))
    .orderBy(asc(eventOutcomes.sortOrder));

  const map = new Map<string, FeedOutcome[]>();
  for (const o of outcomeRows) {
    const list = map.get(o.eventId) ?? [];
    list.push({
      id: o.id,
      label: o.label,
      predictionCount: o.predictionCount,
      imageUrl: o.imageUrl,
    });
    map.set(o.eventId, list);
  }
  return map;
}

export const catalogService = {
  /**
   * Akış: açık ve tahmine kapanmamış etkinlikler.
   *
   * KİŞİSELLEŞTİRME KARARI (Faz 5): ilgi alanı seçen kullanıcıda seçtiği
   * kategoriler ÖNE alınır, diğerleri GİZLENMEZ. İlgi alanı bir filtre olsaydı
   * yeni kullanıcı üç kategori seçip boş bir akışla karşılaşabilirdi — boş akış,
   * ilgisiz içerikten çok daha kötüdür.
   */
  async listOpenEvents(
    viewerId: string | null,
    limit = 20,
    ctx: Ctx = db,
    preferredCategoryIds: readonly string[] = [],
  ): Promise<FeedEvent[]> {
    const now = new Date();

    /*
     * İlgi alanı sıralaması. Tercih YOKSA ek bir ORDER BY ifadesi EKLENMEZ:
     * sabit bir `ORDER BY 0` PostgreSQL tarafından "sıfırıncı sütun" olarak
     * yorumlanır ve sorgu hata verir (entegrasyon testinde yakalandı).
     */
    const orderBy =
      preferredCategoryIds.length > 0
        ? [
            asc(
              sql`CASE WHEN ${inArray(events.categoryId, [...preferredCategoryIds])} THEN 0 ELSE 1 END`,
            ),
            asc(events.closesAt),
          ]
        : [asc(events.closesAt)];

    const rows = await ctx
      .select({
        id: events.id,
        slug: events.slug,
        title: events.title,
        question: events.question,
        closesAt: events.closesAt,
        predictionCount: events.predictionCount,
        challengeCount: events.challengeCount,
        categoryName: categories.name,
        categoryIcon: categories.icon,
        categoryKind: categories.kind,
      })
      .from(events)
      .innerJoin(categories, eq(categories.id, events.categoryId))
      .where(and(eq(events.status, 'OPEN'), gt(events.closesAt, now)))
      .orderBy(...orderBy)
      .limit(limit);

    const outcomes = await attachOutcomes(rows, ctx);

    let mine = new Map<string, string>();
    if (viewerId && rows.length > 0) {
      const myPredictions = await ctx
        .select({ eventId: predictions.eventId, outcomeId: predictions.outcomeId })
        .from(predictions)
        .where(
          and(
            eq(predictions.userId, viewerId),
            inArray(
              predictions.eventId,
              rows.map((r) => r.id),
            ),
            inArray(predictions.status, ['OPEN', 'LOCKED']),
          ),
        );
      mine = new Map(myPredictions.map((p) => [p.eventId, p.outcomeId]));
    }

    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      question: r.question,
      categoryName: r.categoryName,
      categoryIcon: r.categoryIcon,
      isFinancial: r.categoryKind === 'FINANCIAL',
      closesAt: r.closesAt,
      predictionCount: r.predictionCount,
      challengeCount: r.challengeCount,
      outcomes: outcomes.get(r.id) ?? [],
      myOutcomeId: mine.get(r.id) ?? null,
    }));
  },

  async getEventById(eventId: string, ctx: Ctx = db) {
    const rows = await ctx
      .select({
        id: events.id,
        slug: events.slug,
        title: events.title,
        question: events.question,
        status: events.status,
        closesAt: events.closesAt,
        categoryId: events.categoryId,
        categoryName: categories.name,
        categoryIcon: categories.icon,
        categoryKind: categories.kind,
        predictionCount: events.predictionCount,
      })
      .from(events)
      .innerJoin(categories, eq(categories.id, events.categoryId))
      .where(eq(events.id, eventId))
      .limit(1);
    return rows[0];
  },

  /**
   * Public etkinlik sayfası — /event/[slug].
   *
   * Giriş yapmamış ziyaretçi de görebilir; bu yüzden kişiye özel hiçbir veri
   * yoktur (viewerId verilmezse `myOutcomeId` null döner).
   */
  async getPublicEvent(slug: string, viewerId: string | null, ctx: Ctx = db) {
    const rows = await ctx
      .select({
        id: events.id,
        slug: events.slug,
        title: events.title,
        question: events.question,
        status: events.status,
        closesAt: events.closesAt,
        resolvedAt: events.resolvedAt,
        resolvedOutcomeId: events.resolvedOutcomeId,
        predictionCount: events.predictionCount,
        challengeCount: events.challengeCount,
        categoryName: categories.name,
        categoryIcon: categories.icon,
        categorySlug: categories.slug,
        categoryKind: categories.kind,
      })
      .from(events)
      .innerJoin(categories, eq(categories.id, events.categoryId))
      .where(eq(events.slug, slug.trim().toLowerCase()))
      .limit(1);

    const row = rows[0];
    if (!row || row.status === 'DRAFT') return null;

    const outcomeRows = await ctx
      .select({
        id: eventOutcomes.id,
        label: eventOutcomes.label,
        sortOrder: eventOutcomes.sortOrder,
        predictionCount: eventOutcomes.predictionCount,
        imageUrl: eventOutcomes.imageUrl,
      })
      .from(eventOutcomes)
      .where(eq(eventOutcomes.eventId, row.id))
      .orderBy(asc(eventOutcomes.sortOrder));

    const total = outcomeRows.reduce((sum, o) => sum + o.predictionCount, 0);

    let myOutcomeId: string | null = null;
    if (viewerId) {
      const mine = await ctx
        .select({ outcomeId: predictions.outcomeId })
        .from(predictions)
        .where(and(eq(predictions.userId, viewerId), eq(predictions.eventId, row.id)))
        .limit(1);
      myOutcomeId = mine[0]?.outcomeId ?? null;
    }

    return {
      ...row,
      isFinancial: row.categoryKind === 'FINANCIAL',
      isOpen: row.status === 'OPEN' && row.closesAt.getTime() > Date.now(),
      resolvedOutcomeLabel: outcomeRows.find((o) => o.id === row.resolvedOutcomeId)?.label ?? null,
      outcomes: outcomeRows.map((o) => ({
        id: o.id,
        label: o.label,
        predictionCount: o.predictionCount,
        imageUrl: o.imageUrl,
        // Toplam sıfırken pay da sıfırdır; 0/0 hesabı yapılmaz.
        share: total === 0 ? 0 : o.predictionCount / total,
      })),
      myOutcomeId,
    };
  },

  /**
   * Birden çok etkinliğin sonuçlarını TEK sorguda getirir.
   *
   * PERFORMANS (Faz 5): yönetim ekranı her etkinlik için ayrı `getOutcomes`
   * çağırıyordu — 30 etkinlikte 30 sorgu, klasik N+1. Tek `IN (...)` sorgusu
   * aynı işi yapar ve etkinlik sayısından bağımsızdır.
   */
  async getOutcomesFor(eventIds: readonly string[], ctx: Ctx = db) {
    if (eventIds.length === 0) return new Map<string, { id: string; label: string }[]>();

    const rows = await ctx
      .select({
        id: eventOutcomes.id,
        eventId: eventOutcomes.eventId,
        label: eventOutcomes.label,
      })
      .from(eventOutcomes)
      .where(inArray(eventOutcomes.eventId, [...eventIds]))
      .orderBy(asc(eventOutcomes.sortOrder));

    const map = new Map<string, { id: string; label: string }[]>();
    for (const r of rows) {
      const list = map.get(r.eventId) ?? [];
      list.push({ id: r.id, label: r.label });
      map.set(r.eventId, list);
    }
    return map;
  },

  async getOutcomes(eventId: string, ctx: Ctx = db) {
    return ctx
      .select({
        id: eventOutcomes.id,
        key: eventOutcomes.key,
        label: eventOutcomes.label,
        sortOrder: eventOutcomes.sortOrder,
        predictionCount: eventOutcomes.predictionCount,
      })
      .from(eventOutcomes)
      .where(eq(eventOutcomes.eventId, eventId))
      .orderBy(asc(eventOutcomes.sortOrder));
  },

  /** Admin: sonuçlandırılmayı bekleyen etkinlikler. */
  async listAwaitingResolution(ctx: Ctx = db) {
    return ctx
      .select({
        id: events.id,
        title: events.title,
        question: events.question,
        status: events.status,
        closesAt: events.closesAt,
        predictionCount: events.predictionCount,
        challengeCount: events.challengeCount,
      })
      .from(events)
      .where(inArray(events.status, ['OPEN', 'CLOSED']))
      .orderBy(asc(events.closesAt));
  },

  /** Admin: etkinlik + sonuçları tek transaction'da oluşturur. */
  async createEvent(input: {
    readonly categorySlug: string;
    readonly title: string;
    readonly question: string;
    readonly slug: string;
    readonly closesAt: Date;
    readonly resolvesAt: Date;
    readonly outcomes: readonly { key: string; label: string; imageUrl?: string | null }[];
    readonly createdById: string;
    readonly status?: 'DRAFT' | 'OPEN';
  }) {
    if (input.outcomes.length < 2) {
      throw new BusinessRuleError('TOO_FEW_OUTCOMES', 'Bir etkinlikte en az iki sonuç olmalı.');
    }

    return withTransaction(async (tx) => {
      const cat = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, input.categorySlug))
        .limit(1);
      const categoryId = cat[0]?.id;
      if (!categoryId) throw new NotFoundError('Kategori bulunamadı.');

      const inserted = await tx
        .insert(events)
        .values({
          categoryId,
          title: input.title,
          question: input.question,
          slug: input.slug,
          closesAt: input.closesAt,
          resolvesAt: input.resolvesAt,
          status: input.status ?? 'OPEN',
          createdById: input.createdById,
        })
        .returning({ id: events.id });

      const eventId = inserted[0]?.id;
      if (!eventId) throw new Error('Etkinlik oluşturulamadı.');

      await tx.insert(eventOutcomes).values(
        input.outcomes.map((o, i) => ({
          eventId,
          key: o.key,
          label: o.label,
          sortOrder: i,
          imageUrl: o.imageUrl ?? null,
        })),
      );

      return { eventId };
    });
  },

  /**
   * Tahminleri kapatır ve kalabalık dağılımını DONDURUR.
   * Zorluk katsayısının temeli budur; dondurulmadan geçmiş rating yeniden üretilemez.
   */
  async closeEvent(eventId: string, ctx?: Tx): Promise<void> {
    const run = async (tx: Tx) => {
      const total = await tx
        .select({ count: events.predictionCount })
        .from(events)
        .where(eq(events.id, eventId));
      const totalCount = total[0]?.count ?? 0;

      if (totalCount > 0) {
        await tx.execute(sql`
          UPDATE event_outcome
             SET consensus_share = ROUND(prediction_count::numeric / ${totalCount}, 5)
           WHERE event_id = ${eventId}
        `);
      }

      await tx
        .update(events)
        .set({ status: 'CLOSED', updatedAt: new Date() })
        .where(and(eq(events.id, eventId), eq(events.status, 'OPEN')));

      /*
       * KONSENSÜSÜ DONDUR (Faz 8).
       *
       * Burada yapılır, bakım işinde DEĞİL: etkinlik hangi yoldan kapanırsa
       * kapansın (zamanlayıcı, yöneticinin elle kapatması, fikstür servisi)
       * kapanış anındaki dağılım kaydedilmiş olur. Yalnızca bakım işine
       * konsaydı, elle kapatılan bir etkinliğin geçmişi hiç donmazdı ve
       * "topluluğun %18'i" ifadesi o etkinlikte sonsuza kadar oynardı.
       *
       * `freeze` kendi içinde idempotenttir; ikinci çağrı geçmişi ezmez.
       */
      await consensusService.freeze(eventId, tx);
    };

    if (ctx) return run(ctx);
    return withTransaction(run);
  },

  async listCategories(ctx: Ctx = db) {
    return ctx
      .select()
      .from(categories)
      .where(eq(categories.active, true))
      .orderBy(asc(categories.sortOrder));
  },

  async recentResolved(limit = 10, ctx: Ctx = db) {
    return ctx
      .select({
        id: events.id,
        slug: events.slug,
        title: events.title,
        resolvedAt: events.resolvedAt,
        outcomeLabel: eventOutcomes.label,
      })
      .from(events)
      .leftJoin(eventOutcomes, eq(eventOutcomes.id, events.resolvedOutcomeId))
      .where(eq(events.status, 'RESOLVED'))
      .orderBy(desc(events.resolvedAt))
      .limit(limit);
  },

  /**
   * SONUÇ TAHTASI — herkese açık, son N gün.
   *
   * ── NEDEN VAR ──────────────────────────────────────────────────────────
   * Sonuçlar zaten hesaplanıyordu: maç bitiyor, bakım işi skoru okuyor,
   * etkinlik sonuçlanıyor. Ama sonucun GÖRÜLECEĞİ tek yer, o etkinliğin
   * kendi sayfası ve tahmin yapmış kişinin kendi akışıydı. Yani ürün
   * sözünü tutuyor, tuttuğunu gösteremiyordu.
   *
   * Kullanıcının canlıda söylediği tam olarak buydu: "akışa giren maçların
   * sonuçları maçlar bitince neden gözükmüyor". Gözükmüyordu çünkü kimse
   * için bir sonuç listesi yoktu.
   *
   * ── NEDEN HERKESE AÇIK ─────────────────────────────────────────────────
   * Sonuç, ürünün tek dış kanıtıdır. "Burada tahmin edilir" cümlesine
   * inanmayan bir ziyaretçiye gösterilecek şey, dün ne olduğunu bilen bir
   * listedir. Bunun için hesap istemek, kanıtı duvarın arkasına koymaktır.
   * Listede kimsenin adı geçmez; kaç kişinin bildiği geçer.
   *
   * ── NEDEN PENCERE VAR ──────────────────────────────────────────────────
   * Sonsuz bir arşiv ürünün canlı olduğunu değil, eskidiğini gösterir.
   * Yedi gün, "bu hafta ne oldu"yu kapsar ve dünkü maçı hâlâ içerir.
   *
   * İPTALLER DE LİSTEDE: maç ertelenince etkinlik iptal edilir ve çipler
   * iade edilir. Bunu listeden düşürmek, kullanıcının aradığı maçın
   * sessizce yok olması demektir — en çok merak edilen satır o olabilir.
   */
  async resultsBoard(days = 7, limit = 24, ctx: Ctx = db) {
    const since = new Date(Date.now() - days * 24 * 3600_000);
    const winner = alias(eventOutcomes, 'winner_outcome');

    /*
     * KAPANIŞ ANI: iptal edilen etkinlikte `resolved_at` BOŞTUR.
     *
     * Sonuçlanmayan bir etkinliğe "sonuç zamanı" yazmak yanlış olurdu, o
     * yüzden çözüm alanı doldurmak değil; burada son güncelleme anını
     * kullanmak. Yalnızca `resolved_at` ile filtrelenseydi iptaller listeden
     * TAMAMEN düşerdi — oysa kullanıcının aradığı satır çoğu zaman tam
     * olarak o olur: "maçım ne oldu?"
     */
    const settledAt = sql<Date>`coalesce(${events.resolvedAt}, ${events.updatedAt})`;

    const rows = await ctx
      .select({
        id: events.id,
        slug: events.slug,
        title: events.title,
        question: events.question,
        status: events.status,
        resolvedAt: settledAt,
        predictionCount: events.predictionCount,
        categoryName: categories.name,
        categoryIcon: categories.icon,
        winnerLabel: winner.label,
        winnerImageUrl: winner.imageUrl,
        /*
         * Kazanan seçeneğin tahmin sayısı = O SONUCU BİLENLERİN SAYISI.
         * Sayaç kapanışta dondurulduğu için sonradan oynamaz; ayrı bir
         * "doğru bilenler" sorgusu açmaya gerek yok.
         */
        winnerCount: winner.predictionCount,
      })
      .from(events)
      .innerJoin(categories, eq(categories.id, events.categoryId))
      .leftJoin(winner, eq(winner.id, events.resolvedOutcomeId))
      .where(
        and(
          inArray(events.status, ['RESOLVED', 'VOID']),
          /*
           * Tarih METİN olarak bağlanır: postgres.js ham şablonda `Date`
           * nesnesini bağlayamaz (canlıda bir kez yakalandı). Açık tür
           * dönüşümü, karşılaştırmanın metin üzerinden yapılmasını önler.
           */
          sql`coalesce(${events.resolvedAt}, ${events.updatedAt}) >= ${since.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(sql`coalesce(${events.resolvedAt}, ${events.updatedAt}) DESC`)
      .limit(limit);

    return rows.map((r) => ({
      ...r,
      voided: r.status === 'VOID',
      /*
       * İptalde "kimse bilemedi" DEĞİL, "sayılmadı" doğrudur. Bu yüzden
       * sayı sıfıra düşürülmez, null yapılır: sıfır bir ölçümdür, null
       * ölçüm olmadığını söyler.
       */
      correctCount: r.status === 'VOID' ? null : (r.winnerCount ?? 0),
    }));
  },
};
