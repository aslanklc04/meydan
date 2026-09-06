/**
 * Gümüş Çip ekonomisi — Spesifikasyon Bölüm 8 ve Ek B.
 *
 * Gümüş Çip tamamen sanal, oyun içi bir puandır. Gerçek para değildir; nakde
 * çevrilemez, çekilemez, gerçek para ile satın alınamaz.
 *
 * Tüm tutarlar TAM SAYIDIR. Para için hiçbir yerde kayan noktalı sayı kullanılmaz.
 */
const int = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const economy = {
  /** Kayıt tamamlandığında verilen çip. */
  initialGrant: int('ECONOMY_INITIAL_GRANT', 1000),

  /** Günlük giriş ödülü. */
  dailyReward: int('ECONOMY_DAILY_REWARD', 25),

  /** Meydan Okuma başına taraf başına ortaya konabilecek çip aralığı. */
  minStake: int('ECONOMY_MIN_STAKE', 5),
  maxStake: int('ECONOMY_MAX_STAKE', 500),

  /** Bakiyenin tek meydan okumada riske edilebilecek azami oranı (0–1). */
  maxStakeRatio: 0.25,

  /** Kabul edilmeyen meydan okumanın süresi (saat). */
  challengeTtlHours: int('ECONOMY_CHALLENGE_TTL_HOURS', 24),

  /** Kullanıcı başına günlük açık meydan okuma tavanı. */
  maxOpenChallengesPerDay: int('ECONOMY_MAX_OPEN_CHALLENGES_PER_DAY', 20),

  /** Ledger'da sistem karşı hesabının kimliği. Negatif bakiyeye izin verilen tek hesap. */
  systemAccountId: 'SYSTEM',

  /**
   * Arayüzde tek dokunuşla seçilebilen çip miktarları.
   * Kullanıcıdan sayı yazması istenmez (ürün kuralı 24).
   */
  stakePresets: [10, 25, 50, 100] as const,
} as const;

/** Bir stake değerinin kurallara uygunluğu — saf fonksiyon, her katmanda kullanılabilir. */
export function isStakeAllowed(stake: number, balance: number): boolean {
  if (!Number.isInteger(stake)) return false;
  if (stake < economy.minStake || stake > economy.maxStake) return false;
  if (stake > balance) return false;
  if (stake > Math.floor(balance * economy.maxStakeRatio) && stake > economy.minStake) return false;
  return true;
}

export type Economy = typeof economy;
