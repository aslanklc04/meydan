import { z } from 'zod';

/**
 * Ortam değişkeni doğrulaması — Spesifikasyon Bölüm 10.8.
 *
 * Eksik veya geçersiz bir sırla uygulama BAŞLAMAZ. Sırlar kaynak koda konmaz.
 * Lint/test/build gibi sırsız ortamlarda `SKIP_ENV_VALIDATION=1` kullanılır.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url(),

  /** Auth.js oturum imzalama sırrı — en az 32 karakter. */
  AUTH_SECRET: z.string().min(32),

  APP_URL: z.string().url(),

  /** IP adreslerini HMAC'lemek için kullanılan ayrı sır. Ham IP asla saklanmaz. */
  IP_PEPPER: z.string().min(32),

  /** Zamanlanmış iş endpoint'lerini imzalamak için. */
  CRON_SECRET: z.string().min(32),

  /**
   * E-POSTA — üretimde `http`, geliştirmede boş bırakılır (console).
   *
   * `http` seçildiğinde EMAIL_FROM / EMAIL_API_URL / EMAIL_API_KEY üçü birden
   * gereklidir. Eksikse uygulama BAŞLAR ama e-posta gitmez ve
   * `email.misconfigured` günlüğe düşer — kayıt akışı bir sağlayıcı arızası
   * yüzünden tamamen durmasın diye (bkz. server/modules/identity/email.ts).
   */
  EMAIL_PROVIDER: z.enum(['console', 'http']).default('console'),
  EMAIL_FROM: z.string().email().optional(),
  EMAIL_API_URL: z.string().url().optional(),
  EMAIL_API_KEY: z.string().optional(),

  /**
   * Yönetici kurulumu — `scripts/deploy.ts`.
   *
   * Bu adresle GERÇEKTEN kayıt olmuş hesap, dağıtım sırasında ADMIN'e
   * yükseltilir. Parola burada TUTULMAZ; kurucu parolasını kendi belirler.
   * Rol hiçbir zaman istemciden gelen bir değerle atanmaz.
   */
  ADMIN_EMAIL: z.string().email().optional(),

  SENTRY_DSN: z.string().optional(),
});

const clientSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().default('MEYDAN'),
});

const skip = process.env.SKIP_ENV_VALIDATION === '1' || process.env.SKIP_ENV_VALIDATION === 'true';

type ServerEnv = z.infer<typeof serverSchema>;
type ClientEnv = z.infer<typeof clientSchema>;

/**
 * Build/lint gibi sırsız ortamlar için yer tutucular.
 * Yalnızca SKIP_ENV_VALIDATION açıkken kullanılır; çalışma zamanında gerçek
 * sır zorunludur ve eksikse uygulama başlamaz.
 */
const BUILD_PLACEHOLDER = 'build-time-placeholder-not-a-real-secret-value';

function parseServerEnv(): ServerEnv {
  if (skip) {
    return {
      ...process.env,
      AUTH_SECRET: process.env.AUTH_SECRET ?? BUILD_PLACEHOLDER,
      IP_PEPPER: process.env.IP_PEPPER ?? BUILD_PLACEHOLDER,
      CRON_SECRET: process.env.CRON_SECRET ?? BUILD_PLACEHOLDER,
      APP_URL: process.env.APP_URL ?? 'http://localhost:3000',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://meydan:meydan@localhost:5432/meydan',
    } as unknown as ServerEnv;
  }

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(['Ortam değişkenleri geçersiz. Uygulama başlatılmadı:', ...missing].join('\n'));
  }
  return parsed.data;
}

function parseClientEnv(): ClientEnv {
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  });
  return parsed.success ? parsed.data : { NEXT_PUBLIC_APP_NAME: 'MEYDAN' };
}

/** Sunucu tarafı ortam değişkenleri. İstemci paketine ASLA import edilmez. */
export const serverEnv: ServerEnv = parseServerEnv();

/** İstemciye açık ortam değişkenleri. */
export const clientEnv: ClientEnv = parseClientEnv();

export const isProduction = process.env.NODE_ENV === 'production';
export const isTest = process.env.NODE_ENV === 'test';
