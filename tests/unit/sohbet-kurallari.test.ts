import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * MEYDAN SOHBETİNİN EKRAN KURALLARI.
 *
 * Servis testleri kilidin çalıştığını gösteriyor. Buradaki testler EKRANIN o
 * kilidi doğru anlattığını ve sohbetin ULAŞILABİLİR olduğunu korur.
 *
 * İkincisi bu projede dört kez kaybedildi: paylaş düğmesi, takım armaları ve
 * sonuç listesi hep "yapıldı ama kullanıcının olduğu yerde yoktu". Sohbet de
 * yalnızca maç sayfasına konsaydı aynı akıbeti yaşardı — kullanıcı akışta
 * yaşıyor.
 */

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const flat = (p: string) => read(p).replace(/\s+/g, ' ');
const codeOnly = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const sohbet = 'src/features/comments/components/Sohbet.tsx';
const servis = 'src/server/modules/comment/service.ts';
const kart = 'src/features/events/components/EventCard.tsx';
const macSayfasi = 'src/app/(marketing)/event/[slug]/page.tsx';
const akis = 'src/app/(app)/app/feed/page.tsx';

describe('kilit SUNUCUDA', () => {
  it('metin, tahmin yapmamış kişiye hiç üretilmez', () => {
    /*
     * Arayüzde gizlemek yetmez: metin sayfa kaynağında durur ve bakan okur.
     * Servis kilitliyken `items` alanını HİÇ döndürmüyor.
     */
    const code = codeOnly(servis);
    expect(code).toContain('return { locked: true, total };');
    // Kilit kontrolü, yorumlar okunmadan ÖNCE gelmeli.
    const kilit = code.indexOf('return { locked: true, total };');
    const sorgu = code.indexOf('.from(eventComments)\n      .innerJoin(users');
    expect(kilit).toBeGreaterThan(-1);
    if (sorgu > -1) expect(kilit).toBeLessThan(sorgu);
  });

  it('gizlenen ve silinen yorumun metni de gönderilmez', () => {
    expect(codeOnly(servis)).toContain('body: deleted || hidden ? null : r.body');
  });

  it('yazmadan önce TAHMİN şartı aranır', () => {
    expect(codeOnly(servis)).toContain('PREDICTION_REQUIRED');
  });
});

describe('kilitli ekran bir davet', () => {
  it('sayı gösterilir — boş bir kilit değil', () => {
    const f = flat(sohbet);
    expect(f).toContain('yorum var');
    expect(codeOnly(sohbet)).toContain('view.total');
  });

  it('neden kilitli olduğu ürünün diliyle anlatılır', () => {
    expect(flat(sohbet)).toContain('Önce sen söyle');
  });

  it('çıkış yolu var: tahminimi yap', () => {
    expect(flat(sohbet)).toContain('Tahminimi yap');
  });
});

describe('sohbet ULAŞILABİLİR', () => {
  it('AKIŞ kartında sohbet bağlantısı var', () => {
    // Kullanıcı maç sayfasında değil, akışta yaşıyor.
    const f = flat(kart);
    expect(f).toContain('#sohbet');
    expect(f).toContain('Sohbet');
  });

  it('akış, sohbet sayılarını TEK sorguda çeker', () => {
    // Kart başına sorgu, yirmi kartlı akışta yirmi sorgu demekti.
    expect(codeOnly(akis)).toContain('commentService.countsFor');
  });

  it('maç sayfasında sohbet çizilir', () => {
    expect(codeOnly(macSayfasi)).toContain('<Sohbet');
    expect(codeOnly(macSayfasi)).toContain('commentService.view');
  });
});

describe('moderasyon', () => {
  it('şikâyet MEVCUT sisteme gider — ikinci bir kuyruk açılmaz', () => {
    const actions = codeOnly('src/features/comments/actions.ts');
    expect(actions).toContain('socialService.report');
    expect(actions).toContain("targetType: 'COMMENT'");
  });

  it('yönetim ekranında yorumu gizleme düğmesi var', () => {
    const page = flat('src/app/admin/reports/page.tsx');
    expect(page).toContain('Yorumu gizle');
  });

  it('gizleme denetim kaydına yazılır', () => {
    const admin = codeOnly('src/features/admin/actions.ts');
    expect(admin).toContain("action: 'COMMENT_HIDDEN'");
  });
});

describe('sohbet PUAN KAZANDIRMAZ', () => {
  it('serviste itibar ya da çip çağrısı YOK', () => {
    /*
     * Ürün kuralı 41-42: paylaşım, yorum, seri, takipçi ve davet Tahmin
     * Gücünü artırmaz; yorum için Çip verilmez. Kazandırsaydı sohbet,
     * konuşmak için değil puan toplamak için kullanılırdı.
     */
    const code = codeOnly(servis);
    expect(code).not.toContain('reputationService');
    expect(code).not.toContain('coinService');
    expect(code).not.toContain('coinLedger');
  });
});

describe('bahis dili yok', () => {
  it('sohbet ekranı ve servis yasak terimleri içermez', () => {
    for (const p of [sohbet, servis, 'src/features/comments/actions.ts']) {
      const metin = read(p).toLocaleLowerCase('tr');
      for (const yasak of ['bahis', 'restleş', 'oran ver', 'kupon']) {
        expect(metin, `${p} içinde "${yasak}"`).not.toContain(yasak);
      }
    }
  });
});
