/**
 * KÜFÜR VE HAKARET LİSTESİ.
 *
 * ── BU LİSTENİN NE OLDUĞU VE NE OLMADIĞI ───────────────────────────────────
 * Bu bir ÇÖZÜM DEĞİL, BİR HIZ KESİCİDİR. Kelime listesi ile içerik denetimi
 * yapılamaz; kararlı bir kullanıcı listedeki her kelimeyi listede olmayan bir
 * biçimde yazabilir ve listede olmayan sözcüklerle de hakaret edebilir. Asıl
 * savunma üç katmandır ve bu, en zayıf olanıdır:
 *
 *   1. Kapak bir HESABA bağlıdır — anonim değildir.
 *   2. Herkese açık raf ŞİKÂYET EDİLEBİLİR ve yönetici gizleyebilir.
 *   3. Bu liste, düşünmeden yazılanı daha yazılırken durdurur.
 *
 * Listenin işi, sıradan bir kullanıcının ana sayfada küfür görmesini
 * engellemektir; kararlı bir kötü niyetliyi durdurmak değil.
 *
 * ── NEDEN AYRI DOSYA ───────────────────────────────────────────────────────
 * Liste büyüyecek ve düzenlenecek. Süzgeç mantığından ayrı durursa, listeye
 * kelime eklemek mantığa dokunmadan yapılabilir ve mantığın testleri
 * listeden etkilenmez.
 *
 * ── EŞLEŞME BİÇİMİ ─────────────────────────────────────────────────────────
 * Kelimeler NORMALLEŞTİRİLMİŞ metinde, KELİME SINIRIYLA aranır. Sınır şart:
 * içerik olarak arasaydık "sik" kalıbı "siki̇ntı", "eksik", "yapışık" gibi
 * masum kelimeleri yakalar ve ürün, küfür etmeyen kullanıcıyı susturur.
 * Yanlış pozitif, yanlış negatiften daha zararlıdır: biri kötü içeriği
 * geçirir, diğeri dürüst kullanıcıyı kaybettirir.
 */
export const bannedWords: readonly string[] = [
  'amk',
  'aq',
  'amina',
  'aminakoyayim',
  'amcik',
  'orospu',
  'orospucocugu',
  'pic',
  'pickurusu',
  'yarrak',
  'yarak',
  'sik',
  'sikeyim',
  'sikerim',
  'siktir',
  'sikik',
  'gotveren',
  'gotlek',
  'ibne',
  'top',
  'pezevenk',
  'kahpe',
  'surtuk',
  'gavat',
  'seres',
  'tasak',
  'am',
  'meme',
  'dalyarak',
  'salak',
  'aptal',
  'gerizekali',
  'mal',
  'serefsiz',
  'namussuz',
  'piclik',
  'anani',
  'ananin',
  'avradini',
  'sulale',
];

/**
 * Listede olup da GÜNLÜK DİLDE masum kullanımı yaygın olanlar.
 *
 * Bunlar tek başına eşleşse bile ENGELLENMEZ; yalnızca bir hakaret kalıbının
 * parçasıysa engellenir. Sebebi yukarıdaki kural: "Bu maçta top dönmez",
 * "Salak gibi kaçırdı", "Bu takım mal gibi oynuyor" cümleleri kaba olabilir
 * ama bir spor sayfasında olağandır ve bunları engellemek ürünü kullanılamaz
 * hâle getirir.
 *
 * Kaba dille HAKARET arasındaki çizgi bir kelime listesiyle çizilemez. Bu
 * yüzden burada ürün, sınırda kalanı geçirip şikâyet yoluna güvenir.
 */
export const softWords: ReadonlySet<string> = new Set([
  'top',
  'am',
  'meme',
  'mal',
  'salak',
  'aptal',
  'seres',
]);

/**
 * Hakaret KALIPLARI — tek kelime değil, hedefe yönelmiş ifade.
 *
 * "Salak" tek başına geçer; "sen salaksın" geçmez. Fark, kelimenin kendisinde
 * değil kime söylendiğindedir.
 */
export const insultPatterns: readonly RegExp[] = [
  /\b(sen|siz|o|bu)\s+\w*(salak|aptal|mal|gerizekali|serefsiz)\w*\b/,
  /\b(salak|aptal|mal|gerizekali|serefsiz)(sin|siniz|dir)\b/,
  /\b(ananin|anani|avradini|sulale)\b/,
];
