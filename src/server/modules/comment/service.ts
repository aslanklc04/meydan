import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, withTransaction, type Tx } from '@/server/db';
import { eventComments, events, predictions, users } from '@/server/db/schema';
import { BusinessRuleError, NotFoundError, ValidationError } from '@/server/errors';
import { checkPublicText, verdictMessage } from '@/server/content/text-guard';
import { contentLimits } from '@/config';
import { notificationService } from '@/server/modules/social/notification.service';

type Ctx = Tx | typeof db;

/**
 * MEYDAN SOHBETİ — etkinlik başına sohbet.
 *
 * ── KİLİT: TAHMİN YAPMADAN NE OKUNUR NE YAZILIR ────────────────────────────
 * Ürünün temel kuralı "önce sen söyle": kullanıcı tarafını seçmeden
 * kalabalığın dağılımını göremiyor. Sohbet serbest okunsaydı o kural arka
 * kapıdan delinirdi — kişi yorumlara bakıp "herkes ev sahibi diyor" der ve
 * tahminini ona göre yapardı. Konsensüs için kurduğumuz bütün dürüstlük
 * mekanizması, bir yorum listesiyle işlevsiz kalırdı.
 *
 * Kilit SUNUCUDA uygulanır: tahmin yapmamış birine yorumların metni hiç
 * gönderilmez. Arayüzde gizlemek yetmezdi; sayfa kaynağında durur ve bakan
 * görürdü.
 *
 * ── TAHMİN GÜCÜ KAZANDIRMAZ ────────────────────────────────────────────────
 * Yorum yazmak ne Tahmin Gücü ne Gümüş Çip kazandırır (ürün kuralı 41-42).
 * Kazandırsaydı sohbet, konuşmak için değil puan toplamak için kullanılırdı
 * ve ürün kendi ölçüsünü bozardı.
 */

export type CommentView = {
  readonly id: string;
  readonly body: string | null;
  readonly authorUsername: string;
  readonly createdAt: Date;
  readonly deleted: boolean;
  readonly hidden: boolean;
  readonly mine: boolean;
  readonly replies: readonly CommentView[];
};

export type SohbetView =
  | { readonly locked: true; readonly total: number }
  | { readonly locked: false; readonly total: number; readonly items: readonly CommentView[] };

/** Kullanıcının bu etkinlikte herhangi bir tahmini var mı? */
async function hasPredicted(userId: string, eventId: string, ctx: Ctx): Promise<boolean> {
  const rows = await ctx
    .select({ id: predictions.id })
    .from(predictions)
    .where(and(eq(predictions.userId, userId), eq(predictions.eventId, eventId)))
    .limit(1);
  return rows.length > 0;
}

export const commentService = {
  /**
   * Sohbetin toplam yorum sayısı — KİLİTLİYKEN DE gösterilir.
   *
   * Sayı bir sızıntı değil: kimin ne dediğini söylemez, yalnızca orada bir
   * sohbet olduğunu söyler. "Sohbet (12)" yazan kilitli bir düğme, tahmin
   * yapmak için sebeptir; "Sohbet" yazan boş bir düğme değildir.
   */
  async count(eventId: string, ctx: Ctx = db): Promise<number> {
    const rows = await ctx
      .select({ n: sql<number>`count(*)::int` })
      .from(eventComments)
      .where(
        and(
          eq(eventComments.eventId, eventId),
          isNull(eventComments.hiddenAt),
          isNull(eventComments.deletedAt),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  },

  /** Birden çok etkinliğin sayısı — akış kartları için tek sorgu. */
  async countsFor(eventIds: readonly string[], ctx: Ctx = db): Promise<Map<string, number>> {
    if (eventIds.length === 0) return new Map();
    const rows = await ctx
      .select({ eventId: eventComments.eventId, n: sql<number>`count(*)::int` })
      .from(eventComments)
      .where(
        and(
          inArray(eventComments.eventId, [...eventIds]),
          isNull(eventComments.hiddenAt),
          isNull(eventComments.deletedAt),
        ),
      )
      .groupBy(eventComments.eventId);
    return new Map(rows.map((r) => [r.eventId, Number(r.n)]));
  },

  /**
   * Sohbeti okur. Tahmin yapmamış kullanıcıya METİN GÖNDERİLMEZ.
   */
  async view(eventId: string, viewerId: string | null, ctx: Ctx = db): Promise<SohbetView> {
    const total = await this.count(eventId, ctx);

    if (!viewerId || !(await hasPredicted(viewerId, eventId, ctx))) {
      return { locked: true, total };
    }

    const rows = await ctx
      .select({
        id: eventComments.id,
        parentId: eventComments.parentId,
        body: eventComments.body,
        createdAt: eventComments.createdAt,
        deletedAt: eventComments.deletedAt,
        hiddenAt: eventComments.hiddenAt,
        authorId: eventComments.authorId,
        authorUsername: users.username,
      })
      .from(eventComments)
      .innerJoin(users, eq(users.id, eventComments.authorId))
      .where(eq(eventComments.eventId, eventId))
      .orderBy(asc(eventComments.createdAt));

    const bicim = (r: (typeof rows)[number]): CommentView => {
      const deleted = r.deletedAt !== null;
      const hidden = r.hiddenAt !== null;
      return {
        id: r.id,
        /*
         * Gizlenen ya da silinen yorumun METNİ HİÇ GÖNDERİLMEZ. Arayüzde
         * gizlemek yetmez: sayfa kaynağında durur ve bakan okur. Moderasyon
         * kararının anlamı kalmazdı.
         */
        body: deleted || hidden ? null : r.body,
        authorUsername: r.authorUsername,
        createdAt: r.createdAt,
        deleted,
        hidden,
        mine: r.authorId === viewerId,
        replies: [],
      };
    };

    const roots = rows.filter((r) => r.parentId === null).map(bicim);
    const byRoot = new Map(roots.map((r) => [r.id, [] as CommentView[]]));
    for (const r of rows) {
      if (r.parentId === null) continue;
      byRoot.get(r.parentId)?.push(bicim(r));
    }

    return {
      locked: false,
      total,
      items: roots.map((r) => ({ ...r, replies: byRoot.get(r.id) ?? [] })),
    };
  },

  /**
   * Yorum yazar.
   *
   * Sıra bilinçli: önce KİLİT (tahmin yaptın mı), sonra metin denetimi.
   * Tersi olsaydı, tahmin yapmamış biri metnini yazıp "küfür var" cevabı
   * alır ve süzgeci deneyerek öğrenirdi.
   */
  async create(input: {
    readonly eventId: string;
    readonly authorId: string;
    readonly body: string;
    readonly parentId?: string | null;
  }): Promise<{ readonly commentId: string }> {
    const body = input.body.trim().replace(/\s+\n/g, '\n');

    return withTransaction(async (tx) => {
      const eventRows = await tx
        .select({ id: events.id, slug: events.slug, status: events.status })
        .from(events)
        .where(eq(events.id, input.eventId))
        .limit(1);
      const event = eventRows[0];
      if (!event || event.status === 'DRAFT') {
        throw new NotFoundError('Bu meydan bulunamadı.');
      }

      if (!(await hasPredicted(input.authorId, input.eventId, tx))) {
        throw new BusinessRuleError(
          'PREDICTION_REQUIRED',
          'Sohbete katılmak için önce tahminini yap.',
        );
      }

      if (body.length === 0) {
        throw new ValidationError('Bir şey yaz.', 'body');
      }
      if (body.length > contentLimits.commentMaxLength) {
        throw new ValidationError(
          `En fazla ${contentLimits.commentMaxLength} karakter yazabilirsin.`,
          'body',
        );
      }

      const verdict = checkPublicText(body);
      if (!verdict.ok) {
        throw new ValidationError(verdictMessage(verdict.reason, 'yorum'), 'body');
      }

      /*
       * TEK SEVİYE CEVAP. Cevabın cevabı yok: derin ağaçlar telefonda
       * okunamaz ve tartışmayı konudan koparır. Ayrıca cevap, cevap verilen
       * yorumla AYNI etkinlikte olmak zorundadır — başka bir maçın yorumuna
       * bağlanan bir cevap, sohbeti başka bir yere taşırdı.
       */
      let parentId: string | null = null;
      let parentAuthorId: string | null = null;
      if (input.parentId) {
        const parentRows = await tx
          .select({
            id: eventComments.id,
            eventId: eventComments.eventId,
            parentId: eventComments.parentId,
            authorId: eventComments.authorId,
            hiddenAt: eventComments.hiddenAt,
          })
          .from(eventComments)
          .where(eq(eventComments.id, input.parentId))
          .limit(1);
        const parent = parentRows[0];
        if (!parent || parent.eventId !== input.eventId) {
          throw new NotFoundError('Cevap verdiğin yorum bulunamadı.');
        }
        if (parent.parentId !== null) {
          throw new BusinessRuleError('REPLY_DEPTH', 'Cevaba cevap yazılamaz.');
        }
        if (parent.hiddenAt !== null) {
          throw new BusinessRuleError('PARENT_HIDDEN', 'Bu yoruma cevap yazılamaz.');
        }
        parentId = parent.id;
        parentAuthorId = parent.authorId;
      }

      const inserted = await tx
        .insert(eventComments)
        .values({ eventId: input.eventId, authorId: input.authorId, parentId, body })
        .returning({ id: eventComments.id });

      const commentId = inserted[0]!.id;

      /*
       * Cevap bildirimi — kendine cevap yazana GİTMEZ. Kendi yorumuna cevap
       * yazınca bildirim almak, bildirimleri değersizleştirir.
       */
      if (parentAuthorId && parentAuthorId !== input.authorId) {
        await notificationService.create(tx, {
          userId: parentAuthorId,
          type: 'COMMENT_REPLY',
          body: 'Yorumuna cevap geldi.',
          dedupeKey: `comment-reply:${commentId}`,
          actorId: input.authorId,
          href: `/event/${event.slug}#sohbet`,
        });
      }

      return { commentId };
    });
  },

  /**
   * Yazar kendi yorumunu siler.
   *
   * Satır DURUR, metin gider: silinen yoruma verilmiş cevaplar öksüz
   * kalmasın ve okuyucu neye cevap verildiğini anlayabilsin.
   */
  async removeOwn(commentId: string, authorId: string): Promise<void> {
    const rows = await db
      .select({ id: eventComments.id, authorId: eventComments.authorId })
      .from(eventComments)
      .where(eq(eventComments.id, commentId))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Yorum bulunamadı.');
    if (row.authorId !== authorId) {
      throw new BusinessRuleError('NOT_OWNER', 'Yalnızca kendi yorumunu silebilirsin.');
    }
    await db
      .update(eventComments)
      .set({ deletedAt: new Date() })
      .where(and(eq(eventComments.id, commentId), isNull(eventComments.deletedAt)));
  },

  /** Moderasyon gizlemesi — denetim kaydı çağıran tarafta yazılır. */
  async hide(commentId: string, moderatorId: string): Promise<void> {
    const updated = await db
      .update(eventComments)
      .set({ hiddenAt: new Date(), hiddenById: moderatorId })
      .where(and(eq(eventComments.id, commentId), isNull(eventComments.hiddenAt)))
      .returning({ id: eventComments.id });
    if (updated.length === 0) {
      throw new NotFoundError('Yorum bulunamadı ya da zaten gizli.');
    }
  },

  /** Yönetim ekranı: son yorumlar, gizlenenler dâhil. */
  async recentForAdmin(limit = 50, ctx: Ctx = db) {
    return ctx
      .select({
        id: eventComments.id,
        body: eventComments.body,
        createdAt: eventComments.createdAt,
        hiddenAt: eventComments.hiddenAt,
        deletedAt: eventComments.deletedAt,
        authorUsername: users.username,
        eventTitle: events.title,
        eventSlug: events.slug,
      })
      .from(eventComments)
      .innerJoin(users, eq(users.id, eventComments.authorId))
      .innerJoin(events, eq(events.id, eventComments.eventId))
      .orderBy(desc(eventComments.createdAt))
      .limit(limit);
  },
};
