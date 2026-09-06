/**
 * Ledger idempotency anahtarları — saf domain, tek kaynak.
 *
 * Bir hareketin anahtarı, o hareketin DOĞAL KİMLİĞİNDEN türetilir; kullanıcıdan
 * gelmez, dolayısıyla taklit edilemez. Anahtar üzerindeki UNIQUE index, aynı
 * ödemenin ikinci kez yazılmasını veritabanı seviyesinde imkânsız kılar.
 */

export const ledgerKeys = {
  initialGrant: (userId: string) => `grant:${userId}:initial`,
  dailyReward: (userId: string, isoDate: string) => `reward:${userId}:${isoDate}`,

  challengeStake: (challengeId: string, userId: string) =>
    `challenge:${challengeId}:stake:${userId}`,
  challengePayout: (challengeId: string, userId: string) =>
    `challenge:${challengeId}:payout:${userId}`,
  challengeRefund: (challengeId: string, userId: string) =>
    `challenge:${challengeId}:refund:${userId}`,

  adminAdjustment: (referenceId: string) => `admin:${referenceId}`,

  /** Her kullanıcı hareketinin SYSTEM karşı kaydı — sıfır toplamı korur. */
  systemCounterpart: (key: string) => `${key}:system`,
} as const;

/**
 * Meydan Okuma ödemesi — saf hesaplama.
 *
 * MVP'de her iki taraf eşit çip koyar. Kazanan toplam havuzu alır:
 * net kazanç +stake, kaybeden net −stake. Ev payı / komisyon YOKTUR —
 * bahis sitesi çağrışımından kaçınmak bilinçli bir üründür.
 */
export function computePayout(stakeAmount: number): number {
  return stakeAmount * 2;
}

/** Ekonominin sıfır toplamlı olduğunu doğrular: havuz = ödeme. */
export function isZeroSumSettlement(stakeAmount: number, payout: number): boolean {
  return payout === stakeAmount * 2;
}
