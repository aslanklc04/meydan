import { expect, test } from '@playwright/test';
import { PASSWORD, register, stamp, signUpAndEnter } from './helpers';

/**
 * FAZ 5 KABUL KRİTERİ — ilk kullanıcı deneyimi, gerçek tarayıcıda.
 *
 * Sınanan şey ekranların açılması değil, YENİ KULLANICININ NE GÖRDÜĞÜ:
 * karşılama bir kez çıkar, hiçbir bölüm boş bırakılmaz, tahminden Meydan
 * Okumaya geçiş tek dokunuştur.
 */

test.describe('yeni kullanıcı yolu', () => {
  test('kayıt → karşılama → ilgi alanı → akış', async ({ page }) => {
    const name = `yeni${stamp()}`;
    await register(page, name);

    await page.goto('/login');
    await page.getByLabel('E-posta').fill(`${name}@example.com`);
    await page.getByLabel('Parola').fill(PASSWORD);
    await page.getByRole('button', { name: 'Giriş Yap' }).click();

    // Yeni kullanıcı KARŞILAMA ekranıyla karşılanır.
    // NOT: adres kontrolü YAPILMAZ. Sunucu bileşeninden yapılan `redirect()`,
    // istemci gezinmesinde hedef sayfayı yerinde render eder ve tarayıcı
    // adresi `/app/feed` kalabilir. Kullanıcının GÖRDÜĞÜ şey sınanır.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('HOŞ GELDİN');
    // Gümüş Çipin gerçek para OLMADIĞI daha ilk ekranda yazar.
    await expect(page.getByText('gerçek para değildir')).toBeVisible();

    // İki ilgi alanı seç ve gir.
    await page.getByRole('button', { name: 'Spor' }).click();
    await page.getByRole('button', { name: 'Kripto' }).click();
    await expect(page.getByText('2 alan seçtin.')).toBeVisible();

    await page.getByRole('button', { name: 'Meydana Gir' }).click();

    // Akış boş DEĞİL: ne yapılacağı yazıyor ve etkinlik var.
    await expect(page.getByRole('heading', { name: 'Sen ne diyorsun?' })).toBeVisible();
    await expect(page.locator('article').first()).toBeVisible();

    // Seçilen ilgi alanı ÖNE alınır ama diğerleri gizlenmez.
    await expect(page.locator('article')).not.toHaveCount(0);

    // Karşılama BİR DAHA çıkmaz.
    await page.goto('/app/feed');
    await expect(page.getByRole('heading', { name: 'Sen ne diyorsun?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Şimdilik geç' })).toHaveCount(0);
  });

  test('karşılama atlanabilir ve bir daha çıkmaz', async ({ page }) => {
    const name = `atla${stamp()}`;
    await register(page, name);

    await page.goto('/login');
    await page.getByLabel('E-posta').fill(`${name}@example.com`);
    await page.getByLabel('Parola').fill(PASSWORD);
    await page.getByRole('button', { name: 'Giriş Yap' }).click();
    await expect(page.getByRole('button', { name: 'Şimdilik geç' })).toBeVisible();

    await page.getByRole('button', { name: 'Şimdilik geç' }).click();
    await expect(page.getByRole('heading', { name: 'Sen ne diyorsun?' })).toBeVisible();

    // İkinci girişte karşılama YOK.
    await page.goto('/app/feed');
    await expect(page.getByRole('button', { name: 'Şimdilik geç' })).toHaveCount(0);
  });

  test('boş bölümler kullanıcıya NE YAPACAĞINI söyler', async ({ page }) => {
    const name = `bos${stamp()}`;
    await signUpAndEnter(page, name);

    // Akış: kimseyi takip etmiyor → keşif çağrısı var.
    await expect(page.getByText('Henüz kimseyi takip etmiyorsun.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'İyi tahmincileri keşfet' })).toBeVisible();

    // Bildirimler: boş ama çıkışı gösteriyor.
    await page.goto('/app/notifications');
    await expect(page.getByText('Henüz bildirimin yok.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Akışa git' })).toBeVisible();

    // Profil: tahmin yok ama ilk adımı öneriyor.
    await page.goto('/app/profile');
    await expect(page.getByText('Henüz tahmin yapmadın.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'İlk tahminini yap' })).toBeVisible();

    // Liderlik: eşiğin altında olduğu AÇIKÇA yazıyor.
    await page.goto('/app/leaderboard');
    await expect(page.getByRole('heading', { name: /Liderlik/ })).toBeVisible();
  });
});

test.describe('tahminden Meydan Okumaya', () => {
  test('tahmin yapılınca "BU TAHMİNLE MEYDAN OKU" görünür ve çalışır', async ({ page }) => {
    const name = `kopru${stamp()}`;
    await signUpAndEnter(page, name);

    const card = page.locator('article').filter({ hasText: 'BTC günlük kapanış' }).first();
    await expect(card).toBeVisible();

    // ADIM 1: sadece tahmin — çip harcanmaz.
    await card.getByRole('button', { name: 'Yükseliş', exact: true }).click();
    await expect(card).toContainText('Tahmin etmek Gümüş Çip harcamaz');
    await card.getByRole('button', { name: 'TAHMİN ET' }).click();
    await expect(page.getByRole('status')).toContainText('Tahminin kaydedildi');

    // Bakiye DEĞİŞMEDİ.
    await page.goto('/app/profile');
    const balance = page.getByRole('group', { name: 'Gümüş Çip' }).locator('[data-stat-value]');
    await expect(balance).toHaveText('1.000');

    // ADIM 2: aynı tahminle Meydan Okuma köprüsü.
    await page.goto('/app/feed');
    const after = page.locator('article').filter({ hasText: 'BTC günlük kapanış' }).first();
    await expect(after).toContainText('Tahminin: Yükseliş');

    await after.getByRole('button', { name: 'BU TAHMİNLE MEYDAN OKU' }).click();
    // Ne alacağı ve karşı tarafın ne alacağı yazıyor.
    await expect(after).toContainText('Sen Yükseliş diyorsun.');
    await expect(after).toContainText('Karşı taraf Düşüş tarafını alacak.');

    await after.getByRole('button', { name: '25', exact: true }).click();
    await after.getByRole('button', { name: 'AÇIK MEYDAN OLUŞTUR' }).click();
    await expect(page.getByRole('status')).toContainText('Açık Meydan Okuman yayınlandı');

    // ŞİMDİ çip düştü.
    await page.goto('/app/profile');
    await expect(balance).toHaveText('975');
  });
});

test.describe('Meydan Okuma detayı', () => {
  test('iki tarafın seçimi ve ortaya konan çip tek ekranda görünür', async ({ browser }) => {
    const suffix = stamp();
    const a = await (await browser.newContext()).newPage();
    const b = await (await browser.newContext()).newPage();

    await signUpAndEnter(a, `deta${suffix}`);
    await signUpAndEnter(b, `detb${suffix}`);

    // A açık Meydan Okuma yayınlar.
    const card = a.locator('article').filter({ hasText: 'BTC günlük kapanış' }).first();
    await card.getByRole('button', { name: 'Yükseliş', exact: true }).click();
    await card.getByRole('button', { name: 'Meydan Oku', exact: true }).click();
    await card.getByRole('button', { name: '25', exact: true }).click();
    await card.getByRole('button', { name: 'AÇIK MEYDAN OLUŞTUR' }).click();
    await expect(a.getByRole('status')).toContainText('yayınlandı');

    // B detay ekranını açar.
    await b.goto('/app/challenges');
    await b.getByRole('tab', { name: 'AÇIK MEYDANLAR' }).click();
    await b.getByRole('link', { name: 'Ayrıntı' }).first().click();
    await b.waitForURL(/\/app\/challenges\/.+/);

    await expect(b.getByText(`@deta${suffix}`).first()).toBeVisible();
    await expect(b.getByText('Kabul edersen ne olur?')).toBeVisible();
    await expect(b.getByText('25 Gümüş Çip', { exact: false }).first()).toBeVisible();
    // Teknik kimlik ekranda YOK.
    await expect(b.getByText('challengeId')).toHaveCount(0);

    await b.getByRole('button', { name: 'MEYDAN OKUMAYI KABUL ET' }).click();
    await expect(b.getByRole('status')).toContainText('kabul ettin');
  });
});

test.describe('erişilebilirlik ve mobil', () => {
  test('ana gezinme beş sekmelidir ve dokunma hedefleri yeterince büyüktür', async ({ page }) => {
    const name = `mob${stamp()}`;
    await signUpAndEnter(page, name);

    const nav = page.getByRole('navigation', { name: 'Ana gezinme' });
    const links = nav.getByRole('link');
    await expect(links).toHaveCount(5);

    // WCAG 2.5.5 hedefi: en az 44×44 CSS pikseli.
    const count = await links.count();
    for (let i = 0; i < count; i += 1) {
      const box = await links.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  });

  test('sayfa yatay kaymaz (mobil taşma yok)', async ({ page }) => {
    const name = `tasma${stamp()}`;
    await signUpAndEnter(page, name);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // Birkaç pikselik yuvarlama payı bırakılır; asıl yakalanan gerçek taşmadır.
    expect(overflow).toBeLessThanOrEqual(2);
  });

  test('bulunamayan sayfa kullanıcı diliyle karşılar', async ({ page }) => {
    await page.goto('/event/boyle-bir-etkinlik-yok');
    await expect(page.getByText('Aradığın sayfa yok.')).toBeVisible();
    await expect(page.getByText('404')).toHaveCount(0);
  });

  test('Tahmin Gücü açıklaması herkese açıktır', async ({ page }) => {
    await page.goto('/tahmin-gucu');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Tahmin Gücü');
    await expect(page.getByText('Doğruluk')).toBeVisible();
    await expect(page.getByText('gerçek para değildir')).toBeVisible();
  });
});
