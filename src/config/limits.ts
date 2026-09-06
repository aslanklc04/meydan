/**
 * Oran sınırlama tabloları — Spesifikasyon Bölüm 10.4.
 *
 * Anahtar biçimi: {scope}:{identity}:{action}
 * Kimlik: oturum açmışsa userId, değilse IP hash. Aşımda 429 + Retry-After.
 */
export type RateLimitRule = {
  /** Pencere başına izin verilen istek sayısı. */
  readonly limit: number;
  /** Pencere süresi (saniye). */
  readonly windowSec: number;
  /** Sayaç kimliği: kullanıcı mı, IP mi, ikisi birden mi. */
  readonly by: 'user' | 'ip' | 'user+ip';
};

const MINUTE = 60;
const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/**
 * Oran sınırı çarpanı — YALNIZCA otomatik testler içindir.
 *
 * NEDEN VAR: uçtan uca test paketi tek bir "istemci adresinden" onlarca
 * hesap açar. Üretimdeki kayıt sınırı (saatte 3) bu koşuyu ilk üç kullanıcıda
 * durdurur. Sınırı üretimde gevşetmek yanlış çözümdür; test ortamının kendi
 * çarpanını vermesi doğrusudur.
 *
 * VARSAYILAN 1'DİR. Üretimde ASLA ayarlanmaz; ayarlanırsa uygulama başlarken
 * uyarı yazar (aşağıya bakınız).
 */
const limitMultiplier = (() => {
  const raw = process.env.RATE_LIMIT_MULTIPLIER;
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  if (parsed !== 1 && process.env.NODE_ENV === 'production') {
    console.warn(
      '[güvenlik] RATE_LIMIT_MULTIPLIER üretimde ayarlanmış: oran sınırları ' +
        `${parsed} katına çıkarıldı. Bu ayar yalnızca test ortamı içindir.`,
    );
  }
  return parsed;
})();

const scaled = (limit: number): number => limit * limitMultiplier;

export const rateLimits = {
  'auth.login': { limit: scaled(5), windowSec: 15 * MINUTE, by: 'user+ip' },
  'auth.register': { limit: scaled(3), windowSec: HOUR, by: 'ip' },
  'auth.passwordReset': { limit: scaled(3), windowSec: HOUR, by: 'user+ip' },

  'prediction.create': { limit: scaled(30), windowSec: HOUR, by: 'user' },
  'challenge.create': { limit: scaled(20), windowSec: HOUR, by: 'user' },
  'comment.create': { limit: scaled(20), windowSec: HOUR, by: 'user' },
  'reaction.toggle': { limit: scaled(200), windowSec: HOUR, by: 'user' },
  'follow.toggle': { limit: scaled(100), windowSec: DAY, by: 'user' },

  'search.query': { limit: scaled(30), windowSec: MINUTE, by: 'user+ip' },
  'api.public': { limit: scaled(120), windowSec: MINUTE, by: 'ip' },
  'admin.mutation': { limit: scaled(60), windowSec: MINUTE, by: 'user' },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitAction = keyof typeof rateLimits;

/**
 * Yeni hesaplar için ilk 24 saat boyunca uygulanan sıkı "çıraklık" çarpanı.
 * Otomatik hesap üretimini ekonomik olarak anlamsız kılar.
 */
export const noviceAccount = {
  windowHours: 24,
  multiplier: 0.34,
} as const;

/** Sayfalama sınırları — cursor tabanlı listeler. */
export const pagination = {
  defaultLimit: 20,
  maxLimit: 100,
} as const;

/** İçerik uzunluk sınırları. */
export const contentLimits = {
  bioMaxLength: 280,
  explanationMaxLength: 500,
  commentMaxLength: 1000,
  usernameMinLength: 3,
  usernameMaxLength: 20,
} as const;

/** Route çakışması veya kimlik taklidi yaratabilecek kullanıcı adları. */
export const reservedUsernames: readonly string[] = [
  'admin',
  'administrator',
  'api',
  'app',
  'auth',
  'blog',
  'help',
  'legal',
  'login',
  'logout',
  'meydan',
  'moderator',
  'null',
  'official',
  'register',
  'root',
  'settings',
  'support',
  'system',
  'u',
  'undefined',
  'www',
];
