import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { consoleMailer } from '../../src/server/modules/identity/email';

/**
 * `EMAIL_FROM` uygulama AÇILIRKEN okunuyor (serverEnv modül yüklenirken
 * çözülür), sonradan değiştirilemiyor. Bu yüzden http adaptörü her testte
 * ortam ayarlandıktan SONRA yeniden yükleniyor. Testin bunu taklit etmesi
 * şart: aksi hâlde ölçtüğü şey üretimdeki davranış olmaz.
 */
async function freshHttpMailer() {
  vi.resetModules();
  const mod = await import('../../src/server/modules/identity/email');
  return mod.httpMailer;
}

/**
 * "GÖNDERDİK" DEMEDEN ÖNCE GERÇEKTEN GÖNDERİLDİ Mİ?
 *
 * Canlıda kayıt olan kişiye "doğrulama bağlantısını e-postana gönderdik"
 * deniyordu; oysa sağlayıcı isteği reddetmişti. Kullanıcı boş gelen kutusunu
 * bekledi. Buradaki testler, gönderim sonucunun DOĞRU raporlandığını
 * garanti eder — arayüzün dürüstlüğü buna bağlı.
 */

beforeEach(() => {
  process.env.EMAIL_FROM = 'onboarding@resend.dev';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.EMAIL_API_URL;
  delete process.env.EMAIL_API_KEY;
  delete process.env.EMAIL_FROM;
});

function stubFetch(status: number) {
  vi.stubGlobal('fetch', async () => ({ ok: status >= 200 && status < 300, status }) as Response);
}

describe('konsol adaptörü', () => {
  it('ASLA true dönmez — gelen kutusuna hiçbir şey gitmiyor', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await consoleMailer.sendEmailVerification('a@b.com', 't')).toBe(false);
    expect(await consoleMailer.sendPasswordReset('a@b.com', 't')).toBe(false);
    expect(await consoleMailer.sendAccountExistsNotice('a@b.com')).toBe(false);
  });
});

describe('http adaptörü', () => {
  it('sağlayıcı kabul ederse true', async () => {
    process.env.EMAIL_API_URL = 'https://api.resend.com/emails';
    process.env.EMAIL_API_KEY = 're_test';
    stubFetch(200);
    const mailer = await freshHttpMailer();
    expect(await mailer.sendEmailVerification('a@b.com', 't')).toBe(true);
  });

  it('sağlayıcı REDDEDERSE false — canlıda olan tam olarak buydu (403)', async () => {
    process.env.EMAIL_API_URL = 'https://api.resend.com/emails';
    process.env.EMAIL_API_KEY = 're_test';
    stubFetch(403);
    const mailer = await freshHttpMailer();
    expect(await mailer.sendEmailVerification('baskasi@ornek.com', 't')).toBe(false);
  });

  it('EMAIL_FROM eksikse false — istek bile atılmaz', async () => {
    delete process.env.EMAIL_FROM;
    process.env.EMAIL_API_URL = 'https://api.resend.com/emails';
    process.env.EMAIL_API_KEY = 're_test';
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', async () => {
      calls.push(1);
      return {} as Response;
    });
    const mailer = await freshHttpMailer();
    expect(await mailer.sendEmailVerification('a@b.com', 't')).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('anahtar/uç eksikse false — istek bile atılmaz', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', async () => {
      calls.push(1);
      return {} as Response;
    });
    const mailer = await freshHttpMailer();
    expect(await mailer.sendEmailVerification('a@b.com', 't')).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('ağ hatasında false — kayıt akışı yine de ÇÖKMEZ', async () => {
    process.env.EMAIL_API_URL = 'https://api.resend.com/emails';
    process.env.EMAIL_API_KEY = 're_test';
    vi.stubGlobal('fetch', async () => {
      throw new Error('ağ koptu');
    });
    const mailer = await freshHttpMailer();
    await expect(mailer.sendEmailVerification('a@b.com', 't')).resolves.toBe(false);
  });
});
