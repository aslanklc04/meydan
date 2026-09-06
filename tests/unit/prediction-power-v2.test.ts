import { describe, expect, it } from 'vitest';
import {
  applyResolvedPrediction,
  computePredictionPower,
  emptyCounters,
  experience,
  skillMix,
  type RatingCounters,
} from '../../src/server/modules/reputation/domain/prediction-power';
import { rating } from '../../src/config';

/**
 * TAHMİN GÜCÜ — SÜRÜM 2 REGRESYON PAKETİ (Faz 6).
 *
 * Bu dosyanın tek amacı şu değişmezi korumaktır:
 *
 *   YANLIŞ BİR SONUÇ TAHMİN GÜCÜNÜ ASLA YÜKSELTMEZ.
 *   DOĞRU BİR SONUÇ TAHMİN GÜCÜNÜ ASLA DÜŞÜRMEZ.
 *
 * Sürüm 1'de bu değişmez iki bölgede ihlal ediliyordu (bkz. domain dosyasının
 * başlığı ve ADR-30). Aşağıdaki testler örnek seçmez; belirtilen aralıktaki
 * TÜM dizileri üretip her adımı denetler.
 */

/** Bir doğru/yanlış dizisini sayaçlara uygular. */
function play(sequence: readonly boolean[], weight = 0.5): RatingCounters {
  let counters = emptyCounters;
  for (const wasCorrect of sequence) {
    counters = applyResolvedPrediction(counters, { wasCorrect, weight });
  }
  return counters;
}

const power = (counters: RatingCounters) => computePredictionPower(counters).power;

// ═══════════════════════════════════════════════════════════════════════════
describe('DEĞİŞMEZ — sonucun yönü puanın yönünü belirler', () => {
  it('İLK tahmin yanlışsa puan DÜŞER (sürüm 1 regresyonu)', () => {
    const start = power(emptyCounters);
    const after = power(play([false]));

    // Sürüm 1'de bu değer ~+0,02 artıyordu. Artık kesin olarak düşer.
    expect(after).toBeLessThan(start);
  });

  it('İLK tahmin doğruysa puan ARTAR', () => {
    expect(power(play([true]))).toBeGreaterThan(power(emptyCounters));
  });

  it('her uzunlukta ve her dizide yanlış sonuç puanı yükseltmez', () => {
    // 12 uzunluğa kadar TÜM diziler: 2^13 − 1 = 8191 adım denetlenir.
    const violations: string[] = [];

    const walk = (counters: RatingCounters, path: string) => {
      if (path.length >= 12) return;
      const before = power(counters);

      for (const wasCorrect of [true, false]) {
        const next = applyResolvedPrediction(counters, { wasCorrect, weight: 0.5 });
        const after = power(next);
        const nextPath = path + (wasCorrect ? 'D' : 'Y');

        if (!wasCorrect && after > before) {
          violations.push(`${nextPath}: ${before} → ${after}`);
        }
        if (wasCorrect && after < before) {
          violations.push(`${nextPath}: ${before} → ${after}`);
        }
        walk(next, nextPath);
      }
    };

    walk(emptyCounters, '');
    expect(violations).toEqual([]);
  });

  it('UZUN kuyrukta da bozulmaz — 120 tahmine kadar üç uç desen', () => {
    const patterns: Record<string, (i: number) => boolean> = {
      'hep doğru': () => true,
      'hep yanlış': () => false,
      'bir doğru bir yanlış': (i) => i % 2 === 0,
    };

    for (const [name, decide] of Object.entries(patterns)) {
      let counters = emptyCounters;
      for (let i = 0; i < 120; i += 1) {
        const before = power(counters);
        const wasCorrect = decide(i);
        counters = applyResolvedPrediction(counters, { wasCorrect, weight: 0.5 });
        const after = power(counters);

        if (wasCorrect) {
          expect(after, `${name} · adım ${i}`).toBeGreaterThanOrEqual(before);
        } else {
          expect(after, `${name} · adım ${i}`).toBeLessThanOrEqual(before);
        }
      }
    }
  });

  it('zorluk ağırlığından bağımsız olarak değişmez korunur', () => {
    // Ağırlık uçları: neredeyse sıfır (ezici favori) ve tam 1 (kimsenin
    // beklemediği sonuç). İkisinde de yön kuralı bozulmamalı.
    for (const weight of [rating.minWeight, 0.5, 1]) {
      let counters = emptyCounters;
      for (let i = 0; i < 40; i += 1) {
        const before = power(counters);
        const wasCorrect = i % 3 === 0;
        counters = applyResolvedPrediction(counters, { wasCorrect, weight });
        const after = power(counters);
        if (wasCorrect) expect(after, `w=${weight} adım ${i}`).toBeGreaterThanOrEqual(before);
        else expect(after, `w=${weight} adım ${i}`).toBeLessThanOrEqual(before);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('TALEP EDİLEN SENARYO MATRİSİ', () => {
  /** Talimattaki senaryoların tam listesi, beklenen davranışlarıyla. */
  const cases: { name: string; seq: boolean[]; expect: (p: number) => void }[] = [
    {
      name: '0/0 — yeni kullanıcı',
      seq: [],
      expect: (p) => expect(p).toBe(rating.coldStartPower),
    },
    {
      name: '1/1 — tek doğru',
      seq: [true],
      expect: (p) => {
        expect(p).toBeGreaterThan(rating.coldStartPower);
        // Tek tahmin, kanıt sayılmaz: sapma küçük kalmalı.
        expect(p - rating.coldStartPower).toBeLessThan(2);
      },
    },
    {
      name: '0/1 — tek yanlış',
      seq: [false],
      expect: (p) => {
        expect(p).toBeLessThan(rating.coldStartPower);
        expect(rating.coldStartPower - p).toBeLessThan(2);
      },
    },
    { name: '1/2', seq: [true, false], expect: (p) => expect(p).toBeLessThan(51) },
    { name: '2/2', seq: [true, true], expect: (p) => expect(p).toBeGreaterThan(50) },
    { name: '2/3', seq: [true, true, false], expect: (p) => expect(p).toBeGreaterThan(50) },
    {
      name: '8/10',
      seq: [...Array(8).fill(true), ...Array(2).fill(false)],
      expect: (p) => {
        expect(p).toBeGreaterThan(50);
        expect(p).toBeLessThan(70);
      },
    },
    {
      name: '80/100',
      seq: [...Array(80).fill(true), ...Array(20).fill(false)],
      expect: (p) => {
        expect(p).toBeGreaterThan(65);
        expect(p).toBeLessThan(90);
      },
    },
  ];

  for (const c of cases) {
    it(c.name, () => c.expect(power(play(c.seq))));
  }

  it('KÜÇÜK ÖRNEKLEM asla BÜYÜK ÖRNEKLEMİ geçemez — algoritmanın var oluş nedeni', () => {
    const kucuk = play([true, true]); // ham %100
    const buyuk = play([...Array(80).fill(true), ...Array(20).fill(false)]); // ham %80
    expect(power(kucuk)).toBeLessThan(power(buyuk));
  });

  it('SIRA önemli değildir — aynı sonuç kümesi, yalnızca form farkı kadar oynar', () => {
    const dyd = power(play([true, false, true]));
    const ydy = power(play([false, true, false]));
    // İki dizide de doğru sayısı farklı; asıl beklenti 2 doğrunun 1 doğrudan
    // yüksek olmasıdır.
    expect(dyd).toBeGreaterThan(ydy);

    // Aynı doğru sayısıyla sıralama yalnızca formdan gelir ve KÜÇÜK kalır.
    const a = power(play([true, false]));
    const b = power(play([false, true]));
    expect(Math.abs(a - b)).toBeLessThan(1);
  });

  it('art arda doğru tahminler puanı monoton yükseltir', () => {
    let counters = emptyCounters;
    let previous = power(counters);
    for (let i = 0; i < 30; i += 1) {
      counters = applyResolvedPrediction(counters, { wasCorrect: true, weight: 0.5 });
      const current = power(counters);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it('art arda yanlış tahminler puanı monoton düşürür', () => {
    let counters = emptyCounters;
    let previous = power(counters);
    for (let i = 0; i < 30; i += 1) {
      counters = applyResolvedPrediction(counters, { wasCorrect: false, weight: 0.5 });
      const current = power(counters);
      expect(current).toBeLessThan(previous);
      previous = current;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('HACİM TEK BAŞINA PUAN KAZANDIRMAZ', () => {
  it('ortalama beceriye sahip kullanıcı kaç tahmin yaparsa yapsın 50 civarında kalır', () => {
    // Yarısı doğru: gerçek becerisi tam ortalama. Kanıt arttıkça puan
    // ortalamaya YAKINSAR, yukarı kaçmaz.
    let counters = emptyCounters;
    for (let i = 0; i < 200; i += 1) {
      counters = applyResolvedPrediction(counters, { wasCorrect: i % 2 === 0, weight: 0.5 });
    }
    expect(power(counters)).toBeGreaterThan(47);
    expect(power(counters)).toBeLessThan(53);
  });

  it('deneyim hedefte doyar; sonrasında hacmin etkisi kalmaz', () => {
    expect(experience(rating.experienceTarget)).toBeCloseTo(1, 10);
    expect(experience(rating.experienceTarget * 5)).toBe(1);
  });

  it('güven kapısı, sapmayı örneklemle orantılı büyütür', () => {
    // Aynı beceri (hep doğru), farklı örneklem: sapma büyümeli.
    const az = power(play(Array(3).fill(true)));
    const orta = power(play(Array(30).fill(true)));
    const cok = power(play(Array(120).fill(true)));
    expect(az).toBeLessThan(orta);
    expect(orta).toBeLessThan(cok);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('sınırlar ve bileşen ayrımı', () => {
  it('puan her koşulda 0–100 arasındadır', () => {
    expect(power(play(Array(500).fill(true), 1))).toBeLessThanOrEqual(100);
    expect(power(play(Array(500).fill(false), 1))).toBeGreaterThanOrEqual(0);
  });

  it('beceri karışımı nötrde tam 0,5 verir', () => {
    expect(skillMix({ accuracy: 0.5, difficulty: 0.5, form: 0.5 })).toBeCloseTo(0.5, 12);
  });

  it('beceri karışımı ağırlık oranlarını korur (40 : 25 : 15)', () => {
    const onlyAccuracy = skillMix({ accuracy: 1, difficulty: 0, form: 0 });
    const onlyDifficulty = skillMix({ accuracy: 0, difficulty: 1, form: 0 });
    const onlyForm = skillMix({ accuracy: 0, difficulty: 0, form: 1 });

    expect(onlyAccuracy + onlyDifficulty + onlyForm).toBeCloseTo(1, 12);
    expect(onlyAccuracy / onlyDifficulty).toBeCloseTo(0.4 / 0.25, 10);
    expect(onlyDifficulty / onlyForm).toBeCloseTo(0.25 / 0.15, 10);
  });

  it('breakdown bileşenleri birbirine KARIŞMAZ', () => {
    // Zorluk ağırlıkları farklı verilir: sabit 0,5 ağırlıkta doğruluk ile
    // zorluk sayısal olarak ÇAKIŞIR ve test hiçbir şey kanıtlamaz.
    let counters = emptyCounters;
    counters = applyResolvedPrediction(counters, { wasCorrect: true, weight: 0.9 });
    counters = applyResolvedPrediction(counters, { wasCorrect: true, weight: 0.2 });
    counters = applyResolvedPrediction(counters, { wasCorrect: false, weight: 0.7 });

    const { breakdown } = computePredictionPower(counters);
    expect(breakdown.accuracy).not.toBeCloseTo(breakdown.difficulty, 6);
    expect(breakdown.experience).toBeGreaterThan(0);
    expect(breakdown.form).toBeGreaterThan(0);
    expect(breakdown.form).toBeLessThan(1);
  });

  it('kategori istatistiği GENEL istatistikle aynı fonksiyondan geçer ama AYRI sayaçtır', () => {
    // Aynı algoritma, farklı sayaç: kategori uzmanlığı genel puanı
    // etkilemez, genel puan da kategoriyi etkilemez.
    const genel = play([true, true, true, false, false]);
    const kategori = play([true, true]);
    expect(power(genel)).not.toBeCloseTo(power(kategori), 3);
  });
});
