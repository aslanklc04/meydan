import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * YÖNETİM EKRANI — İKİ SESSİZ ARIZAYA KARŞI BEKÇİ.
 *
 * Buradaki iki kural da canlıda kırıldı ve ikisi de derlemeden, tip
 * denetiminden ve mevcut testlerden GEÇEREK kırıldı. Bu yüzden ayrı bir
 * bekçi gerekiyor.
 */

const ADMIN_DIR = join(process.cwd(), 'src/app/admin');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') ? [full] : [];
  });
}

describe('yönetim ekranı sayfaları', () => {
  const files = walk(ADMIN_DIR);

  it('sayfa dosyaları bulunuyor', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  /**
   * ARIZA 1 — SAYFAYI DÜŞÜREN OK FONKSİYONU.
   *
   * `ActionButton` bir istemci bileşenidir. Sunucu bileşeninden ona geçirilen
   * fonksiyon, ancak SUNUCU EYLEMİNİN KENDİSİ ise serileştirilebilir. Onu ok
   * fonksiyonuyla sarmak sıradan bir closure üretir; React serileştiremez ve
   * sayfanın tamamı "Yönetim ekranı yüklenemedi" hatasıyla düşer.
   *
   * Özet ve Sezonlar sayfaları tam olarak bundan açılmıyordu. Derleme ve tip
   * denetimi bunu GÖRMEZ — hata yalnızca sayfa gerçekten açıldığında çıkar.
   *
   * Doğru yol: `sunucuEylemi.bind(null, ...)`.
   */
  it('action prop`una ok fonksiyonu geçirilmiyor (sayfayı düşürür)', () => {
    const offenders = files.filter((f) => /action=\{\s*\(\s*\)\s*=>/.test(readFileSync(f, 'utf8')));

    expect(
      offenders.map((f) => f.replace(process.cwd() + '/', '')),
      'Bu dosyalarda `action={() => ...}` var. `.bind(null, ...)` kullan.',
    ).toEqual([]);
  });

  /**
   * ARIZA 2 — YETKİSİZ ERİŞİM.
   *
   * Yönetim ekranı yalnızca yöneticiye açıktır. Denetim İKİ katmandadır:
   * rota (layout) ve her sunucu eyleminin içinde `requireRole`. Layout'taki
   * denetim silinirse sıradan kullanıcı yönetim ekranını görür.
   */
  it('yönetim kabuğu rol denetimi yapıyor', () => {
    const layout = readFileSync(join(ADMIN_DIR, 'layout.tsx'), 'utf8');
    expect(layout).toContain("actor.role !== 'ADMIN'");
    expect(layout).toMatch(/redirect\(/);
  });

  it('her yönetim sunucu eylemi rol denetimi yapıyor', () => {
    const actions = readFileSync(join(process.cwd(), 'src/features/admin/actions.ts'), 'utf8');
    const exported = actions.match(/export async function (\w+)/g) ?? [];
    expect(exported.length).toBeGreaterThan(4);

    // Her eylemin gövdesinde requireRole çağrısı olmalı.
    const bodies = actions.split(/export async function /).slice(1);
    const missing = bodies
      .filter((b) => !b.includes('requireRole'))
      .map((b) => b.slice(0, b.indexOf('(')));

    expect(missing, 'Bu eylemlerde requireRole yok').toEqual([]);
  });
});
