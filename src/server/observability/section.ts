import { log } from './logger';

/**
 * BÖLÜM KORUMASI — bir sorgu düşerse SAYFA düşmesin.
 *
 * ── NEDEN VAR ──────────────────────────────────────────────────────────────
 * Ana sayfa sekiz, akış dokuz ayrı sorgudan besleniyor ve `Promise.all`
 * bunlardan biri hata verdiğinde hepsini düşürür. Canlıda bir bölümdeki tek
 * bir tarih hatası SİTENİN ÖN KAPISINI kapattı: ziyaretçi MEYDAN'ı değil
 * "Bir sorun oluştu" yazısını gördü.
 *
 * Bu orantısız bir ceza. Gazete rafı çekilemediyse doğru davranış rafı
 * çizmemek ve sayfanın geri kalanını göstermektir.
 *
 * ── NEDEN SESSİZ DEĞİL ─────────────────────────────────────────────────────
 * Hata yutulmuyor, günlüğe hangi bölümün düştüğü yazılıyor. "Hata olursa
 * boş dön" kuralı, sebebi kaydedilmediğinde bir hatayı kalıcı olarak
 * görünmez yapar — asıl tehlikeli olan budur.
 *
 * ── YEDEK DEĞER NEDEN HEP BOŞ ──────────────────────────────────────────────
 * Eksik bölüm gösterilir; uydurma satır GÖSTERİLMEZ. Ürünün baştan beri
 * savunduğu kural: boşluğu doldurma görüntüsü, boşluğun kendisinden kötüdür.
 */
export async function bolum<T>(ad: string, getir: () => Promise<T>, yedek: T): Promise<T> {
  try {
    return await getir();
  } catch (error) {
    log.error('sayfa.bolum_dustu', { operation: 'page.render', section: ad, error });
    return yedek;
  }
}
