import { describe, expect, it } from 'vitest';
import { databaseUrl, normalizeDatabaseUrl } from '../../src/server/db/url';

/**
 * BAĞLANTI ADRESİ NORMALLEŞTİRME — Faz 7.
 *
 * Bu testlerin varlık sebebi gerçek bir arızadır: Neon panelinden AYNEN
 * kopyalanan adres `channel_binding=require` taşıyor ve postgres.js bunu
 * sunucuya başlangıç parametresi olarak yolladığı için PostgreSQL bağlantıyı
 * "unrecognized configuration parameter" diyerek reddediyor. Uygulama hiç
 * açılmıyor.
 *
 * Sınanan asıl şey: SSL ayarı KORUNURKEN zararlı parametrenin düşmesi.
 * Şifreleme sessizce kapanırsa arıza, çalışmayan bir siteden çok daha kötü
 * olurdu — bağlantı açık şekilde akardı.
 */

describe('desteklenmeyen parametreler', () => {
  it('Neon adresindeki channel_binding DÜŞER, sslmode KALIR', () => {
    const { url, dropped } = normalizeDatabaseUrl(
      'postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    );

    expect(url).toContain('sslmode=require');
    expect(url).not.toContain('channel_binding');
    expect(dropped).toEqual(['channel_binding']);
  });

  it('bilinmeyen her parametre düşer — kara liste değil izin listesi', () => {
    const { url, dropped } = normalizeDatabaseUrl(
      'postgresql://u:p@h/db?gssencmode=prefer&pgbouncer=true&yarin_eklenecek_bir_sey=1',
    );

    expect(url).not.toContain('gssencmode');
    expect(url).not.toContain('pgbouncer');
    expect(url).not.toContain('yarin_eklenecek_bir_sey');
    expect(dropped).toHaveLength(3);
  });

  it('sürücünün anladığı parametreler KORUNUR', () => {
    const { url, dropped } = normalizeDatabaseUrl(
      'postgresql://u:p@h/db?sslmode=require&connect_timeout=10&application_name=meydan&max=3',
    );

    expect(url).toContain('sslmode=require');
    expect(url).toContain('connect_timeout=10');
    expect(url).toContain('application_name=meydan');
    expect(url).toContain('max=3');
    expect(dropped).toEqual([]);
  });
});

describe('kimlik bilgileri', () => {
  it('kullanıcı adı, parola, sunucu ve veritabanı adı DEĞİŞMEZ', () => {
    const url = databaseUrl(
      'postgresql://meydan_user:S1FRE-AAA@ep-cool-a1b2.eu-central-1.aws.neon.tech/neondb?channel_binding=require',
    );
    const parsed = new URL(url);

    expect(parsed.username).toBe('meydan_user');
    expect(parsed.password).toBe('S1FRE-AAA');
    expect(parsed.hostname).toBe('ep-cool-a1b2.eu-central-1.aws.neon.tech');
    expect(parsed.pathname).toBe('/neondb');
  });

  it('düşürülenler listesi DEĞER değil yalnızca AD taşır', () => {
    const { dropped } = normalizeDatabaseUrl(
      'postgresql://u:S1FRE-AAA@h/db?channel_binding=require',
    );
    expect(dropped).toEqual(['channel_binding']);
    expect(JSON.stringify(dropped)).not.toContain('S1FRE-AAA');
    expect(JSON.stringify(dropped)).not.toContain('require');
  });
});

describe('sınır durumları', () => {
  it('parametresiz adres olduğu gibi kalır', () => {
    const raw = 'postgresql://u:p@localhost:5432/meydan';
    expect(databaseUrl(raw)).toBe(raw);
  });

  it('ayrıştırılamayan adres OLDUĞU GİBİ döner — hata sürücüye bırakılır', () => {
    // Burada hata fırlatmak, "adres geçersiz" mesajını sürücünün daha
    // anlaşılır hatasının önüne geçirirdi.
    const raw = 'bu bir adres degil';
    expect(databaseUrl(raw)).toBe(raw);
  });

  it('idempotenttir: iki kez normalleştirmek aynı sonucu verir', () => {
    const once = databaseUrl('postgresql://u:p@h/db?sslmode=require&channel_binding=require');
    expect(databaseUrl(once)).toBe(once);
  });
});
