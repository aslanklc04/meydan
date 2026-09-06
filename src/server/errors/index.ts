/**
 * Domain hata hiyerarşisi — Spesifikasyon Bölüm 5.4.
 *
 * KULLANICIYA GÖRÜNEN HER MESAJ sade Türkçedir ve şu üçünü içermez: yığın izi,
 * sınıf/kısıt adı (`DrizzleError`, `prediction_one_active_per_user_event`),
 * veritabanı kimliği. Beklenmeyen hatalar `InternalError` olarak sarılır;
 * teknik detay yalnızca sunucu günlüğüne gider.
 *
 * Mesajların dili ürünün geri kalanıyla aynıdır: ikinci tekil şahıs ("dene",
 * "yapamazsın"). `tests/unit/error-messages.test.ts` bunu CI'da zorlar.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly field: string | undefined;

  constructor(message: string, field?: string) {
    super(message);
    this.name = new.target.name;
    this.field = field;
  }
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  readonly httpStatus = 400;
}

export class AuthenticationError extends DomainError {
  override readonly code: string;
  readonly httpStatus = 401;
  constructor(message = 'Bu işlem için giriş yapman gerekiyor.', code = 'UNAUTHENTICATED') {
    super(message);
    this.code = code;
  }
}

export class AuthorizationError extends DomainError {
  override readonly code: string;
  readonly httpStatus = 403;
  constructor(message = 'Bu işlemi yapamazsın.', code = 'FORBIDDEN') {
    super(message);
    this.code = code;
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = 'Aradığın şeyi bulamadık.') {
    super(message);
  }
}

export class ConflictError extends DomainError {
  override readonly code: string;
  readonly httpStatus = 409;
  constructor(code: string, message: string, field?: string) {
    super(message, field);
    this.code = code;
  }
}

export class BusinessRuleError extends DomainError {
  override readonly code: string;
  readonly httpStatus = 422;
  constructor(code: string, message: string, field?: string) {
    super(message, field);
    this.code = code;
  }
}

export class RateLimitError extends DomainError {
  readonly code = 'RATE_LIMITED';
  readonly httpStatus = 429;
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super('Çok hızlı gidiyorsun. Biraz bekleyip tekrar dene.');
    this.retryAfterSec = retryAfterSec;
  }
}

export class InternalError extends DomainError {
  readonly code = 'INTERNAL';
  readonly httpStatus = 500;
  constructor() {
    // Teknik detay YALNIZCA sunucu günlüğüne gider; kullanıcı ne yapacağını
    // bilmeli, neyin bozulduğunu değil.
    super('Bir sorun oluştu. Lütfen tekrar dene.');
  }
}

/**
 * Postgres hata kodunu bulur.
 *
 * Drizzle, sürücü hatasını kendi hata tipine sarar (`cause` zinciri). Yalnızca
 * en üst seviyeye bakmak, unique ihlallerinin sessizce kaçırılmasına yol açar —
 * ki bu, "zaten var" durumunun kullanıcıya teknik hata olarak görünmesi demektir.
 */
function pgErrorCode(error: unknown, depth = 0): string | null {
  if (depth > 5 || typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') return code;
  return pgErrorCode((error as { cause?: unknown }).cause, depth + 1);
}

/** Bir Postgres constraint adının hataya karışıp karışmadığı. */
export function violatesConstraint(error: unknown, constraintName: string): boolean {
  return String((error as { message?: string })?.message ?? '').includes(constraintName);
}

/** Postgres unique ihlali (23505) → ConflictError eşlemesi. */
export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === '23505';
}

/** Postgres CHECK ihlali (23514). */
export function isCheckViolation(error: unknown): boolean {
  return pgErrorCode(error) === '23514';
}
