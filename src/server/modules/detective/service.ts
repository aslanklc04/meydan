import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { db, withTransaction, type Tx } from '@/server/db';
import { detectiveAttempts, detectiveCases, detectiveOptions } from '@/server/db/schema';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  isUniqueViolation,
} from '@/server/errors';

type Ctx = Tx | typeof db;

/**
 * KISA DEDEKTİF.
 *
 * ── CEVAP VERMEDEN ÇÖZÜM GÖRÜNMEZ ──────────────────────────────────────────
 * Ürünün her yerinde işleyen kural burada da geçerli: "önce sen söyle."
 * Doğru seçenek ve çözüm metni, cevap verilmemiş bir kullanıcıya SUNUCUDAN
 * HİÇ GÖNDERİLMEZ. Arayüzde gizlemek yetmezdi — sayfa kaynağında durur ve
 * bakan okurdu; o an oyun biter.
 *
 * ── TAHMİN GÜCÜNÜ DEĞİŞTİRMEZ ──────────────────────────────────────────────
 * Dedektif karnesi AYRI tutulur. Aynı sayıya karışsaydı "geleceği ne kadar
 * iyi biliyor" ile "geçmişi ne kadar iyi çözüyor" birbirine karışır ve
 * Tahmin Gücü ölçtüğü şeyi ölçmez olurdu. İkisi farklı yetenek.
 */

export type DedektifSecenek = {
  readonly id: string;
  readonly label: string;
};

export type DedektifVaka = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly scenario: string;
  readonly question: string;
  readonly difficulty: number;
  readonly attemptCount: number;
  readonly correctCount: number;
  readonly options: readonly DedektifSecenek[];
  /** Cevap verildiyse dolu; verilmediyse HER ALANI null. */
  readonly sonuc: {
    readonly secilenId: string;
    readonly dogruId: string;
    readonly dogruMu: boolean;
    readonly explanation: string;
  } | null;
};

export type DedektifKarne = {
  readonly cozulen: number;
  readonly dogru: number;
};

export const detectiveService = {
  /** Yayındaki vakalar — en yeniden eskiye. */
  async list(viewerId: string | null, limit = 30, ctx: Ctx = db) {
    const rows = await ctx
      .select({
        id: detectiveCases.id,
        slug: detectiveCases.slug,
        title: detectiveCases.title,
        question: detectiveCases.question,
        difficulty: detectiveCases.difficulty,
        attemptCount: detectiveCases.attemptCount,
        correctCount: detectiveCases.correctCount,
        createdAt: detectiveCases.createdAt,
      })
      .from(detectiveCases)
      .where(isNotNull(detectiveCases.publishedAt))
      .orderBy(desc(detectiveCases.publishedAt))
      .limit(limit);

    if (!viewerId || rows.length === 0) {
      return rows.map((r) => ({ ...r, cozdumMu: null as boolean | null }));
    }

    /*
     * Hangi vakaları çözdüğü listede GÖRÜNÜR ama ne cevap verdiği görünmez.
     * "Çözüldü" işareti, kullanıcının nereye devam edeceğini bilmesi için;
     * cevabın kendisi listede işi olmayan bir bilgi.
     */
    const denemeler = await ctx
      .select({ caseId: detectiveAttempts.caseId, correct: detectiveAttempts.correct })
      .from(detectiveAttempts)
      .where(eq(detectiveAttempts.userId, viewerId));
    const harita = new Map(denemeler.map((d) => [d.caseId, d.correct]));

    return rows.map((r) => ({ ...r, cozdumMu: harita.get(r.id) ?? null }));
  },

  /**
   * Tek vaka. Cevap verilmemişse çözüm ve doğru seçenek HİÇ DÖNMEZ.
   */
  async bySlug(slug: string, viewerId: string | null, ctx: Ctx = db): Promise<DedektifVaka | null> {
    const rows = await ctx
      .select()
      .from(detectiveCases)
      .where(eq(detectiveCases.slug, slug))
      .limit(1);
    const vaka = rows[0];
    if (!vaka || vaka.publishedAt === null) return null;

    const secenekler = await ctx
      .select({
        id: detectiveOptions.id,
        label: detectiveOptions.label,
        isCorrect: detectiveOptions.isCorrect,
      })
      .from(detectiveOptions)
      .where(eq(detectiveOptions.caseId, vaka.id))
      .orderBy(asc(detectiveOptions.sortOrder));

    let deneme: { optionId: string; correct: boolean } | undefined;
    if (viewerId) {
      const d = await ctx
        .select({ optionId: detectiveAttempts.optionId, correct: detectiveAttempts.correct })
        .from(detectiveAttempts)
        .where(and(eq(detectiveAttempts.caseId, vaka.id), eq(detectiveAttempts.userId, viewerId)))
        .limit(1);
      deneme = d[0];
    }

    return {
      id: vaka.id,
      slug: vaka.slug,
      title: vaka.title,
      scenario: vaka.scenario,
      question: vaka.question,
      difficulty: vaka.difficulty,
      attemptCount: vaka.attemptCount,
      correctCount: vaka.correctCount,
      // Seçeneklerin hangisinin doğru olduğu ASLA listede gitmez.
      options: secenekler.map((o) => ({ id: o.id, label: o.label })),
      /*
       * Çözüm metni ve doğru seçenek yalnızca cevap verilmişse üretilir.
       * Bu `null`, "ekranda gösterme" demek değil — "sunucudan hiç çıkma"
       * demek. Aradaki fark, oyunun var olup olmaması.
       */
      sonuc: deneme
        ? {
            secilenId: deneme.optionId,
            dogruId: secenekler.find((o) => o.isCorrect)?.id ?? '',
            dogruMu: deneme.correct,
            explanation: vaka.explanation,
          }
        : null,
    };
  },

  /**
   * Cevap verir. BİR KEZ.
   *
   * Doğruluk SUNUCUDA hesaplanır; istemciden gelen hiçbir "doğru bildim"
   * bilgisine güvenilmez.
   */
  async answer(input: {
    readonly caseId: string;
    readonly userId: string;
    readonly optionId: string;
  }): Promise<{ readonly dogruMu: boolean }> {
    return withTransaction(async (tx) => {
      const secenekler = await tx
        .select({
          id: detectiveOptions.id,
          caseId: detectiveOptions.caseId,
          isCorrect: detectiveOptions.isCorrect,
        })
        .from(detectiveOptions)
        .where(eq(detectiveOptions.id, input.optionId))
        .limit(1);
      const secenek = secenekler[0];
      if (!secenek || secenek.caseId !== input.caseId) {
        throw new NotFoundError('Bu seçenek bu vakaya ait değil.');
      }

      const vakalar = await tx
        .select({ id: detectiveCases.id, publishedAt: detectiveCases.publishedAt })
        .from(detectiveCases)
        .where(eq(detectiveCases.id, input.caseId))
        .limit(1);
      if (!vakalar[0] || vakalar[0].publishedAt === null) {
        throw new NotFoundError('Vaka bulunamadı.');
      }

      const dogruMu = secenek.isCorrect;

      try {
        await tx.insert(detectiveAttempts).values({
          caseId: input.caseId,
          userId: input.userId,
          optionId: input.optionId,
          correct: dogruMu,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError('ALREADY_ANSWERED', 'Bu vakaya zaten cevap verdin.');
        }
        throw error;
      }

      /*
       * Sayaçlar tek ifadeyle artırılır. Ayrı okuma+yazma yapılsaydı iki kişi
       * aynı anda cevapladığında biri kaybolurdu — ve "kaç kişi bildi" sayısı
       * sessizce yanlış olurdu.
       */
      await tx
        .update(detectiveCases)
        .set({
          attemptCount: sql`${detectiveCases.attemptCount} + 1`,
          correctCount: sql`${detectiveCases.correctCount} + ${dogruMu ? 1 : 0}`,
        })
        .where(eq(detectiveCases.id, input.caseId));

      return { dogruMu };
    });
  },

  /** Kişinin dedektif karnesi — Tahmin Gücünden AYRI. */
  async karne(userId: string, ctx: Ctx = db): Promise<DedektifKarne> {
    const rows = await ctx
      .select({
        cozulen: sql<number>`count(*)::int`,
        dogru: sql<number>`count(*) FILTER (WHERE ${detectiveAttempts.correct})::int`,
      })
      .from(detectiveAttempts)
      .where(eq(detectiveAttempts.userId, userId));
    return { cozulen: Number(rows[0]?.cozulen ?? 0), dogru: Number(rows[0]?.dogru ?? 0) };
  },

  /** Yönetim: vaka ekler. Doğru seçenek TAM OLARAK BİR tane olmalı. */
  async createCase(input: {
    readonly slug: string;
    readonly title: string;
    readonly scenario: string;
    readonly question: string;
    readonly explanation: string;
    readonly difficulty: number;
    readonly createdById: string;
    readonly options: readonly { readonly label: string; readonly correct: boolean }[];
    readonly publish?: boolean;
  }): Promise<{ readonly caseId: string }> {
    const dogruSayisi = input.options.filter((o) => o.correct).length;
    if (input.options.length < 2) {
      throw new BusinessRuleError('TOO_FEW_OPTIONS', 'En az iki seçenek gerekir.');
    }
    if (dogruSayisi !== 1) {
      throw new BusinessRuleError(
        'ONE_CORRECT_REQUIRED',
        'Tam olarak bir seçenek doğru olarak işaretlenmeli.',
      );
    }

    return withTransaction(async (tx) => {
      const inserted = await tx
        .insert(detectiveCases)
        .values({
          slug: input.slug.trim().toLowerCase(),
          title: input.title.trim(),
          scenario: input.scenario.trim(),
          question: input.question.trim(),
          explanation: input.explanation.trim(),
          difficulty: input.difficulty,
          createdById: input.createdById,
          publishedAt: input.publish === false ? null : new Date(),
        })
        .returning({ id: detectiveCases.id });

      const caseId = inserted[0]!.id;
      await tx.insert(detectiveOptions).values(
        input.options.map((o, i) => ({
          caseId,
          label: o.label.trim(),
          isCorrect: o.correct,
          sortOrder: i,
        })),
      );
      return { caseId };
    });
  },
};
