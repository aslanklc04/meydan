/**
 * Tahmin Gücü algoritma sabitleri — Spesifikasyon Bölüm 6 ve Ek B.
 *
 * Bu değerlerin hiçbiri servis veya bileşen içine gömülmez. Algoritma
 * versiyonlanabilir: sabitler değiştiğinde `algorithmVersion` artırılır ve
 * `scripts/recompute-ratings.ts` geçmişi yeniden hesaplar.
 */
export const rating = {
  /**
   * Bileşen ağırlıkları — toplamı 1.0 olmalıdır (test ile doğrulanır).
   *
   * SÜRÜM 2 (Faz 6): `experience` artık toplamsal bir pay DEĞİL, güven
   * kapısıdır. Diğer üçünün payları beceri karışımı içinde 0,80'e
   * normalize edilir; oranları (40 : 25 : 15) korunur.
   */
  weights: {
    accuracy: 0.4,
    difficulty: 0.25,
    experience: 0.2,
    form: 0.15,
  },

  /** Bayesian prior: kanıt yokken kullanıcı ortalama bir tahminci sayılır (5/10 = 0,5). */
  prior: {
    alpha: 5,
    beta: 5,
  },

  /** Zorluk bileşeninin prior kütlesi (alpha = beta). */
  difficultyPrior: 2.5,

  /** Zorluk ağırlığı tabanı — ezici favorilerde bile sıfır katkı olmaz. */
  minWeight: 0.05,

  /**
   * Bu sayının altında katılımcısı olan event'lerde dağılım gürültüdür;
   * zorluk ağırlığı nötr (0,5) kabul edilir. (Ek A.4)
   */
  minParticipantsForDifficulty: 20,

  /** Deneyim bileşeninin doyum noktası (tahmin sayısı). */
  experienceTarget: 100,

  /** Form (EWMA) yarı ömrü — tahmin sayısı cinsinden. */
  formHalfLife: 20,

  /** Form düzeltmesi için asgari örneklem. */
  formMinSample: 10,

  /** Profilde gösterilen "son N tahmin" penceresi. */
  recentWindow: 30,

  /**
   * Görsel yayılım katsayısı: PP_display = 50 + (PP - 50) * k
   * Algoritmanın matematiğini bozmadan üst bandı genişletmek için tek nokta.
   */
  displayCalibration: 1.0,

  /** Bu kadar puan değişimde kullanıcıya bildirim gönderilir. */
  notifyDelta: 2.0,

  /**
   * Yeni kullanıcının başlangıç skoru — formülden türer.
   *
   * SÜRÜM 2'de kanıt yokken güven kapısı 0'dır; puan tam nötr noktada,
   * yani 50'de durur. Sürüm 1'de bu değer 40'tı ve "hiçbir şey kanıtlamamış
   * kullanıcıyı ortalamanın ALTINDA saymak" anlamına geliyordu.
   */
  coldStartPower: 50,

  /**
   * Algoritma sürümü. Değiştiğinde `scripts/recompute-ratings.ts` geçmişi
   * yeniden hesaplar ve `user_rating.algorithm_version` bu değere taşınır.
   */
  algorithmVersion: 2,
} as const;

/** EWMA katsayısı — yarı ömürden türetilir. */
export const formLambda = 1 - Math.pow(2, -1 / rating.formHalfLife);

export type Rating = typeof rating;
