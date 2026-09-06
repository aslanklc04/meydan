'use server';

import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { signIn, signOut } from '@/server/auth';
import { DomainError, InternalError } from '@/server/errors';
import { identityService } from '@/server/modules/identity/service';
import { enforceSharedRateLimit } from '@/server/security/shared-rate-limit';
import { currentIpHash } from '@/server/security/request-identity';
import { log, logEvents } from '@/server/observability/logger';
import { mailer } from '@/server/modules/identity/email';
import {
  loginSchema,
  registerSchema,
  requestResetSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './schemas';

/**
 * Kimlik Server Action'ları.
 *
 * Her action aynı use-case servisini çağırır; iş kuralı transport katmanında
 * yaşamaz (Spesifikasyon Bölüm 4). REST karşılıkları Faz 4'te aynı servisi kullanır.
 */

export type ActionState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly message: string }
  | { readonly status: 'error'; readonly message: string; readonly field?: string };

function toErrorState(error: unknown): ActionState {
  if (error instanceof DomainError) {
    return error.field === undefined
      ? { status: 'error', message: error.message }
      : { status: 'error', message: error.message, field: error.field };
  }
  log.error(logEvents.unexpectedError, { operation: 'auth', outcome: 'failure', error });
  return { status: 'error', message: new InternalError().message };
}

function firstIssue(issues: readonly { message: string; path: PropertyKey[] }[]): ActionState {
  const issue = issues[0];
  return {
    status: 'error',
    message: issue?.message ?? 'Girdi geçersiz.',
    field: String(issue?.path[0] ?? ''),
  };
}

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    username: formData.get('username'),
    email: formData.get('email'),
    password: formData.get('password'),
    acceptTerms: formData.get('acceptTerms') === 'on' || formData.get('acceptTerms') === 'true',
  });

  if (!parsed.success) return firstIssue(parsed.error.issues);

  try {
    /*
     * ORAN SINIRLAMA (Faz 6 güvenlik denetiminde eksik bulundu).
     *
     * Faz 5'e kadar `config/limits.ts` içinde auth kuralları TANIMLIYDI ama
     * hiçbir yerden ÇAĞRILMIYORDU: kayıt, giriş ve parola sıfırlama uçları
     * sınırsızdı. Kayıt IP başına sınırlanır — otomatik hesap üretimi ve
     * e-posta bombardımanı bu uçtan yapılır.
     */
    const ipHash = await currentIpHash();
    await enforceSharedRateLimit('auth.register', ipHash ? { ipHash } : {});

    const result = await identityService.register({ ...parsed.data });
    await mailer.sendEmailVerification(parsed.data.email, result.verificationToken);
    return {
      status: 'success',
      message: 'Hesabın oluşturuldu. Doğrulama bağlantısını e-postana gönderdik.',
    };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) return firstIssue(parsed.error.issues);

  try {
    // Parola deneme saldırısına karşı: e-posta + IP birlikte sınırlanır.
    // Yalnızca IP olsaydı paylaşımlı ağlar cezalandırılırdı; yalnızca
    // e-posta olsaydı saldırgan hesap değiştirerek sınırı atlardı.
    const ipHash = await currentIpHash();
    await enforceSharedRateLimit('auth.login', {
      userId: parsed.data.email.toLowerCase(),
      ...(ipHash ? { ipHash } : {}),
    });

    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: '/app/feed',
    });
    return { status: 'success', message: 'Giriş yapıldı.' };
  } catch (error) {
    if (isRedirectError(error)) throw error;

    // Oran sınırı ayrı mesaj ister: "parola hatalı" demek yanıltıcı olur ve
    // kullanıcı boşuna denemeye devam eder.
    if (error instanceof DomainError && error.code === 'RATE_LIMITED') {
      return { status: 'error', message: error.message };
    }

    log.warn(logEvents.authFailed, { operation: 'auth.login', outcome: 'failure' });
    // Tek tip mesaj: hangi alanın hatalı olduğu sızdırılmaz.
    return { status: 'error', message: 'E-posta veya parola hatalı.' };
  }
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: '/' });
}

export async function requestPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = requestResetSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) return firstIssue(parsed.error.issues);

  // Yanıt HER ZAMAN aynıdır — e-postanın kayıtlı olup olmadığı sızdırılmaz.
  const genericResponse: ActionState = {
    status: 'success',
    message: 'Bu adres kayıtlıysa sıfırlama bağlantısını gönderdik.',
  };

  try {
    // Sıfırlama e-postası da bir gönderim uçudur: sınırsız bırakılırsa
    // birinin gelen kutusu doldurulabilir.
    const ipHash = await currentIpHash();
    await enforceSharedRateLimit('auth.passwordReset', {
      userId: parsed.data.email.toLowerCase(),
      ...(ipHash ? { ipHash } : {}),
    });

    const result = await identityService.requestPasswordReset(parsed.data.email);
    if (result) await mailer.sendPasswordReset(parsed.data.email, result.token);
    return genericResponse;
  } catch (error) {
    console.error('[auth] parola sıfırlama hatası', error);
    return genericResponse;
  }
}

export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
  });
  if (!parsed.success) return firstIssue(parsed.error.issues);

  try {
    await identityService.resetPassword(parsed.data.token, parsed.data.password);
    return {
      status: 'success',
      message: 'Parolan güncellendi. Tüm cihazlardaki oturumların kapatıldı.',
    };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function verifyEmailAction(token: string): Promise<ActionState> {
  const parsed = verifyEmailSchema.safeParse({ token });
  if (!parsed.success) return firstIssue(parsed.error.issues);

  try {
    await identityService.verifyEmail(parsed.data.token);
    return { status: 'success', message: 'E-posta adresin doğrulandı.' };
  } catch (error) {
    return toErrorState(error);
  }
}
