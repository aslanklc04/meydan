/**
 * Config barrel.
 *
 * KURAL: `src/config/**` dışında hiçbir yerde sabit sayı (magic number) bulunmaz.
 * Eşiklerin koda gömülmesi, ürün ayarını mühendislik işine dönüştürür.
 *
 * Not: `env.ts` bilinçli olarak buradan yeniden dışa aktarılmaz — sunucu sırları
 * istemci paketine sızmasın diye doğrudan `@/config/env` üzerinden import edilir.
 */
export { brand, financialDisclaimer, legalContactEmail } from './brand';
export { economy, isStakeAllowed } from './economy';
export { rating, formLambda } from './rating';
export { expertise } from './expertise';
export { rateLimits, noviceAccount, pagination, contentLimits, reservedUsernames } from './limits';
export type { RateLimitRule, RateLimitAction } from './limits';
