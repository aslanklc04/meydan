import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GAZETE SAYFALARININ DÜRÜSTLÜK KURALLARI.
 *
 * Bu testler işlevi değil, SÖZÜ korur. Gazete bilerek gerçek bir gazeteye
 * benzetildi; tam bu yüzden "haber değil, tahmin" ibaresi bir süs değil,
 * sayfanın var olma şartıdır. Bir tasarım düzenlemesi sırasında o satırın
 * sessizce silinmesi, ürünü olmamış olayları haber gibi gösteren bir yere
 * çevirir — ve bunu kimse fark etmez.
 *
 * Kaynak metin üzerinden bakılır çünkü korunan şey davranış değil, EKRANDA
 * DURAN CÜMLEDİR.
 */

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const publicPage = read('src/app/(marketing)/g/[token]/page.tsx');
const ogImage = read('src/app/(marketing)/g/[token]/kapak/route.tsx');
const composer = read('src/features/gazette/components/GazetteComposer.tsx');
const robots = read('src/app/robots.ts');

describe('"haber değil" uyarısı', () => {
  it('herkese açık kapak sayfasında YAZILI', () => {
    expect(publicPage).toContain('Bu bir haber değildir');
    expect(publicPage).toContain('tahminleridir');
  });

  it('PAYLAŞIM GÖRSELİNİN İÇİNE de basılır', () => {
    // Önizleme sayfadan koparak dolaşır; ekran görüntüsünde sayfanın uyarısı
    // yoktur. Uyarı görselin üstündeyse kopya da uyarıyı taşır.
    expect(ogImage).toContain('TAHMİN — HABER DEĞİL');
  });
});

describe('arama motoruna kapalılık', () => {
  it('robots.txt /g/ yolunu KAPATIR', () => {
    expect(robots).toContain("'/g/'");
  });

  it('sayfa kendi başlığında da indekslenmemeyi söyler', () => {
    // İki kapı: robots.txt bir ricadır, sayfa etiketi ikinci savunmadır.
    expect(publicPage).toMatch(/robots:\s*\{\s*index:\s*false/);
  });
});

describe('kilit uyarısı gönderimden ÖNCE', () => {
  it('kurma ekranı geri alınamazlığı önceden söyler', () => {
    // Kilidi gönderdikten SONRA öğrenmek, ürünün kullanıcıya tuzak kurması olur.
    expect(composer).toContain('çıkarılamaz');
    expect(composer).toContain('ikinci bir kapağa konamaz');
  });

  it('kurma ekranındaki sınır bir GÜVENLİK ÖNLEMİ olarak sunulmaz', () => {
    // İstemcideki sayaç kapatılabilir; kuralın sunucuda olduğu yazılı kalmalı.
    const withoutComments = composer.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(withoutComments).not.toContain('güvenlik');
  });
});

describe('ziyaretçiye dağılım göstermeme', () => {
  it('kapak sayfası konsensüs servisini HİÇ çağırmaz', () => {
    // Kapağı gören kişi henüz tahmin yapmadı; "önce sen söyle" burada da geçerli.
    expect(publicPage).not.toContain('consensusService');
  });
});

describe('atıf sayacı kimseyi isimlendirmez', () => {
  it('kayıt akışı yalnızca jetonu taşır, kullanıcıyı bağlamaz', () => {
    const actions = read('src/features/auth/actions.ts');
    expect(actions).toContain('countSignup');
    // Bir ilişki tablosu yazılmıyor: yalnızca sayaç artırılıyor.
    expect(actions).not.toMatch(/referredBy|referrerId|invitedBy/);
  });
});
