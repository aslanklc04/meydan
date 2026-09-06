import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Terminoloji koruması — Spesifikasyon Bölüm 3.3 ve 7.
 *
 * Ürün dilinde "rest", "rest çek", "restleşme" ifadeleri hiçbir katmanda
 * kullanılmaz: UI metni, kod, veritabanı enum'ları, analytics olay adları,
 * bildirim metinleri. Kullanılan ifadeler: Meydan Okuma / Meydan Oku /
 * Meydan Okumayı Kabul Et / Meydan Okumalarım / Sana Gelen Meydan Okumalar.
 *
 * Bu kuralı insan denetimine bırakmıyoruz: ihlal, CI'da build'i kırar.
 */

const SCAN_ROOTS = ['src', 'prisma'];
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.css', '.prisma', '.json', '.md']);
const IGNORED_DIRS = new Set(['node_modules', '.next', 'coverage', 'dist', '.git']);

/** Bu dosya kuralın kendisini tarif ettiği için taramadan muaftır. */
const EXEMPT_FILES = new Set(['tests/unit/terminology.test.ts']);

/**
 * Yasaklı ürün dili — ürün kuralı 31.
 *
 * İki grup:
 *   1. Kumar/argo kalıpları ("rest çek", "restleşme")
 *   2. Bahis dili ("bahis", "kupon", "oran") — MEYDAN bir bahis sitesi değildir
 *   3. Gerçek para mekanizmaları — MVP'de kesinlikle YOK (ürün kuralı 30)
 */
const FORBIDDEN_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /rest\s*çek/i, label: '"rest çek"' },
  { pattern: /restleş/i, label: '"restleşme"' },
  { pattern: /\brestler\b/i, label: '"restler"' },
  { pattern: /\brest['’]?[ie]\b/i, label: '"reste" / "rest\'i"' },
];

/**
 * Bahis dili — yalnızca KULLANICIYA GÖSTERİLEN metinlerde yasaktır.
 *
 * Yorumlarda "bahis sitesi gibi görünmemeli" demek serbesttir ve gereklidir;
 * asıl kural, bu kelimelerin arayüz metnine sızmamasıdır. Bu yüzden tarama
 * yalnızca dizge (string) literalleri üzerinde yapılır.
 */
const FORBIDDEN_IN_STRINGS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\bbahis/i, label: '"bahis"' },
  { pattern: /\bkupon/i, label: '"kupon"' },
  { pattern: /\bbahis\s*oran/i, label: '"bahis oranı"' },
  { pattern: /\bkumar/i, label: '"kumar"' },
];

/** Bir satırdaki dizge literallerini çıkarır. */
function stringLiterals(line: string): string[] {
  return [...line.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? '',
  );
}

/**
 * Gerçek para mekanizmaları — kodda İMPLEMENTE EDİLEMEZ (ürün kuralı 30).
 * Yorumlarda "yapılmayacak" biçiminde geçmesi serbesttir; bu yüzden yalnızca
 * tanımlayıcı/çağrı olarak kullanımları aranır.
 */
const FORBIDDEN_IDENTIFIERS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  {
    pattern:
      /\b(function|const|let|async)\s+\w*(deposit|withdraw|cashout|purchaseChips|buyCoins)\w*\s*[=(]/i,
    label: 'gerçek para fonksiyonu',
  },
  {
    pattern: /\b(deposit|withdrawal|cashOut|purchaseChips|buyCoins|chargeCard)\s*\(/i,
    label: 'gerçek para çağrısı',
  },
];

/**
 * Çıplak "rest" sözcüğü: yalnızca büyük harfli REST (API bağlamı) serbesttir.
 * `...rest` (JS rest parametresi) ve `foo.rest` gibi kullanımlar hariç tutulur.
 */
const BARE_TOKEN = /(?<![.\w'’])[Rr][Ee][Ss][Tt](?![\w'’])/g;

function collectFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectFiles(full, acc);
    } else if (SCAN_EXTENSIONS.has(extname(full))) {
      acc.push(full);
    }
  }
  return acc;
}

describe('ürün terminolojisi', () => {
  const files = SCAN_ROOTS.flatMap((root) => collectFiles(root)).filter(
    (f) => !EXEMPT_FILES.has(f.replaceAll('\\', '/')),
  );

  it('taranacak dosya bulur', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('yasaklı kumar/argo kalıpları içermez', () => {
    const violations: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const { pattern, label } of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            violations.push(`${file}:${index + 1} → ${label} :: ${line.trim()}`);
          }
        }
      });
    }

    expect(violations, `Yasaklı terim bulundu:\n${violations.join('\n')}`).toEqual([]);
  });

  it('çıplak "rest" sözcüğünü yalnızca REST (API) olarak kullanır', () => {
    const violations: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const match of line.matchAll(BARE_TOKEN)) {
          if (match[0] !== 'REST') {
            violations.push(`${file}:${index + 1} → "${match[0]}" :: ${line.trim()}`);
          }
        }
      });
    }

    expect(violations, `Küçük harfli "rest" kullanımı:\n${violations.join('\n')}`).toEqual([]);
  });

  it('kullanıcıya gösterilen metinlerde bahis dili kullanılmaz', () => {
    const violations: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const literal of stringLiterals(line)) {
          for (const { pattern, label } of FORBIDDEN_IN_STRINGS) {
            if (pattern.test(literal)) {
              violations.push(`${file}:${index + 1} → ${label} :: ${literal.trim()}`);
            }
          }
        }
      });
    }

    expect(violations, `Bahis dili bulundu:\n${violations.join('\n')}`).toEqual([]);
  });

  it('gerçek para mekanizması implemente edilmemiştir', () => {
    const violations: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const { pattern, label } of FORBIDDEN_IDENTIFIERS) {
          if (pattern.test(line)) {
            violations.push(`${file}:${index + 1} → ${label} :: ${line.trim()}`);
          }
        }
      });
    }

    expect(violations, `Gerçek para mekanizması bulundu:\n${violations.join('\n')}`).toEqual([]);
  });

  it('doğru ürün terimlerini tanımlar', async () => {
    const { brand } = await import('../../src/config/brand');
    expect(brand.challengeNoun).toBe('Meydan Okuma');
    expect(brand.challengeVerb).toBe('Meydan Oku');
    expect(brand.challengeAccept).toBe('Meydan Okumayı Kabul Et');
    expect(brand.challengeInbox).toBe('Sana Gelen Meydan Okumalar');
    expect(brand.currencyName).toBe('Gümüş Çip');
    expect(brand.ratingName).toBe('Tahmin Gücü');
  });

  it('kullanıcıya gösterilen etiketlerde teknik durum adı yoktur', async () => {
    const labels = await import('../../src/features/predictions/labels');
    const shown = [
      ...Object.values(labels.predictionStatusLabel),
      ...Object.values(labels.predictionResultLabel),
      ...Object.values(labels.challengeStatusLabel),
    ];

    // Ekranda ne 'PENDING' ne 'RESOLVED' ne de büyük harfli enum görünür
    for (const text of shown) {
      expect(text, `"${text}" teknik görünüyor`).not.toMatch(/^[A-Z_]+$/);
      expect(text.length).toBeGreaterThan(3);
    }
  });
});
