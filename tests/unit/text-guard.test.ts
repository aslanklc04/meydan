import { describe, expect, it } from 'vitest';
import { checkPublicText, normalizeForMatch } from '../../src/server/content/text-guard';

/**
 * METİN SÜZGECİ.
 *
 * Bu testlerin YARISI süzgecin yakaladıklarını, yarısı YAKALAMAMASI
 * GEREKENLERİ sınar. İkincisi daha önemlidir: yanlış pozitif, küfür etmeyen
 * bir kullanıcıyı susturur ve o kullanıcı geri gelmez. Yanlış negatif ise
 * şikâyet yoluyla telafi edilebilir.
 */

const blocked = (s: string) => checkPublicText(s).ok === false;
const allowed = (s: string) => checkPublicText(s).ok === true;

describe('normalleştirme', () => {
  it('Türkçe harfleri ve büyük/küçük farkını eritir', () => {
    expect(normalizeForMatch('SİKTİR')).toContain('siktir');
    expect(normalizeForMatch('Şükrü')).toBe('sukru');
  });

  it('rakamla harf taklidini çözer', () => {
    expect(normalizeForMatch('s1kt1r')).toContain('siktir');
    expect(normalizeForMatch('4mk')).toContain('amk');
  });

  it('harf arasına serpiştirilen ayraçları temizler', () => {
    expect(normalizeForMatch('s.i.k.t.i.r')).toContain('siktir');
    expect(normalizeForMatch('s-i-k-t-i-r')).toContain('siktir');
  });

  it('kelimeler arasındaki NORMAL boşluğu korur', () => {
    // Korunmasaydı bütün cümle tek kelimeye yapışır ve kelime sınırı diye
    // bir şey kalmazdı.
    expect(normalizeForMatch('bu hafta böyle biter')).toBe('bu hafta boyle biter');
  });
});

describe('yakalananlar', () => {
  it('düz küfür', () => {
    expect(blocked('siktir git')).toBe(true);
    expect(blocked('amk bu maç')).toBe(true);
  });

  it('gizlenmiş küfür', () => {
    expect(blocked('s1kt1r')).toBe(true);
    expect(blocked('s.i.k.t.i.r')).toBe(true);
    expect(blocked('SİKTİR')).toBe(true);
    expect(blocked('siiiktir')).toBe(true);
  });

  it('hedefe yönelmiş hakaret', () => {
    expect(blocked('sen salaksın')).toBe(true);
    expect(blocked('bu adam gerizekalı')).toBe(true);
  });

  it('bağlantı ve alan adı', () => {
    expect(blocked('bahis için https://kotu.example')).toBe(true);
    expect(blocked('www.birsite.com adresine gel')).toBe(true);
    expect(blocked('kazanc.xyz')).toBe(true);
    expect(blocked('t.me/kanal')).toBe(true);
  });

  it('sistem mesajı taklidi', () => {
    // Ana sayfada ürünün kendi sesi sanılacak başlık.
    expect(blocked('MEYDAN: hesabın kapatıldı')).toBe(true);
    expect(blocked('Meydan yönetimi duyurusu')).toBe(true);
  });

  it('anlamsız başlık', () => {
    expect(blocked('aaaaaaaa')).toBe(true);
    expect(blocked('...')).toBe(true);
  });
});

describe('YANLIŞ POZİTİF OLMAMALI — asıl sınav', () => {
  it('içinde yasak dizi geçen masum kelimeler geçer', () => {
    // Kelime sınırı olmasaydı bunların hepsi engellenirdi.
    expect(allowed('Bu maçta sıkıntı yok')).toBe(true);
    expect(allowed('Eksik kadroyla çıkacaklar')).toBe(true);
    expect(allowed('Yapışık fikstür')).toBe(true);
    expect(allowed('Sıkı bir maç olacak')).toBe(true);
  });

  it('spor dilindeki kaba ama olağan ifadeler geçer', () => {
    // "Top" ve "mal" gibi kelimeleri engellemek ürünü kullanılamaz yapar.
    expect(allowed('Bu takımda top dönmüyor')).toBe(true);
    expect(allowed('Mal gibi kaçırdı o golü')).toBe(true);
  });

  it('sıradan başlıklar geçer', () => {
    expect(allowed('Bu hafta üç iddia')).toBe(true);
    expect(allowed('Şampiyon PSV Eindhoven')).toBe(true);
    expect(allowed('Galatasaray — Fenerbahçe derbisi')).toBe(true);
    expect(allowed('İki maç ve bir sürpriz')).toBe(true);
  });

  it('markayı ANMAK serbesttir, marka ADINA konuşmak değildir', () => {
    expect(allowed('MEYDAN tahminlerim')).toBe(true);
    expect(allowed('Meydan okuyorum')).toBe(true);
  });
});

describe('mesaj hangi kelimenin yakalandığını SÖYLEMEZ', () => {
  it('gerekçe metni yasak kelimeyi içermez', () => {
    // Söyleseydik, süzgeci nasıl atlatacağını öğretmiş olurduk.
    const verdict = checkPublicText('siktir');
    expect(verdict.ok).toBe(false);
    expect(JSON.stringify(verdict)).not.toContain('siktir');
  });
});
