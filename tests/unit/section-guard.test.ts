import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { bolum } from '../../src/server/observability/section';

/**
 * BÖLÜM KORUMASI.
 *
 * ── NEDEN BU TEST VAR ──────────────────────────────────────────────────────
 * Canlıda tek bir bölümdeki tek bir tarih hatası SİTENİN ÖN KAPISINI kapattı:
 * ana sayfa hiç açılmadı, sunucu 500 döndürdü. Hatanın kendisi küçüktü;
 * cezası orantısızdı.
 *
 * Buradaki testler o orantısızlığın geri gelmemesini korur.
 */

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('bolum()', () => {
  it('başarılı sorguda değeri aynen döner', async () => {
    await expect(bolum('deneme', async () => [1, 2, 3], [])).resolves.toEqual([1, 2, 3]);
  });

  it('sorgu PATLARSA yedek değeri döner — sayfa düşmez', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      bolum(
        'deneme',
        async () => {
          throw new Error('bilerek');
        },
        [],
      ),
    ).resolves.toEqual([]);
    spy.mockRestore();
  });

  it('hatayı YUTMAZ — günlüğe yazar', async () => {
    /*
     * "Hata olursa boş dön" kuralı, sebebi kaydedilmediğinde bir hatayı
     * kalıcı olarak görünmez yapar. Asıl tehlikeli olan budur.
     */
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await bolum(
      'raf_tuttu',
      async () => {
        throw new Error('bilerek');
      },
      [],
    );
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.[0])).toContain('raf_tuttu');
    spy.mockRestore();
  });
});

describe('ana sayfanın her bölümü korunuyor', () => {
  const home = codeOnly('src/app/page.tsx');

  it('hiçbir sorgu korumasız çağrılmıyor', () => {
    for (const cagri of [
      'featuredService.today()',
      'consensusService.view(',
      'consensusService.outcomesOf(',
      'catalogService.listOpenEvents(',
      'gazetteService.shelfToday()',
      'gazetteService.shelfResolvingToday()',
      'gazetteService.shelfHits(',
      'catalogService.resultsBoard(',
    ]) {
      const i = home.indexOf(cagri);
      expect(i, `${cagri} sayfada bulunamadı`).toBeGreaterThan(-1);
      // Çağrının hemen öncesinde `bolum(` geçmeli.
      expect(home.slice(Math.max(0, i - 120), i), `${cagri} korumasız`).toContain('bolum(');
    }
  });
});

describe('akış ekranının bölümleri korunuyor', () => {
  const feed = codeOnly('src/app/(app)/app/feed/page.tsx');

  it('liste sorguları korumalı', () => {
    for (const cagri of [
      'catalogService.listOpenEvents(',
      'challengeService.listIncoming(',
      'challengeService.listOpen(',
      'socialService.feed(',
      'gazetteService.eligible(',
      'predictionService.recentResults(',
      'catalogService.resultsBoard(',
    ]) {
      const i = feed.indexOf(cagri);
      expect(i, `${cagri} akışta bulunamadı`).toBeGreaterThan(-1);
      expect(feed.slice(Math.max(0, i - 140), i), `${cagri} korumasız`).toContain('bolum(');
    }
  });
});

describe('ana sayfanın kendi hata sınırı var', () => {
  it('kök hata sınırı dosyası duruyor', () => {
    /*
     * Ana sayfa hiçbir hata sınırının altında değildi; hata doğrudan
     * `global-error`'a düşüyor ve ziyaretçi tasarımsız bir ekran görüyordu.
     */
    const err = read('src/app/error.tsx');
    expect(err).toContain('ErrorScreen');
    expect(err).toContain("'use client'");
  });
});
