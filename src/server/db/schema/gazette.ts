import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';
import { users } from './identity';
import { predictions } from './prediction';

/**
 * GELECEK GAZETESİ — kullanıcının kendi eseri olan, paylaşılabilir tahmin kapağı.
 *
 * ── NEDEN AYRI BİR TABLO ───────────────────────────────────────────────────
 * Gazete yeni bir tahmin türü DEĞİLDİR. Kullanıcının zaten yaptığı 1-3 tahmini
 * bir kapak altında toplar. Bu yüzden `prediction` tablosuna dokunulmaz:
 * çekirdek döngü olduğu gibi çalışmaya devam eder, gazete onun üstüne bir
 * sunum katmanıdır. Gazete silinse tahminler yerinde kalır.
 *
 * ── PAYLAŞIM JETONU NEDEN AYRI BİR ALAN ────────────────────────────────────
 * Bağlantıda `id` kullanılsaydı, kimlikler sıralı olmasa bile bir kullanıcı
 * kendi gazetesinin adresinden başkalarınınkini denemeye çalışırdı; dahası
 * ürünün kuralı gereği kullanıcıya iç kimlik gösterilmez. `public_token`
 * yalnızca paylaşım içindir: rastgele üretilir, tahmin edilemez ve iç
 * kimlikle ilişkisi yoktur.
 */
/**
 * Kapağın kimlere görüneceği.
 *
 * PRIVATE: yalnızca bağlantıyı bilen görür. Kapak hiçbir listede yer almaz.
 * PUBLIC:  ayrıca ana sayfadaki raflarda herkese görünür.
 *
 * VARSAYILAN PRIVATE'tir. Serbest yazılmış bir metni kullanıcının açık bir
 * tercihi olmadan herkesin ana sayfasına koymak, ona sormadan adına karar
 * vermektir; bu tercih onay kutusuyla ve okunur bir cümleyle istenir.
 */
export const gazetteVisibility = pgEnum('gazette_visibility', ['PRIVATE', 'PUBLIC']);

export const gazettes = pgTable(
  'gazette',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    /**
     * Paylaşım adresinin tek parçası: /g/<public_token>.
     *
     * Uzunluk ve rastgelelik servis katmanında üretilir (crypto kaynaklı);
     * burada yalnızca TEKİL olması garanti edilir. Çakışma olasılığı yok
     * denecek kadar küçüktür ama "yok denecek kadar" bir kısıt değildir:
     * asıl koruma bu tekil index'tir.
     */
    publicToken: text('public_token').notNull(),

    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Kullanıcının verdiği kapak başlığı. */
    title: text('title').notNull(),

    /** Hangi ürün gününde yayımlandı — ürün takvimi `config/time.ts`. */
    publishedDay: date('published_day').notNull(),

    /**
     * ── ATIF SAYAÇLARI ──────────────────────────────────────────────────────
     * Kim geldiğini DEĞİL, kaç kişi geldiğini sayarlar. Ziyaretçi kimliği,
     * IP'si veya parmak izi tutulmaz; paylaşımın işe yarayıp yaramadığını
     * anlamak için sayı yeterlidir ve kimseyi izlemek gerekmez.
     */
    viewCount: integer('view_count').notNull().default(0),
    signupCount: integer('signup_count').notNull().default(0),

    visibility: gazetteVisibility('visibility').notNull().default('PRIVATE'),

    /**
     * GÖRÜNÜRLÜK TEK YÖNLÜ BİR MANDALDIR.
     *
     * Kullanıcı herkese açık bir kapağı gizleyebilir (fikrini değiştirme,
     * mahremiyet hakkı) ama geri açamaz. Sebep, manşetin silinemez olmasıyla
     * aynı: serbest bırakılsaydı kullanıcı kapağını herkese açar, manşetleri
     * tutmayınca gizler, tutunca yeniden açardı. Raf o zaman gerçeği değil,
     * herkesin en iyi gününü gösterirdi.
     *
     * Bu alan dolduğunda görünürlük PRIVATE'te kilitlenir — kural veritabanı
     * kısıtıyla uygulanır, koddaki bir `if` ile değil.
     */
    madePrivateAt: timestamp('made_private_at', { withTimezone: true }),

    /**
     * MODERASYON GİZLEMESİ — kullanıcının kendi tercihinden ayrıdır.
     *
     * Gizlenen kapak yalnızca raftan değil BAĞLANTIDAN da düşer. Yalnızca
     * raftan düşseydi gizleme bir gösteriden ibaret olurdu: şikâyet edilen
     * içerik, paylaşıldığı yerde okunmaya devam ederdi.
     */
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    hiddenById: text('hidden_by_id').references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('gazette_public_token_key').on(t.publicToken),
    index('gazette_owner_idx').on(t.ownerId, t.createdAt.desc()),
    // Raf sorguları: herkese açık ve gizlenmemiş kapaklar, yeniden eskiye.
    index('gazette_shelf_idx').on(t.visibility, t.hiddenAt, t.createdAt.desc()),
  ],
);

/**
 * Gazetenin manşetleri — her biri kullanıcının mevcut bir tahmini.
 *
 * ── SEÇİCİ SUNUMA KARŞI İKİ KİLİT ──────────────────────────────────────────
 * Bir tahmin gazeteye eklendikten sonra çıkarılamaz (servis kuralı) ve aynı
 * tahmin İKİNCİ bir gazeteye giremez (aşağıdaki tekil index). İkinci kural
 * olmasaydı kural birincisi işe yaramazdı: kullanıcı sonucu gördükten sonra
 * yalnızca tutan tahminini içeren yeni bir gazete kurar ve karnesini
 * kusursuz gösterirdi. Kural veritabanında durur; unutulacak bir `if`
 * değildir.
 *
 * `slot` ile "en çok üç manşet" kuralı da veriye yazılır: 0, 1, 2 dışında
 * değer kabul edilmez ve aynı gazetede aynı slot iki kez olamaz.
 */
export const gazetteItems = pgTable(
  'gazette_item',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    gazetteId: text('gazette_id')
      .notNull()
      .references(() => gazettes.id, { onDelete: 'cascade' }),

    predictionId: text('prediction_id')
      .notNull()
      .references(() => predictions.id, { onDelete: 'cascade' }),

    slot: integer('slot').notNull(),
  },
  (t) => [
    uniqueIndex('gazette_item_prediction_key').on(t.predictionId),
    uniqueIndex('gazette_item_slot_key').on(t.gazetteId, t.slot),
  ],
);
