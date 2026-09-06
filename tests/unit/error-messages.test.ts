import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  AuthorizationError,
  InternalError,
  NotFoundError,
  RateLimitError,
} from '../../src/server/errors';

/**
 * KULLANICIYA GÖRÜNEN METİN DENETİMİ — Faz 5, kural 18 ve 19.
 *
 * Bu test bir stil tercihini değil, bir ÜRÜN KURALINI zorlar: kullanıcı hiçbir
 * koşulda teknik terim, kısıt adı, veritabanı hatası veya yığın izi görmez.
 *
 * Yöntem: kaynak dosyalardaki STRING SABİTLERİ taranır. Yalnızca dizeler
 * taranır çünkü açıklama satırları ve tanımlayıcı adları (`isUniqueViolation`
 * gibi) kullanıcıya gösterilmez — Faz 4'te bu ayrım yapılmadığı için test
 * kendi açıklamalarını yakalıyordu.
 */

const SRC = join(process.cwd(), 'src');

/** Kullanıcıya gösterilen bir metinde ASLA geçmemesi gereken kalıplar. */
const FORBIDDEN = [
  'DrizzleError',
  'PostgresError',
  'Neon',
  'stack trace',
  'undefined',
  'null pointer',
  'Internal Server Error',
  '500 ',
  'ECONNREFUSED',
  'constraint',
  'violation',
  'violates',
  'uuid',
  'UUID',
  'eventId',
  'userId',
  'challengeId',
  'outcomeId',
];

/** Bu dosyalar teknik: kullanıcıya metin göstermezler. */
const SKIP = ['/server/db/', '/server/observability/', 'schema/', '.test.'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : [];
  });
}

/** Kaynaktaki tek ve çift tırnaklı dize sabitleri (şablon dizeleri dâhil). */
function stringLiterals(source: string): string[] {
  const matches = source.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g);
  return matches ?? [];
}

describe('kullanıcıya görünen metinler', () => {
  const files = walk(SRC).filter((f) => !SKIP.some((s) => f.includes(s)));

  it('kaynak taraması dosya buluyor (testin kendisi anlamlı mı?)', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('hiçbir kullanıcı metni teknik terim içermez', () => {
    const problems: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const literal of stringLiterals(source)) {
        // İçerideki `${...}` ifadeleri KOD'dur, kullanıcı metni değil:
        // `@${user.userId}` yazan bir şablonda kullanıcı yalnızca "@" görür.
        // Bu yüzden interpolasyonlar taramadan önce ayıklanır.
        const text = literal.slice(1, -1).replace(/\$\{[^}]*\}/g, '…');

        // Ham SQL şablonları da kullanıcıya gitmez.
        if (/\b(SELECT|UPDATE|INSERT|DELETE|FROM|WHERE|COUNT|FILTER|JOIN)\b/.test(text)) continue;

        // Yalnızca CÜMLE gibi görünen dizeler kullanıcıya gidebilir:
        // en az üç kelimelik olanlar. `'/app/feed'` gibi yollar ve
        // `'CHALLENGE_RECEIVED'` gibi anahtarlar elenir.
        if (text.split(/\s+/).filter(Boolean).length < 3) continue;
        if (text.startsWith('/') || text.startsWith('http')) continue;

        for (const term of FORBIDDEN) {
          if (text.includes(term)) {
            problems.push(`${file.replace(SRC, 'src')}: "${text.slice(0, 80)}" → ${term}`);
          }
        }
      }
    }

    expect(problems).toEqual([]);
  });
});

describe('hata sınıflarının varsayılan mesajları', () => {
  const messages = [
    new AuthenticationError().message,
    new AuthorizationError().message,
    new NotFoundError().message,
    new RateLimitError(30).message,
    new InternalError().message,
  ];

  it('hepsi Türkçedir ve nokta ile biter', () => {
    for (const m of messages) {
      expect(m.length).toBeGreaterThan(10);
      expect(m.endsWith('.')).toBe(true);
    }
  });

  it('hiçbiri teknik terim ya da hata kodu içermez', () => {
    for (const m of messages) {
      expect(m).not.toMatch(/error|exception|[0-9]{3}|null|undefined/i);
    }
  });

  it('beklenmeyen hata mesajı kullanıcıya NE YAPACAĞINI söyler', () => {
    // "Bir hata oluştu." tek başına çıkmaz sokak; kullanıcı ekranda kalakalır.
    expect(new InternalError().message).toMatch(/tekrar dene/i);
  });
});
