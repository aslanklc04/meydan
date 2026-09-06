/**
 * BAĞLANTI ADRESİ NORMALLEŞTİRME.
 *
 * ── SORUN ──────────────────────────────────────────────────────────────────
 * Yönetilen PostgreSQL sağlayıcıları (Neon, Supabase, Railway…) panellerinde
 * `libpq` biçiminde bağlantı adresi verir:
 *
 *   postgresql://…/neondb?sslmode=require&channel_binding=require
 *
 * `postgres.js` sürücüsü, TANIMADIĞI her sorgu parametresini sunucuya
 * "başlangıç parametresi" olarak yollar. `channel_binding` bir PostgreSQL
 * ayarı değildir; sunucu bağlantıyı şu hatayla reddeder:
 *
 *   unrecognized configuration parameter "channel_binding"
 *
 * Sonuç: uygulama hiç açılmaz. Bu, panelden kopyalanan adresin AYNEN
 * yapıştırılmasıyla ortaya çıkar — yani en doğal kullanımda.
 *
 * ── NEDEN KODDA ÇÖZÜLÜYOR ──────────────────────────────────────────────────
 * Alternatif, kurulumu yapan kişiden adresi elle kırpmasını istemekti. Bu
 * yanlış: kurucu adresi bir daha kopyaladığında (sağlayıcı parolayı
 * yenilediğinde, veritabanı taşındığında) hata sessizce geri gelir ve
 * "dün çalışıyordu" denen türden bir arıza doğar. Sınır burada temizlenirse
 * sorun bir daha çıkmaz.
 *
 * ── NEDEN İZİN LİSTESİ (kara liste değil) ──────────────────────────────────
 * Yarın başka bir sağlayıcı bilmediğimiz bir parametre eklerse kara liste onu
 * kaçırır ve aynı arıza tekrar eder. İzin listesi, tanımadığımız her şeyi
 * varsayılan olarak düşürür: bilinmeyen bir parametrenin en kötü sonucu
 * "yok sayıldı" olur, "uygulama açılmadı" değil.
 */

/**
 * `postgres.js`'in gerçekten anladığı parametreler (src/index.js, parseOptions).
 * Bunların dışındakiler sunucuya başlangıç parametresi olarak gider.
 */
const SUPPORTED_PARAMS = new Set([
  // TLS
  'sslmode',
  'ssl',
  'sslrootcert',
  // Havuz ve zaman aşımı
  'max',
  'idle_timeout',
  'connect_timeout',
  'max_lifetime',
  'max_pipeline',
  'keep_alive',
  'backoff',
  // Davranış
  'prepare',
  'fetch_types',
  'target_session_attrs',
  // Gerçek PostgreSQL başlangıç parametreleri — güvenle geçebilir
  'application_name',
  'options',
]);

export type NormalizedUrl = {
  readonly url: string;
  /** Düşürülen parametre adları — günlüğe yazmak için. Değerleri TAŞIMAZ. */
  readonly dropped: readonly string[];
};

/**
 * Adresteki desteklenmeyen sorgu parametrelerini ayıklar.
 *
 * Adres ayrıştırılamıyorsa OLDUĞU GİBİ döndürülür: burada hata fırlatmak,
 * asıl sorunu (geçersiz adres) daha anlaşılır biçimde bildiren sürücünün
 * önüne geçerdi.
 *
 * Parola ve diğer kimlik bilgileri değiştirilmez, günlüğe yazılmaz.
 */
export function normalizeDatabaseUrl(raw: string): NormalizedUrl {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { url: raw, dropped: [] };
  }

  const dropped: string[] = [];
  for (const key of [...parsed.searchParams.keys()]) {
    if (!SUPPORTED_PARAMS.has(key)) {
      parsed.searchParams.delete(key);
      if (!dropped.includes(key)) dropped.push(key);
    }
  }

  return { url: parsed.toString(), dropped };
}

/** Kısa yol: yalnızca temizlenmiş adres. */
export function databaseUrl(raw: string): string {
  return normalizeDatabaseUrl(raw).url;
}
