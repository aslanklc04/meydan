/**
 * ADR-18 — Karşı sonucun deterministik atanması. Saf domain.
 *
 * PROBLEM: "Galatasaray — Fenerbahçe · Beraberlik" gibi 3 sonuçlu bir etkinlikte
 * "otomatik karşıt sonuç" tanımsızdır. Kabul eden kişiye tekrar seçim yaptırmak
 * ise akışı bozar (ürün kuralı 9B ve 24).
 *
 * ÇÖZÜM: karşı sonuç, meydan okuma OLUŞTURULURKEN deterministik olarak atanır ve
 * kabul kartında AÇIKÇA gösterilir. Kabul eden ekstra seçim yapmaz, ama neyi
 * aldığını görür. Beğenmezse kabul etmez.
 *
 * KURAL: sortOrder'a göre sıralı sonuçlar arasında, oluşturanın seçmediği İLK
 * sonuç karşı taraf olur.
 *
 *   GS(0) — FB(1) — Beraberlik(2)
 *     oluşturan GS         → karşı FB
 *     oluşturan FB         → karşı GS
 *     oluşturan Beraberlik → karşı GS
 *
 * İki sonuçlu etkinliklerde (Yükseliş/Düşüş) sonuç zaten tek olasılıktır.
 *
 * NOT: üçüncü bir sonuç çıkarsa (ör. beraberlik) İKİ TARAF DA yanılır ve
 * ekonomi `REFUND_BOTH` ile herkesin çipini iade eder — Spesifikasyon Bölüm 7.4.
 * Bu yüzden deterministik atama kimseye haksızlık üretmez.
 */

export type OutcomeRef = {
  readonly id: string;
  readonly sortOrder: number;
};

/**
 * Oluşturanın seçimine karşılık gelen rakip sonucu döndürür.
 * Etkinlikte en az iki sonuç yoksa null döner (meydan okuma açılamaz).
 */
export function pickCounterOutcome(
  outcomes: readonly OutcomeRef[],
  creatorOutcomeId: string,
): OutcomeRef | null {
  const ordered = [...outcomes].sort((a, b) => a.sortOrder - b.sortOrder);
  return ordered.find((o) => o.id !== creatorOutcomeId) ?? null;
}

/** Bir etkinlik meydan okumaya uygun mu? En az iki sonuç gerekir. */
export function supportsChallenge(outcomes: readonly OutcomeRef[]): boolean {
  return outcomes.length >= 2;
}
