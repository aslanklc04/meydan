import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';
import { users } from './identity';
import { categories } from './catalog';

/**
 * Governance context — Faz 5.
 *
 * İki şey: kullanıcının ilgi alanları (onboarding) ve yönetici denetim kaydı.
 */

/**
 * Kullanıcının seçtiği kategoriler.
 *
 * Ayrı tablo, `profile` içinde JSON dizi değil: kategori bir varlıktır ve
 * yabancı anahtar bütünlüğü ile korunur. Silinen bir kategori ilgi alanı
 * satırlarını da götürür; JSON'da bu ancak elle temizlikle olurdu.
 */
export const userInterests = pgTable(
  'user_interest',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.categoryId] }),
    index('user_interest_user_idx').on(t.userId),
  ],
);

export const auditAction = pgEnum('audit_action', [
  'EVENT_CREATED',
  'EVENT_CLOSED',
  'EVENT_RESOLVED',
  'EVENT_VOIDED',
  'USER_SUSPENDED',
  'USER_REACTIVATED',
  'REPORT_REVIEWED',
  'LEADERBOARD_GENERATED',
  'JOBS_RUN',
  /** Sistem kaynaklı para hareketi: süresi dolan Meydan Okumanın iadesi. */
  'CHALLENGE_REFUNDED',
  /** İtibarın toplu yeniden hesaplanması (algoritma sürüm geçişi). */
  'RATINGS_RECOMPUTED',
  'GAZETTE_HIDDEN',
]);

/**
 * Yönetici denetim kaydı — kim, ne zaman, neyi değiştirdi.
 *
 * DEĞİŞMEZDİR: yalnızca eklenir. Güncelleme veya silme yolu yoktur; bu
 * yüzden `updatedAt` sütunu da yoktur. Hassas veri (parola, oturum, token)
 * `metadata` içine YAZILMAZ.
 */
export const auditLogs = pgTable(
  'audit_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: auditAction('action').notNull(),
    /** Etkilenen kaydın türü ve kimliği — ör. "event", "user". */
    targetType: varchar('target_type', { length: 30 }),
    targetId: text('target_id'),
    /** Karar için gereken bağlam. Sır, token veya parola İÇERMEZ. */
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_created_idx').on(t.createdAt.desc()),
    index('audit_log_actor_idx').on(t.actorId, t.createdAt.desc()),
    index('audit_log_target_idx').on(t.targetType, t.targetId),
  ],
);

export const jobStatus = pgEnum('job_status', ['RUNNING', 'SUCCEEDED', 'FAILED']);

/**
 * Bakım işi çalıştırma kaydı — Faz 6.
 *
 * NEDEN VAR: zamanlanmış bir iş sessizce çalışmayı bırakırsa kimse fark etmez;
 * fark edildiğinde ise günlerdir iade edilmemiş çipler birikmiştir. Bu tablo
 * "en son ne zaman çalıştı ve sonucu neydi?" sorusunu tek sorguda yanıtlar ve
 * yönetim ekranında görünür.
 *
 * Aynı anda iki instance'ın çalışmasını bu tablo DEĞİL, PostgreSQL advisory
 * lock engeller (bkz. `jobs.service.ts`). Tablo yalnızca kayıt tutar.
 */
export const jobRuns = pgTable(
  'job_run',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    jobName: varchar('job_name', { length: 60 }).notNull(),
    status: jobStatus('status').notNull().default('RUNNING'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    /** İşin ürettiği sayılar — hassas veri içermez. */
    report: jsonb('report'),
    /** Kullanıcıya değil, operatöre yönelik hata özeti. */
    error: varchar('error', { length: 500 }),
    /** Aynı çalıştırmanın günlük satırlarıyla eşleştirilmesi için. */
    correlationId: varchar('correlation_id', { length: 40 }),
  },
  (t) => [
    index('job_run_name_idx').on(t.jobName, t.startedAt.desc()),
    index('job_run_status_idx').on(t.status, t.startedAt.desc()),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type UserInterest = typeof userInterests.$inferSelect;
export type JobRun = typeof jobRuns.$inferSelect;

/**
 * Paylaşımlı oran sınırlama sayacı — Faz 6.
 *
 * NEDEN VERİTABANI: Faz 4–5'teki sayaç süreç belleğindeydi. Uygulama iki
 * instance'a çıktığında etkin limit ikiye katlanıyordu; saldırgan için bu,
 * limiti "aşmak" değil sadece daha çok istek atmak demekti. Redis doğru
 * araçtır ama bu ölçekte YENİ BİR ALTYAPI ve yeni bir aylık maliyettir
 * (Faz 6 talimatı: gereksiz altyapı kurma). PostgreSQL zaten var, tek
 * satırlık bir UPSERT saniyeler altı gecikmeyle bu işi görür.
 *
 * PENCERE MODELİ: sabit pencere (fixed window). Anahtar, zaman damgasının
 * pencere boyuna bölümünü içerir. Bilinen ödünü: iki pencerenin sınırında
 * kısa süreliğine limitin iki katına izin verilebilir. Kayan pencerenin
 * doğruluğu bu iş için gereğinden pahalıdır ve bu ödün kabul edilmiştir.
 *
 * TEMİZLİK: `expires_at` geçmiş satırlar bakım işinde silinir; tablo süresiz
 * büyümez.
 */
export const rateLimitCounters = pgTable(
  'rate_limit_counter',
  {
    /** `${eylem}:${kimlik}:${pencereNo}` */
    bucketKey: varchar('bucket_key', { length: 200 }).primaryKey(),
    hits: integer('hits').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('rate_limit_expiry_idx').on(t.expiresAt)],
);

export type RateLimitCounter = typeof rateLimitCounters.$inferSelect;
