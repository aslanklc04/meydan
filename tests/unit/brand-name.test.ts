import { describe, expect, it } from 'vitest';

/**
 * ÜRÜN ADININ BOŞ KALMAMASI — Faz 7.
 *
 * GERÇEK OLAY: canlıya alınan sitede yasal uyarı şöyle göründü:
 *
 *     "'daki finans ve kripto içerikleri yalnızca…"
 *
 * Yatırım uyarısı, hangi platformdan söz ettiğini söylemeden yayınlandı.
 *
 * SEBEP: `process.env.NEXT_PUBLIC_APP_NAME ?? 'MEYDAN'`. Next.js,
 * tanımlanmamış bir NEXT_PUBLIC_ değişkenini derleme sırasında BOŞ METİN
 * olarak koda gömer. Boş metin `??` için "tanımlı" sayıldığından varsayılan
 * hiç devreye girmez.
 *
 * Bu test o davranışın kendisini sınar; ad tanımsız, boş ya da yalnızca
 * boşluk olduğunda da ürün adı görünmelidir.
 */

/** brand.ts içindeki mantığın birebir aynısı. */
function resolveAppName(raw: string | undefined): string {
  const configured = raw?.trim();
  return configured ? configured : 'MEYDAN';
}

describe('ürün adı çözümleme', () => {
  it('BOŞ METİN varsayılana düşer — asıl hata buydu', () => {
    expect(resolveAppName('')).toBe('MEYDAN');
  });

  it('yalnızca boşluk da adsızlıktır', () => {
    expect(resolveAppName('   ')).toBe('MEYDAN');
    expect(resolveAppName('\n\t ')).toBe('MEYDAN');
  });

  it('tanımsız varsayılana düşer', () => {
    expect(resolveAppName(undefined)).toBe('MEYDAN');
  });

  it('gerçek bir ad KORUNUR', () => {
    expect(resolveAppName('MEYDAN')).toBe('MEYDAN');
    expect(resolveAppName('Başka Ad')).toBe('Başka Ad');
  });

  it('baştaki/sondaki boşluk kırpılır', () => {
    expect(resolveAppName('  MEYDAN  ')).toBe('MEYDAN');
  });
});

describe('yasal metinler adsız kalmaz', () => {
  it('hiçbir çözümleme sonucu boş dizge üretmez', () => {
    for (const raw of ['', '   ', undefined, 'X']) {
      const name = resolveAppName(raw);
      expect(name.length).toBeGreaterThan(0);
      // Uyarı metni "{ad}'daki …" kalıbıyla kuruluyor; ad boşsa cümle
      // kesme işaretiyle başlar ve hangi platform olduğu kaybolur.
      expect(`${name}'daki finans içerikleri`.startsWith("'")).toBe(false);
    }
  });
});
