import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';
import { users } from './identity';

/**
 * Catalog context — kategori, etkinlik, sonuçlar ve tekrarlayan etkinlik şablonları.
 *
 * Outcome sistemi bilinçli olarak GENELDİR: spor, hava, dünya, oyun, sinema, müzik,
 * finans ve kripto aynı Event → EventOutcome → Prediction zincirini kullanır.
 * Kategoriye özel ayrı bir motor YOKTUR.
 */

/** Finansal kategoriler zorunlu uyarı bileşenini tetikler (Spesifikasyon Bölüm 9.6). */
export const categoryKind = pgEnum('category_kind', ['GENERAL', 'FINANCIAL']);

/**
 * Etkinliğin YAŞAM DÖNGÜSÜ. Tek bir durum alanı kullanılır (ADR-19):
 * ayrı bir `resolutionStatus` alanı bu değerlerle örtüşür ve zamanla ayrışabilir.
 *
 *   DRAFT     → admin hazırlıyor, kimse göremez
 *   OPEN      → tahmin ve meydan okuma açık
 *   CLOSED    → tahmin kapandı, sonuç bekleniyor (geçmişte kalmış ≠ çözülmüş)
 *   RESOLVING → sonuçlandırma işi çalışıyor
 *   RESOLVED  → sonuç kesinleşti, ödemeler yapıldı
 *   VOID      → sonuç güvenilir biçimde belirlenemedi, tüm çipler iade edildi
 *   CANCELLED → etkinlik hiç gerçekleşmedi, iptal edildi
 */
export const eventStatus = pgEnum('event_status', [
  'DRAFT',
  'OPEN',
  'CLOSED',
  'RESOLVING',
  'RESOLVED',
  'VOID',
  'CANCELLED',
]);

/** Sonucun hangi kaynaktan geldiği. MVP'de yalnızca MANUAL kullanılır. */
export const resolutionSource = pgEnum('resolution_source', [
  'MANUAL',
  'SPORTS',
  'WEATHER',
  'CRYPTO_MARKET',
  'STOCK_MARKET',
]);

export const recurrence = pgEnum('recurrence', ['DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY']);

/**
 * Günün Meydanı — öne çıkarma türü (Faz 8).
 *
 * DAILY_PRIMARY bir takvim gününde YALNIZCA BİR TANE olabilir; kural kısmi
 * tekil index ile veritabanında zorlanır (bkz. drizzle/0013). Uygulama
 * katmanına bırakılsaydı, iki yönetici aynı anda seçtiğinde ya da bir betik
 * ikinci kez çalıştığında sessizce iki "günün maçı" oluşurdu.
 */
export const featuredType = pgEnum('featured_type', ['DAILY_PRIMARY', 'DAILY_SECONDARY']);

export const categories = pgTable(
  'category',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    slug: varchar('slug', { length: 40 }).notNull(),
    name: varchar('name', { length: 60 }).notNull(),
    icon: varchar('icon', { length: 8 }).notNull(),
    description: varchar('description', { length: 200 }),
    kind: categoryKind('kind').notNull().default('GENERAL'),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('category_slug_key').on(t.slug),
    index('category_active_idx').on(t.active, t.sortOrder),
  ],
);

export const events = pgTable(
  'event',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id),

    title: varchar('title', { length: 160 }).notNull(),
    /** Kullanıcıya gösterilen soru: "Maçı kim kazanacak?" */
    question: varchar('question', { length: 200 }).notNull(),
    description: varchar('description', { length: 600 }),
    slug: varchar('slug', { length: 180 }).notNull(),

    status: eventStatus('status').notNull().default('DRAFT'),

    startsAt: timestamp('starts_at', { withTimezone: true }),
    /** Tahminlerin kapandığı an. Etkinliğin bittiği an DEĞİLDİR. */
    closesAt: timestamp('closes_at', { withTimezone: true }).notNull(),
    /** Sonucun beklendiği an. closesAt'ten sonradır. */
    resolvesAt: timestamp('resolves_at', { withTimezone: true }).notNull(),
    /** Kuralın yorumlandığı saat dilimi (IANA). Depolama her zaman UTC. */
    timezone: varchar('timezone', { length: 60 }).notNull().default('UTC'),

    resolutionSource: resolutionSource('resolution_source').notNull().default('MANUAL'),
    resolvedOutcomeId: text('resolved_outcome_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    voidReason: varchar('void_reason', { length: 200 }),

    /** Denormalize sayaçlar — okuma yolunu hızlandırır, gece doğrulanır. */
    predictionCount: integer('prediction_count').notNull().default(0),
    challengeCount: integer('challenge_count').notNull().default(0),

    /** ADR-16: şablondan üretilen etkinlikler. */
    templateId: text('template_id'),
    occurrenceKey: varchar('occurrence_key', { length: 20 }),

    /**
     * GÜNÜN MEYDANI (Faz 8).
     *
     * `featuredDate` bir TAKVİM GÜNÜDÜR, zaman damgası değil: "9 Eylül'ün
     * Meydanı" sorusu saat diliminden bağımsız tek bir gün olmalıdır.
     * Hangi güne düştüğü tek merkezden (config/time.ts) hesaplanır.
     */
    featuredType: featuredType('featured_type'),
    featuredDate: date('featured_date'),

    /**
     * KAPANIŞTA DONDURULAN KONSENSÜS.
     *
     * NEDEN SAKLANIYOR: "topluluğun yalnızca %18'i seninle aynı taraftaydı"
     * ifadesi, tahminin yapıldığı andaki gerçeği anlatır. Bu değer canlı
     * sorguyla üretilirse, sonuç açıklandıktan sonra insanlar tahmin
     * yapmayı bıraktıkça ya da veriler değiştikçe GEÇMİŞ KART DEĞİŞİR.
     * Paylaşılmış bir "ben demiştim" kartının sonradan başka bir yüzde
     * göstermesi, ürünün bütün güven vaadini çürütür.
     *
     * Biçim: { outcomeId: adet } + toplam. Kapanış anında bir kez yazılır.
     */
    consensusFrozenAt: timestamp('consensus_frozen_at', { withTimezone: true }),
    consensusSnapshot: jsonb('consensus_snapshot').$type<ConsensusSnapshot>(),

    createdById: text('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('event_slug_key').on(t.slug),
    index('event_status_closes_idx').on(t.status, t.closesAt),
    index('event_category_status_idx').on(t.categoryId, t.status),
    index('event_resolves_idx').on(t.resolvesAt, t.status),
    index('event_featured_idx').on(t.featuredDate, t.featuredType),
  ],
);

/**
 * Dondurulmuş konsensüs kaydı.
 *
 * `counts` yalnızca GERÇEK ve GEÇERLİ tahminleri sayar: misafir seçimleri,
 * sistem/yönetici test hesapları ve geçersiz sayılmış tahminler dışarıdadır.
 * `total` ayrıca tutulur çünkü düşük örneklem koruması toplam sayıya bakar:
 * üç kişilik bir etkinlikte yüzde göstermek sahte sosyal kanıttır.
 */
export type ConsensusSnapshot = {
  readonly counts: Readonly<Record<string, number>>;
  readonly total: number;
};

export const eventOutcomes = pgTable(
  'event_outcome',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    /** Makine anahtarı: GALATASARAY | FENERBAHCE | DRAW | UP | DOWN | UNCHANGED */
    key: varchar('key', { length: 40 }).notNull(),
    /** Kullanıcıya gösterilen etiket: "Galatasaray" */
    label: varchar('label', { length: 80 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),

    predictionCount: integer('prediction_count').notNull().default(0),
    /**
     * Tahmin kapanışında DONDURULAN kalabalık payı (Spesifikasyon Bölüm 6.1).
     * Zorluk katsayısının temelidir; dondurulmadan geçmiş rating yeniden üretilemez.
     */
    consensusShare: numeric('consensus_share', { precision: 6, scale: 5 }),
  },
  (t) => [
    uniqueIndex('event_outcome_key_unique').on(t.eventId, t.key),
    index('event_outcome_order_idx').on(t.eventId, t.sortOrder),
  ],
);

/** ADR-16 — tekrarlayan etkinlik şablonu. Faz 4'te üretim işi bağlanacak. */
export const eventTemplates = pgTable(
  'event_template',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    slug: varchar('slug', { length: 60 }).notNull(),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id),

    titlePattern: varchar('title_pattern', { length: 200 }).notNull(),
    questionPattern: varchar('question_pattern', { length: 200 }).notNull(),
    slugPattern: varchar('slug_pattern', { length: 200 }).notNull(),
    /** [{ key, label, sortOrder }] */
    outcomes: jsonb('outcomes').notNull(),

    recurrence: recurrence('recurrence').notNull(),
    recurrenceConfig: jsonb('recurrence_config'),
    timezone: varchar('timezone', { length: 60 }).notNull().default('UTC'),

    closesAtLocal: varchar('closes_at_local', { length: 8 }).notNull(),
    resolvesAtLocal: varchar('resolves_at_local', { length: 8 }).notNull(),

    resolutionSource: resolutionSource('resolution_source').notNull().default('MANUAL'),
    generateAheadDays: integer('generate_ahead_days').notNull().default(3),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('event_template_slug_key').on(t.slug),
    index('event_template_active_idx').on(t.active),
  ],
);

export type Category = typeof categories.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type EventOutcome = typeof eventOutcomes.$inferSelect;
