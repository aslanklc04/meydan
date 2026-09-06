import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Vite 8+ tsconfig "paths" çözümlemesini yerel olarak destekler (@/* → src/*).
    tsconfigPaths: true,
  },
  test: {
    env: {
      SKIP_ENV_VALIDATION: '1',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://meydan:meydan@127.0.0.1:5432/meydan_test?sslmode=disable',
    },
    /** Entegrasyon testleri aynı veritabanına yazar; dosyalar sırayla çalışır. */
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/server/modules/**/domain/**', 'src/config/**', 'src/lib/**'],
      // Faz 18'de domain katmanı için %90 satır kapsamı eşiği devreye alınır.
    },
  },
});
