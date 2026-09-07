/**
 * Marka ve ürün dili — tek kaynak.
 *
 * Ürün adı hiçbir bileşene, tablo adına, enum değerine veya metne gömülmez.
 * Ad değişikliği bu dosyanın (veya ortam değişkeninin) güncellenmesinden ibarettir.
 *
 * YASAK TERİMLER: kumar argosundan gelen ifadeler (bahis masası dili) hiçbir
 * katmanda kullanılmaz — UI metni, kod, veritabanı enum'ları, analytics olay
 * adları ve bildirim metinleri dâhil. Yasaklı kalıpların tam listesi ve kuralın
 * kendisi `tests/unit/terminology.test.ts` içindedir; ihlal CI'da build'i kırar.
 */
/**
 * Ürün adı ortam değişkeninden gelebilir.
 *
 * ⚠️ `??` BURADA YETMEZ — ve bu, canlıda gerçekten yaşandı.
 *
 * Next.js, tanımlanmamış bir `NEXT_PUBLIC_*` değişkenini derleme sırasında
 * kodun içine BOŞ METİN olarak gömer. Boş metin `??` için "tanımlı" sayılır,
 * dolayısıyla varsayılan hiç devreye girmez. Faz 7'de yayına alınan sitede
 * yasal uyarı şöyle göründü:
 *
 *     "'daki finans ve kripto içerikleri yalnızca…"
 *
 * Yani yatırım uyarısı, hangi platformdan bahsettiğini söylemeden yayınlandı.
 * Boşluk da aynı sınıfa girer: sadece boşluktan oluşan bir ad, adsızlıktır.
 */
const configuredAppName = process.env.NEXT_PUBLIC_APP_NAME?.trim();

export const brand = {
  appName: configuredAppName ? configuredAppName : 'MEYDAN',
  tagline: 'Tahminini ortaya koy.',
  description:
    'Gerçek dünyadaki olaylarda tarafını seç. Arkadaşlarına Meydan Oku. Tahmin Gücünü kanıtla.',

  /** Sanal oyun içi para birimi. Gerçek para değildir. */
  currencyName: 'Gümüş Çip',
  currencyShort: 'Çip',

  /** İtibar skoru (0–100). Ham başarı yüzdesinden ayrı bir metriktir. */
  ratingName: 'Tahmin Gücü',
  accuracyName: 'Başarı Yüzdesi',
  formName: 'Form',

  /** Ana sosyal mekanik. */
  challengeNoun: 'Meydan Okuma',
  challengeVerb: 'Meydan Oku',
  challengeAccept: 'Meydan Okumayı Kabul Et',
  challengeDecline: 'Meydan Okumayı Reddet',
  challengeInbox: 'Sana Gelen Meydan Okumalar',
  challengeOutbox: 'Gönderdiğin Meydan Okumalar',
  challengeMine: 'Meydan Okumalarım',

  /** Ana navigasyon. */
  nav: {
    feed: 'Akış',
    trending: 'Gündem',
    challenges: 'Meydan Okumalar',
    leaderboard: 'Liderlik',
    profile: 'Profil',
  },

  expertSuffix: 'Tahmin Uzmanı',
} as const;

/**
 * Finans ve kripto içeriklerinde gösterilmesi ZORUNLU uyarı.
 * Tek kaynak: `components/disclaimers/FinancialDisclaimer.tsx` bu metni kullanır.
 */
export const financialDisclaimer = {
  title: 'Önemli Bilgilendirme',
  short: 'Bu içerik kullanıcı tahminidir. Yatırım tavsiyesi veya alım-satım önerisi değildir.',
  full:
    `${brand.appName}'daki finans ve kripto içerikleri yalnızca kullanıcıların kendi ` +
    'tahminlerini ve görüşlerini yansıtır. Bu içerikler yatırım tavsiyesi, alım-satım önerisi ' +
    `veya finansal danışmanlık değildir. ${brand.appName} herhangi bir yatırım kararını ` +
    'yönlendirmez veya garanti edilmiş sonuç/kazanç sunmaz. Yatırım kararları kullanıcıların ' +
    'kendi sorumluluğundadır.',
} as const;

export type Brand = typeof brand;
