/**
 * Yapılandırılmış olay günlüğü — Faz 5.
 *
 * Neden `console.log` sarmalayıcısı ve harici bir kütüphane değil: bu aşamada
 * ihtiyaç, olayların MAKİNE OKUNABİLİR ve TUTARLI biçimde çıkması. Bunun için
 * tek satırlık JSON yeterli; bir günlük kütüphanesi bugün karşılığı olmayan bir
 * bağımlılık olurdu (Faz 5 talimatı: gereksiz bağımlılık ekleme). Toplayıcıya
 * (Sentry, Loki, CloudWatch) geçiş bu dosyanın değişmesinden ibarettir.
 *
 * HASSAS VERİ YAZILMAZ. Parola, oturum kimliği, token, çerez ve ham IP bu
 * fonksiyonlara GEÇİRİLMEZ; `redact()` bilinen alan adlarını son savunma
 * olarak temizler ama asıl kural çağıranın bunları hiç göndermemesidir.
 */

export type LogLevel = 'info' | 'warn' | 'error';

/**
 * YAPILANDIRILMIŞ ALAN SÖZLEŞMESİ (Faz 6).
 *
 * Her satır JSON'dur ve mümkün olduğunda şu alanları taşır. Zorunlu değildir —
 * bir alanı uydurmak, olmadığını bilmekten kötüdür — ama adları SABİTTİR:
 * arama yaparken `userId` ile `user_id` arasında seçim yapmak zorunda kalmak
 * günlüğü işe yaramaz hale getirir.
 *
 *   correlationId  bir isteğin/işin tüm satırlarını birbirine bağlar
 *   operation      ne yapılıyordu (ör. "challenge.accept")
 *   userId         işlemi yapan (varsa)
 *   eventId        etkinlik (varsa)
 *   challengeId    Meydan Okuma (varsa)
 *   outcome        "success" | "failure"
 *   durationMs     süre
 *   errorCode      domain hata kodu (teknik yığın izi DEĞİL)
 *
 * HASSAS VERİ YAZILMAZ: parola, token, oturum, çerez, ham IP, e-posta,
 * telefon. `redact()` bunları son savunma olarak temizler; asıl kural
 * çağıranın hiç göndermemesidir.
 */
export type LogFields = {
  readonly correlationId?: string;
  readonly operation?: string;
  readonly userId?: string;
  readonly eventId?: string;
  readonly challengeId?: string;
  readonly outcome?: 'success' | 'failure';
  readonly durationMs?: number;
  readonly errorCode?: string;
} & Record<string, unknown>;

/**
 * Değeri asla günlüğe düşmemesi gereken alan adları.
 *
 * EŞLEŞME KELİME SINIRINDADIR, alt dize değil. Alt dize eşleşmesi sessiz
 * yanlış pozitif üretiyordu: `skippedEvents` içinde "ip" geçtiği için sayaç
 * "[gizlendi]" olarak yazılıyor ve operatör işin kaç etkinlik atladığını
 * göremiyordu. Gizleme fazlası da bir arıza türüdür.
 */
const FORBIDDEN_KEYS = [
  'password',
  'passwordhash',
  'parola',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'sessionid',
  'session',
  'cookie',
  'authorization',
  'auth',
  'ip',
  'iphash',
  'ipaddress',
  'email',
  'eposta',
  'phone',
  'telefon',
];

/** `challengeId` → ["challenge", "id"] · `ip_hash` → ["ip", "hash"] */
function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

function isForbidden(key: string): boolean {
  const words = keyWords(key);
  const flat = words.join('');
  return FORBIDDEN_KEYS.includes(flat) || words.some((w) => FORBIDDEN_KEYS.includes(w));
}

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isForbidden(key)) {
      safe[key] = '[gizlendi]';
      continue;
    }
    safe[key] = value instanceof Error ? value.message : value;
  }
  return safe;
}

function emit(level: LogLevel, event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...redact(fields),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.warn(line);
}

export const log = {
  info: (event: string, fields: LogFields = {}) => emit('info', event, fields),
  warn: (event: string, fields: LogFields = {}) => emit('warn', event, fields),
  error: (event: string, fields: LogFields = {}) => emit('error', event, fields),
};

/**
 * Bir işlemi ölçer ve sonucunu tek satırda yazar.
 *
 * Süre ve sonuç (başarı/başarısızlık) elle yazıldığında er geç unutulur;
 * sarmalayıcı bunu yapının parçası yapar. Hata YUTULMAZ, yalnızca kaydedilip
 * yeniden fırlatılır.
 */
export async function timed<T>(
  operation: string,
  fields: LogFields,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await run();
    log.info(operation, {
      ...fields,
      operation,
      outcome: 'success',
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    log.error(operation, {
      ...fields,
      operation,
      outcome: 'failure',
      durationMs: Date.now() - startedAt,
      errorCode: (error as { code?: string })?.code ?? 'UNKNOWN',
      error,
    });
    throw error;
  }
}

/** Günlüğe düşürülen olay adları — tek kaynak, yazım hatası olmasın. */
export const logEvents = {
  authFailed: 'auth.failed',
  authSucceeded: 'auth.succeeded',
  registered: 'auth.registered',
  challengeCreated: 'challenge.created',
  challengeAccepted: 'challenge.accepted',
  challengeExpired: 'challenge.expired',
  predictionCreated: 'prediction.created',
  eventResolved: 'resolution.completed',
  ledgerImbalance: 'ledger.imbalance',
  adminAction: 'admin.action',
  moderationReport: 'moderation.report',
  rateLimited: 'security.rate_limited',
  unexpectedError: 'error.unexpected',

  // Faz 6 — zamanlanmış işler
  jobSucceeded: 'job.succeeded',
  jobFailed: 'job.failed',
  jobSkipped: 'job.skipped',
} as const;

/**
 * Bir çalıştırmanın tüm günlük satırlarını birbirine bağlayan kimlik.
 *
 * Üretimde bir isteğin ya da işin bıraktığı satırlar farklı zamanlarda ve
 * farklı seviyelerde düşer; ortak bir kimlik olmadan "bu hata hangi işlemde
 * oldu?" sorusu yanıtlanamaz. Kriptografik güç gerekmez, çarpışmaması yeter.
 */
export function newCorrelationId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
