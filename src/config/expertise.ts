/**
 * Kategori uzmanlığı ve liderlik eşikleri — Spesifikasyon Bölüm 6.3, 11 ve Ek B.
 *
 * İki-üç tahminle uzmanlık ilan edilmesi ürünün güvenilirliğini yok eder.
 * Bu yüzden eşikler veritabanı/config üzerinden yönetilir, koda gömülmez.
 */
export const expertise = {
  /** Uzman rozeti için asgari tamamlanmış kategori tahmini. */
  minCategoryPredictions: 30,

  /** Uzman rozeti için asgari kategori Tahmin Gücü. */
  minCategoryPower: 75,

  /** Aktiflik şartı: son N gün içinde en az M tahmin. */
  activityWindowDays: 90,
  minRecentPredictions: 5,

  /** Genel liderlik tablosuna girebilmek için asgari tamamlanmış tahmin. */
  leaderboardMinPredictions: 20,

  /** Kategori liderlik tablosuna girebilmek için asgari kategori tahmini. */
  leaderboardMinCategoryPredictions: 15,
} as const;

export type Expertise = typeof expertise;
