import { describe, expect, it } from 'vitest';
import {
  checkUsername,
  normalizeEmail,
  normalizeUsername,
} from '../../src/server/modules/identity/domain/username';
import {
  checkPassword,
  commonPasswords,
  passwordPolicy,
} from '../../src/server/modules/identity/domain/password';

describe('kullanıcı adı kuralları', () => {
  it('geçerli adı kabul eder ve normalize eder', () => {
    const result = checkUsername('Emir');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.username).toBe('Emir');
      expect(result.usernameLower).toBe('emir');
    }
  });

  it('boşlukları temizler', () => {
    const result = checkUsername('  Mert  ');
    expect(result.ok && result.username).toBe('Mert');
  });

  it('kısa adı reddeder', () => {
    expect(checkUsername('ab')).toEqual({ ok: false, reason: 'TOO_SHORT' });
  });

  it('uzun adı reddeder', () => {
    expect(checkUsername('a'.repeat(21))).toEqual({ ok: false, reason: 'TOO_LONG' });
  });

  it('geçersiz karakteri reddeder', () => {
    expect(checkUsername('emir-can')).toEqual({ ok: false, reason: 'INVALID_CHARACTERS' });
    expect(checkUsername('emir can')).toEqual({ ok: false, reason: 'INVALID_CHARACTERS' });
    expect(checkUsername('emir@')).toEqual({ ok: false, reason: 'INVALID_CHARACTERS' });
  });

  it('rezerve adları reddeder — büyük/küçük harften bağımsız', () => {
    expect(checkUsername('admin')).toEqual({ ok: false, reason: 'RESERVED' });
    expect(checkUsername('ADMIN')).toEqual({ ok: false, reason: 'RESERVED' });
    expect(checkUsername('Support')).toEqual({ ok: false, reason: 'RESERVED' });
    expect(checkUsername('api')).toEqual({ ok: false, reason: 'RESERVED' });
  });

  it('kimlik taklidine açık homoglifleri reddeder', () => {
    // Kiril "а" (U+0430) Latin "a" gibi görünür — @Emir yerine @Emіr açılamaz
    expect(checkUsername('Emirа')).toEqual({ ok: false, reason: 'CONFUSABLE' });
    expect(checkUsername('аdmin')).toEqual({ ok: false, reason: 'CONFUSABLE' });
    // Türkçe İ/ı da Latin i ile karışır
    expect(checkUsername('Emır')).toEqual({ ok: false, reason: 'CONFUSABLE' });
  });

  it('alt çizgi kenar durumlarını reddeder', () => {
    expect(checkUsername('_emir')).toEqual({
      ok: false,
      reason: 'LEADING_OR_TRAILING_UNDERSCORE',
    });
    expect(checkUsername('emir_')).toEqual({
      ok: false,
      reason: 'LEADING_OR_TRAILING_UNDERSCORE',
    });
    expect(checkUsername('emir__can')).toEqual({ ok: false, reason: 'CONSECUTIVE_UNDERSCORES' });
  });

  it('normalizasyon büyük/küçük harften bağımsızdır', () => {
    expect(normalizeUsername('EMIR')).toBe('emir');
    expect(normalizeUsername(' Emir ')).toBe('emir');
  });

  it('e-postayı normalize eder', () => {
    expect(normalizeEmail('  Emir@Example.COM ')).toBe('emir@example.com');
  });
});

describe('parola politikası', () => {
  it('yeterince uzun ve çeşitli parolayı kabul eder', () => {
    expect(checkPassword('meydan-tahmin-2026')).toEqual({ ok: true });
  });

  it('kısa parolayı reddeder', () => {
    expect(checkPassword('kisa123')).toEqual({ ok: false, reason: 'TOO_SHORT' });
  });

  it('aşırı uzun parolayı reddeder (DoS koruması)', () => {
    expect(checkPassword('a1b2c3d4e5'.repeat(30))).toEqual({ ok: false, reason: 'TOO_LONG' });
  });

  it('yaygın parolaları reddeder', () => {
    expect(checkPassword('password123')).toEqual({ ok: false, reason: 'COMMON' });
    expect(checkPassword('galatasaray')).toEqual({ ok: false, reason: 'COMMON' });
    expect(checkPassword('PAROLA12345')).toEqual({ ok: false, reason: 'COMMON' });
  });

  it('yaygın parola listesinde ölü kayıt bulunmaz', () => {
    // Uzunluk kontrolü listeden önce çalışır; minLength'ten kısa kayıtlar
    // hiçbir zaman eşleşmez ve listeyi yanıltıcı biçimde şişirir.
    for (const entry of commonPasswords) {
      expect(entry.length, `"${entry}" listede ölü kayıt`).toBeGreaterThanOrEqual(
        passwordPolicy.minLength,
      );
      expect(entry, `"${entry}" küçük harfli olmalı`).toBe(entry.toLowerCase());
    }
  });

  it('kullanıcı adını veya e-postayı içeren parolayı reddeder', () => {
    expect(checkPassword('emir-cok-guclu-parola', ['emir'])).toEqual({
      ok: false,
      reason: 'CONTAINS_IDENTIFIER',
    });
    expect(checkPassword('bakemir@example.com!', ['emir@example.com'])).toEqual({
      ok: false,
      reason: 'CONTAINS_IDENTIFIER',
    });
  });

  it('düşük çeşitlilikli parolayı reddeder', () => {
    expect(checkPassword('aaaaaaaaaaaa')).toEqual({ ok: false, reason: 'LOW_VARIETY' });
    expect(checkPassword('121212121212')).toEqual({ ok: false, reason: 'LOW_VARIETY' });
  });

  it('politika sınırı NIST önerisiyle uyumlu', () => {
    expect(passwordPolicy.minLength).toBeGreaterThanOrEqual(8);
  });
});
