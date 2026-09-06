import { expect, test } from '@playwright/test';

/**
 * Faz 1 duman testi. Gerçek E2E akışları (kayıt → tahmin → Meydan Okuma →
 * kabul → sonuçlandırma → profil) Faz 2'den itibaren eklenir.
 */
test('ana sayfa açılır ve marka adını gösterir', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/MEYDAN/);
});

test('sayfa dili Türkçe olarak işaretlenmiş', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
});

test('finansal uyarı görünür ve yatırım tavsiyesi olmadığını söyler', async ({ page }) => {
  await page.goto('/');
  const note = page.getByRole('note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('yatırım tavsiyesi');
});
