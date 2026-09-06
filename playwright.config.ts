import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.APP_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * Hazır Chromium'u olan ortamlarda (CI imajı, sandbox) indirmeyi atla.
 * PLAYWRIGHT_CHROMIUM_PATH tanımlıysa o çalıştırılabilir kullanılır.
 */
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const launchOptions = chromiumPath ? { executablePath: chromiumPath } : undefined;

/**
 * E2E akışları — Faz 18'de tamamlanır:
 * kayıt → giriş → tahmin → Meydan Okuma → kabul → sonuçlandırma → profil → takip → liderlik
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Her koşu temiz ve seed'lenmiş bir veritabanıyla başlar.
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(launchOptions ? { launchOptions } : {}) },
    },
    // MOBİL ÖNCELİKLİ: ürün önce telefonda çalışmalı.
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], ...(launchOptions ? { launchOptions } : {}) },
    },
  ],
  webServer: {
    command: 'npm run build && npm run start',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      SKIP_ENV_VALIDATION: '1',
      NEXT_TELEMETRY_DISABLED: '1',
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'e2e-test-secret-at-least-32-characters-long!!',
      /*
       * Oran sınırları TEST ORTAMINDA gevşetilir.
       *
       * Paket tek bir istemci adresinden onlarca hesap açar; üretimdeki
       * "saatte 3 kayıt" sınırı koşuyu üçüncü kullanıcıda durdurur. Sınırı
       * üretimde gevşetmek yanlış çözüm olurdu — testin kendi çarpanını
       * vermesi doğrusu. Üretimde bu değişken AYARLANMAZ.
       */
      RATE_LIMIT_MULTIPLIER: '1000',
      DATABASE_URL:
        process.env.E2E_DATABASE_URL ??
        'postgresql://meydan:meydan@127.0.0.1:5432/meydan?sslmode=disable',
    },
  },
});
