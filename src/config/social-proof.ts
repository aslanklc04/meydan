/**
 * SOSYAL KANIT EŞİKLERİ (Faz 8).
 *
 * ── NEDEN EŞİK GEREKİYOR ───────────────────────────────────────────────────
 * "Topluluğun %67'si seninle aynı fikirde" cümlesi, arkasında üç kişi varken
 * YANLIŞ BİLGİDİR. Teknik olarak 2/3 doğrudur; iletişim olarak sahtedir,
 * çünkü okuyan kişi arkasında bir kalabalık olduğunu anlar.
 *
 * Erken aşamada bir ürünün yapabileceği en zararlı şey, kendi boşluğunu
 * yüzdeyle örtmektir: sayı büyük görünür, kullanıcı gelir, ürünün ıssız
 * olduğunu fark eder ve bir daha dönmez. Bu yüzden eşik altında SAYININ
 * KENDİSİ gösterilir — "7 kişi tahmin yaptı" dürüsttür ve küçük olması
 * ürünün yeni olduğunu söyler, yalan söylemez.
 *
 * ── SAYILARIN GEREKÇESİ ────────────────────────────────────────────────────
 * 30, yüzdenin tek bir kişinin gelmesiyle belirgin biçimde oynamadığı ilk
 * makul eşiktir: 30 kişide bir kişi %3,3 puan değiştirir, 10 kişide %10.
 * Yalnız Kurt eşiği daha yüksektir çünkü kalıcı bir başarı rozetidir;
 * hafifçe kalabalık bir etkinlikte azınlıkta kalmak nadir bir başarı değildir.
 */

export const socialProof = {
  /**
   * Yüzde göstermek için gereken en az tahmin sayısı. Altında yalnızca
   * katılımcı sayısı gösterilir.
   */
  minSampleForPercentage: 30,

  /**
   * "Azınlıktasın / çoğunluktasın" bağlamı için gereken en az tahmin sayısı.
   * Yüzde eşiğiyle aynıdır — ikisi de aynı iddianın farklı kılığıdır.
   */
  minSampleForPosition: 30,

  /** Kullanıcının tarafı bu payın altındaysa "azınlıkta" sayılır. */
  minorityThreshold: 0.35,

  /** Kullanıcının tarafı bu payın üstündeyse "çoğunlukta" sayılır. */
  majorityThreshold: 0.5,

  /** 🐺 Yalnız Kurt — kalıcı başarı rozeti. */
  loneWolf: {
    /** Etkinlik en az bu kadar tahmin almış olmalı. */
    minParticipants: 30,
    /** Kazanan tarafın payı bu değerin ALTINDA olmalı. */
    maxWinningSideShare: 0.15,
  },
} as const;
