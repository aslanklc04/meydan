import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * Katman sınırları — Spesifikasyon Bölüm 3.2.
 *
 * Bu kurallar mimarinin belgede kalmasını değil, kodda zorlanmasını sağlar.
 * Sınır ihlali bir lint hatasıdır; CI'da build'i kırar.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores(['.next/**', 'out/**', 'build/**', 'coverage/**', 'next-env.d.ts']),

  // --- Genel kurallar -------------------------------------------------------
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // --- KURAL 1: UI katmanı repository'ye doğrudan erişemez -------------------
  // UI'nin veritabanına doğrudan erişimi transaction sınırlarını görünmez şekilde kırar.
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/server/modules/*/*.repository', '@/server/modules/**/repository*'],
              message: 'UI katmanı repository çağıramaz. Use-case servisini (service.ts) kullanın.',
            },
            {
              group: ['@/server/db', '@/server/db/*'],
              message: 'UI katmanı veritabanı istemcisini doğrudan kullanamaz.',
            },
            {
              group: ['@prisma/client'],
              message: 'Prisma yalnızca server/modules ve server/db içinde kullanılır.',
            },
          ],
        },
      ],
    },
  },

  // --- KURAL 2: bir modül başka modülün repository'sini import edemez --------
  // Kendi repository'si göreli yolla (./repository) çağrılır; alias ile başka
  // modülün repository'sine erişim modül sınırını kırar.
  //
  // NOT: bu blok domain bloğundan ÖNCE gelmelidir. Flat config'te aynı kuralı
  // tanımlayan sonraki blok öncekini geçersiz kılar; domain dosyaları her iki
  // desene de uyduğu için sıralama davranışı belirler.
  {
    files: ['src/server/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/server/modules/*/repository', '@/server/modules/*/*.repository'],
              message: 'Modüller arası erişim yalnızca service arayüzü üzerinden yapılır.',
            },
          ],
        },
      ],
    },
  },

  // --- KURAL 3: domain katmanı saftır, I/O bağımlılığı olamaz ----------------
  // Rating ve ekonomi kuralları veritabanı olmadan test edilebilmelidir.
  // Kural 2'nin desenlerini de içerir, çünkü bu blok onu geçersiz kılar.
  {
    files: ['src/server/modules/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@prisma/client',
                '@/server/db',
                '@/server/db/*',
                '@/server/security/*',
                '@/config/env',
                'redis',
                'ioredis',
                'next',
                'next/*',
                'react',
              ],
              message:
                'Domain katmanı saftır: I/O, framework veya veritabanı bağımlılığı içeremez.',
            },
            {
              group: ['@/server/modules/*/repository', '@/server/modules/*/*.repository'],
              message: 'Modüller arası erişim yalnızca service arayüzü üzerinden yapılır.',
            },
          ],
        },
      ],
    },
  },

  // --- KURAL 4: sunucu sırları istemci paketine sızamaz ---------------------
  {
    files: ['src/components/**/*.tsx', 'src/features/**/components/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/config/env'],
              message:
                'Sunucu ortam değişkenleri istemci bileşenlerine import edilemez. clientEnv kullanın.',
            },
          ],
        },
      ],
    },
  },

  // --- Test dosyalarında gevşetme ------------------------------------------
  {
    files: ['tests/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
]);

export default eslintConfig;
