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

/**
 * YORUMSUZ KAYNAK.
 *
 * "Şu ifade kodda GEÇMEMELİ" biçimindeki testler, kaynağın YORUMLARINDA aynı
 * ifade geçtiği için üç kez kendi kendine takıldı — çünkü bir kuralı
 * anlatan yorum, doğal olarak kuralın yasakladığı kelimeyi içerir. Yasak
 * KODA aittir; açıklamaya değil.
 */
const codeOnly = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

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
    expect(codeOnly('src/features/gazette/components/GazetteComposer.tsx')).not.toContain(
      'güvenlik',
    );
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

describe('sahibin kendi kapağını görmesi', () => {
  const page = read('src/app/(marketing)/g/[token]/page.tsx');

  it('sahibine "gazeteni kur" DEMEZ, paylaşma aracı verir', () => {
    // Canlıda görülen hata: kullanıcı kapağını yeni kurmuş, ona bakıyor ve
    // ürün ondan kapak kurmasını istiyordu.
    expect(page).toContain('isOwner');
    expect(page).toContain('ShareBar');
    expect(page).toContain('Gazeten hazır');
  });

  it('sahiplik İÇ KİMLİKLE değil kullanıcı adıyla belirlenir', () => {
    // Sayfaya `ownerId` taşımak, hiçbir işe yaramayan bir iç kimliği
    // herkesin okuyabileceği HTML'e koymak olurdu.
    expect(page).toContain('actor.username === gazette.ownerUsername');
    expect(codeOnly('src/app/(marketing)/g/[token]/page.tsx')).not.toContain('ownerId');
  });

  it('SAHİBİN KENDİ ziyareti sayaca EKLENMEZ', () => {
    // Sayılsaydı "12 kişi baktı" aslında "12 kez sen baktın" olurdu.
    expect(page).toMatch(/if\s*\(!isOwner\)\s*\{[\s\S]{0,200}countView/);
  });
});

describe('paylaş çubuğu', () => {
  const bar = read('src/features/gazette/components/ShareBar.tsx');

  it('tek bir tarayıcı arayüzüne bağlı DEĞİL', () => {
    // Kullanıcının tarayıcısı bilinmiyor; üç kademeli geri düşüş şart.
    expect(bar).toContain('navigator.share');
    expect(bar).toContain('navigator.clipboard');
    // Üçüncü kademe her zaman ekranda: salt okunur adres kutusu.
    expect(bar).toContain('readOnly');
  });

  it('paylaşılan adres MUTLAKTIR', () => {
    // Göreli bir `/g/...` WhatsApp'a yapıştırıldığında bağlantı olmaz, düz
    // metin olur.
    expect(read('src/app/(marketing)/g/[token]/page.tsx')).toContain('serverEnv.APP_URL');
  });

  it('paylaşım bağlantılarında İZLEME parametresi YOK', () => {
    expect(bar).not.toMatch(/utm_|fbclid|gclid/);
  });
});

describe('görünürlük ve moderasyon arayüzü', () => {
  const composer = read('src/features/gazette/components/GazetteComposer.tsx');
  const controls = read('src/features/gazette/components/GazetteControls.tsx');
  const shelf = read('src/features/gazette/components/Shelf.tsx');

  it('görünürlük kutusu ÖNCEDEN İŞARETLİ DEĞİL', () => {
    // Önceden işaretlenmiş bir kutu, sorulmuş sayılmaz.
    expect(composer).toContain('name="isPublic"');
    expect(composer).not.toMatch(/name="isPublic"[^>]*defaultChecked/);
    expect(composer).not.toMatch(/name="isPublic"[^>]*checked/);
  });

  it('rafa koymanın geri dönüşü olmadığı ÖNCEDEN yazılı', () => {
    expect(composer).toContain('geri koyamazsın');
  });

  it('raftan çekmeden ÖNCE geri dönüşsüzlük tekrar söyleniyor', () => {
    expect(controls).toContain('bir daha geri konamaz');
    // Ve "silinmiyor" olduğu da: kullanıcı ne kaybettiğini bilmeli.
    expect(controls).toContain('Manşetler silinmez');
  });

  it('şikâyet yolu var ve otomatik yaptırım vaat etmiyor', () => {
    expect(controls).toContain("targetType: 'GAZETTE'");
    expect(controls).toContain('bir kişi tarafından incelenir');
    expect(controls).not.toContain('kaldırıldı');
  });

  it('raf küçük sayıda "en çok / en iyi" DEMEZ', () => {
    // Üç kapaklı bir listeye "en çok tutanlar" demek, arkasında bir yarış
    // varmış izlenimi verir.
    const homepage = read('src/app/page.tsx');
    const shelfTitles = homepage.match(/title="[^"]*"/g) ?? [];
    for (const t of shelfTitles) {
      expect(t.toLowerCase()).not.toMatch(/en çok|en iyi|en popüler/);
    }
    expect(shelf).toContain('kapak'); // kaç kapak olduğu dürüstçe yazılır
  });

  it('"Tuttu" rafı karnenin tamamını gösterir', () => {
    expect(shelf).toContain('sonuçtan');
    expect(shelf).toContain('tuttu');
  });

  it('boş raf hiç çizilmez', () => {
    expect(shelf).toMatch(/entries\.length === 0\) return null/);
  });
});

describe('süzgeç herkese açık metinde ZORUNLU', () => {
  it('gazete servisi başlığı süzgeçten geçirir', () => {
    const service = read('src/server/modules/gazette/service.ts');
    expect(service).toContain('checkPublicText');
    // Süzgeç görünürlükten BAĞIMSIZ çalışır: gizli kapağın da bağlantısı
    // paylaşılır.
    expect(service).not.toMatch(/isPublic[\s\S]{0,80}checkPublicText/);
  });
});

describe('bakım işi HERKESİN ziyaretiyle tetiklenir', () => {
  it('mantık TEK dosyada durur', () => {
    // İki kabuğa kopyalansaydı eşik ya da hata yönetimi birinde değişir,
    // diğerinde kalırdı.
    const trigger = read('src/server/modules/governance/visit-trigger.ts');
    expect(trigger).toContain('STALE_AFTER_MINUTES');
    expect(trigger).toContain('runScheduled');
  });

  it('OTURUM İÇİ kabuk tetikleyiciyi çağırır', () => {
    expect(read('src/app/(app)/app/layout.tsx')).toContain('triggerMaintenanceAfterResponse()');
  });

  it('HERKESE AÇIK kabuk da çağırır — asıl düzeltme bu', () => {
    // Canlıda görülen hata: tetikleyici yalnızca oturum içi kabuktaydı.
    // Kurucu bir gün giriş yapmayınca maç çekilmedi, Günün Meydanı
    // seçilmedi ve ana sayfa BOŞ kaldı — hem de siteyi ilk kez gören
    // ziyaretçiler için.
    expect(read('src/app/(marketing)/layout.tsx')).toContain('triggerMaintenanceAfterResponse()');
  });

  it('iş YANITTAN SONRA çalışır — ziyaretçi beklemez', () => {
    expect(read('src/server/modules/governance/visit-trigger.ts')).toContain('after(');
  });

  it('hata YUTULUR — bakım arızası sayfayı düşürmez', () => {
    expect(read('src/server/modules/governance/visit-trigger.ts')).toMatch(
      /catch[\s\S]{0,120}log\.error/,
    );
  });
});
