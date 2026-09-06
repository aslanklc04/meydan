import { describe, expect, it } from 'vitest';
import {
  adjustedAccuracy,
  applyResolvedPrediction,
  computePredictionPower,
  difficultyWeight,
  emptyCounters,
  experience,
  formComponent,
  nextForm,
  rawAccuracy,
  weightedDifficulty,
  type RatingCounters,
} from '../../src/server/modules/reputation/domain/prediction-power';
import { rating } from '../../src/config';
import {
  pickCounterOutcome,
  supportsChallenge,
} from '../../src/server/modules/challenge/domain/counter-outcome';

/** Tahmin Gücü — Spesifikasyon Bölüm 6. */

describe('bileşenler', () => {
  it('Bayesian doğruluk kanıt yokken 0,5 verir', () => {
    expect(adjustedAccuracy(0, 0)).toBeCloseTo(0.5, 10);
  });

  it('prior küçük örneklemde baskın, büyük örneklemde ihmal edilebilir', () => {
    // 2/2 → ham %100 ama düzeltilmiş yalnızca 0,583
    expect(adjustedAccuracy(2, 2)).toBeCloseTo(7 / 12, 5);
    // 500/500 → prior neredeyse etkisiz
    expect(adjustedAccuracy(500, 500)).toBeGreaterThan(0.98);
  });

  it('deneyim logaritmik doyar ve hedefte tavan yapar', () => {
    expect(experience(0)).toBe(0);
    expect(experience(rating.experienceTarget)).toBeCloseTo(1, 10);
    expect(experience(rating.experienceTarget * 10)).toBe(1);
    // İlk tahminler en çok katkıyı verir
    expect(experience(20) - experience(0)).toBeGreaterThan(experience(100) - experience(80));
  });

  it('form az örneklemle sıçramaz', () => {
    // Tek doğru tahminden sonra form neredeyse nötr kalır
    expect(formComponent(1, 1)).toBeCloseTo(0.55, 5);
    // Yeterli örneklemle tam etki
    expect(formComponent(1, 20)).toBeCloseTo(1, 5);
  });

  it('EWMA yarı ömrü config ile tutarlı', () => {
    let form = 0.5;
    for (let i = 0; i < rating.formHalfLife; i += 1) form = nextForm(form, true);
    expect(form).toBeGreaterThan(0.5);
    expect(form).toBeLessThan(1);
  });

  it('zorluk ağırlığı: kalabalığa karşı çağrı daha değerli', () => {
    const many = 50;
    expect(difficultyWeight(0.9, many)).toBeCloseTo(0.1, 5); // ezici favori
    expect(difficultyWeight(0.5, many)).toBeCloseTo(0.5, 5); // dengeli
    expect(difficultyWeight(0.2, many)).toBeCloseTo(0.8, 5); // kalabalığa karşı
  });

  it('zorluk ağırlığının tabanı vardır — sıfır katkı olmaz', () => {
    expect(difficultyWeight(1, 50)).toBe(rating.minWeight);
  });

  it('az katılımlı etkinlikte zorluk NÖTR olur — sömürü kapalı', () => {
    // 5 kişilik etkinlikte dağılım gürültüdür
    expect(difficultyWeight(0.05, 5)).toBe(0.5);
    expect(difficultyWeight(null, 100)).toBe(0.5);
  });

  it('ham başarı yüzdesi Tahmin Gücünden ayrıdır', () => {
    expect(rawAccuracy(186, 257)).toBeCloseTo(0.7237, 4);
    expect(rawAccuracy(0, 0)).toBe(0);
  });
});

describe('soğuk başlangıç', () => {
  it('yeni kullanıcı config ile aynı skoru alır', () => {
    const result = computePredictionPower(emptyCounters);
    expect(result.power).toBeCloseTo(rating.coldStartPower, 3);
  });

  it('bileşenler nötr başlar', () => {
    const { breakdown } = computePredictionPower(emptyCounters);
    expect(breakdown.accuracy).toBeCloseTo(0.5, 5);
    expect(breakdown.difficulty).toBeCloseTo(0.5, 5);
    // Deneyim bir GÜVEN KAPISIDIR: kanıt yokken kapı kapalıdır (0).
    expect(breakdown.experience).toBe(0);
    expect(breakdown.form).toBeCloseTo(0.5, 5);
  });
});

describe('ÇALIŞILMIŞ ÖRNEK — algoritmanın var oluş nedeni', () => {
  // Kullanıcı A: 2 tahminden 2'si doğru (ham %100)
  const userA: RatingCounters = {
    total: 2,
    correct: 2,
    weightSum: 0.6,
    weightedCorrectSum: 0.6,
    form: 0.53,
    recentCount: 2,
  };

  // Kullanıcı B: 100 tahminden 80'i doğru (ham %80)
  const userB: RatingCounters = {
    total: 100,
    correct: 80,
    weightSum: 45,
    weightedCorrectSum: 35.1,
    form: 0.84,
    recentCount: 100,
  };

  it('%100 doğrulukla 2 tahmin yapan, %80 ile 100 tahmin yapanın ALTINDA kalır', () => {
    const a = computePredictionPower(userA);
    const b = computePredictionPower(userB);

    // Ham oran sıralaması (100% > 80%) TERSİNE döner
    expect(rawAccuracy(userA.correct, userA.total)).toBeGreaterThan(
      rawAccuracy(userB.correct, userB.total),
    );
    expect(a.power).toBeLessThan(b.power);
  });

  it('beklenen bantlarda kalır', () => {
    // Sürüm 2 bantları: az örneklemli kullanıcı nötre yakın durur, çok
    // örneklemli kullanıcı gerçek becerisine açılır.
    expect(computePredictionPower(userA).power).toBeGreaterThan(50);
    expect(computePredictionPower(userA).power).toBeLessThan(60);
    expect(computePredictionPower(userB).power).toBeGreaterThan(70);
    expect(computePredictionPower(userB).power).toBeLessThan(95);
  });
});

describe('güncelleme mekaniği', () => {
  it('doğru tahmin skoru yükseltir', () => {
    const before = computePredictionPower(emptyCounters).power;
    const after = computePredictionPower(
      applyResolvedPrediction(emptyCounters, { wasCorrect: true, weight: 0.5 }),
    ).power;
    expect(after).toBeGreaterThan(before);
  });

  it('doğru bilen her zaman yanılandan yukarıda olur', () => {
    const correct = applyResolvedPrediction(emptyCounters, { wasCorrect: true, weight: 0.5 });
    const wrong = applyResolvedPrediction(emptyCounters, { wasCorrect: false, weight: 0.5 });
    expect(computePredictionPower(correct).power).toBeGreaterThan(
      computePredictionPower(wrong).power,
    );
  });

  /**
   * FAZ 6'DA DÜZELTİLDİ (sürüm 2 · ADR-30).
   *
   * Sürüm 1'de deneyim bileşeni puana DOĞRUDAN eklendiği için ilk tahminde
   * 0 → 0,150'lik sıçraması doğruluk kaybını baskılıyor ve kullanıcının İLK
   * tahmini yanlış olsa bile skoru ~0,02 puan ARTIYORDU.
   *
   * Sürüm 2'de deneyim bir güven kapısıdır; puan ekleyemez. Bu test artık
   * düzeltilmiş davranışı kilitler. Tüm dizilerdeki tüketici doğrulama
   * `prediction-power-v2.test.ts` içindedir.
   */
  it('ilk yanlış tahmin skoru DÜŞÜRÜR (sürüm 1 regresyonu kapatıldı)', () => {
    const wrong = applyResolvedPrediction(emptyCounters, { wasCorrect: false, weight: 0.5 });
    const power = computePredictionPower(wrong).power;
    expect(power).toBeLessThan(rating.coldStartPower);
  });

  it('üst üste yanlışlar skoru düşürür', () => {
    let counters = emptyCounters;
    for (let i = 0; i < 10; i += 1) {
      counters = applyResolvedPrediction(counters, { wasCorrect: false, weight: 0.5 });
    }
    expect(computePredictionPower(counters).power).toBeLessThan(rating.coldStartPower);
  });

  it('skor 0–100 aralığının dışına çıkamaz', () => {
    let perfect = emptyCounters;
    for (let i = 0; i < 300; i += 1) {
      perfect = applyResolvedPrediction(perfect, { wasCorrect: true, weight: 1 });
    }
    const p = computePredictionPower(perfect).power;
    expect(p).toBeLessThanOrEqual(100);
    expect(p).toBeGreaterThanOrEqual(0);
  });

  it('zorluk toplamları doğru birikir', () => {
    const c1 = applyResolvedPrediction(emptyCounters, { wasCorrect: true, weight: 0.8 });
    const c2 = applyResolvedPrediction(c1, { wasCorrect: false, weight: 0.3 });
    expect(c2.total).toBe(2);
    expect(c2.correct).toBe(1);
    expect(c2.weightSum).toBeCloseTo(1.1, 5);
    expect(c2.weightedCorrectSum).toBeCloseTo(0.8, 5);
  });

  it('zorluk bileşeni kalabalığa karşı doğruyu ödüllendirir', () => {
    const hard = applyResolvedPrediction(emptyCounters, { wasCorrect: true, weight: 0.9 });
    const easy = applyResolvedPrediction(emptyCounters, { wasCorrect: true, weight: 0.1 });
    expect(weightedDifficulty(hard.weightSum, hard.weightedCorrectSum)).toBeGreaterThan(
      weightedDifficulty(easy.weightSum, easy.weightedCorrectSum),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('ADR-18 — karşı sonucun deterministik atanması', () => {
  const gsFbDraw = [
    { id: 'gs', sortOrder: 0 },
    { id: 'fb', sortOrder: 1 },
    { id: 'draw', sortOrder: 2 },
  ];

  it('Galatasaray seçilirse karşı taraf Fenerbahçe olur', () => {
    expect(pickCounterOutcome(gsFbDraw, 'gs')?.id).toBe('fb');
  });

  it('Fenerbahçe seçilirse karşı taraf Galatasaray olur', () => {
    expect(pickCounterOutcome(gsFbDraw, 'fb')?.id).toBe('gs');
  });

  it('Beraberlik seçilirse ilk sıradaki sonuç karşı taraf olur', () => {
    expect(pickCounterOutcome(gsFbDraw, 'draw')?.id).toBe('gs');
  });

  it('atama DETERMİNİSTİKTİR — sıralama karışsa da aynı sonucu verir', () => {
    const shuffled = [...gsFbDraw].reverse();
    expect(pickCounterOutcome(shuffled, 'gs')?.id).toBe('fb');
  });

  it('karşı taraf asla oluşturanın seçimi olamaz', () => {
    for (const outcome of gsFbDraw) {
      expect(pickCounterOutcome(gsFbDraw, outcome.id)?.id).not.toBe(outcome.id);
    }
  });

  it('iki sonuçlu etkinlikte karşı taraf tek olasılıktır', () => {
    const binary = [
      { id: 'up', sortOrder: 0 },
      { id: 'down', sortOrder: 1 },
    ];
    expect(pickCounterOutcome(binary, 'up')?.id).toBe('down');
    expect(pickCounterOutcome(binary, 'down')?.id).toBe('up');
  });

  it('tek sonuçlu etkinlikte Meydan Okuma açılamaz', () => {
    const single = [{ id: 'only', sortOrder: 0 }];
    expect(supportsChallenge(single)).toBe(false);
    expect(pickCounterOutcome(single, 'only')).toBeNull();
  });
});
