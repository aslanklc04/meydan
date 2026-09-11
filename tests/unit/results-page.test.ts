import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SONUÇ SAYFASININ KURALLARI.
 *
 * Bu testler bir işlevi değil, İKİ SÖZÜ korur:
 *
 *   1. Sonuç herkese açıktır. Sonuç, bu ürünün dışarıdan doğrulanabilir tek
 *      kanıtıdır; kayıt duvarının arkasına konulduğu anda ziyaretçiye
 *      "bize güven" demekten başka bir şey kalmaz.
 *   2. Listede kaç kişinin bildiği yazar, kimin bildiği yazmaz.
 *
 * İkisi de bir tasarım düzenlemesi sırasında sessizce kaybolabilecek türden
 * kararlar; kaybolduğunda kimse fark etmez. Bu yüzden kaynak metin üzerinden
 * sınanır.
 */

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Yasak KODA aittir, açıklamaya değil — kuralı anlatan yorum onu içerir. */
const codeOnly = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/** Prettier satırları yeniden sardığı için çok kelimeli metin düzleştirilir. */
const flat = (p: string) => read(p).replace(/\s+/g, ' ');

const page = 'src/app/(marketing)/sonuclar/page.tsx';
const row = 'src/features/results/components/ResultRow.tsx';
const home = 'src/app/page.tsx';
const shell = 'src/app/(marketing)/layout.tsx';

describe('sonuç sayfası herkese açıktır', () => {
  it('giriş zorunluluğu YOKTUR', () => {
    const code = codeOnly(page);
    expect(code).not.toContain('currentActor');
    expect(code).not.toContain('redirect(');
    expect(code).not.toContain('requireActor');
  });

  it('public kabuğun altında durur — oturum kabuğunda değil', () => {
    // Yol `(marketing)` grubunda: dosyanın varlığı bu kararın kendisidir.
    expect(() => read(page)).not.toThrow();
  });

  it('arama motoruna kapatılmamıştır', () => {
    // Ürünün tek dış kanıtı indekslenebilir olmalı.
    expect(codeOnly(page)).not.toContain('robots');
    expect(read('src/app/sitemap.ts')).toContain('/sonuclar');
  });
});

describe('kim değil kaç kişi', () => {
  it('satırda kullanıcı adı ALANI YOK', () => {
    const code = codeOnly(row);
    expect(code).not.toContain('username');
    expect(code).not.toContain('/u/');
  });

  it('küçük sayıda yüzde göstermez — kesir yazar', () => {
    const code = codeOnly(row);
    expect(code).toContain('minSampleForPercentage');
    expect(flat(row)).toContain('kişiden {sayiIyelik(hit, formatCount(hit))} bildi');
  });

  it('Türkçe eki SABİT YAZILMAZ', () => {
    /*
     * Ek sabit yazıldığı için canlıda "1 kişiden 0'i bildi" çıkıyordu;
     * doğrusu "0'ı". Ek, sayının okunuşuna göre değişir ve bu ürünün en çok
     * görünen cümlesi tam olarak budur.
     */
    expect(codeOnly(row)).toContain('sayiIyelik');
    expect(codeOnly(row)).not.toContain('&apos;i bildi');
  });

  it('tahmin yokken sayı cümlesi hiç kurulmaz', () => {
    // "0 kişiden 0'ı bildi" doğru ama utandırıcı ve bilgisizdir.
    expect(codeOnly(row)).toContain('total > 0');
  });
});

describe('iptal edilen etkinlik', () => {
  it('"kimse bilemedi" DEMEZ, sayılmadığını söyler', () => {
    expect(flat(row)).toContain('İptal edildi — tahminler sayılmadı');
  });

  it('"kimse bilemedi" cümlesi İPTALE ULAŞAMAZ', () => {
    /*
     * Bu cümle artık var — ama yalnızca SONUÇLANMIŞ bir etkinlikte kimsenin
     * bilemediği durumda. İptalde sonuç yoktur; orada "kimse bilemedi"
     * demek, kimsenin hatası olmayan bir şeyi kullanıcıların başarısızlığı
     * gibi göstermek olurdu.
     *
     * Koruma `showsCount` içinde: `!data.voided` şartı sağlanmadan o dal
     * hiç çizilmiyor.
     */
    const code = codeOnly(row);
    expect(code).toContain('const showsCount = !data.voided');
    const i = code.indexOf('kimse bilemedi');
    expect(i).toBeGreaterThan(-1);
    expect(code.slice(0, i)).toContain('showsCount &&');
  });
});

describe('boş liste', () => {
  it('sahte satırla doldurulmaz, ne yapılacağını söyler', () => {
    const f = flat(page);
    expect(f).toContain('Bu hafta henüz sonuçlanan yok');
    expect(f).toContain('Açık meydanlara bak');
  });
});

describe('sonuçlara ulaşılabilir', () => {
  it('ana sayfada bölüm ve tam listeye bağlantı var', () => {
    const f = flat(home);
    expect(f).toContain('resultsBoard');
    expect(f).toContain('/sonuclar');
  });

  it('public üst çubukta bağlantı var', () => {
    // Bir etkinlik sayfasına düşen ziyaretçinin "dün ne oldu"ya gidecek yeri.
    expect(flat(shell)).toContain('href="/sonuclar"');
  });

  it('akışta biten meydanlara bağlantı var', () => {
    expect(flat('src/app/(app)/app/feed/page.tsx')).toContain('/sonuclar');
  });
});

describe('akışta TAHMİN ETMEDİĞİN maçların sonucu', () => {
  /*
   * En uzun süre açık kalan kör nokta buydu. Sonuç listesi önce ana sayfaya
   * ve /sonuclar'a kondu; oysa GİRİŞ YAPMIŞ kullanıcı ana sayfayı görmüyor,
   * akışta yaşıyor. Akıştan geçen ama tahmin edilmeyen maçın sonucu
   * kullanıcı için hiçbir yerde yoktu: kapanıyor, açık listeden düşüyor,
   * kayboluyordu.
   */
  const feed = 'src/app/(app)/app/feed/page.tsx';

  it('akış, herkesin sonuçlarını da çeker', () => {
    expect(codeOnly(feed)).toContain('catalogService.resultsBoard(7, 12)');
  });

  it('kendi tahminlerin AYIKLANIR — aynı maç iki kez çıkmaz', () => {
    const code = codeOnly(feed);
    expect(code).toContain('new Set(results.map((r) => r.eventId))');
    expect(code).toContain('!mine.has(r.id)');
  });

  it('bölüm ekranda çiziliyor', () => {
    const f = flat(feed);
    expect(f).toContain('Biten meydanlar');
    expect(f).toContain('Tahmin etmediklerin de dâhil');
    expect(codeOnly(feed)).toContain('otherResults.map');
  });

  it('hiç sonuç yoksa bölüm hiç görünmez', () => {
    // Boş bir "Biten meydanlar" başlığı, akışı ıssız gösterirdi.
    expect(codeOnly(feed)).toContain('otherResults.length > 0');
  });
});

describe('akıştaki kendi sonuçların penceresi', () => {
  it('üç gün değil YEDİ gündür', () => {
    /*
     * Üç günlük pencere, hafta içi girmeyen kullanıcı için cumartesi
     * maçının sonucunu HİÇ göstermiyordu. Ürünün verdiği tek söz "sonucu
     * göreceksin" iken bu savunulabilir değil.
     */
    const code = codeOnly('src/app/(app)/app/feed/page.tsx');
    expect(code).toContain('recentResults(actor.id, 24 * 7)');
    expect(flat('src/app/(app)/app/feed/page.tsx')).toContain('Son yedi günde kapanan');
  });
});
