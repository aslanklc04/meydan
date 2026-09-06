import { expect, test, type Page } from '@playwright/test';
import { login, register, stamp } from './helpers';

/**
 * FAZ 3 KABUL KRİTERİ — gerçek tarayıcıda, uçtan uca.
 *
 * Emir kayıt olur → Mert kayıt olur → Emir "Galatasaray" seçer, 50 Gümüş Çip
 * koyar, Mert'e Meydan Okur → Mert kabul eder (karşı sonuç otomatik) →
 * Admin sonucu "Galatasaray" olarak belirler → Emir kazanır, bakiyeler doğru.
 *
 * Bu test sayfanın açıldığını değil, ÜRÜNÜN ÇALIŞTIĞINI doğrular.
 */

/**
 * Profildeki istatistik kartından sayı okur.
 * `[data-stat-value]` kullanılır: metin sırasına dayanmak, karta bir satır
 * eklendiğinde testi sessizce yanlış sayı okumaya iter.
 */
async function readStat(page: Page, label: string): Promise<number> {
  const card = page.getByRole('group', { name: label });
  const text = await card.locator('[data-stat-value]').first().innerText();
  return Number(text.replace(/\./g, '').trim());
}

async function readBalance(page: Page): Promise<number> {
  await page.goto('/app/profile');
  return readStat(page, 'Gümüş Çip');
}

/** "2026-09-06T18:00" — datetime-local alanının beklediği biçim. */
function localDateTime(hoursFromNow: number): string {
  const d = new Date(Date.now() + hoursFromNow * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Testin KENDİ etkinliğini yönetim ekranından oluşturur.
 *
 * NEDEN: iki tarayıcı projesi (masaüstü ve mobil) aynı veritabanına karşı
 * paralel koşuyor. Ortak seed etkinliğini kullansalardı biri diğerinin
 * etkinliğini sonuçlandırır ve ikinci koşu "etkinlik bulunamadı" ile
 * düşerdi — nitekim düştü. Her koşunun kendi etkinliği olması testi
 * sıraya ve rastlantıya bağlı olmaktan çıkarır.
 */
async function createEventAsAdmin(admin: Page, title: string, slug: string): Promise<void> {
  await login(admin, 'yonetici@meydan.local');
  await admin.goto('/admin/events');

  const form = admin.locator('form').filter({ hasText: 'Yeni Etkinlik' });
  await form.getByLabel('Kategori').selectOption('spor');
  await form.getByLabel('Başlık').fill(title);
  await form.getByLabel('Soru').fill('Maçı kim kazanacak?');
  await form.getByLabel('Bağlantı adresi (slug)').fill(slug);
  await form.getByLabel('Tahminler kapanır').fill(localDateTime(4));
  await form.getByLabel('Sonuç beklenir').fill(localDateTime(8));

  const outcomes = form.locator('fieldset input');
  await outcomes.nth(0).fill('Galatasaray');
  await outcomes.nth(1).fill('Fenerbahçe');
  await form.getByRole('button', { name: 'Sonuç ekle' }).click();
  await form.locator('fieldset input').nth(2).fill('Beraberlik');

  await form.getByRole('button', { name: 'Etkinliği Oluştur' }).click();
  await expect(admin.getByRole('status')).toContainText('Etkinlik oluşturuldu');
}

test.describe('çekirdek döngü', () => {
  test('Emir Meydan Okur, Mert kabul eder, admin sonuçlandırır, çipler doğru akar', async ({
    browser,
  }) => {
    const suffix = stamp();
    const emirName = `emir${suffix}`;
    const mertName = `mert${suffix}`;
    const eventTitle = `Derbi ${suffix}`;

    const emirContext = await browser.newContext();
    const mertContext = await browser.newContext();
    const adminContext = await browser.newContext();
    const emir = await emirContext.newPage();
    const mert = await mertContext.newPage();
    const admin = await adminContext.newPage();

    // ── 0. Bu koşuya ait etkinlik yönetim ekranından oluşturulur ──────────
    await createEventAsAdmin(admin, eventTitle, `derbi-${suffix}`);

    // ── 1. İki kullanıcı kayıt olur ───────────────────────────────────────
    await register(emir, emirName);
    await register(mert, mertName);

    await login(emir, `${emirName}@example.com`);
    await login(mert, `${mertName}@example.com`);

    // Yeni kullanıcı boş ekran görmez: ne yapacağı yazıyor.
    await expect(emir.getByText('Aşağıdan bir sonuç seç')).toBeVisible();

    const emirStart = await readBalance(emir);
    const mertStart = await readBalance(mert);
    expect(emirStart).toBe(1000);
    expect(mertStart).toBe(1000);

    // ── 2. Emir tahminini seçer ve Mert'e Meydan Okur ─────────────────────
    await emir.goto('/app/feed');
    const card = emir.locator('article').filter({ hasText: eventTitle }).first();
    await expect(card).toBeVisible();

    // FAZ 5 AKIŞI: sonuç seç → "Meydan Oku" ile çip adımına geç → çip ve rakip.
    await card.getByRole('button', { name: 'Galatasaray', exact: true }).click();
    await card.getByRole('button', { name: 'Meydan Oku', exact: true }).click();
    // Karşı tarafın hangi seçeneği aldığı ONAYDAN ÖNCE yazar.
    await expect(card).toContainText('Karşı taraf');
    await card.getByRole('button', { name: '50', exact: true }).click();
    await card.getByRole('button', { name: 'Belirli birine Meydan Oku' }).click();
    await card.getByLabel('Kime Meydan Okumak istiyorsun?').fill(mertName);
    await card.getByRole('button', { name: 'MEYDAN OKU', exact: true }).click();

    await expect(emir.getByRole('status')).toContainText('Meydan Okuman');
    await expect(emir.getByRole('status')).toContainText('50 Gümüş Çip');

    // Çip anında stake edildi
    expect(await readBalance(emir)).toBe(emirStart - 50);

    // ── 3. Mert Meydan Okumayı görür ve kabul eder ────────────────────────
    await mert.goto('/app/feed');
    const incoming = mert.locator('article').filter({ hasText: 'sana Meydan Okudu' }).first();
    await expect(incoming).toBeVisible();

    // Karşı sonuç AÇIKÇA gösterilir — ama seçim istenmez (ADR-18)
    await expect(incoming).toContainText('Galatasaray');
    await expect(incoming).toContainText('Fenerbahçe');
    await expect(incoming).toContainText('50 Gümüş Çip');

    await incoming.getByRole('button', { name: 'Meydan Okumayı Kabul Et' }).click();
    // Kullanıcı ne olduğunu AÇIKÇA görür (ürün kuralı 32)
    await expect(mert.getByRole('status')).toContainText('kabul ettin');

    expect(await readBalance(mert)).toBe(mertStart - 50);

    // ── 4. Admin sonucu belirler ──────────────────────────────────────────
    await admin.goto('/admin/events');

    const panel = admin.locator('article').filter({ hasText: eventTitle }).first();
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Galatasaray', exact: true }).click();
    await panel.getByRole('button', { name: 'Sonucu Onayla' }).click();
    await panel.getByRole('button', { name: 'Evet, sonuçlandır' }).click();
    await expect(admin.getByRole('status')).toContainText('Sonuç kaydedildi');

    // ── 5. Sonuçlar doğru ─────────────────────────────────────────────────
    // Emir kazandı: −50 stake +100 ödeme = net +50
    expect(await readBalance(emir)).toBe(emirStart + 50);
    // Mert kaybetti: net −50
    expect(await readBalance(mert)).toBe(mertStart - 50);

    // Tahmin sonuçları kullanıcı diliyle gösterilir — teknik durum adı YOK
    await emir.goto('/app/profile');
    await expect(emir.getByText('Doğru bildin')).toBeVisible();
    await expect(emir.getByText('RESOLVED')).toHaveCount(0);

    await mert.goto('/app/profile');
    await expect(mert.getByText('Tutmadı')).toBeVisible();

    // Tahmin Gücü güncellendi ve iki kullanıcı ayrıştı
    const emirPower = await readStat(emir, 'Tahmin Gücü');
    const mertPower = await readStat(mert, 'Tahmin Gücü');
    expect(emirPower).toBeGreaterThan(mertPower);

    // ── 6. Aynı sonuçlandırma İKİNCİ KEZ çalıştırılırsa hiçbir şey değişmez ──
    await admin.goto('/admin/events');
    const stillListed = admin.locator('article').filter({ hasText: eventTitle }).first();
    if (await stillListed.isVisible().catch(() => false)) {
      await stillListed.getByRole('button', { name: 'Galatasaray', exact: true }).click();
      await stillListed.getByRole('button', { name: 'Sonucu Onayla' }).click();
      await stillListed.getByRole('button', { name: 'Evet, sonuçlandır' }).click();
    }

    // Bakiyeler DEĞİŞMEZ — çift ödeme yok
    expect(await readBalance(emir)).toBe(emirStart + 50);
    expect(await readBalance(mert)).toBe(mertStart - 50);

    await emirContext.close();
    await mertContext.close();
    await adminContext.close();
  });

  test('Açık Meydan Okuma: ilk kabul eden karşı taraf olur', async ({ browser }) => {
    const suffix = stamp();
    const aName = `acan${suffix}`;
    const bName = `bcan${suffix}`;

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    await register(a, aName);
    await register(b, bName);
    await login(a, `${aName}@example.com`);
    await login(b, `${bName}@example.com`);

    // A, BTC etkinliğinde Açık Meydan Okuma yayınlar
    await a.goto('/app/feed');
    const card = a.locator('article').filter({ hasText: 'BTC günlük kapanış' }).first();
    await card.getByRole('button', { name: 'Yükseliş', exact: true }).click();
    await card.getByRole('button', { name: 'Meydan Oku', exact: true }).click();
    await card.getByRole('button', { name: '25', exact: true }).click();
    await card.getByRole('button', { name: 'AÇIK MEYDAN OLUŞTUR' }).click();
    await expect(a.getByRole('status')).toContainText('Açık Meydan Okuman yayınlandı');

    // B akışta görür ve kabul eder — hangi tarafı aldığı açıkça yazar
    await b.goto('/app/feed');
    const open = b
      .locator('article')
      .filter({ hasText: 'Açık Meydan Okuma yayınladı' })
      .filter({ hasText: `@${aName}` })
      .first();
    await expect(open).toBeVisible();
    await expect(open).toContainText('Düşüş');

    await open.getByRole('button', { name: 'Meydan Okumayı Kabul Et' }).click();
    await expect(b.getByRole('status')).toContainText('kabul ettin');

    await ctxA.close();
    await ctxB.close();
  });

  test('finansal etkinlikte yatırım tavsiyesi uyarısı görünür', async ({ page }) => {
    const name = `uyari${stamp()}`;
    await register(page, name);
    await login(page, `${name}@example.com`);

    await page.goto('/app/feed');
    const card = page.locator('article').filter({ hasText: 'BTC günlük kapanış' }).first();
    await expect(card).toContainText('Yatırım tavsiyesi');
  });
});
