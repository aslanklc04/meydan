import { contentLimits, reservedUsernames } from '@/config';

/**
 * Kullanıcı adı kuralları — saf domain. I/O yok, test edilebilir.
 * Spesifikasyon Bölüm 10.1 (Kullanıcı adı güvenliği).
 */

export type UsernameRejection =
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'INVALID_CHARACTERS'
  | 'RESERVED'
  | 'CONFUSABLE'
  | 'LEADING_OR_TRAILING_UNDERSCORE'
  | 'CONSECUTIVE_UNDERSCORES';

export type UsernameCheck =
  | { readonly ok: true; readonly username: string; readonly usernameLower: string }
  | { readonly ok: false; readonly reason: UsernameRejection };

const ALLOWED = /^[A-Za-z0-9_]+$/;

/**
 * Latin harflere görsel olarak benzeyen karakterler (Kiril, Yunan, tam genişlik).
 * Bunlara izin vermek @Emir yerine @Еmir (Kiril Е) açılmasına, yani kimlik
 * taklidine imkân verir. Girdi bu karakterleri içeriyorsa reddedilir.
 */
const CONFUSABLE_CHARS = /[Ѐ-ӿͰ-Ͽ＀-￯‐-―‘-‟İıÀ-ɏ]/;

/** Depolama ve arama için normalize edilmiş biçim. */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function checkUsername(rawInput: string): UsernameCheck {
  const username = rawInput.trim();

  if (CONFUSABLE_CHARS.test(username)) return { ok: false, reason: 'CONFUSABLE' };
  if (username.length < contentLimits.usernameMinLength) return { ok: false, reason: 'TOO_SHORT' };
  if (username.length > contentLimits.usernameMaxLength) return { ok: false, reason: 'TOO_LONG' };
  if (!ALLOWED.test(username)) return { ok: false, reason: 'INVALID_CHARACTERS' };
  if (username.startsWith('_') || username.endsWith('_')) {
    return { ok: false, reason: 'LEADING_OR_TRAILING_UNDERSCORE' };
  }
  if (username.includes('__')) return { ok: false, reason: 'CONSECUTIVE_UNDERSCORES' };

  const usernameLower = normalizeUsername(username);
  if (reservedUsernames.includes(usernameLower)) return { ok: false, reason: 'RESERVED' };

  return { ok: true, username, usernameLower };
}

/** E-posta normalizasyonu: unique index'in kimlik taklidine açılmaması için zorunlu. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export const usernameRejectionMessages: Record<UsernameRejection, string> = {
  TOO_SHORT: `Kullanıcı adı en az ${contentLimits.usernameMinLength} karakter olmalı.`,
  TOO_LONG: `Kullanıcı adı en fazla ${contentLimits.usernameMaxLength} karakter olabilir.`,
  INVALID_CHARACTERS: 'Kullanıcı adı yalnızca harf, rakam ve alt çizgi içerebilir.',
  RESERVED: 'Bu kullanıcı adı kullanılamaz.',
  CONFUSABLE: 'Kullanıcı adı yalnızca İngiliz alfabesi harfleri ve rakam içerebilir.',
  LEADING_OR_TRAILING_UNDERSCORE: 'Kullanıcı adı alt çizgi ile başlayamaz veya bitemez.',
  CONSECUTIVE_UNDERSCORES: 'Kullanıcı adında art arda alt çizgi kullanılamaz.',
};
