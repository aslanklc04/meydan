import { expect, type Page } from '@playwright/test';

/**
 * E2E ortak yardımcıları.
 *
 * Faz 5'te karşılama ekranı eklendi: giriş yapan YENİ kullanıcı önce
 * `/app/welcome` sayfasına yönlendirilir. Bu yüzden her testin kendi
 * giriş kodunu yazması yerine tek yerde toplandı — akış değiştiğinde tek
 * dosya güncellenir.
 */

export const PASSWORD = 'meydan-tahmin-2026';

export const stamp = () => Math.random().toString(36).slice(2, 8);

export async function register(page: Page, username: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Kullanıcı adı').fill(username);
  await page.getByLabel('E-posta').fill(`${username}@example.com`);
  await page.getByLabel('Parola').fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Meydana Katıl' }).click();
  await expect(page.getByRole('status')).toContainText('Hesabın oluşturuldu');
}

/** Giriş yapar ve karşılama ekranı çıkarsa geçer; sonuçta akışta olunur. */
export async function login(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-posta').fill(email);
  await page.getByLabel('Parola').fill(PASSWORD);
  await page.getByRole('button', { name: 'Giriş Yap' }).click();
  await page.waitForURL(/\/app\/(feed|welcome)/);
  await skipOnboardingIfShown(page);
}

/**
 * Karşılama ekranındaysa "Şimdilik geç" ile akışa çıkar.
 *
 * ADRESE DEĞİL İÇERİĞE bakılır. Next.js'te bir Server Component'ten yapılan
 * `redirect()`, istemci tarafı gezinmesi sırasında hedef sayfayı yerinde
 * render eder ama tarayıcı adresini DEĞİŞTİRMEYEBİLİR: `/app/feed` adresinde
 * karşılama ekranı durur. Adrese bakan bir kontrol bu yüzden sessizce yanılır
 * (bu testte yakalandı).
 */
export async function skipOnboardingIfShown(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: 'Şimdilik geç' });
  const feedHeading = page.getByRole('heading', { name: 'Sen ne diyorsun?' });

  // ÖNCE ekranın oturmasını bekle. Adres, içerik render edilmeden önce
  // `/app/feed` olabiliyor; hemen bakan bir kontrol "karşılama yok" sanıp
  // sessizce geçiyordu (bu testte yakalandı).
  await expect(skip.or(feedHeading).first()).toBeVisible();

  if (!(await skip.isVisible())) return;
  await skip.click();
  await expect(feedHeading).toBeVisible();
}

/** Kayıt + giriş + karşılamayı geçme — çoğu testin ihtiyacı olan tek adım. */
export async function signUpAndEnter(page: Page, username: string): Promise<void> {
  await register(page, username);
  await login(page, `${username}@example.com`);
}
