import { formLambda, rating } from '@/config';

/**
 * Tahmin Gücü — Spesifikasyon Bölüm 6. Saf domain: I/O yok, test edilebilir.
 *
 * Çözülen problem: 2 tahminden 2'sini bilen kullanıcı, 100 tahminden 80'ini bilen
 * kullanıcıdan daha güvenilir gösterilemez. Ham oran bunu yapamaz.
 *
 * ── ALGORİTMA SÜRÜM 2 (Faz 6) ─────────────────────────────────────────────
 *
 * SÜRÜM 1 şuydu:  PP = 100 × (0.40·Â + 0.25·D̂ + 0.20·Ê + 0.15·F̂)
 *
 * Bu biçimde deneyim (Ê) puana DOĞRUDAN eklenirdi ve bu, kanıtlanabilir bir
 * hataya yol açıyordu: yanlış bir tahmin puanı YÜKSELTEBİLİYORDU.
 *
 * KÖK NEDEN — marjinal analiz. Bir tahmin daha yapıldığında:
 *   • deneyimin kazancı   ≈ 0.20 / ((1+t)·ln(1+T))        → 1/t ile azalır
 *   • doğruluğun kaybı    ≈ 0.40 · (c+α) / (t+α+β)²       → 1/t² ile azalır
 * İki eğri farklı hızda söndüğü için deneyim kazancı iki bölgede doğruluk
 * kaybını geçer: t = 0'da (Ê 0 → 0,150 sıçraması) ve t ≳ 46 civarında hiç
 * doğru bilememiş kullanıcıda. Yani sorun bir sabit seçiminden değil,
 * TOPLAMSAL bir hacim ödülünün varlığından kaynaklanır. Hangi sabit seçilirse
 * seçilsin toplamsal bir Ê terimi bir yerde sonucu ters çevirir.
 *
 * SÜRÜM 2 — deneyim artık PUAN EKLEMEZ, GÜVEN KAPISIDIR:
 *
 *   S  = (0.40·Â + 0.25·D̂ + 0.15·F̂) / 0.80      (beceri karışımı, nötrü 0,5)
 *   PP = 100 × [ 0.5 + Ê(t) · (S − 0.5) ]
 *
 * Okunuşu: "Puanın, ortalamadan ne kadar uzaklaşabileceğini kanıt miktarı
 * belirler." Kanıt yokken (Ê = 0) herkes tam ortada, 50'dedir. Kanıt
 * biriktikçe puan kendi gerçek becerisine doğru açılır.
 *
 * BU BİÇİM MONOTONDUR: yanlış bir sonuç Â, D̂ ve F̂'nin ÜÇÜNÜ birden düşürür,
 * yani S kesin azalır; ve Ê yalnızca S'nin 0,5'ten sapmasını ölçekler, kendi
 * başına puan eklemez. `tests/unit/prediction-power.test.ts` bunu 0–120 tahmin
 * aralığındaki tüm doğru/yanlış dizilerinde tüketici (exhaustive) olarak
 * doğrular.
 *
 * ÜRÜN SONUCU: yeni kullanıcı artık 40 değil 50 ile başlar. "Hiçbir şey
 * kanıtlamadan ortalamanın altında sayılmak" zaten savunulabilir değildi;
 * public açıklama sayfası da "ortadan başlar" diyordu. Ayrıca yalnızca çok
 * tahmin yaparak puan yükseltmek artık İMKÂNSIZDIR: becerisi ortalama olan
 * biri kaç tahmin yaparsa yapsın 50'de kalır.
 *
 * Tüm sabitler config/rating.ts üzerinden gelir; hiçbiri buraya gömülmez.
 */

/** Tahmin Gücü hesabı için gereken kümülatif sayaçlar. */
export type RatingCounters = {
  /** Sonuçlanmış tahmin sayısı (VOID hariç). */
  readonly total: number;
  readonly correct: number;
  /** Σ w — zorluk ağırlıkları toplamı. */
  readonly weightSum: number;
  /** Σ (w · s) — doğru tahminlerin ağırlıklı toplamı. */
  readonly weightedCorrectSum: number;
  /** EWMA form skoru [0,1]. */
  readonly form: number;
  /** Form düzeltmesi için son dönem örneklem sayısı. */
  readonly recentCount: number;
};

/** Kullanıcıya "detay" olarak gösterilebilecek bileşen dökümü. */
export type PowerBreakdown = {
  /** İsabet — Bayesian düzeltilmiş doğruluk. */
  readonly accuracy: number;
  /** Zorluk — kalabalığa karşı doğru çıkmanın değeri. */
  readonly difficulty: number;
  /** Deneyim — örneklem güveni. */
  readonly experience: number;
  /** Form — son dönem performansı. */
  readonly form: number;
};

export type PowerResult = {
  /** 0–100, üç ondalık. */
  readonly power: number;
  readonly breakdown: PowerBreakdown;
};

export const emptyCounters: RatingCounters = {
  total: 0,
  correct: 0,
  weightSum: 0,
  weightedCorrectSum: 0,
  form: 0.5,
  recentCount: 0,
};

/**
 * Â — Bayesian düzeltilmiş doğruluk (%40).
 *
 * Prior "kanıt yokken kullanıcı ortalama bir tahmincidir" varsayımıdır.
 * Örneklem büyüdükçe etkisi doğal olarak erir: 2 tahminde baskın, 500'de ihmal
 * edilebilir. Küçük örneklem probleminin tek satırlık çözümü budur.
 */
export function adjustedAccuracy(correct: number, total: number): number {
  const { alpha, beta } = rating.prior;
  return (correct + alpha) / (total + alpha + beta);
}

/**
 * D̂ — zorluk ağırlıklı isabet (%25).
 *
 * Kalabalığın %90'ının seçtiği favoriyi bilmek, %20'sinin seçtiğini bilmekle
 * aynı değerde değildir.
 */
export function weightedDifficulty(weightSum: number, weightedCorrectSum: number): number {
  const prior = rating.difficultyPrior;
  return (weightedCorrectSum + prior) / (weightSum + prior * 2);
}

/**
 * Ê — deneyim, yani KANIT GÜVENİ.
 *
 * Sürüm 2'de bu değer puana eklenmez; puanın ortalamadan ne kadar
 * uzaklaşabileceğini belirleyen çarpandır. Logaritmik doyar: ilk tahminler
 * güveni hızla artırır, hedefte (varsayılan 100 tahmin) 1'e oturur ve orada
 * kalır — sonrasında hacmin hiçbir etkisi kalmaz.
 */
export function experience(total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.log(1 + total) / Math.log(1 + rating.experienceTarget));
}

/**
 * F̂ — form / tutarlılık (beceri karışımında %15).
 *
 * SÜRÜM 2 NOTU: burada ARTIK ikinci bir güven çarpanı uygulanmaz.
 * Sürüm 1'de form hem kendi içinde (`recentCount / formMinSample`) hem de
 * dolaylı olarak deneyimle sönümleniyordu. Bu ÇİFT KAPI, küçük örneklemde
 * ters bir kenar durum üretiyordu: yanlış bir tahminden sonra form düşerken
 * iç güven çarpanı büyüdüğü için F̂ bazen ARTABİLİYORDU (ör. n = 1 → 2 iken
 * çarpan iki katına çıkar, formun 0,5'ten sapması ise ancak %20 azalır).
 *
 * Artık tek bir güven kapısı var — Ê — ve F̂ ham EWMA formunun kendisidir.
 * Böylece "yanlış sonuç her bileşeni düşürür" değişmezi bozulmaz.
 *
 * Fonksiyon geriye dönük uyumluluk için duruyor: sürüm 1 kayıtlarını yeniden
 * hesaplayan `scripts/recompute-ratings.ts` ve karşılaştırma testleri kullanır.
 */
export function formComponent(form: number, recentCount: number): number {
  const confidence = Math.min(1, recentCount / rating.formMinSample);
  return 0.5 + (form - 0.5) * confidence;
}

/**
 * Bir tahminin zorluk ağırlığı.
 *
 * `consensusShare` tahmin kapanışında DONDURULUR; aksi hâlde geçmiş yeniden
 * hesaplandığında farklı sonuç üretir ve itibar denetlenemez hâle gelir.
 *
 * Az katılımlı etkinliklerde dağılım gürültüdür (Ek A.4): eşiğin altında
 * ağırlık nötr kabul edilir, böylece "boş etkinliğe oynayıp zorluk toplama"
 * sömürüsü kapanır.
 */
export function difficultyWeight(consensusShare: number | null, participantCount: number): number {
  if (consensusShare === null || participantCount < rating.minParticipantsForDifficulty) {
    return 0.5;
  }
  return Math.max(rating.minWeight, 1 - consensusShare);
}

/** EWMA form güncellemesi. */
export function nextForm(currentForm: number, wasCorrect: boolean): number {
  return formLambda * (wasCorrect ? 1 : 0) + (1 - formLambda) * currentForm;
}

/**
 * Beceri karışımı S — doğruluk, zorluk ve formun ağırlıklı ortalaması.
 *
 * Ağırlıklar spesifikasyondaki oranlardır; deneyim payı dışarıda tutulduğu
 * için toplamları 0,80'e normalize edilir. Nötr değeri 0,5'tir: üç bileşen de
 * kanıt yokken 0,5 verir.
 */
export function skillMix(breakdown: Omit<PowerBreakdown, 'experience'>): number {
  const { weights } = rating;
  const mass = weights.accuracy + weights.difficulty + weights.form;
  return (
    (weights.accuracy * breakdown.accuracy +
      weights.difficulty * breakdown.difficulty +
      weights.form * breakdown.form) /
    mass
  );
}

/** Bileşke Tahmin Gücü — sürüm 2 (güven kapılı). */
export function computePredictionPower(counters: RatingCounters): PowerResult {
  const breakdown: PowerBreakdown = {
    accuracy: adjustedAccuracy(counters.correct, counters.total),
    difficulty: weightedDifficulty(counters.weightSum, counters.weightedCorrectSum),
    experience: experience(counters.total),
    // Tek güven kapısı Ê'dir; form burada HAM EWMA değeridir (bkz. formComponent).
    form: counters.form,
  };

  const skill = skillMix(breakdown);

  // Deneyim, puanın nötrden (0,5) ne kadar uzaklaşabileceğini belirler.
  const raw = 0.5 + breakdown.experience * (skill - 0.5);

  // Görsel yayılım katsayısı: algoritmanın matematiğini bozmadan üst bandı
  // ayarlamanın TEK noktası (Bölüm 6.2 kalibrasyon notu).
  const scaled = 50 + (raw * 100 - 50) * rating.displayCalibration;
  const power = Math.min(100, Math.max(0, Math.round(scaled * 1000) / 1000));

  return { power, breakdown };
}

/** Sonuçlanan bir tahminden sonra sayaçların yeni hâli. */
export function applyResolvedPrediction(
  counters: RatingCounters,
  input: { readonly wasCorrect: boolean; readonly weight: number },
): RatingCounters {
  return {
    total: counters.total + 1,
    correct: counters.correct + (input.wasCorrect ? 1 : 0),
    weightSum: counters.weightSum + input.weight,
    weightedCorrectSum: counters.weightedCorrectSum + (input.wasCorrect ? input.weight : 0),
    form: nextForm(counters.form, input.wasCorrect),
    recentCount: counters.recentCount + 1,
  };
}

/** Ham başarı yüzdesi — Tahmin Gücü'nden AYRI gösterilir (Bölüm 6). */
export function rawAccuracy(correct: number, total: number): number {
  return total === 0 ? 0 : correct / total;
}
