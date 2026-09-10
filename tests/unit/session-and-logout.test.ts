import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * OTURUM SÜRESİ VE ÇIKIŞ YOLU.
 *
 * İkisi de "kod var mı" sorusundan çok "kullanıcı bunu bulabiliyor mu"
 * sorusudur. Çıkış işlevi zaten yazılmıştı; profil sayfasının en altında,
 * diğerleriyle aynı görünen soluk bir düğmeydi ve kurucu bulamadı.
 * BULUNAMAYAN BİR ÇIKIŞ YOLU, OLMAYAN ÇIKIŞ YOLUDUR.
 */

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const flat = (p: string) => read(p).replace(/\s+/g, ' ');

const authConfig = read('src/server/auth/config.ts');
const loginPage = read('src/app/(auth)/login/page.tsx');
const authActions = read('src/features/auth/actions.ts');
const appLayout = read('src/app/(app)/app/layout.tsx');
const profile = read('src/app/(app)/app/profile/page.tsx');

describe('çıkış yolu bulunabilir', () => {
  it('ÜST ÇUBUKTA bir çıkış düğmesi var', () => {
    expect(appLayout).toContain('logoutAction');
    expect(appLayout).toContain('Oturumu kapat');
  });

  it('profil sayfasında AYRI BAŞLIKLI bir Hesap bölümü var', () => {
    // Diğer bağlantıların arasında duran bir eylem, aranmadıkça görünmez.
    expect(profile).toContain('hesap-baslik');
    expect(flat('src/app/(app)/app/profile/page.tsx')).toContain('Oturumu kapat');
  });

  it('çıkış SUNUCU eylemiyle yapılır — istemcide temizlenen bir bayrak değil', () => {
    expect(profile).toContain('<form action={logoutAction}>');
    expect(appLayout).toContain('<form action={logoutAction}>');
  });
});

describe('beni hatırla', () => {
  it('giriş formunda seçenek VAR ve işaretsiz başlar', () => {
    expect(loginPage).toContain('name="remember"');
    expect(loginPage).not.toMatch(/name="remember"[^>]*(defaultChecked|checked)/);
  });

  it('kutunun NE YAPTIĞI yanında yazılı', () => {
    // "Beni hatırla" tek başına ne kadar süre olduğunu söylemez.
    expect(flat('src/app/(auth)/login/page.tsx')).toContain('12 saat');
    expect(flat('src/app/(auth)/login/page.tsx')).toContain('Ortak bir bilgisayardaysan');
  });

  it('işaretlenmemiş kutu KISA oturum demektir', () => {
    // İşaretsiz onay kutusu forma hiç gelmez; yokluk "hatırlama" olmalı.
    expect(authActions).toContain("formData.get('remember') === 'on' ? 'true' : 'false'");
  });

  it('iki ayrı süre tanımlı ve kısa olan varsayılan', () => {
    expect(authConfig).toContain('REMEMBER_MS');
    expect(authConfig).toContain('SHORT_MS');
    expect(authConfig).toContain("credentials?.remember === 'true'");
  });

  it('süre MUTLAKTIR — her istekte uzatılmaz', () => {
    /*
     * Kayan süre, bir kez ele geçirilen oturumun sonsuza kadar açık kalması
     * demektir. Bitiş zamanı yalnızca `user` varken, yani GİRİŞTE yazılır.
     */
    const jwtBlock = authConfig.slice(
      authConfig.indexOf('async jwt('),
      authConfig.indexOf('async session('),
    );
    expect(jwtBlock).toContain('token.expiresAt = Date.now()');
    expect(jwtBlock).toMatch(/if \(user &&[\s\S]*token\.expiresAt = Date\.now\(\)/);
  });

  it('süre dolduğunda oturum SUNUCUDA biter', () => {
    // Çerezin tarayıcıda durup durmaması kararı değiştirmemeli.
    const sessionBlock = authConfig.slice(authConfig.indexOf('async session('));
    expect(sessionBlock).toContain('Date.now() > expiresAt');
  });

  it('ESKİ çerezler sırf sürüm geçti diye dışarı atılmaz', () => {
    const sessionBlock = authConfig.slice(authConfig.indexOf('async session('));
    expect(sessionBlock).toContain('expiresAt !== null');
  });
});
