import { expect, test } from '@playwright/test';
import { login, register, stamp } from './helpers';

/**
 * FAZ 4 KABUL KRİTERİ — sosyal katman, gerçek tarayıcıda.
 *
 * Kayıt → public profil → takip → akışta görünme → bildirim → gezinme.
 * Her koşu kendi kullanıcılarını üretir; ortak duruma bağlı değildir.
 */

test.describe('sosyal katman', () => {
  test('takip et → akışta gör → bildirim düşer', async ({ browser }) => {
    const suffix = stamp();
    const takipci = `takipci${suffix}`;
    const yildiz = `yildiz${suffix}`;

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    await register(a, takipci);
    await register(b, yildiz);
    await login(a, `${takipci}@example.com`);
    await login(b, `${yildiz}@example.com`);

    // ── Public profil giriş yapmadan da açılır ──────────────────────────────
    const anon = await (await browser.newContext()).newPage();
    await anon.goto(`/u/${yildiz}`);
    await expect(anon.getByRole('heading', { name: `@${yildiz}` })).toBeVisible();
    // Ziyaretçiye katılma çağrısı gösterilir, takip düğmesi değil.
    await expect(anon.getByRole('link', { name: 'Takip etmek için Meydana Katıl' })).toBeVisible();
    // Teknik kimlik SIZMAZ.
    await expect(anon.getByText('RESOLVED')).toHaveCount(0);
    await anon.close();

    // ── Takip ───────────────────────────────────────────────────────────────
    await a.goto(`/u/${yildiz}`);
    await a.getByRole('button', { name: 'Takip Et' }).click();
    // Düğme durumu değişir: artık takip ediliyor.
    await expect(a.getByRole('button', { name: 'Takibi Bırak' })).toBeVisible();
    await expect(a.getByText('1 takipçi')).toBeVisible();

    // ── Takip edilen tahmin yapar ───────────────────────────────────────────
    await b.goto('/app/feed');
    const card = b.locator('article').filter({ hasText: 'BTC günlük kapanış' }).first();
    await card.getByRole('button', { name: 'Yükseliş', exact: true }).click();
    await card.getByRole('button', { name: 'TAHMİN ET' }).click();
    await expect(b.getByRole('status')).toContainText('Tahminin kaydedildi');

    // ── Takipçinin akışında görünür ─────────────────────────────────────────
    await a.goto('/app/feed');
    const feedItem = a
      .locator('li')
      .filter({ hasText: `@${yildiz}` })
      .first();
    await expect(feedItem).toBeVisible();
    await expect(feedItem).toContainText('tahminini ortaya koydu');

    // ── Takip edilene bildirim düşer ────────────────────────────────────────
    await b.goto('/app/notifications');
    await expect(b.getByText(`@${takipci} seni takip etmeye başladı.`)).toBeVisible();

    await b.getByRole('button', { name: 'Tümünü okundu say' }).click();
    // Okundu işaretlendikten sonra düğme kaybolur.
    await expect(b.getByRole('button', { name: 'Tümünü okundu say' })).toHaveCount(0);

    await ctxA.close();
    await ctxB.close();
  });

  test('beş sekmeli gezinme her sayfayı açar', async ({ page }) => {
    const name = `gezgin${stamp()}`;
    await register(page, name);
    await login(page, `${name}@example.com`);

    const nav = page.getByRole('navigation', { name: 'Ana gezinme' });

    for (const [label, path] of [
      ['Gündem', '/app/trending'],
      ['Meydan Okumalar', '/app/challenges'],
      ['Liderlik', '/app/leaderboard'],
      ['Profil', '/app/profile'],
      ['Akış', '/app/feed'],
    ] as const) {
      await nav.getByRole('link', { name: label }).click();
      await page.waitForURL(`**${path}`);
      // Hiçbir sayfada ham teknik değer görünmez.
      await expect(page.getByText('undefined')).toHaveCount(0);
    }
  });

  test('Meydan Okumalar sayfasında dört sekme vardır', async ({ page }) => {
    const name = `sekme${stamp()}`;
    await register(page, name);
    await login(page, `${name}@example.com`);

    await page.goto('/app/challenges');
    const tablist = page.getByRole('tablist', { name: 'Meydan Okuma bölümleri' });
    for (const tab of ['GELEN', 'GÖNDERDİKLERİM', 'AÇIK MEYDANLAR', 'TAMAMLANANLAR']) {
      await expect(tablist.getByRole('tab', { name: tab })).toBeVisible();
    }

    await tablist.getByRole('tab', { name: 'TAMAMLANANLAR' }).click();
    await expect(page.getByText('Henüz tamamlanan Meydan Okuman yok.')).toBeVisible();
  });

  test('public etkinlik sayfası ziyaretçiye açıktır ve SEO başlığı taşır', async ({ page }) => {
    await page.goto('/event/btc-gunluk-kapanis');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('BTC');
    await expect(page).toHaveTitle(/BTC/);
    // Finansal içerikte uyarı ZORUNLU.
    await expect(page.getByText('Yatırım tavsiyesi')).toBeVisible();
    // Ziyaretçi katılmaya davet edilir.
    await expect(page.getByRole('link', { name: 'Meydana Katıl' })).toBeVisible();
  });
});
