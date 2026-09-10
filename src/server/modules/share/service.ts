import { randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { eventOutcomes, events, predictionShares, predictions, users } from '@/server/db/schema';
import { BusinessRuleError, NotFoundError } from '@/server/errors';

/** Transaction ya da havuz — servis her ikisiyle de çalışır. */
type Ctx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/**
 * TEK SORULUK MEYDAN OKUMA.
 *
 * ── PAYLAŞIMIN EN KÜÇÜK BİRİMİ ─────────────────────────────────────────────
 * Kullanıcı bir sorunun bağlantısını arkadaşına gönderir. Alıcı doğrudan
 * soruya düşer — tanıtım sayfasına, kayıt duvarına ya da uygulama mağazasına
 * değil. Tek soru, üç düğme, on saniye.
 *
 * ── EN KRİTİK KURAL: GÖNDERENİN CEVABI GİZLİ ───────────────────────────────
 * Alıcı, gönderenin ne dediğini kendi tahminini yapmadan GÖREMEZ.
 *
 * Bu bir sürpriz efekti değil, ölçüm bütünlüğü meselesi. Gönderenin cevabı
 * önce görünseydi alıcının verdiği cevap kendi görüşü olmaktan çıkar,
 * arkadaşına katılma ya da inat etme kararına dönüşürdü. Ürünün topladığı
 * veri "insanlar ne düşünüyor" olmaz, "insanlar arkadaşına ne kadar uyuyor"
 * olurdu — ki bu, MEYDAN'ın ölçmek istediğinin tam tersidir.
 *
 * Aynı kural etkinlik sayfasında da geçerli (`consensusService`); burada
 * tekrar edilmesinin sebebi, paylaşım bağlantısının o sayfadan BAĞIMSIZ bir
 * giriş noktası olması. Kural tek yerde durursa öbür kapıdan girilir.
 *
 * ── SAYAÇLAR NEDEN ÜÇ TANE ─────────────────────────────────────────────────
 * Görüntülenme, cevap ve kayıt ayrı sayılır. Yalnız görüntülenmeyi saymak
 * paylaşımın işe yaradığı yanılgısını verir: bağlantıya bakıp kapatan biri
 * hiçbir şey yapmamıştır. Asıl ölçü CEVAPTIR.
 */

/**
 * Paylaşım jetonu — 16 bayt (2^128) kriptografik rastgelelik.
 *
 * `base64url` seçildi: adres çubuğunda kaçış karakteri üretmez, elle okunup
 * yazılabilir. Kullanıcı kimliği, tahmin kimliği ya da zaman damgası
 * İÇERMEZ; jetondan hiçbir şey öğrenilemez.
 */
function newToken(): string {
  return randomBytes(16).toString('base64url');
}

export type ChallengeOutcome = {
  readonly id: string;
  readonly label: string;
  readonly imageUrl: string | null;
};

export type ChallengeView = {
  readonly publicToken: string;
  readonly senderUsername: string;
  /**
   * İç kimlik. Sayfaya BASILMAZ; cevabı kaydeden eylem etkinliği jetondan
   * çözebilsin diye burada. İstemciden etkinlik kimliği ALINMAZ — alınsaydı
   * paylaşılan sorudan başka bir etkinliğe cevap gönderilebilirdi.
   */
  readonly eventId: string;
  readonly eventSlug: string;
  readonly eventTitle: string;
  readonly question: string;
  readonly categoryIcon: string | null;
  readonly closesAt: Date;
  readonly isOpen: boolean;
  readonly outcomes: readonly ChallengeOutcome[];
  /**
   * Gönderenin seçtiği sonuç — YALNIZCA izleyen kendi tahminini yaptıysa ya
   * da etkinlik sonuçlandıysa doldurulur. Aksi hâlde `null` DÖNER, gizlenmez:
   * veri sunucudan hiç çıkmaz.
   */
  readonly senderOutcomeId: string | null;
  /** İzleyenin bu etkinlikteki kendi tahmini. */
  readonly viewerOutcomeId: string | null;
  /** Sonuç geldiyse kazanan seçenek. */
  readonly resolvedOutcomeId: string | null;
  readonly resolvedOutcomeLabel: string | null;
};

export const shareService = {
  /**
   * Bir tahmin için paylaşım bağlantısı üretir. İDEMPOTENT.
   *
   * Aynı tahmin ikinci kez paylaşılmak istenirse yeni jeton üretilmez, var
   * olan döner. Aksi hâlde aynı tahmin için onlarca adres oluşur ve sayaçlar
   * o adreslere bölünürdü.
   */
  async createForPrediction(predictionId: string, ownerId: string): Promise<string> {
    const rows = await db
      .select({ userId: predictions.userId })
      .from(predictions)
      .where(eq(predictions.id, predictionId))
      .limit(1);

    if (!rows[0]) throw new NotFoundError('Tahmin bulunamadı.');
    // Başkasının tahmini paylaşılamaz. "Bulunamadı" denir, "senin değil"
    // denmez: ikincisi, var olduğunu doğrulamak olur.
    if (rows[0].userId !== ownerId) throw new NotFoundError('Tahmin bulunamadı.');

    const existing = await db
      .select({ publicToken: predictionShares.publicToken })
      .from(predictionShares)
      .where(eq(predictionShares.predictionId, predictionId))
      .limit(1);
    if (existing[0]) return existing[0].publicToken;

    const publicToken = newToken();
    const inserted = await db
      .insert(predictionShares)
      .values({ publicToken, predictionId })
      .onConflictDoNothing({ target: predictionShares.predictionId })
      .returning({ publicToken: predictionShares.publicToken });

    if (inserted[0]) return inserted[0].publicToken;

    // Yarış: aynı anda ikinci bir istek jetonu üretti. Onunkini kullan.
    const raced = await db
      .select({ publicToken: predictionShares.publicToken })
      .from(predictionShares)
      .where(eq(predictionShares.predictionId, predictionId))
      .limit(1);
    if (!raced[0]) throw new BusinessRuleError('SHARE_FAILED', 'Bağlantı oluşturulamadı.');
    return raced[0].publicToken;
  },

  /**
   * Paylaşım jetonuyla meydan okumayı okur. GİRİŞ GEREKTİRMEZ.
   *
   * `viewerId` null ise (misafir) gönderenin cevabı hiçbir koşulda
   * gönderilmez: misafir tahmin yapamaz, dolayısıyla görme hakkı doğmaz.
   */
  async byToken(
    publicToken: string,
    viewerId: string | null,
    ctx: Ctx = db,
  ): Promise<ChallengeView | null> {
    const rows = await ctx
      .select({
        publicToken: predictionShares.publicToken,
        senderUsername: users.username,
        senderDeletedAt: users.deletedAt,
        senderOutcomeId: predictions.outcomeId,
        eventId: events.id,
        eventSlug: events.slug,
        eventTitle: events.title,
        question: events.question,
        closesAt: events.closesAt,
        status: events.status,
        resolvedOutcomeId: events.resolvedOutcomeId,
      })
      .from(predictionShares)
      .innerJoin(predictions, eq(predictions.id, predictionShares.predictionId))
      .innerJoin(users, eq(users.id, predictions.userId))
      .innerJoin(events, eq(events.id, predictions.eventId))
      .where(eq(predictionShares.publicToken, publicToken))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    // Hesabını silmiş kullanıcının meydan okuması da yayından kalkar.
    if (row.senderDeletedAt !== null) return null;
    // Taslak etkinlik paylaşılamaz.
    if (row.status === 'DRAFT') return null;

    const outcomes = await ctx
      .select({
        id: eventOutcomes.id,
        label: eventOutcomes.label,
        imageUrl: eventOutcomes.imageUrl,
      })
      .from(eventOutcomes)
      .where(eq(eventOutcomes.eventId, row.eventId))
      .orderBy(eventOutcomes.sortOrder);

    // İzleyenin kendi tahmini.
    let viewerOutcomeId: string | null = null;
    if (viewerId) {
      const mine = await ctx
        .select({ outcomeId: predictions.outcomeId })
        .from(predictions)
        .where(and(eq(predictions.userId, viewerId), eq(predictions.eventId, row.eventId)))
        .limit(1);
      viewerOutcomeId = mine[0]?.outcomeId ?? null;
    }

    /*
     * ── GÖNDERENİN CEVABI BURADA AÇILIR YA DA HİÇ ÇIKMAZ ──────────────────
     *
     * İki koşuldan biri: izleyen kendi tahminini yapmış olmalı, ya da
     * etkinlik zaten sonuçlanmış olmalı (sonuç belliyse gizlemenin anlamı
     * kalmaz). Hiçbiri yoksa alan `null` gider — istemciye gönderilip CSS ile
     * gizlenmez, çünkü öyle bir gizleme gizleme değildir.
     */
    const resolved = row.status === 'RESOLVED' && row.resolvedOutcomeId !== null;
    const maySeeSender = viewerOutcomeId !== null || resolved;

    return {
      publicToken: row.publicToken,
      senderUsername: row.senderUsername,
      eventId: row.eventId,
      eventSlug: row.eventSlug,
      eventTitle: row.eventTitle,
      question: row.question,
      categoryIcon: null,
      closesAt: row.closesAt,
      isOpen: row.status === 'OPEN' && row.closesAt > new Date(),
      outcomes,
      senderOutcomeId: maySeeSender ? row.senderOutcomeId : null,
      viewerOutcomeId,
      resolvedOutcomeId: resolved ? row.resolvedOutcomeId : null,
      resolvedOutcomeLabel: resolved
        ? (outcomes.find((o) => o.id === row.resolvedOutcomeId)?.label ?? null)
        : null,
    };
  },

  /** Bağlantıyı açan kişi. Sessiz: bilinmeyen jeton hata üretmez. */
  async countView(publicToken: string, ctx: Ctx = db): Promise<void> {
    await ctx
      .update(predictionShares)
      .set({ viewCount: sql`${predictionShares.viewCount} + 1` })
      .where(eq(predictionShares.publicToken, publicToken));
  },

  /** Bağlantıdan gelip CEVAP VEREN kişi — asıl ölçü budur. */
  async countAnswer(publicToken: string, ctx: Ctx = db): Promise<void> {
    await ctx
      .update(predictionShares)
      .set({ answerCount: sql`${predictionShares.answerCount} + 1` })
      .where(eq(predictionShares.publicToken, publicToken));
  },

  /** Bağlantıdan gelip kaydolan kişi. */
  async countSignup(publicToken: string, ctx: Ctx = db): Promise<void> {
    await ctx
      .update(predictionShares)
      .set({ signupCount: sql`${predictionShares.signupCount} + 1` })
      .where(eq(predictionShares.publicToken, publicToken));
  },

  /** Kullanıcının paylaştığı sorular ve karşılıkları. */
  async listMine(ownerId: string, limit = 20, ctx: Ctx = db) {
    return ctx
      .select({
        publicToken: predictionShares.publicToken,
        eventTitle: events.title,
        eventSlug: events.slug,
        viewCount: predictionShares.viewCount,
        answerCount: predictionShares.answerCount,
        signupCount: predictionShares.signupCount,
      })
      .from(predictionShares)
      .innerJoin(predictions, eq(predictions.id, predictionShares.predictionId))
      .innerJoin(events, eq(events.id, predictions.eventId))
      .innerJoin(users, eq(users.id, predictions.userId))
      .where(and(eq(predictions.userId, ownerId), isNull(users.deletedAt)))
      .orderBy(predictionShares.createdAt)
      .limit(limit);
  },
};
