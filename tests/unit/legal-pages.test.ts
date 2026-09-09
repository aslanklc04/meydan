import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * YASAL SAYFALAR VE KIRIK BAĞLANTILAR.
 *
 * Canlıda kayıt formundaki "Kullanım koşullarını ve gizlilik politikasını
 * kabul ediyorum" onay kutusu, VAR OLMAYAN iki sayfaya bağlanıyordu; ikisi de
 * 404 dönüyordu. Kullanıcıya okuyamadığı bir metni kabul ettirmek, onayı
 * anlamsız kılar — ve bu, derlemeden ve testlerden geçerek canlıya çıktı.
 *
 * Bu test iki şeyi birden bekler: sayfaların var olması VE uygulamadaki
 * hiçbir iç bağlantının karşılığı olmayan bir rotaya gitmemesi.
 */

const APP = join(process.cwd(), 'src/app');

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? pageFiles(full) : full.endsWith('.tsx') ? [full] : [];
  });
}

/** "(marketing)" gibi grup klasörleri adrese girmez; [slug] dinamiktir. */
function routeExists(route: string): boolean {
  const segments = route.split('/').filter(Boolean);

  const walk = (dir: string, rest: string[]): boolean => {
    if (rest.length === 0) {
      return existsSync(join(dir, 'page.tsx')) || existsSync(join(dir, 'route.ts'));
    }
    const [head, ...tail] = rest;
    const direct = join(dir, head!);
    if (existsSync(direct) && statSync(direct).isDirectory() && walk(direct, tail)) return true;

    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      // Grup klasörü: adrese katkısı yok, içine bakılır.
      if (entry.startsWith('(') && walk(full, rest)) return true;
      // Dinamik segment: her değeri karşılar.
      if (entry.startsWith('[') && walk(full, tail)) return true;
    }
    return false;
  };

  return walk(APP, segments);
}

describe('yasal sayfalar', () => {
  it('kullanım koşulları sayfası VAR', () => {
    expect(routeExists('/legal/terms')).toBe(true);
  });

  it('gizlilik politikası sayfası VAR', () => {
    expect(routeExists('/legal/privacy')).toBe(true);
  });

  it('kayıt formu her iki sayfaya da bağlanıyor', () => {
    const register = readFileSync(join(APP, '(auth)/register/page.tsx'), 'utf8');
    expect(register).toContain('/legal/terms');
    expect(register).toContain('/legal/privacy');
  });

  it('sanal para ve yatırım uyarıları KALDIRILMADI', () => {
    const terms = readFileSync(join(APP, '(marketing)/legal/terms/page.tsx'), 'utf8');
    expect(terms).toContain('Gerçek para değildir');
    expect(terms).toContain('Yatırım tavsiyesi');
  });

  it('uydurma iletişim adresi gömülü değil', () => {
    const privacy = readFileSync(join(APP, '(marketing)/legal/privacy/page.tsx'), 'utf8');
    // Adres ortam değişkeninden gelmeli; sabit yazılmış bir mailto olmamalı.
    expect(/mailto:[a-z0-9._-]+@/i.test(privacy)).toBe(false);
  });
});

describe('kırık iç bağlantı yok', () => {
  /*
   * ÖNCE DENETÇİYİ DENETLE. Var olmayan bir rotayı "var" sayan bir test,
   * hiç test olmamasından kötüdür: yeşil yanar ve güven verir.
   */
  it('denetçi, olmayan rotayı olmadı diye bildiriyor', () => {
    expect(routeExists('/legal/terms')).toBe(true);
    expect(routeExists('/boyle-bir-sayfa-yok')).toBe(false);
    expect(routeExists('/legal/olmayan-alt-sayfa')).toBe(false);
  });

  it('href ile gidilen her sabit rotanın sayfası var', () => {
    const broken: string[] = [];

    for (const file of pageFiles(APP)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/href="(\/[^"#?]*)"/g)) {
        const route = match[1]!;
        // Dinamik ifade, dış bağlantı ve dosya uzantılı yollar atlanır.
        if (route.includes('${') || /\.[a-z0-9]+$/i.test(route)) continue;
        if (route === '/') continue;
        if (!routeExists(route)) broken.push(`${file.replace(APP, 'src/app')} → ${route}`);
      }
    }

    expect(broken, 'Bu bağlantılar 404 döner').toEqual([]);
  });
});
