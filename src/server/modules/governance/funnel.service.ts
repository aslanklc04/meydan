import { sql } from 'drizzle-orm';
import { db } from '@/server/db';

/**
 * ÖLÇÜM HUNİSİ — ürünün kendi karnesi.
 *
 * ── NEDEN YENİ BİR İZLEME TABLOSU YOK ──────────────────────────────────────
 * Ölçmek istediğimiz her şey ZATEN kayıtlı: kim ne zaman kaydoldu, kim ne
 * zaman tahmin yaptı, hangi etkinlik ne zaman sonuçlandı. Bunların üstüne bir
 * "olay akışı" tablosu kurmak üç bedel getirirdi ve hiçbir yeni bilgi
 * vermezdi:
 *
 *   • Her tıklamayı yazan bir tablo hızla en büyük tablo olur.
 *   • Toplanan her ek alan, korunması gereken yeni bir kişisel veridir.
 *   • İki kaynak (olay akışı ve gerçek tablolar) er ya da geç birbirini
 *     tutmaz ve hangisinin doğru olduğu tartışılır.
 *
 * Bu yüzden huni TÜRETİLİR, biriktirilmez. Sorgular biraz daha ağırdır; ama
 * bu sayfaya günde birkaç kez bakılacak, kullanıcı akışında değil.
 *
 * ── TANIMLAR SABİT ─────────────────────────────────────────────────────────
 * "7. gün tutundurma", "ilk hafta dönüşü" ve "6-8 gün" farklı şeylerdir;
 * tanım sonradan seçilirse her rapor kendi lehine bir pencere bulur. Yol
 * haritasında kilitlenen tanımlar burada da aynen uygulanır:
 *
 *   t₀        Kullanıcının İLK gerçek tahmininin zamanı.
 *   Y7        t₀'dan sonra 24-192 saat aralığında en az bir YENİ tahmin.
 *   Y28       Aynı davranış, 24-696 saat aralığında.
 *   Sonuç     Sonuç hazır olduktan sonraki 72 saatte sonucu görüp yeni
 *   döngüsü   tahmin yapan kişi ÷ sonucu hazır olan uygun kullanıcı.
 *
 * Sonuncusu MEYDAN için en önemlisidir: bizim döngümüz sonucun gelmesine
 * bağlı ve maç ertelenince kullanıcı "terk etti" diye sayılırsa ölçüm kendi
 * kendini yanıltır.
 *
 * ── PAYDA DÜRÜSTLÜĞÜ ───────────────────────────────────────────────────────
 * Payda, PENCEREYİ TAMAMLAMIŞ kullanıcılardır. Dün kaydolmuş birini Y7
 * paydasına koymak, daha yaşanmamış bir şeyi "olmadı" diye saymaktır ve oranı
 * sistematik olarak düşük gösterir.
 */

export type FunnelRatio = {
  /** Davranışı gerçekleştiren kişi sayısı. */
  readonly hit: number;
  /** Pencereyi tamamlamış ve dolayısıyla sayılabilir kişi sayısı. */
  readonly eligible: number;
};

export type FunnelSnapshot = {
  readonly users: number;
  readonly verifiedUsers: number;
  /** En az bir gerçek tahmin yapmış kullanıcı. */
  readonly predictors: number;
  readonly predictions: number;
  readonly resolvedPredictions: number;
  readonly y7: FunnelRatio;
  readonly y28: FunnelRatio;
  readonly resultCycle: FunnelRatio;
  /** Paylaşım nesnelerinin toplamları — kim değil, kaç. */
  readonly shares: {
    readonly links: number;
    readonly views: number;
    readonly answers: number;
    readonly signups: number;
  };
  readonly gazettes: {
    readonly total: number;
    readonly published: number;
    readonly views: number;
    readonly signups: number;
  };
};

/** Tek satırlık sayım sorgularının ortak sarmalayıcısı. */
async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const rows = (await db.execute(query)) as unknown as { n: number | string }[];
  return Number(rows[0]?.n ?? 0);
}

export const funnelService = {
  async snapshot(): Promise<FunnelSnapshot> {
    /*
     * t₀ TABLOSU: her kullanıcının ilk tahmini.
     *
     * Antrenman, sayfa açılışı ve bildirim tıklaması buraya GİRMEZ; yalnızca
     * gerçek bir etkinliğe verilmiş tahmin sayılır. Aksi hâlde ölçü, ürünün
     * asıl davranışını değil, gezinmeyi ölçerdi.
     */
    const firstPrediction = sql`
      SELECT "user_id" AS uid, min("created_at") AS t0
      FROM "prediction"
      GROUP BY "user_id"
    `;

    const [
      users,
      verifiedUsers,
      predictors,
      predictions,
      resolvedPredictions,
      y7Hit,
      y7Eligible,
      y28Hit,
      y28Eligible,
      cycleHit,
      cycleEligible,
      shareLinks,
      shareViews,
      shareAnswers,
      shareSignups,
      gazetteTotal,
      gazettePublished,
      gazetteViews,
      gazetteSignups,
    ] = await Promise.all([
      scalar(sql`SELECT count(*)::int AS n FROM "user" WHERE "deleted_at" IS NULL`),
      scalar(
        sql`SELECT count(*)::int AS n FROM "user"
            WHERE "deleted_at" IS NULL AND "email_verified" IS NOT NULL`,
      ),
      scalar(sql`SELECT count(DISTINCT "user_id")::int AS n FROM "prediction"`),
      scalar(sql`SELECT count(*)::int AS n FROM "prediction"`),
      scalar(sql`SELECT count(*)::int AS n FROM "prediction" WHERE "status" = 'RESOLVED'`),

      // ── Y7 ────────────────────────────────────────────────────────────
      scalar(sql`
        WITH ilk AS (${firstPrediction})
        SELECT count(DISTINCT i.uid)::int AS n
        FROM ilk i
        JOIN "prediction" p ON p."user_id" = i.uid
        WHERE p."created_at" >= i.t0 + interval '24 hours'
          AND p."created_at" <  i.t0 + interval '192 hours'
      `),
      scalar(sql`
        WITH ilk AS (${firstPrediction})
        SELECT count(*)::int AS n FROM ilk
        WHERE t0 + interval '192 hours' <= now()
      `),

      // ── Y28 ───────────────────────────────────────────────────────────
      scalar(sql`
        WITH ilk AS (${firstPrediction})
        SELECT count(DISTINCT i.uid)::int AS n
        FROM ilk i
        JOIN "prediction" p ON p."user_id" = i.uid
        WHERE p."created_at" >= i.t0 + interval '24 hours'
          AND p."created_at" <  i.t0 + interval '696 hours'
      `),
      scalar(sql`
        WITH ilk AS (${firstPrediction})
        SELECT count(*)::int AS n FROM ilk
        WHERE t0 + interval '696 hours' <= now()
      `),

      /*
       * ── SONUÇ DÖNGÜSÜ ─────────────────────────────────────────────────
       *
       * Uygun kişi: bir tahmini sonuçlanmış ve o sonucun üstünden 72 saat
       * GEÇMİŞ kullanıcı. Sonuç dün geldiyse kişinin daha üç günü var;
       * onu "dönmedi" saymak yaşanmamış bir şeyi ölçmektir.
       *
       * Başarı: o sonuçtan sonraki 72 saat içinde YENİ bir tahmin.
       */
      scalar(sql`
        WITH sonuclar AS (
          SELECT p."user_id" AS uid, e."resolved_at" AS r
          FROM "prediction" p
          JOIN "event" e ON e."id" = p."event_id"
          WHERE p."status" = 'RESOLVED' AND e."resolved_at" IS NOT NULL
        )
        SELECT count(DISTINCT s.uid)::int AS n
        FROM sonuclar s
        JOIN "prediction" p2 ON p2."user_id" = s.uid
        WHERE s.r + interval '72 hours' <= now()
          AND p2."created_at" > s.r
          AND p2."created_at" <= s.r + interval '72 hours'
      `),
      scalar(sql`
        WITH sonuclar AS (
          SELECT p."user_id" AS uid, e."resolved_at" AS r
          FROM "prediction" p
          JOIN "event" e ON e."id" = p."event_id"
          WHERE p."status" = 'RESOLVED' AND e."resolved_at" IS NOT NULL
        )
        SELECT count(DISTINCT uid)::int AS n FROM sonuclar
        WHERE r + interval '72 hours' <= now()
      `),

      // ── Paylaşım sayaçları ────────────────────────────────────────────
      scalar(sql`SELECT count(*)::int AS n FROM "prediction_share"`),
      scalar(sql`SELECT coalesce(sum("view_count"), 0)::int AS n FROM "prediction_share"`),
      scalar(sql`SELECT coalesce(sum("answer_count"), 0)::int AS n FROM "prediction_share"`),
      scalar(sql`SELECT coalesce(sum("signup_count"), 0)::int AS n FROM "prediction_share"`),

      scalar(sql`SELECT count(*)::int AS n FROM "gazette"`),
      scalar(
        sql`SELECT count(*)::int AS n FROM "gazette"
            WHERE "visibility" = 'PUBLIC' AND "hidden_at" IS NULL`,
      ),
      scalar(sql`SELECT coalesce(sum("view_count"), 0)::int AS n FROM "gazette"`),
      scalar(sql`SELECT coalesce(sum("signup_count"), 0)::int AS n FROM "gazette"`),
    ]);

    return {
      users,
      verifiedUsers,
      predictors,
      predictions,
      resolvedPredictions,
      y7: { hit: y7Hit, eligible: y7Eligible },
      y28: { hit: y28Hit, eligible: y28Eligible },
      resultCycle: { hit: cycleHit, eligible: cycleEligible },
      shares: {
        links: shareLinks,
        views: shareViews,
        answers: shareAnswers,
        signups: shareSignups,
      },
      gazettes: {
        total: gazetteTotal,
        published: gazettePublished,
        views: gazetteViews,
        signups: gazetteSignups,
      },
    };
  },
};
