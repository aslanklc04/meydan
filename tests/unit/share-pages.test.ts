import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * TEK SORULUK MEYDAN OKUMANIN EKRAN KURALLARI.
 *
 * Bu testler davranışı değil, EKRANDA DURAN CÜMLEYİ ve kuralın hangi katmanda
 * uygulandığını korur. Servis testleri "gönderenin cevabı gelmiyor" der;
 * buradakiler "o kural sayfada da delinmedi" der.
 */

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Yorumları ayıklanmış kaynak — "kodda geçmemeli" testleri için. */
const codeOnly = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/**
 * Boşluklar tekilleştirilmiş kaynak.
 *
 * Biçimlendirici JSX metnini satır sonlarından böler; "şu cümle ekranda
 * yazıyor" testleri araya giren satır sonu yüzünden kırıldı. Aranan şey
 * cümlenin kendisi, satıra nasıl sığdığı değil.
 */
const flat = (p: string) => read(p).replace(/\s+/g, ' ');

const page = read('src/app/(marketing)/m/[token]/page.tsx');
const pageFlat = flat('src/app/(marketing)/m/[token]/page.tsx');
const answer = read('src/features/share/components/ChallengeAnswer.tsx');
const ask = read('src/features/share/components/AskAFriend.tsx');
const actions = read('src/features/share/actions.ts');
const service = read('src/server/modules/share/service.ts');
const robots = read('src/app/robots.ts');

describe('gönderenin cevabı sunucuda kalır', () => {
  it('sayfa, gönderenin cevabını SUNUCUDAN gelen alana bakarak gösterir', () => {
    // Sayfanın kendi kararı yok: alan doluysa gösterir, boşsa gösteremez.
    expect(page).toContain('view.senderOutcomeId !== null');
  });

  it('kural SERVİSTE uygulanır — sayfa katmanında değil', () => {
    // Sayfada uygulansaydı, ikinci bir sayfa yazan biri kuralı atlardı.
    expect(service).toContain('maySeeSender');
    expect(service).toContain('senderOutcomeId: maySeeSender ? row.senderOutcomeId : null');
  });

  it('cevap verilmemişken merak ADIYLA söyleniyor', () => {
    // "Cevabını ver, sonra göreceksin" bir vaattir; yazılmazsa alıcı neden
    // cevap vereceğini bilmez.
    expect(pageFlat).toContain('kendi tahminini yaptıktan sonra');
  });
});

describe('cevap yolu çekirdek servisten geçer', () => {
  it('paylaşımdan gelen cevap AYRI bir tahmin yolu açmaz', () => {
    // Ayrı yol açılsaydı kapanmış etkinlik, oran sınırı ve tekrar tahmin
    // kuralları burada AYRICA uygulanmak zorunda kalırdı.
    expect(actions).toContain('predictionService.create');
  });

  it('etkinlik JETONDAN çözülür, istemciden ALINMAZ', () => {
    // İstemci söyleseydi, paylaşılan sorudan başka bir etkinliğe cevap
    // gönderilebilirdi.
    expect(actions).toContain('shareService.byToken');
    expect(actions).toContain('eventId: share.eventId');
    expect(codeOnly('src/features/share/components/ChallengeAnswer.tsx')).not.toContain('eventId');
  });

  it('sayaç hatası tahmini DÜŞÜRMEZ', () => {
    expect(actions).toMatch(/countAnswer[\s\S]{0,200}catch/);
  });
});

describe('misafir akışı', () => {
  it('misafir seçimi HAFIZADA tutulur, veritabanına yazılmaz', () => {
    expect(answer).toContain('useState');
    expect(codeOnly('src/features/share/components/ChallengeAnswer.tsx')).not.toContain(
      'localStorage',
    );
  });

  it('kayıt bağlantısı hem dönüş adresini hem atıf jetonunu taşır', () => {
    expect(answer).toContain('next=');
    expect(answer).toContain('ref=');
  });

  it('gerçek para olmadığı kayıt adımında yazılı', () => {
    expect(flat('src/features/share/components/ChallengeAnswer.tsx')).toContain('Gerçek para yok');
  });
});

describe('paylaşım düğmesi', () => {
  it('TAHMİNİN YAPILDIĞI YERDE durur — akışta da, etkinlik sayfasında da', () => {
    /*
     * Canlıda görülen hata: kutu yalnızca herkese açık etkinlik sayfasındaydı.
     * İnsanlar tahminlerini AKIŞTA yapıyor ve oradan etkinlik sayfasına
     * geçmiyorlar; düğme vardı ama görülmüyordu.
     *
     * Kart iki yerde de kullanıldığı için, kutunun kartın İÇİNDE olması hem
     * ikisinde birden görünmesini sağlar hem kopyalanmasını önler.
     */
    const card = read('src/features/events/components/EventCard.tsx');
    expect(card).toContain('<AskAFriend');
    // Kartın hangi ekranlarda kullanıldığı: ikisi de.
    expect(read('src/app/(app)/app/feed/page.tsx')).toContain('<EventCard');
    expect(read('src/app/(marketing)/event/[slug]/page.tsx')).toContain('<EventCard');
  });

  it('yalnızca TAHMİN YAPMIŞ kullanıcıya gösterilir', () => {
    // Kartta `alreadyPredicted` bloğunun içinde: tahmin yoksa blok çizilmez.
    const card = read('src/features/events/components/EventCard.tsx');
    const block = card.slice(card.indexOf('{alreadyPredicted && !stakeStep &&'));
    expect(block.slice(0, block.indexOf('{/* ── ADIM 1'))).toContain('<AskAFriend');
  });

  it('etkinlik sayfasında İKİNCİ bir kopya YOK', () => {
    const eventPage = read('src/app/(marketing)/event/[slug]/page.tsx');
    expect(eventPage).not.toContain('AskAFriend');
  });

  it('gönderene, alıcının önce kendi cevabını vereceği söyleniyor', () => {
    expect(flat('src/features/share/components/AskAFriend.tsx')).toContain(
      'kendi tahminini yapmadan göremeyecek',
    );
  });

  it('paylaşım bağlantılarında İZLEME parametresi YOK', () => {
    expect(ask).not.toMatch(/utm_|fbclid|gclid/);
  });
});

describe('arama motoruna kapalılık', () => {
  it('robots.txt /m/ yolunu KAPATIR', () => {
    expect(robots).toContain("'/m/'");
  });

  it('sayfa kendi başlığında da indekslenmemeyi söyler', () => {
    expect(page).toMatch(/robots:\s*\{\s*index:\s*false/);
  });
});

describe('atıf sayaçları', () => {
  it('görüntülenme, cevap ve kayıt AYRI sayılır', () => {
    // Yalnız görüntülenmeyi saymak, paylaşımın işe yaradığı yanılgısını verir.
    expect(service).toContain('countView');
    expect(service).toContain('countAnswer');
    expect(service).toContain('countSignup');
  });

  it('GÖNDERENİN kendi ziyareti sayılmaz', () => {
    expect(page).toMatch(/if\s*\(!isSender\)\s*\{[\s\S]{0,200}countView/);
  });

  it('kim geldiği DEĞİL kaç kişi geldiği tutulur', () => {
    expect(service).not.toMatch(/viewerId.*insert|referrerId|invitedBy/);
  });
});
