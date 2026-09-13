import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ARAMA MOTORUNA GÖRÜNÜRLÜK.
 *
 * Site hiçbir aramada çıkmıyordu. Sebep teknik bir kusur DEĞİLDİ — Google'ın
 * siteden haberi yoktu. Ama bu tespit ancak teknik tarafın gerçekten temiz
 * olduğu doğrulanabildiği için yapılabilir; aşağıdaki testler o tarafın
 * sessizce bozulmamasını sağlar.
 */

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const flat = (p: string) => read(p).replace(/\s+/g, ' ');

describe('tarayıcıya kapı açık', () => {
  it('robots.txt ana sayfayı ENGELLEMİYOR', () => {
    const r = read('src/app/robots.ts');
    expect(r).toContain("allow: '/'");
    // Oturum içi ve yönetim ekranları kapalı kalmalı.
    expect(r).toContain("'/app/'");
    expect(r).toContain("'/admin/'");
  });

  it('site haritası robots.txt içinde duyuruluyor', () => {
    expect(read('src/app/robots.ts')).toContain('sitemap:');
  });

  it('ana sayfa indekslemeye kapatılmamış', () => {
    const home = read('src/app/page.tsx');
    expect(home).not.toMatch(/robots:\s*\{\s*index:\s*false/);
  });

  it('sonuç sayfası ve site haritası birbirini biliyor', () => {
    expect(read('src/app/sitemap.ts')).toContain('/sonuclar');
  });
});

describe('sayfa kimliği', () => {
  it('başlık, açıklama ve mutlak adres tabanı var', () => {
    const layout = flat('src/app/layout.tsx');
    expect(layout).toContain('metadataBase');
    expect(layout).toContain('description: brand.description');
    expect(layout).toContain('openGraph');
  });
});

describe('Google doğrulama etiketi', () => {
  it('değer YOKSA etiket HİÇ basılmaz', () => {
    /*
     * Boş `content` taşıyan bir doğrulama etiketi, doğrulamayı sessizce
     * başarısız kılar ve kurucu neden olmadığını anlayamaz.
     */
    const layout = flat('src/app/layout.tsx');
    expect(layout).toContain('serverEnv.GOOGLE_SITE_VERIFICATION');
    expect(layout).toContain('? { verification: { google: serverEnv.GOOGLE_SITE_VERIFICATION } }');
    expect(layout).toContain(': {})');
  });

  it('kod ortam değişkeninden okunur, koda gömülmez', () => {
    expect(read('src/config/env.ts')).toContain('GOOGLE_SITE_VERIFICATION');
    // Gerçek bir doğrulama kodu kaynağa yazılmamalı.
    expect(read('src/app/layout.tsx')).not.toMatch(/google:\s*'[A-Za-z0-9_-]{20,}'/);
  });
});
