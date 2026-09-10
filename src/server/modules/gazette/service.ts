import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import {
  eventOutcomes,
  events,
  gazetteItems,
  gazettes,
  predictions,
  users,
} from '@/server/db/schema';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  isUniqueViolation,
} from '@/server/errors';
import { productDay } from '@/config/time';

/** Transaction ya da havuz — servis her ikisiyle de çalışır. */
type Ctx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/**
 * GELECEK GAZETESİ — kullanıcının kendi kurduğu, paylaşılabilir tahmin kapağı.
 *
 * ── NEDEN BU BİÇİM ─────────────────────────────────────────────────────────
 * Paylaşılan şey bir SKOR değil, bir İDDİA olmalı. "Tahmin gücüm 1420" cümlesi
 * yalnızca sahibini ilgilendirir; "önümüzdeki üç gün şunlar olacak" cümlesi ise
 * okuyanda merak bırakır ve okuyanın geri gelmesi için bir sebep — sonucu
 * görmek — yaratır. Paylaşımın işe yaraması için alıcının da kazanacağı bir şey
 * olmalıdır.
 *
 * ── NEDEN AYRI BİR TAHMİN AKIŞI DEĞİL ──────────────────────────────────────
 * Gazete kurmak yeni tahmin yapmaz; kullanıcının ZATEN yaptığı tahminleri
 * toplar. Böylece çekirdek döngüye (tahmin → kapanış → sonuç → itibar) hiç
 * dokunulmaz ve ilk tahminin önüne üç adımlık bir form konmaz. İlk tahmin
 * ucuz kalır; gazete ikinci adımdır.
 *
 * ── ÜÇ KURAL, ÜÇÜ DE VERİTABANINDA ─────────────────────────────────────────
 * 1. Bir tahmin ömrü boyunca tek gazeteye girer (tekil index).
 * 2. En çok üç manşet (slot 0-2 + CHECK).
 * 3. Manşet sonradan çıkarılamaz — bu servis silme yolu SUNMAZ.
 *
 * Üçü birlikte tek bir şeyi engeller: sonucu gördükten sonra kaybeden manşeti
 * gizleyip kusursuz bir karne paylaşmak. Laboratuvar raporundaki karşı örnek
 * tam olarak budur: 100, 100 ve 0 puanlı üç tahminin gerçek ortalaması 66,7'dir;
 * kaybedeni silebilseydin 100 görünürdü.
 */

/** Kapak başlığı sınırı — veritabanındaki CHECK ile aynı. */
const MAX_TITLE = 70;
const MAX_ITEMS = 3;

/**
 * Paylaşım jetonu.
 *
 * 16 bayt rastgelelik (2^128) tarayıcıda denenerek bulunamaz. `base64url`
 * seçildi çünkü adres çubuğunda kaçış karakteri üretmez ve elle okunup
 * yazılabilir. Kullanıcı kimliği, gazete kimliği veya zaman DAMGASI
 * İÇERMEZ: jetonun kendisinden hiçbir şey öğrenilemez.
 */
function newToken(): string {
  return randomBytes(16).toString('base64url');
}

export type GazetteHeadline = {
  readonly slot: number;
  readonly eventSlug: string;
  readonly eventTitle: string;
  readonly question: string;
  readonly categoryIcon: string | null;
  readonly outcomeLabel: string;
  readonly outcomeImageUrl: string | null;
  readonly closesAt: Date;
  readonly resolvesAt: Date;
  /** null = sonuç henüz yok. */
  readonly resolvedOutcomeLabel: string | null;
  /** true = doğru, false = tutmadı, null = sonuç yok ya da iptal. */
  readonly correct: boolean | null;
  /** Etkinlik iptal edildi: manşet görünür kalır ama puana girmez. */
  readonly voided: boolean;
};

export type GazetteView = {
  readonly publicToken: string;
  readonly title: string;
  readonly ownerUsername: string;
  readonly publishedDay: string;
  readonly createdAt: Date;
  readonly headlines: readonly GazetteHeadline[];
  /** Sonuçlanmış manşet sayısı ve kaçının tuttuğu. İptal edilenler sayılmaz. */
  readonly settled: number;
  readonly hits: number;
  readonly viewCount: number;
};

/**
 * Gazeteye konulabilecek tahminler.
 *
 * KAPANMIŞ ETKİNLİK ALINMAZ. Bu, gazetenin bütün anlamını taşıyan kuraldır:
 * kapanmış (hele sonuçlanmış) bir tahmini kapağa koyabilseydin, gazete bir
 * TAHMİN değil bir ÖZET olurdu ve okuyanın merak edeceği hiçbir şey kalmazdı.
 * "Gelecek" gazetesi ancak henüz olmamış şeylerden kurulabilir.
 */
async function eligiblePredictions(userId: string, ctx: Ctx, now: Date) {
  return ctx
    .select({
      predictionId: predictions.id,
      eventId: events.id,
      eventTitle: events.title,
      question: events.question,
      slug: events.slug,
      closesAt: events.closesAt,
      outcomeLabel: eventOutcomes.label,
      outcomeImageUrl: eventOutcomes.imageUrl,
    })
    .from(predictions)
    .innerJoin(events, eq(events.id, predictions.eventId))
    .innerJoin(eventOutcomes, eq(eventOutcomes.id, predictions.outcomeId))
    .leftJoin(gazetteItems, eq(gazetteItems.predictionId, predictions.id))
    .where(
      and(
        eq(predictions.userId, userId),
        eq(events.status, 'OPEN'),
        // `gt` kullanılır, ham SQL değil: ham şablonda Date parametresi
        // sürücüye tipsiz gider ve bağlanamaz.
        gt(events.closesAt, now),
        // Zaten başka bir gazetede olan tahmin listede görünmez.
        isNull(gazetteItems.id),
      ),
    )
    .orderBy(asc(events.closesAt));
}

export const gazetteService = {
  /** Kullanıcının gazeteye koyabileceği açık tahminleri. */
  async eligible(userId: string, now: Date = new Date(), ctx: Ctx = db) {
    return eligiblePredictions(userId, ctx, now);
  },

  /**
   * Gazete kurar. TÜM MANŞETLER TEK İŞLEMDE yazılır.
   *
   * Kısmi yazma kabul edilmez: üçüncü manşet reddedilirse ilk ikisi de
   * yazılmaz. Yarım bir gazete, kullanıcının kilitlediğini sandığı üç
   * iddiadan yalnızca ikisini taşır ve bu, ürünün verdiği sözün sessizce
   * bozulmasıdır.
   */
  async create(input: {
    readonly ownerId: string;
    readonly title: string;
    readonly predictionIds: readonly string[];
    readonly now?: Date;
  }): Promise<{ readonly publicToken: string }> {
    const now = input.now ?? new Date();
    const title = input.title.trim().replace(/\s+/g, ' ');

    if (title.length === 0) {
      throw new BusinessRuleError('GAZETTE_TITLE_REQUIRED', 'Gazetene bir başlık ver.', 'title');
    }
    if (title.length > MAX_TITLE) {
      throw new BusinessRuleError(
        'GAZETTE_TITLE_TOO_LONG',
        `Başlık en çok ${MAX_TITLE} karakter olabilir.`,
        'title',
      );
    }

    const ids = [...new Set(input.predictionIds)];
    if (ids.length === 0) {
      throw new BusinessRuleError(
        'GAZETTE_EMPTY',
        'Kapağa en az bir tahmin koymalısın.',
        'predictionIds',
      );
    }
    if (ids.length > MAX_ITEMS) {
      throw new BusinessRuleError(
        'GAZETTE_TOO_MANY',
        `Bir kapakta en çok ${MAX_ITEMS} manşet olur.`,
        'predictionIds',
      );
    }

    return db.transaction(async (tx) => {
      /*
       * Uygunluk kontrolü İŞLEMİN İÇİNDE yapılır ve sonuçları yeniden okunur.
       * Dışarıda okunup içeride güvenilseydi, iki sekmede aynı anda gazete
       * kuran bir kullanıcı aynı tahmini iki kapağa sokabilirdi — okuma ile
       * yazma arasındaki boşlukta kural yoktur. Son sözü yine de veritabanı
       * söyler (tekil index); bu kontrol yalnızca anlaşılır bir hata mesajı
       * verebilmek içindir.
       */
      const allowed = await eligiblePredictions(input.ownerId, tx, now);
      const allowedIds = new Set(allowed.map((r) => r.predictionId));

      for (const id of ids) {
        if (!allowedIds.has(id)) {
          throw new BusinessRuleError(
            'GAZETTE_ITEM_NOT_ELIGIBLE',
            'Bu tahminlerden biri kapağa konamıyor: ya kapanmış bir etkinliğe ait ya da başka bir gazetede.',
            'predictionIds',
          );
        }
      }

      const publicToken = newToken();

      const inserted = await tx
        .insert(gazettes)
        .values({
          publicToken,
          ownerId: input.ownerId,
          title,
          publishedDay: productDay(now),
        })
        .returning({ id: gazettes.id });

      const gazetteId = inserted[0]?.id;
      if (!gazetteId) throw new ConflictError('GAZETTE_NOT_CREATED', 'Gazete oluşturulamadı.');

      try {
        await tx
          .insert(gazetteItems)
          .values(ids.map((predictionId, slot) => ({ gazetteId, predictionId, slot })));
      } catch (error) {
        // Tekil index devreye girdi: tahmin bu arada başka bir gazeteye girmiş.
        // İşlem bütünüyle geri alınır, yarım gazete kalmaz.
        if (isUniqueViolation(error)) {
          throw new ConflictError(
            'GAZETTE_ITEM_TAKEN',
            'Bu tahminlerden biri az önce başka bir kapağa eklendi. Listeyi yenile.',
            'predictionIds',
          );
        }
        throw error;
      }

      return { publicToken };
    });
  },

  /**
   * Paylaşım jetonuyla gazeteyi okur. GİRİŞ GEREKTİRMEZ.
   *
   * Ziyaretçiye dağılım, iç kimlik ya da sahibin başka verisi gönderilmez;
   * yalnızca kapakta görünen şey döner.
   */
  async byToken(publicToken: string, ctx: Ctx = db): Promise<GazetteView | null> {
    const rows = await ctx
      .select({
        id: gazettes.id,
        publicToken: gazettes.publicToken,
        title: gazettes.title,
        publishedDay: gazettes.publishedDay,
        createdAt: gazettes.createdAt,
        viewCount: gazettes.viewCount,
        ownerUsername: users.username,
        ownerDeletedAt: users.deletedAt,
      })
      .from(gazettes)
      .innerJoin(users, eq(users.id, gazettes.ownerId))
      .where(eq(gazettes.publicToken, publicToken))
      .limit(1);

    const gazette = rows[0];
    // Hesabını silmiş kullanıcının gazetesi de yayından kalkar.
    if (!gazette || gazette.ownerDeletedAt !== null) return null;

    const items = await ctx
      .select({
        slot: gazetteItems.slot,
        eventSlug: events.slug,
        eventTitle: events.title,
        question: events.question,
        closesAt: events.closesAt,
        resolvesAt: events.resolvesAt,
        eventStatus: events.status,
        resolvedOutcomeId: events.resolvedOutcomeId,
        outcomeId: predictions.outcomeId,
        outcomeLabel: eventOutcomes.label,
        outcomeImageUrl: eventOutcomes.imageUrl,
      })
      .from(gazetteItems)
      .innerJoin(predictions, eq(predictions.id, gazetteItems.predictionId))
      .innerJoin(events, eq(events.id, predictions.eventId))
      .innerJoin(eventOutcomes, eq(eventOutcomes.id, predictions.outcomeId))
      .where(eq(gazetteItems.gazetteId, gazette.id))
      .orderBy(asc(gazetteItems.slot));

    // Sonuç etiketleri ayrı okunur: sonuç, kullanıcının seçtiği seçenek
    // olmayabilir.
    const resolvedIds = items
      .map((i) => i.resolvedOutcomeId)
      .filter((id): id is string => id !== null);
    const labels = new Map<string, string>();
    if (resolvedIds.length > 0) {
      const rows2 = await ctx
        .select({ id: eventOutcomes.id, label: eventOutcomes.label })
        .from(eventOutcomes)
        .where(inArray(eventOutcomes.id, resolvedIds));
      for (const r of rows2) labels.set(r.id, r.label);
    }

    let settled = 0;
    let hits = 0;

    const headlines: GazetteHeadline[] = items.map((i) => {
      /*
       * İPTAL EDİLEN ETKİNLİK GÖRÜNÜR KALIR AMA SAYILMAZ.
       *
       * Kartı gazeteden silmek, kullanıcının o gün gerçekten üç iddia
       * kurduğunu gizlerdi; puana katmak ise kimsenin hatası olmayan bir
       * şeyden onu sorumlu tutardı. İkisi de yanlış; doğru olan göstermek
       * ve saymamaktır.
       */
      const voided = i.eventStatus === 'VOID';
      const resolvedLabel = i.resolvedOutcomeId ? (labels.get(i.resolvedOutcomeId) ?? null) : null;

      let correct: boolean | null = null;
      if (!voided && i.eventStatus === 'RESOLVED' && i.resolvedOutcomeId !== null) {
        correct = i.resolvedOutcomeId === i.outcomeId;
        settled += 1;
        if (correct) hits += 1;
      }

      return {
        slot: i.slot,
        eventSlug: i.eventSlug,
        eventTitle: i.eventTitle,
        question: i.question,
        categoryIcon: null,
        outcomeLabel: i.outcomeLabel,
        outcomeImageUrl: i.outcomeImageUrl,
        closesAt: i.closesAt,
        resolvesAt: i.resolvesAt,
        resolvedOutcomeLabel: voided ? null : resolvedLabel,
        correct,
        voided,
      };
    });

    return {
      publicToken: gazette.publicToken,
      title: gazette.title,
      ownerUsername: gazette.ownerUsername,
      publishedDay: gazette.publishedDay,
      createdAt: gazette.createdAt,
      headlines,
      settled,
      hits,
      viewCount: gazette.viewCount,
    };
  },

  /** Kullanıcının kendi gazeteleri — en yeniden eskiye. */
  async listMine(ownerId: string, limit = 20, ctx: Ctx = db) {
    return ctx
      .select({
        publicToken: gazettes.publicToken,
        title: gazettes.title,
        publishedDay: gazettes.publishedDay,
        viewCount: gazettes.viewCount,
        signupCount: gazettes.signupCount,
      })
      .from(gazettes)
      .where(eq(gazettes.ownerId, ownerId))
      .orderBy(desc(gazettes.createdAt))
      .limit(limit);
  },

  /**
   * Görüntülenme sayacı. SESSİZ: bilinmeyen jeton hata üretmez.
   *
   * Sayaç sayfanın gösterilmesini geciktirmemeli — çağıran taraf bunu
   * yanıt sonrasına bırakır. Sayaç yanlış sayarsa kimse zarar görmez;
   * sayfa açılmazsa görür.
   */
  async countView(publicToken: string, ctx: Ctx = db): Promise<void> {
    await ctx
      .update(gazettes)
      .set({ viewCount: sql`${gazettes.viewCount} + 1` })
      .where(eq(gazettes.publicToken, publicToken));
  },

  /** Bu gazete üzerinden gelen kayıt. Aynı gerekçeyle sessizdir. */
  async countSignup(publicToken: string, ctx: Ctx = db): Promise<void> {
    await ctx
      .update(gazettes)
      .set({ signupCount: sql`${gazettes.signupCount} + 1` })
      .where(eq(gazettes.publicToken, publicToken));
  },

  /** Sahiplik doğrulaması — düzenleme/paylaşım ekranları için. */
  async assertOwner(publicToken: string, userId: string, ctx: Ctx = db): Promise<void> {
    const rows = await ctx
      .select({ ownerId: gazettes.ownerId })
      .from(gazettes)
      .where(eq(gazettes.publicToken, publicToken))
      .limit(1);
    if (!rows[0]) throw new NotFoundError('Gazete bulunamadı.');
    if (rows[0].ownerId !== userId) throw new NotFoundError('Gazete bulunamadı.');
  },
};
