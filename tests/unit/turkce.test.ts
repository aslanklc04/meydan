import { describe, expect, it } from 'vitest';
import { iyelikEki, sayiIyelik } from '../../src/lib/turkce';

/**
 * TÜRKÇE SAYI EKLERİ.
 *
 * Bu testler bir işlevi değil, ÜRÜNÜN İMZA CÜMLESİNİ korur: "3 kişiden 2'si".
 * Kod bu eki sabit yazdığı için canlıda "1 kişiden 0'i bildi" yazıyordu.
 * Sayıya güven iddia eden bir ekranın kendi cümlesini yanlış yazması,
 * göründüğünden büyük bir kusurdur.
 */

describe('iyelik eki', () => {
  it('birler basamağına göre doğru ek', () => {
    const beklenen: Record<number, string> = {
      0: 'ı', // sıfırı
      1: 'i', // biri
      2: 'si', // ikisi
      3: 'ü', // üçü
      4: 'ü', // dördü
      5: 'i', // beşi
      6: 'sı', // altısı
      7: 'si', // yedisi
      8: 'i', // sekizi
      9: 'u', // dokuzu
    };
    for (const [sayi, ek] of Object.entries(beklenen)) {
      expect(iyelikEki(Number(sayi)), `${sayi} için`).toBe(ek);
    }
  });

  it('onluklar kendi okunuşuna göre ek alır', () => {
    const beklenen: Record<number, string> = {
      10: 'u', // onu
      20: 'si', // yirmisi
      30: 'u', // otuzu
      40: 'ı', // kırkı
      50: 'si', // ellisi
      60: 'ı', // altmışı
      70: 'i', // yetmişi
      80: 'i', // sekseni
      90: 'ı', // doksanı
    };
    for (const [sayi, ek] of Object.entries(beklenen)) {
      expect(iyelikEki(Number(sayi)), `${sayi} için`).toBe(ek);
    }
  });

  it('sonu dolu olan sayılarda BİRLER belirler', () => {
    // "yirmi üç" → "üçü"; onluk değil, son sözcük konuşur.
    expect(iyelikEki(23)).toBe('ü');
    expect(iyelikEki(42)).toBe('si');
    expect(iyelikEki(107)).toBe('si');
    expect(iyelikEki(1234)).toBe('ü');
  });

  it('yüz, bin ve milyon katları', () => {
    expect(iyelikEki(100)).toBe('ü'); // yüzü
    expect(iyelikEki(500)).toBe('ü'); // beş yüzü
    expect(iyelikEki(1000)).toBe('i'); // bini
    expect(iyelikEki(20000)).toBe('i'); // yirmi bini
    expect(iyelikEki(1_000_000)).toBe('u'); // milyonu
  });

  it('geçersiz sayıda EK UYDURMAZ', () => {
    // Yanlış bir ek yazmaktansa eksiz bırakmak dürüsttür.
    expect(iyelikEki(-3)).toBe('');
    expect(iyelikEki(1.5)).toBe('');
    expect(sayiIyelik(-3)).toBe('-3');
  });
});

describe('ürünün imza cümlesi', () => {
  it('canlıda yanlış yazılan üç cümle artık doğru', () => {
    expect(`1 kişiden ${sayiIyelik(0)} bildi`).toBe("1 kişiden 0'ı bildi");
    expect(`3 kişiden ${sayiIyelik(2)}`).toBe("3 kişiden 2'si");
    expect(`10 kişiden ${sayiIyelik(4)}`).toBe("10 kişiden 4'ü");
  });

  it('gösterim biçimi ayrı verilebilir — binlik ayracı korunur', () => {
    expect(sayiIyelik(1234, '1.234')).toBe("1.234'ü");
  });
});
