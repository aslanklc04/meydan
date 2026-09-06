/**
 * Parola politikası — saf domain.
 *
 * Yaklaşım: uzunluk önceliklidir. Karmaşıklık zorunluluğu (büyük harf + rakam +
 * sembol) kullanıcıları tahmin edilebilir kalıplara iter ("Parola1!"); NIST SP
 * 800-63B bu yüzden uzunluk + yaygın parola reddi önerir.
 */
export const passwordPolicy = {
  minLength: 10,
  maxLength: 200,
} as const;

export type PasswordRejection =
  'TOO_SHORT' | 'TOO_LONG' | 'COMMON' | 'CONTAINS_IDENTIFIER' | 'LOW_VARIETY';

export type PasswordCheck =
  { readonly ok: true } | { readonly ok: false; readonly reason: PasswordRejection };

/**
 * Yaygın parolalar. Üretimde bu liste bir sözlük dosyasına genişletilir
 * (Faz 17); burada en sık kullanılanlar ve Türkçe yaygın kalıplar bulunur.
 *
 * Not: uzunluk kontrolü bu listeden ÖNCE çalışır. Bu yüzden `minLength`'ten kısa
 * bir giriş listeye eklenirse hiçbir zaman eşleşmez — ölü kayıt olur. Listenin
 * her elemanının en az `minLength` uzunlukta olması testle zorlanır.
 */
export const commonPasswords: ReadonlySet<string> = new Set([
  '1234567890',
  '12345678901',
  'password123',
  'password1234',
  'qwertyuiop',
  'qwerty12345',
  'iloveyou123',
  'administrator',
  'meydan12345',
  'sifre12345',
  'parola12345',
  'galatasaray',
  'fenerbahce',
  'besiktas1903',
  'trabzonspor',
]);

export function checkPassword(
  password: string,
  identifiers: readonly string[] = [],
): PasswordCheck {
  if (password.length < passwordPolicy.minLength) return { ok: false, reason: 'TOO_SHORT' };
  if (password.length > passwordPolicy.maxLength) return { ok: false, reason: 'TOO_LONG' };

  const lower = password.toLowerCase();

  if (commonPasswords.has(lower)) return { ok: false, reason: 'COMMON' };

  // Kullanıcı adı veya e-posta parolanın içinde geçemez.
  for (const id of identifiers) {
    const needle = id.trim().toLowerCase();
    if (needle.length >= 3 && lower.includes(needle)) {
      return { ok: false, reason: 'CONTAINS_IDENTIFIER' };
    }
  }

  // "aaaaaaaaaa" veya "1111111111" gibi tek karakterli diziler reddedilir.
  if (new Set(password).size < 5) return { ok: false, reason: 'LOW_VARIETY' };

  return { ok: true };
}

export const passwordRejectionMessages: Record<PasswordRejection, string> = {
  TOO_SHORT: `Parola en az ${passwordPolicy.minLength} karakter olmalı.`,
  TOO_LONG: `Parola en fazla ${passwordPolicy.maxLength} karakter olabilir.`,
  COMMON: 'Bu parola çok yaygın kullanılıyor. Daha özgün bir parola seçin.',
  CONTAINS_IDENTIFIER: 'Parola kullanıcı adınızı veya e-postanızı içeremez.',
  LOW_VARIETY: 'Parola yeterince çeşitli karakter içermiyor.',
};
