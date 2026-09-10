import { bannedWords, insultPatterns, softWords } from './banned-words';

/**
 * HERKESE AÇIK METİN SÜZGECİ.
 *
 * ── NEREDE KULLANILIR ──────────────────────────────────────────────────────
 * Kullanıcının yazdığı ve BAŞKALARININ EKRANINDA belirecek serbest metinler
 * için: gazete kapak başlığı gibi. Yalnızca kendine görünen metinlerde
 * kullanılmaz — orada süzmek, kimseyi korumadan kullanıcıyı kısıtlamak olur.
 *
 * ── SÜZGECİN DÜRÜST SINIRLARI ──────────────────────────────────────────────
 * Kelime listesiyle içerik denetimi ÇALIŞMAZ. Bu süzgeç üç şeyi yapar:
 *   • düşünmeden yazılan küfrü yazarken durdurur,
 *   • ana sayfayı bağlantı spam'ine kapatır,
 *   • sistem mesajı taklidini engeller.
 * Yapmadığı şey: kararlı bir kötü niyetliyi durdurmak. Onun için şikâyet
 * yolu ve yönetici gizlemesi var. Bu dosyanın "içerik güvenliği çözüldü"
 * anlamına geldiğini varsayan bir kod yazılmamalıdır.
 *
 * ── NEDEN NORMALLEŞTİRME ───────────────────────────────────────────────────
 * Ham metinde arama yapmak işe yaramaz: "s1kt1r", "s.i.k.t.i.r", "SİKTİR",
 * "siiiktir" hepsi aynı şeydir ve hiçbiri düz karşılaştırmayla yakalanmaz.
 * Bu yüzden metin önce tek bir biçime indirgenir, arama ondan sonra yapılır.
 */

/** Türkçe harflerin ASCII karşılıkları — normalleştirme için. */
const TR_MAP: Readonly<Record<string, string>> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  i: 'i',
  İ: 'i',
  I: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u',
};

/** Rakam ve simgeyle harf taklidi (leet) — "s1kt1r" gibi yazımlar için. */
const LEET_MAP: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
  '*': '',
};

/**
 * Metni tek bir karşılaştırma biçimine indirger.
 *
 * Adımların SIRASI önemlidir: önce harf birleştirme (küçük harf + Türkçe),
 * sonra leet, sonra araya serpiştirilmiş ayraçların temizliği, en sonda
 * tekrar eden harflerin sadeleştirilmesi. Ters sırada yapılırsa "s.1.k"
 * gibi bir yazım ilk adımda bozulup sonraki adımlarda yakalanamaz.
 */
export function normalizeForMatch(input: string): string {
  let text = input.toLowerCase();

  let mapped = '';
  for (const char of text) {
    mapped += TR_MAP[char] ?? LEET_MAP[char] ?? char;
  }
  text = mapped;

  // Aksanlı harfleri taban harfe indir (é → e). Türkçe eşlemesi zaten
  // yukarıda yapıldı; bu, geri kalan diller için ağ görevi görür.
  text = text.normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Harfler ARASINA serpiştirilmiş ayraçları at: "s.i.k", "s i k", "s-i-k".
  // Yalnızca tek karakterlik ayraç dizileri temizlenir; kelimeler arasındaki
  // normal boşluk korunur, yoksa bütün cümle tek kelimeye yapışır ve kelime
  // sınırı diye bir şey kalmaz.
  text = text.replace(/(?<=[a-z])[.\-_+'`]+(?=[a-z])/g, '');
  text = text.replace(/(?<=\b[a-z])\s(?=[a-z]\b)/g, '');

  // Tekrar eden harfleri ikiye indir: "siiiiktir" → "siiktir" → eşleşme için
  // sonra tekile inecek. İkiye indirmek, "kelle" gibi gerçek çift harfleri
  // korur.
  text = text.replace(/(.)\1{2,}/g, '$1$1');

  // Harf ve boşluk dışındaki her şeyi boşluğa çevir; boşlukları tekilleştir.
  text = text
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

/** Çift harfleri tekile indirilmiş biçim — "siiktir" → "siktir". */
function collapsed(text: string): string {
  return text.replace(/(.)\1+/g, '$1');
}

export type TextVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'PROFANITY' | 'LINK' | 'IMPERSONATION' | 'GIBBERISH' };

/** Bağlantı ve alan adı kalıpları — ana sayfaya spam taşınmasın. */
const LINK_PATTERNS: readonly RegExp[] = [
  /https?:\/\//i,
  /www\./i,
  /\b[a-z0-9-]+\.(com|net|org|io|co|tr|ru|xyz|info|biz|link|site|online|shop)\b/i,
  /\bt\.me\b/i,
  /@[a-z0-9_]{3,}\.[a-z]{2,}/i,
];

/**
 * Kapak başlığı gibi HERKESE AÇIK bir metni denetler.
 *
 * Dönen değer bir gerekçe taşır ama kullanıcıya gösterilecek cümleyi
 * ÜRETMEZ: hangi kelimenin yakalandığını söylemek, süzgeci atlatmayı
 * öğretmek olur. Çağıran taraf genel bir mesaj gösterir.
 */
export function checkPublicText(input: string): TextVerdict {
  const raw = input.trim();

  // ── Bağlantı ────────────────────────────────────────────────────────────
  // Ham metinde aranır: normalleştirme noktaları sildiği için alan adları
  // normalleşmiş metinde görünmez olur.
  for (const pattern of LINK_PATTERNS) {
    if (pattern.test(raw)) return { ok: false, reason: 'LINK' };
  }

  const text = normalizeForMatch(raw);
  const flat = collapsed(text);

  // ── Sistem mesajı taklidi ───────────────────────────────────────────────
  // "MEYDAN: hesabın kapatıldı" gibi bir başlık, ana sayfada ürünün kendi
  // sesi sanılır. Kullanıcının markayı ANMASI serbesttir; ürün adına
  // KONUŞMASI değil — ayrım iki nokta üst üste ve resmî sıfatlardadır.
  // İki nokta HAM metinde aranır: normalleştirme noktalama işaretlerini
  // boşluğa çevirdiği için "MEYDAN: ..." ile "MEYDAN tahminlerim" normalleşmiş
  // metinde birbirinden ayırt edilemez hâle gelir. Ayrımı yapan işaretin
  // kendisidir, o yüzden silinmeden önce bakılır.
  if (/^\s*meydan\s*[:\-–—]/i.test(raw)) return { ok: false, reason: 'IMPERSONATION' };
  if (/\bmeydan\s+(resmi|yonetim|yonetimi|ekibi|destek|admin|yonetici)\b/.test(text)) {
    return { ok: false, reason: 'IMPERSONATION' };
  }

  // ── Hakaret kalıpları ───────────────────────────────────────────────────
  for (const pattern of insultPatterns) {
    if (pattern.test(text) || pattern.test(flat)) return { ok: false, reason: 'PROFANITY' };
  }

  // ── Kelime listesi ──────────────────────────────────────────────────────
  // KELİME SINIRIYLA aranır. İçerik olarak aransaydı "eksik", "sıkıntı",
  // "yapışık" gibi masum kelimeler yakalanır ve ürün, küfür etmeyen
  // kullanıcıyı susturur.
  const words = new Set([...text.split(' '), ...flat.split(' ')]);
  for (const banned of bannedWords) {
    if (softWords.has(banned)) continue; // yalnızca kalıp içinde engellenir
    if (words.has(banned)) return { ok: false, reason: 'PROFANITY' };
  }

  // ── Anlamsız metin ──────────────────────────────────────────────────────
  // Tek harf tekrarı ("aaaaaaa") ya da hiç harf içermeyen bir başlık,
  // rafta yer kaplamaktan başka bir şey yapmaz.
  if (text.replace(/\s/g, '').length < 2) return { ok: false, reason: 'GIBBERISH' };
  if (/^(.)\1*$/.test(text.replace(/\s/g, ''))) return { ok: false, reason: 'GIBBERISH' };

  return { ok: true };
}

/** Kullanıcıya gösterilecek mesaj — hangi kelimenin yakalandığını SÖYLEMEZ. */
export function verdictMessage(reason: Exclude<TextVerdict, { ok: true }>['reason']): string {
  switch (reason) {
    case 'LINK':
      return 'Başlığa bağlantı koyulamıyor.';
    case 'IMPERSONATION':
      return 'Bu başlık MEYDAN adına yazılmış gibi görünüyor. Başka bir başlık seç.';
    case 'GIBBERISH':
      return 'Başlık anlaşılır bir metin olmalı.';
    case 'PROFANITY':
      return 'Bu başlık herkese açık bir sayfada görünecek. Kaba ifade içermeyen bir başlık seç.';
  }
}
