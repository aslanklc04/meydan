import { describe, expect, it } from 'vitest';
import { economy, isStakeAllowed } from '../../src/config/economy';
import { rating, formLambda } from '../../src/config/rating';
import { expertise } from '../../src/config/expertise';
import { rateLimits, reservedUsernames } from '../../src/config/limits';
import { financialDisclaimer } from '../../src/config/brand';

describe('rating config', () => {
  it('bileşen ağırlıklarının toplamı 1.0', () => {
    const { accuracy, difficulty, experience, form } = rating.weights;
    expect(accuracy + difficulty + experience + form).toBeCloseTo(1, 10);
  });

  it('spesifikasyondaki ağırlık dağılımını korur', () => {
    expect(rating.weights.accuracy).toBe(0.4);
    expect(rating.weights.difficulty).toBe(0.25);
    expect(rating.weights.experience).toBe(0.2);
    expect(rating.weights.form).toBe(0.15);
  });

  it('prior ortalaması 0,5 — kanıt yokken kullanıcı ortalama tahminci sayılır', () => {
    const mean = rating.prior.alpha / (rating.prior.alpha + rating.prior.beta);
    expect(mean).toBe(0.5);
  });

  it('soğuk başlangıç skoru formülle tutarlı (sürüm 2)', () => {
    // Sürüm 2: PP = 100 × [0,5 + Ê·(S − 0,5)].
    // Kanıt yokken Ê = 0 olduğu için beceri karışımı ne olursa olsun puan
    // tam nötr noktadadır.
    const skillMixNeutral = 0.5;
    const confidence = 0;
    const cold = 100 * (0.5 + confidence * (skillMixNeutral - 0.5));
    expect(cold).toBeCloseTo(rating.coldStartPower, 6);
  });

  it('algoritma sürümü kayıt altındadır', () => {
    // Sürüm değişimi geçmişin yeniden hesaplanmasını gerektirir; sabitin
    // sessizce değişmediğinden emin olunur.
    expect(rating.algorithmVersion).toBe(2);
  });

  it('EWMA lambda yarı ömürden doğru türetilir', () => {
    // 20 adım sonra ağırlık yarıya inmeli
    expect(Math.pow(1 - formLambda, rating.formHalfLife)).toBeCloseTo(0.5, 10);
  });

  it('zorluk ağırlığı tabanı sıfırdan büyük', () => {
    expect(rating.minWeight).toBeGreaterThan(0);
    expect(rating.minWeight).toBeLessThan(0.5);
  });
});

describe('economy config', () => {
  it('tüm çip tutarları tam sayı', () => {
    expect(Number.isInteger(economy.initialGrant)).toBe(true);
    expect(Number.isInteger(economy.dailyReward)).toBe(true);
    expect(Number.isInteger(economy.minStake)).toBe(true);
    expect(Number.isInteger(economy.maxStake)).toBe(true);
  });

  it('stake aralığı tutarlı', () => {
    expect(economy.minStake).toBeGreaterThan(0);
    expect(economy.maxStake).toBeGreaterThan(economy.minStake);
  });

  it('bakiyeden fazla stake reddedilir', () => {
    expect(isStakeAllowed(100, 50)).toBe(false);
  });

  it('minimum altındaki stake reddedilir', () => {
    expect(isStakeAllowed(1, 1000)).toBe(false);
  });

  it('maksimum üstündeki stake reddedilir', () => {
    expect(isStakeAllowed(economy.maxStake + 1, 100000)).toBe(false);
  });

  it('ondalıklı stake reddedilir', () => {
    expect(isStakeAllowed(10.5, 1000)).toBe(false);
  });

  it('bakiye oranı tavanını aşan stake reddedilir', () => {
    // 1000 çipin %25'i = 250
    expect(isStakeAllowed(300, 1000)).toBe(false);
    expect(isStakeAllowed(250, 1000)).toBe(true);
  });

  it('geçerli stake kabul edilir', () => {
    expect(isStakeAllowed(10, 1000)).toBe(true);
  });
});

describe('expertise config', () => {
  it('uzmanlık eşiği anlamlı bir örneklem gerektirir', () => {
    // 2-3 tahminle uzman olunamaz — ürünün güvenilirliği buna bağlı
    expect(expertise.minCategoryPredictions).toBeGreaterThanOrEqual(30);
    expect(expertise.minCategoryPower).toBeGreaterThanOrEqual(75);
  });

  it('liderlik eşiği küçük örneklemi dışarıda bırakır', () => {
    expect(expertise.leaderboardMinPredictions).toBeGreaterThan(0);
    expect(expertise.leaderboardMinCategoryPredictions).toBeGreaterThan(0);
  });
});

describe('limits config', () => {
  it('her oran sınırı pozitif limit ve pencereye sahip', () => {
    for (const [action, rule] of Object.entries(rateLimits)) {
      expect(rule.limit, action).toBeGreaterThan(0);
      expect(rule.windowSec, action).toBeGreaterThan(0);
    }
  });

  it('kritik kimlik eylemleri sıkı sınırlı', () => {
    expect(rateLimits['auth.login'].limit).toBeLessThanOrEqual(5);
    expect(rateLimits['auth.register'].limit).toBeLessThanOrEqual(3);
  });

  it('route çakışması yaratacak kullanıcı adları rezerve', () => {
    for (const name of ['admin', 'api', 'system', 'support', 'u', 'login']) {
      expect(reservedUsernames).toContain(name);
    }
  });

  it('rezerve adlar küçük harf ve tekil', () => {
    expect(reservedUsernames.every((n) => n === n.toLowerCase())).toBe(true);
    expect(new Set(reservedUsernames).size).toBe(reservedUsernames.length);
  });
});

describe('finansal uyarı metni', () => {
  it('yatırım tavsiyesi olmadığını açıkça belirtir', () => {
    const full = financialDisclaimer.full.toLocaleLowerCase('tr-TR');
    const short = financialDisclaimer.short.toLocaleLowerCase('tr-TR');
    expect(full).toContain('yatırım tavsiyesi');
    expect(full).toContain('değildir');
    expect(short).toContain('yatırım tavsiyesi');
    expect(short).toContain('değildir');
  });

  it('garanti/kesin kazanç ifadesi içermez', () => {
    const forbidden = /garantili kazanç|kesin kazanç|kesin sonuç|kazandırır/i;
    expect(forbidden.test(financialDisclaimer.full)).toBe(false);
    expect(forbidden.test(financialDisclaimer.short)).toBe(false);
  });
});
