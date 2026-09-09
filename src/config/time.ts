/**
 * ZAMAN — tek merkez (Faz 8).
 *
 * NEDEN AYRI DOSYA: "Günün Meydanı", "günlük seri", "haftalık sıralama" ve
 * "bugün kaç tahmin yapıldı" ifadelerinin hepsi bir GÜN tanımına dayanır.
 * Bu tanım dosyadan dosyaya farklı yazılırsa (biri UTC, biri sunucu yerel
 * saati, biri kullanıcı saati) aynı anda iki farklı "bugün" oluşur ve
 * kullanıcı serisini neden kaybettiğini asla anlayamaz.
 *
 * KARAR: ürünün takvimi Türkiye saatine göre işler. Depolama her zaman
 * UTC'dir; yalnızca "hangi güne düşüyor" sorusu bu saat diliminde
 * cevaplanır. Sunucu Frankfurt'ta çalışıyor olabilir, kullanıcı başka bir
 * ülkede olabilir — ürünün günü değişmez.
 */

/** Ürün takviminin saat dilimi. Sunucunun yerel saati KULLANILMAZ. */
export const PRODUCT_TIMEZONE = 'Europe/Istanbul';

/**
 * Verilen anın ürün takvimindeki günü — `YYYY-MM-DD`.
 *
 * `Intl` ile hesaplanır; elle saat ekleme yapılmaz çünkü yaz saati
 * uygulaması, geçmiş kural değişiklikleri ve artık saniyeler elle
 * hesaplandığında yılda birkaç gün sessizce yanlış sonuç verir.
 */
export function productDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PRODUCT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * Ürün takviminde haftanın başladığı gün — PAZARTESİ.
 *
 * Haftalık sıralama ve "bu hafta" ifadeleri buradan türer. Pazartesi seçimi
 * Türkiye'deki yaygın kullanımla uyumludur; Pazar'dan başlatan bir kütüphane
 * varsayılanı sessizce farklı bir hafta üretirdi.
 */
export function productWeekStart(at: Date = new Date()): string {
  const day = productDay(at);
  const [y, m, d] = day.split('-').map(Number);
  // Öğlen UTC seçilir: gün sınırına yakın saatlerde yaz saati kaymasının
  // günü bir ileri/geri almasını engeller.
  const noon = new Date(Date.UTC(y!, m! - 1, d!, 12));
  const weekday = (noon.getUTCDay() + 6) % 7; // Pazartesi = 0
  noon.setUTCDate(noon.getUTCDate() - weekday);
  return noon.toISOString().slice(0, 10);
}

/** İki ürün gününün farkı (gün sayısı). Seri hesabı buna dayanır. */
export function daysBetween(fromDay: string, toDay: string): number {
  const a = Date.parse(`${fromDay}T12:00:00Z`);
  const b = Date.parse(`${toDay}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
