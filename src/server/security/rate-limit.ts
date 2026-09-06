import { rateLimits, noviceAccount, type RateLimitAction } from '@/config';
import { RateLimitError } from '@/server/errors';

/**
 * Oran sınırlama — kayan pencere.
 *
 * BU FAZDA REDIS KULLANILMAZ (Faz 4 talimatı: gereksiz altyapı artırma).
 * Sayaçlar süreç belleğinde tutulur.
 *
 * BİLİNEN SINIR: tek süreçte doğru çalışır. Uygulama yatay ölçeklendiğinde
 * her instance kendi sayacını tutar, yani etkin limit instance sayısıyla
 * çarpılır. Faz 17'de paylaşımlı sayaç (Redis) devreye alınacak; arayüz
 * (`enforceRateLimit`) değişmeyeceği için geçiş yalnızca adaptör değişimidir.
 */

type Bucket = { readonly timestamps: number[] };

const buckets = new Map<string, Bucket>();

/** Bellek sızıntısını önlemek için periyodik temizlik. */
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 5 * 60_000;

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  const cutoff = now - 24 * 3600_000;
  for (const [key, bucket] of buckets) {
    if (bucket.timestamps.every((t) => t < cutoff)) buckets.delete(key);
  }
}

export type RateLimitIdentity = {
  readonly userId?: string;
  readonly ipHash?: string;
  /** Hesap bu tarihten sonra açıldıysa "çıraklık" limitleri uygulanır. */
  readonly accountCreatedAt?: Date;
};

function identityKey(rule: (typeof rateLimits)[RateLimitAction], id: RateLimitIdentity): string {
  switch (rule.by) {
    case 'user':
      return id.userId ?? id.ipHash ?? 'anonim';
    case 'ip':
      return id.ipHash ?? id.userId ?? 'anonim';
    case 'user+ip':
      return `${id.userId ?? '-'}|${id.ipHash ?? '-'}`;
  }
}

/**
 * Bir eylemin izin verilip verilmediğini denetler.
 * Aşımda `RateLimitError` fırlatır — kullanıcıya teknik detay gitmez.
 */
export function enforceRateLimit(
  action: RateLimitAction,
  identity: RateLimitIdentity,
  now = Date.now(),
): void {
  const rule = rateLimits[action];
  sweep(now);

  // Yeni hesaplar için daha sıkı tavan: otomatik hesap üretimini
  // ekonomik olarak anlamsız kılar.
  let limit: number = rule.limit;
  if (identity.accountCreatedAt) {
    const ageHours = (now - identity.accountCreatedAt.getTime()) / 3600_000;
    if (ageHours < noviceAccount.windowHours) {
      limit = Math.max(1, Math.floor(rule.limit * noviceAccount.multiplier));
    }
  }

  const key = `${action}:${identityKey(rule, identity)}`;
  const windowStart = now - rule.windowSec * 1000;
  const bucket = buckets.get(key) ?? { timestamps: [] };

  const recent = bucket.timestamps.filter((t) => t > windowStart);

  if (recent.length >= limit) {
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + rule.windowSec * 1000 - now) / 1000));
    buckets.set(key, { timestamps: recent });
    throw new RateLimitError(retryAfterSec);
  }

  recent.push(now);
  buckets.set(key, { timestamps: recent });
}

/** Test yardımcısı — sayaçları sıfırlar. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Kalan hak — arayüzde "yavaşla" uyarısı göstermek için. */
export function remainingQuota(
  action: RateLimitAction,
  identity: RateLimitIdentity,
  now = Date.now(),
): number {
  const rule = rateLimits[action];
  const key = `${action}:${identityKey(rule, identity)}`;
  const windowStart = now - rule.windowSec * 1000;
  const bucket = buckets.get(key);
  if (!bucket) return rule.limit;
  return Math.max(0, rule.limit - bucket.timestamps.filter((t) => t > windowStart).length);
}
