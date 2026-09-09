import { describe, expect, it } from 'vitest';
import { safeNext, DEFAULT_NEXT } from '../../src/features/auth/safe-next';

/**
 * AÇIK YÖNLENDİRME KORUMASI.
 *
 * Bu testin varlık sebebi tek bir saldırı: saldırgan
 * `/register?next=https://sahte-meydan.com/giris` bağlantısını paylaşır.
 * Kullanıcı GERÇEK siteye kaydolur, sonra kendini birebir benzeyen sahte bir
 * giriş ekranında bulur ve gerçek siteden geldiği için güvenir.
 *
 * Bu yüzden kural izin listesi mantığındadır ve buradaki her satır bir
 * kaçış denemesidir.
 */

describe('güvenli dönüş adresi', () => {
  it('kendi sitemizdeki yolu KABUL eder', () => {
    expect(safeNext('/event/mac-123')).toBe('/event/mac-123');
    expect(safeNext('/event/mac-123?outcome=abc')).toBe('/event/mac-123?outcome=abc');
    expect(safeNext('/m/AbC123')).toBe('/m/AbC123');
  });

  it('DIŞ SİTEYİ reddeder — asıl saldırı', () => {
    for (const kotu of [
      'https://sahte-meydan.com/giris',
      'http://sahte-meydan.com',
      '//sahte-meydan.com',
      '///sahte-meydan.com',
    ]) {
      expect(safeNext(kotu), kotu).toBe(DEFAULT_NEXT);
    }
  });

  it('şema hilelerini reddeder', () => {
    for (const kotu of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x']) {
      expect(safeNext(kotu), kotu).toBe(DEFAULT_NEXT);
    }
  });

  it('ters eğik çizgi ve kodlanmış kaçışları reddeder', () => {
    // Bazı tarayıcılarda "/\evil.com" → "//evil.com" olarak çözümlenir.
    for (const kotu of ['/\\evil.com', '/%2f%2fevil.com', '/%5cevil.com', '/x\\y']) {
      expect(safeNext(kotu), kotu).toBe(DEFAULT_NEXT);
    }
  });

  it('satır sonu enjeksiyonunu reddeder', () => {
    expect(safeNext('/ok\nSet-Cookie: x=1')).toBe(DEFAULT_NEXT);
    expect(safeNext('/ok\r\nLocation: https://evil.com')).toBe(DEFAULT_NEXT);
  });

  it('kimlik ekranlarına döndürmez — döngü olurdu', () => {
    for (const dongu of ['/login', '/register', '/reset-password', '/forgot-password']) {
      expect(safeNext(dongu), dongu).toBe(DEFAULT_NEXT);
    }
    // Ama sorgu parametresi olsa bile aynı kural işler.
    expect(safeNext('/login?next=/x')).toBe(DEFAULT_NEXT);
  });

  it('boş ve tanımsız değerlerde varsayılana düşer', () => {
    expect(safeNext(null)).toBe(DEFAULT_NEXT);
    expect(safeNext(undefined)).toBe(DEFAULT_NEXT);
    expect(safeNext('')).toBe(DEFAULT_NEXT);
    expect(safeNext('   ')).toBe(DEFAULT_NEXT);
  });
});
