import { z } from 'zod';

/**
 * Ortam değişkeni doğrulaması — Spesifikasyon Bölüm 10.8.
 *
 * Sırlar kaynak koda konmaz. Lint/test/build gibi sırsız ortamlarda
 * `SKIP_ENV_VALIDATION=1` kullanılır.
 *
 * ── İKİ SINIF DEĞİŞKEN ─────────────────────────────────────────────────────
 *
 * KATI (eksik/geçersizse uygulama BAŞLAMAZ):
 *   DATABASE_URL, AUTH_SECRET, APP_URL, IP_PEPPER, CRON_SECRET
 *   Bunlar yanlış olduğunda arıza SESSİZDİR ve tehlikelidir: zayıf bir
 *   AUTH_SECRET ile site çalışmaya devam eder ama oturumlar taklit edilebilir.
 *   Görünür bir çökme, görünmez bir güvenlik açığından iyidir.
 *
 * HOŞGÖRÜLÜ (geçersizse UYARI yazılır, güvenli varsayılana düşülür):
 *   EMAIL_*, ADMIN_EMAIL, SENTRY_DSN
 *   Bunların hepsinin güvenli bir varsayılanı vardır. En kötü sonuç
 *   "e-posta gitmedi" ya da "yönetici yükseltilmedi" olur — ikisi de
 *   düzeltilebilir ve görünür. Bunlar yüzünden siteyi komple durdurmak
 *   orantısızdır.
 *
 * ── BU AYRIM NEDEN VAR ─────────────────────────────────────────────────────
 * Faz 7'de gerçek bir olay yaşandı: dağıtım paneline yanlışlıkla girilmiş bir
 * `EMAIL_PROVIDER` değeri yüzünden site ÜST ÜSTE ÜÇ KEZ yayına alınamadı.
 * Oysa e-posta katmanı zaten "tanımadığım sağlayıcı → uyar ve varsayılana dön"
 * diye yazılmıştı; katı doğrulama o dayanıklılığı boşa çıkarmıştı.
 * Doğrulamanın işi arızayı ERKEN GÖSTERMEKTİR, arıza ÜRETMEK değil.
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

  // ── HOŞGÖRÜLÜ ALAN ───────────────────────────────────────────────────────
  // Biçim burada DAYATILMAZ; aşağıda uyarı olarak denetlenir ve kullanıldığı
  // yerde güvenli varsayılana düşülür.

  /** `console` (varsayılan) | `http`. Tanınmayan değer → console + uyarı. */
  EMAIL_PROVIDER: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_API_URL: z.string().optional(),
  EMAIL_API_KEY: z.string().optional(),

  /**
   * Yönetici kurulumu — `scripts/deploy.ts`.
   *
   * Bu adresle GERÇEKTEN kayıt olmuş hesap, dağıtım sırasında ADMIN'e
   * yükseltilir. Parola burada TUTULMAZ; kurucu parolasını kendi belirler.
   * Rol hiçbir zaman istemciden gelen bir değerle atanmaz.
   *
   * Geçersizse: yükseltme atlanır ve uyarı yazılır. Site çalışmaya devam eder.
   */
  ADMIN_EMAIL: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
});

/** Kaba e-posta biçim denetimi — dayatma değil, uyarı üretmek için. */
export function looksLikeEmail(value: string | undefined): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** `EMAIL_PROVIDER` değerini güvenli bir seçeneğe indirger. */
export function resolveEmailProvider(raw: string | undefined): 'console' | 'http' {
  const value = raw?.trim().toLowerCase();
  return value === 'http' ? 'http' : 'console';
}

/**
 * Hoşgörülü alandaki sorunları GÖRÜNÜR kılar.
 *
 * Sessizce varsayılana dönmek, katı doğrulamanın tersi bir arıza üretirdi:
 * kurucu e-postaların neden gitmediğini hiç anlamazdı. Bu yüzden düşülen her
 * varsayılan günlüğe yazılır. DEĞERLER YAZILMAZ, yalnızca hangi ayarın
 * beklenmeyen olduğu.
 */
function warnAboutTolerated(env: NodeJS.ProcessEnv): void {
  const problems: string[] = [];

  const provider = env.EMAIL_PROVIDER?.trim();
  if (provider && provider.toLowerCase() !== 'console' && provider.toLowerCase() !== 'http') {
    problems.push('EMAIL_PROVIDER tanınmadı → "console" kullanılacak, e-posta GÖNDERİLMEYECEK');
  }
  if (env.EMAIL_FROM && !looksLikeEmail(env.EMAIL_FROM)) {
    problems.push('EMAIL_FROM geçerli bir e-posta adresi değil → e-posta gönderimi kapalı');
  }
  if (env.ADMIN_EMAIL && !looksLikeEmail(env.ADMIN_EMAIL)) {
    problems.push('ADMIN_EMAIL geçerli bir e-posta adresi değil → yönetici yükseltmesi atlanacak');
  }

  if (problems.length > 0) {
    console.warn(
      ['[ayarlar] Beklenmeyen değerler var; uygulama güvenli varsayılanlarla devam ediyor:']
        .concat(problems.map((p) => `  - ${p}`))
        .join('\n'),
    );
  }
}

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
    throw new Error(
      [
        'Ortam değişkenleri geçersiz. Uygulama başlatılmadı:',
        ...missing,
        '',
        'Bu ayarlar zorunludur; yanlış olduklarında arıza sessiz ve tehlikeli olur.',
        'Dağıtım platformunun "Environment Variables" bölümünden düzeltin.',
      ].join('\n'),
    );
  }

  // Katı alan geçti. Hoşgörülü alandaki sorunlar yalnızca UYARI üretir.
  warnAboutTolerated(process.env);

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
