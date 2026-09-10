/**
 * Teknik durumların KULLANICI DİLİNE çevrilmesi — tek kaynak.
 *
 * Kullanıcı asla `PENDING`, `RESOLVED`, `eventId` gibi teknik değerler görmez
 * (ürün kuralları 7 ve 21). Veritabanı enum'ları burada, tek yerde, insan
 * diline çevrilir.
 */

export const predictionStatusLabel = {
  OPEN: 'Sonuç bekleniyor',
  LOCKED: 'Meydan Okuma sürüyor',
  RESOLVED: 'Sonuçlandı',
  VOID: 'Etkinlik iptal edildi',
} as const;

export const predictionResultLabel = {
  CORRECT: 'Doğru bildin',
  INCORRECT: 'Tutmadı',
  VOID: 'Çipin iade edildi',
} as const;

export const challengeStatusLabel = {
  PENDING: 'Yanıt bekleniyor',
  ACCEPTED: 'Sonuç bekleniyor',
  DECLINED: 'Reddedildi',
  EXPIRED: 'Süresi doldu',
  CANCELLED: 'İptal edildi',
  COMPLETED: 'Tamamlandı',
} as const;

/** Sonuçlanmış bir tahminin rozet rengi. */
export function resultTone(result: string | null): 'correct' | 'incorrect' | 'neutral' {
  if (result === 'CORRECT') return 'correct';
  if (result === 'INCORRECT') return 'incorrect';
  return 'neutral';
}

/**
 * "4 saat", "12 dakika" — kapanışa kalan süre.
 *
 * `timeAgo` ile aynı sebeple metin de kabul eder: bu değerlerden biri
 * (gazete rafındaki `next_resolves_at`) hesaplanmış bir sütundan gelir.
 */
export function timeRemaining(closesAt: Date | string | number, now: Date = new Date()): string {
  const at = closesAt instanceof Date ? closesAt : new Date(closesAt);
  if (Number.isNaN(at.getTime())) return '';

  const ms = at.getTime() - now.getTime();
  if (ms <= 0) return 'Kapandı';

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} dakika`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat`;

  return `${Math.floor(hours / 24)} gün`;
}

/** Meydan Okuma sonucunun kullanıcıya gösterilecek özeti. */
export function challengeOutcomeMessage(input: {
  readonly settlement: string | null;
  readonly winnerUserId: string | null;
  readonly viewerId: string;
  readonly stakeAmount: number;
}): string {
  if (input.settlement === 'REFUND_CREATOR') {
    return `Kimse Meydan Okumanı kabul etmedi. ${input.stakeAmount} Gümüş Çipin iade edildi.`;
  }
  if (input.settlement === 'REFUND_BOTH') {
    return `Kimse bilemedi. ${input.stakeAmount} Gümüş Çipin iade edildi.`;
  }
  if (input.winnerUserId === input.viewerId) {
    return `Tebrikler! Meydan Okumayı kazandın. +${input.stakeAmount * 2} Gümüş Çip.`;
  }
  return `Bu Meydan Okumayı kaybettin. −${input.stakeAmount} Gümüş Çip.`;
}

/** Bildirim türüne göre ikon — Faz 5. Renk dışında da anlam taşır. */
export const notificationIcon: Record<string, string> = {
  CHALLENGE_RECEIVED: '⚔️',
  CHALLENGE_ACCEPTED: '🤝',
  CHALLENGE_DECLINED: '↩️',
  CHALLENGE_COMPLETED: '🏁',
  CHALLENGE_EXPIRED: '⏳',
  PREDICTION_CORRECT: '🎯',
  PREDICTION_INCORRECT: '📉',
  RATING_CHANGED: '🧠',
  NEW_FOLLOWER: '👤',
  FOLLOWED_USER_PREDICTION: '👥',
  BADGE_EARNED: '🏆',
  SEASON_RESULT: '📅',
};

/**
 * "3 dakika önce", "2 gün önce" — bildirim listesi için.
 *
 * ── NEDEN METİN DE KABUL EDİYOR ────────────────────────────────────────────
 * Hesaplanmış bir SQL sütunu (`coalesce`, `min`, `max`…) sürücünün tarih
 * dönüştürücüsünden geçmez ve geriye METİN döner. Bu fonksiyon yalnızca
 * `Date` kabul ettiği için canlıda `date.getTime is not a function` hatası
 * verdi ve ANA SAYFA TAMAMEN AÇILMADI.
 *
 * Asıl düzeltme kaynakta yapıldı (servis artık `Date` döndürüyor). Buradaki
 * hoşgörü ikinci savunma hattıdır: bir tarih biçimlendiricisinin bütün
 * sayfayı düşürmesi, hatanın kendisinden çok daha pahalıdır. Geçersiz bir
 * değerde patlamak yerine boş metin döner — eksik bir satır, beyaz bir
 * ekrandan iyidir.
 */
export function timeAgo(date: Date | string | number, now: Date = new Date()): string {
  const at = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(at.getTime())) return '';

  const seconds = Math.floor((now.getTime() - at.getTime()) / 1000);
  if (seconds < 60) return 'az önce';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dakika önce`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} gün önce`;

  return `${Math.floor(days / 30)} ay önce`;
}
