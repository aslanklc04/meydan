import { lt, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { rateLimitCounters } from '@/server/db/schema';
import { rateLimits, noviceAccount, type RateLimitAction } from '@/config';
import { RateLimitError } from '@/server/errors';
import { enforceRateLimit as enforceInProcess } from './rate-limit';
import { log, logEvents } from '@/server/observability/logger';

/**
 * PAYLAŞIMLI ORAN SINIRLAMA — Faz 6.
 *
 * PROBLEM: Faz 4–5'teki sayaç süreç belleğindeydi. Tek instance'ta doğru
 * çalışıyordu; iki instance'ta etkin limit ikiye katlanıyordu. Bu, limitin
 * "bypass edilmesi" değil ama kötüye kullanıma açılan gerçek bir paydı.
 *
 * ÇÖZÜM: sayaç PostgreSQL'de tek bir UPSERT ile tutulur. Yeni altyapı yok.
 *
 * BAŞARISIZLIK DAVRANIŞI — bilinçli bir ödün. Veritabanına ulaşılamazsa:
 *   • AÇIK bırakmak (fail-open) sınırı tamamen kaldırır → güvenlik açığı,
 *   • KAPALI bırakmak (fail-closed) veritabanı sarsıntısında giriş dâhil her
 *     şeyi durdurur → erişilebilirlik felaketi.
 * Seçilen üçüncü yol: süreç içi sayaca DÜŞ. Koruma zayıflar ama sıfırlanmaz,
 * uygulama ayakta kalır ve olay günlüğe düşer.
 */

export type RateLimitIdentity = {
  readonly userId?: string;
  readonly ipHash?: string;
  readonly accountCreatedAt?: Date;
};

/**
 * Kimlik anahtarı. Kimlik ÇIKARILAMIYORSA `null` döner.
 *
 * NEDEN ORTAK "anonim" KOVASI YOK — Faz 6'da bilinçle değiştirildi.
 * Önceki davranışta kimliği belirlenemeyen istekler tek bir "anonim" kovaya
 * düşüyordu. Ters vekil `x-forwarded-for` başlığını yazmadığında bunun sonucu
 * şudur: SİTEYE GİREN HERKES aynı sayacı paylaşır ve saatte üçüncü kayıttan
 * sonra kimse kayıt olamaz. Yani bir yapılandırma hatası, tüm kullanıcılar
 * için hizmet kesintisine dönüşür.
 *
 * Bu yüzden kimliksiz istekte IP tabanlı kural UYGULANMAZ, ama olay günlüğe
 * düşer. Kullanıcı tabanlı kurallar (oturum gerektiren her şey) etkilenmez;
 * kaybedilen koruma yalnızca oturumsuz uçlardadır ve orada da tek savunma
 * oran sınırı değildir (parola karmaşıklığı, e-posta doğrulama, çıraklık
 * çarpanı).
 */
function identityKey(
  rule: (typeof rateLimits)[RateLimitAction],
  id: RateLimitIdentity,
): string | null {
  switch (rule.by) {
    case 'user':
      return id.userId ?? id.ipHash ?? null;
    case 'ip':
      return id.ipHash ?? id.userId ?? null;
    case 'user+ip':
      if (!id.userId && !id.ipHash) return null;
      return `${id.userId ?? '-'}|${id.ipHash ?? '-'}`;
  }
}

/** Yeni hesaplar için daha sıkı tavan — otomatik hesap üretimini caydırır. */
function effectiveLimit(
  rule: (typeof rateLimits)[RateLimitAction],
  identity: RateLimitIdentity,
  now: number,
): number {
  if (!identity.accountCreatedAt) return rule.limit;
  const ageHours = (now - identity.accountCreatedAt.getTime()) / 3600_000;
  if (ageHours >= noviceAccount.windowHours) return rule.limit;
  return Math.max(1, Math.floor(rule.limit * noviceAccount.multiplier));
}

/**
 * Eylemi denetler; aşımda `RateLimitError` fırlatır.
 *
 * SAYAÇ ÖNCE ARTAR, sonra karşılaştırılır. Tersi (önce oku, sonra yaz) iki
 * istek arasında yarış bırakır: ikisi de eski sayacı okuyup ikisi de geçer.
 * Tek `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` bunu atomik yapar.
 */
export async function enforceSharedRateLimit(
  action: RateLimitAction,
  identity: RateLimitIdentity,
  now: number = Date.now(),
): Promise<void> {
  const rule = rateLimits[action];
  const limit = effectiveLimit(rule, identity, now);
  const windowMs = rule.windowSec * 1000;

  const key = identityKey(rule, identity);
  if (key === null) {
    // Kimlik yok: sınırlama uygulanamaz. Sessizce geçmek yerine GÜRÜLTÜLÜ
    // biçimde kaydedilir — üretimde bu satır görülüyorsa ters vekil
    // yapılandırması eksiktir (docs/deployment.md).
    log.warn(logEvents.rateLimited, {
      operation: action,
      outcome: 'failure',
      reason: 'kimlik_yok',
    });
    return;
  }

  // Sabit pencere: anahtar pencerenin sıra numarasını taşır.
  const windowIndex = Math.floor(now / windowMs);
  const bucketKey = `${action}:${key}:${windowIndex}`;
  const expiresAt = new Date((windowIndex + 1) * windowMs);

  let hits: number;
  try {
    const rows = await db
      .insert(rateLimitCounters)
      .values({ bucketKey, hits: 1, expiresAt })
      .onConflictDoUpdate({
        target: rateLimitCounters.bucketKey,
        set: { hits: sql`${rateLimitCounters.hits} + 1` },
      })
      .returning({ hits: rateLimitCounters.hits });

    hits = rows[0]?.hits ?? 1;
  } catch (error) {
    // Veritabanı erişilemiyor: korumayı KAYBETMEDEN süreç içi sayaca düş.
    log.error(logEvents.unexpectedError, {
      operation: 'ratelimit.shared',
      outcome: 'failure',
      fallback: 'in_process',
      error,
    });
    enforceInProcess(action, identity, now);
    return;
  }

  if (hits > limit) {
    const retryAfterSec = Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000));
    log.warn(logEvents.rateLimited, { operation: action, retryAfterSec });
    throw new RateLimitError(retryAfterSec);
  }
}

/** Kalan hak — arayüzde "yavaşla" uyarısı göstermek için. */
export async function remainingSharedQuota(
  action: RateLimitAction,
  identity: RateLimitIdentity,
  now: number = Date.now(),
): Promise<number> {
  const rule = rateLimits[action];
  const key = identityKey(rule, identity);
  if (key === null) return effectiveLimit(rule, identity, now);

  const windowMs = rule.windowSec * 1000;
  const bucketKey = `${action}:${key}:${Math.floor(now / windowMs)}`;

  const rows = await db
    .select({ hits: rateLimitCounters.hits })
    .from(rateLimitCounters)
    .where(sql`${rateLimitCounters.bucketKey} = ${bucketKey}`)
    .limit(1);

  return Math.max(0, effectiveLimit(rule, identity, now) - (rows[0]?.hits ?? 0));
}

/**
 * Süresi dolmuş sayaçları siler — bakım işinden çağrılır.
 * Tablo aksi hâlde süresiz büyür; sayaçlar geçmişe dönük hiçbir işe yaramaz.
 */
export async function pruneRateLimitCounters(now: Date = new Date()): Promise<number> {
  const deleted = await db
    .delete(rateLimitCounters)
    .where(lt(rateLimitCounters.expiresAt, now))
    .returning({ bucketKey: rateLimitCounters.bucketKey });
  return deleted.length;
}
