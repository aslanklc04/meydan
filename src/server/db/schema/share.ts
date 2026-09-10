import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';
import { predictions } from './prediction';

/**
 * TEK SORULUK MEYDAN OKUMA — paylaşımın en küçük birimi.
 *
 * ── NEDEN GAZETEDEN AYRI ───────────────────────────────────────────────────
 * Gazete alıcıya OKUNACAK bir sayfa verir: üç manşet, bir kapak, bir karne.
 * Güzeldir ama alıcının yapacağı bir iş yoktur; en fazla bakar ve kapatır.
 *
 * Bu bağlantı ise alıcıya YAPILACAK bir iş verir: tek bir soru, üç düğme,
 * on saniye. Sonra da bir merak bırakır — "arkadaşım ne demiş?" Bu ikisi
 * farklı işler görür ve ikisi de gerekir: gazete anlatır, bu davet eder.
 *
 * ── NEDEN AYRI TABLO, `prediction` ÜZERİNE SÜTUN DEĞİL ─────────────────────
 * `prediction` çekirdek döngünün tablosudur ve çalışıyor. Her tahmin
 * paylaşılmaz; paylaşılanlar azınlıktır. Çalışan bir tabloya, satırların
 * çoğunda boş kalacak bir sütun eklemek yerine paylaşım kaydı kendi
 * tablosunda durur. Tahmin silinirse paylaşım da gider; tersi olmaz.
 */
export const predictionShares = pgTable(
  'prediction_share',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    /**
     * Paylaşım adresinin tek parçası: /m/<public_token>.
     *
     * İç kimlikle ilişkisi yoktur; jetondan kimin, hangi tahmini paylaştığı
     * çıkarılamaz. Üretimi servis katmanında, kriptografik rastgelelikle.
     */
    publicToken: text('public_token').notNull(),

    predictionId: text('prediction_id')
      .notNull()
      .references(() => predictions.id, { onDelete: 'cascade' }),

    /**
     * ── ATIF SAYAÇLARI ──────────────────────────────────────────────────────
     * Kim geldiğini DEĞİL, kaç kişi geldiğini sayarlar. Ziyaretçi kimliği, IP
     * ya da parmak izi tutulmaz.
     *
     * Üçü ayrı ayrı sayılır çünkü hunideki üç ayrı soruyu cevaplarlar:
     *   • viewCount   — bağlantı açıldı mı?
     *   • answerCount — açan kişi CEVAP VERDİ mi? (asıl ölçü bu)
     *   • signupCount — cevap veren kaldı mı?
     * Yalnız görüntülenmeyi saymak, paylaşımın işe yaradığı yanılgısını verir.
     */
    viewCount: integer('view_count').notNull().default(0),
    answerCount: integer('answer_count').notNull().default(0),
    signupCount: integer('signup_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('prediction_share_token_key').on(t.publicToken),
    /*
     * Bir tahminin TEK paylaşım bağlantısı olur.
     *
     * Her "paylaş"a basışta yeni jeton üretilseydi, aynı tahmin için onlarca
     * adres oluşur ve sayaçlar o adreslere bölünürdü: hangisinin işe
     * yaradığını kimse söyleyemezdi. Aynı tahmin, aynı bağlantı.
     */
    uniqueIndex('prediction_share_prediction_key').on(t.predictionId),
    index('prediction_share_created_idx').on(t.createdAt.desc()),
  ],
);
