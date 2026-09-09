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
 * Eşikler ürünün GERÇEK ölçeğine göre seçildi, ideal ölçeğine göre değil.
 * İlk sürümde yüzde eşiği 30'du; oysa ilk beta 10-20 kişilik olacak ve o
 * eşikte yüzde hiç görünmezdi — mekanik, tam da test edileceği dönemde ölü
 * kalırdı. Eşik altında veri gizlenmiyor, kesir olarak gösteriliyor.
 *
 * Yalnız Kurt eşiği en yüksektir çünkü KALICI bir rozettir: az katılımlı bir
 * etkinlikte azınlıkta kalmak nadir bir başarı değildir ve rozet dağıtıldıkça
 * değersizleşir.
 */

export const socialProof = {
  /**
   * Yüzde göstermek için gereken en az tahmin sayısı.
   *
   * ALTINDA VERİ GİZLENMEZ, BİÇİMİ DEĞİŞİR: "%67" yerine "3 kişiden 2'si"
   * yazılır. Kesir hem dürüsttür hem daha çok bilgi taşır — yüzde örneklem
   * büyüklüğünü saklar, kesir söyler. Böylece mekanik HER ÖLÇEKTE çalışır;
   * yalnızca ifade küçük sayıda yanıltmayacak hâle gelir.
   *
   * NEDEN 30 DEĞİL 10: ilk sürümde 30'du. Oysa ilk beta 10-20 kişiyle
   * yapılacak ve etkinlik başına belki 6-8 tahmin gelecek. 30 eşiğinde
   * yüzde HİÇ görünmez, yani ürünün imza mekaniği tam da test edileceği
   * dönemde hiç çalışmaz. Eşik, ürünün gerçek ölçeğine göre seçilmeli.
   */
  minSampleForPercentage: 10,

  /**
   * "Azınlıktasın / çoğunluktasın" için gereken en az tahmin sayısı.
   *
   * Yüzde eşiğinden YÜKSEK: bu bir iddiadır, sayı değil. Beş kişilik bir
   * etkinlikte "azınlıktasın" demek, azınlık kavramını değersizleştirir.
   */
  minSampleForPosition: 20,

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
