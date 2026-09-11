/**
 * TÜRKÇE SAYI EKLERİ.
 *
 * ── NEDEN BU DOSYA VAR ─────────────────────────────────────────────────────
 * Ürünün imza cümlesi "3 kişiden 2'si". Kod bu eki SABİT yazıyordu ('i) ve
 * canlıda şu cümleler çıkıyordu:
 *
 *     "1 kişiden 0'i bildi"      → doğrusu 0'ı
 *     "3 kişiden 2'i"            → doğrusu 2'si
 *     "10 kişiden 4'i"           → doğrusu 4'ü
 *
 * Türkçede ek, sayının OKUNUŞUNA göre değişir; rakama göre değil. "iki" →
 * "ikisi", "dört" → "dördü", "sıfır" → "sıfırı". Sabit bir ek, üründeki en
 * çok görünen cümleyi her seferinde yanlış yazar.
 *
 * Bu, küçük bir yazım hatası gibi görünür ama değil: ürünün bütün iddiası
 * "dürüst ve özenli sayı gösterimi" üzerine kurulu. Kendi cümlesini Türkçe
 * yazamayan bir ekranın sayısına da kimse güvenmez.
 *
 * ── KAPSAM ─────────────────────────────────────────────────────────────────
 * 3. tekil iyelik eki (belirtme değil): "2'si", "5'i", "10'u".
 * Sayı, son okunan sözcüğüne göre ek alır: 1.234 → "bin iki yüz otuz dört"
 * → "dördü". Yani yalnızca sonu belirleyicidir.
 */

/** Birler: rakam → ek (0-9). */
const BIRLER = ['ı', 'i', 'si', 'ü', 'ü', 'i', 'sı', 'si', 'i', 'u'] as const;

/** Onlar: 10, 20, … 90 → ek. */
const ONLAR: Record<number, string> = {
  10: 'u',
  20: 'si',
  30: 'u',
  40: 'ı',
  50: 'si',
  60: 'ı',
  70: 'i',
  80: 'i',
  90: 'ı',
};

/**
 * "3" → "3'ü", "2" → "2'si", "0" → "0'ı".
 *
 * Negatif ya da tam olmayan sayılarda ek denenmez: uydurma bir ek yazmaktansa
 * sayıyı eksiz bırakmak dürüsttür (bu ürün hiç bu tür sayı göstermiyor).
 */
export function iyelikEki(sayi: number): string {
  if (!Number.isInteger(sayi) || sayi < 0) return '';

  // Sonu 1-9 ise okunan son sözcük birler basamağıdır.
  const birler = sayi % 10;
  if (birler !== 0) return BIRLER[birler]!;

  // Sonu 0: son okunan sözcük onlar, yüzler, binler… olabilir.
  const onlar = sayi % 100;
  if (onlar !== 0) return ONLAR[onlar]!;

  const yuzler = sayi % 1000; // 100, 200, … 900 → "yüz" → "yüzü"
  if (yuzler !== 0) return 'ü';

  const binler = sayi % 1_000_000; // 1.000, 2.000, … → "bin" → "bini"
  if (binler !== 0) return 'i';

  const milyon = sayi % 1_000_000_000; // "milyon" → "milyonu"
  if (milyon !== 0) return 'u';

  // 0 ve milyar katları: "sıfır" → "sıfırı", "milyar" → "milyarı"
  return 'ı';
}

/**
 * "3 kişiden 2'si" cümlesindeki sayı+ek parçası: `2'si`.
 *
 * Sayının kendisi çağıran tarafta biçimlendirilir (binlik ayracı için),
 * burada yalnızca ek üretilir.
 */
export function sayiIyelik(sayi: number, gosterim: string = String(sayi)): string {
  const ek = iyelikEki(sayi);
  return ek ? `${gosterim}'${ek}` : gosterim;
}
