import { describe, expect, it } from 'vitest';
import { looksLikeEmail, resolveEmailProvider } from '../../src/config/env';
import { selectMailer, consoleMailer, httpMailer } from '../../src/server/modules/identity/email';

/**
 * KATI / HOŞGÖRÜLÜ AYRIMI — Faz 7.
 *
 * Bu testlerin varlık sebebi gerçek bir olaydır: dağıtım paneline yanlışlıkla
 * girilmiş bir `EMAIL_PROVIDER` değeri yüzünden site ÜST ÜSTE ÜÇ KEZ yayına
 * alınamadı. E-posta katmanı zaten "tanımadığım sağlayıcı → varsayılana dön"
 * diye yazılmıştı; katı ortam doğrulaması o dayanıklılığı boşa çıkarıyordu.
 *
 * Kural: doğrulamanın işi arızayı ERKEN GÖSTERMEKTİR, arıza ÜRETMEK değil.
 * Güvenli varsayılanı olan bir ayar, siteyi durdurmaya yetkili değildir.
 */

describe('e-posta sağlayıcısı çözümleme', () => {
  it('geçerli değerler korunur', () => {
    expect(resolveEmailProvider('http')).toBe('http');
    expect(resolveEmailProvider('console')).toBe('console');
  });

  it('büyük/küçük harf ve boşluk tolere edilir', () => {
    expect(resolveEmailProvider('  HTTP ')).toBe('http');
    expect(resolveEmailProvider('Console')).toBe('console');
  });

  it('tanınmayan HER değer güvenli varsayılana düşer', () => {
    for (const bad of ['smtp', 'resend', 'evet', '1', 'true', '', '   ', undefined]) {
      expect(resolveEmailProvider(bad)).toBe('console');
    }
  });
});

describe('adaptör seçimi ÇÖKMEZ', () => {
  it('tanınmayan sağlayıcıyla bile bir Mailer döner', () => {
    // Asıl mesele: burada hata FIRLATILMAMASI. Fırlatsaydı uygulama açılmazdı.
    expect(() => selectMailer('bilinmeyen-saglayici')).not.toThrow();
    expect(selectMailer('bilinmeyen-saglayici')).toBe(consoleMailer);
  });

  it('doğru değer doğru adaptörü seçer', () => {
    expect(selectMailer('http')).toBe(httpMailer);
    expect(selectMailer('console')).toBe(consoleMailer);
    expect(selectMailer(undefined)).toBe(consoleMailer);
  });
});

describe('e-posta biçim denetimi', () => {
  it('geçerli adresleri tanır', () => {
    expect(looksLikeEmail('aslan@example.com')).toBe(true);
    expect(looksLikeEmail('  bir.kisi+etiket@alt.alan.com  ')).toBe(true);
  });

  it('geçersizleri reddeder', () => {
    for (const bad of ['', '   ', 'merhaba', 'a@b', '@b.com', 'a b@c.com', undefined]) {
      expect(looksLikeEmail(bad)).toBe(false);
    }
  });

  it('bu denetim UYGULAMAYI DURDURMAK için değil, uyarmak içindir', () => {
    // Sözleşme: bir tahmin fonksiyonu, bir doğrulayıcı değil. Hata fırlatmaz.
    expect(() => looksLikeEmail('bozuk')).not.toThrow();
  });
});
