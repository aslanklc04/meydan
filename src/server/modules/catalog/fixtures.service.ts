import { and, eq, inArray, isNull, like, lt } from 'drizzle-orm';
import { db } from '@/server/db';
import { events, eventOutcomes } from '@/server/db/schema';
import { users } from '@/server/db/schema';
import { log } from '@/server/observability/logger';
import { catalogService } from './service';
import { resolutionService } from '@/server/modules/resolution/service';

/**
 * FİKSTÜR ENTEGRASYONU — TheSportsDB (Faz 7).
 *
 * ── NEDEN VAR ──────────────────────────────────────────────────────────────
 * Faz 3'ten kalan tekrarlayan şablon her gün şu soruyu üretiyordu:
 *
 *     "2026-09-08 tarihli günün maçını ev sahibi mi kazanacak?"
 *
 * HANGİ MAÇ? Takım adı olmayan bir soru ne tahmin edilebilir ne
 * sonuçlandırılabilir. Otomatik içerik üretimi, arkasında GERÇEK BİR VERİ
 * KAYNAĞI olmadan anlamsızdır. Bu modül o kaynağı bağlar.
 *
 * ── NEDEN football-data.org DEĞİL ──────────────────────────────────────────
 * Önce football-data.org bağlanmıştı. İki sebeple terk edildi:
 *
 *   1. ANAHTARSIZ SESSİZ BOŞLUK. Anahtar olmadan /matches ucu hata
 *      döndürmüyor; `{"resultSet":{"count":0},"matches":[]}` döndürüyor.
 *      Yani entegrasyon "çalışıyor" görünüp sonsuza kadar sıfır maç getirir
 *      ve kimse sebebini anlamaz. Bu, arızanın en kötü türüdür: sessiz olanı.
 *      (Lige özel uçlar ise anahtarsız 403 verir.)
 *   2. SÜPER LİG ÜCRETSİZ KATMANDA YOK. Türk kullanıcıya Bundesliga
 *      göstermek, ürünün en güçlü kancasını çöpe atmaktır.
 *
 * TheSportsDB ikisini birden çözer: belgelenmiş ücretsiz anahtarla çalışır
 * (KURULUM GEREKTİRMEZ) ve Süper Lig'i kapsar.
 *
 * ── KAPSAM: YALNIZCA "KİM KAZANIR" ────────────────────────────────────────
 * Üç sonuç üretilir: ev sahibi / beraberlik / deplasman. Alt-üst, çifte şans,
 * karşılıklı gol gibi bahis kuponu türleri BİLİNÇLİ OLARAK YOKTUR. Bunlar
 * bahis ürünlerinin pazar menüsüdür; MEYDAN'ın terminoloji kuralı (Faz 5) bu
 * dili yasaklar ve ürünün "beceriye dayalı tahmin oyunu" konumunu zayıflatır.
 *
 * ── NEDEN KENDİ KENDİNE SONUÇLANDIRIYOR ───────────────────────────────────
 * Sonuçlandırılmayan etkinlik, kullanıcının bağladığı çipin süresiz askıda
 * kalması demektir. Elle sonuçlandırma haftada onlarca maçta sürdürülemez ve
 * ilk unutulan maçta kullanıcı güvenini kaybedersin.
 *
 * Sonuçlandırma mevcut `resolutionService` üzerinden yapılır — çip defteri,
 * Meydan Okuma kapanışı ve itibar güncellemesi aynı yoldan geçer. Yan kapı
 * yoktur.
 */

/**
 * Sağlayıcı adresi. Ayarlanabilir olması TEST İÇİNDİR: entegrasyonun gerçekten
 * etkinlik açtığı, sahte bir sunucuya karşı uçtan uca doğrulanabilsin.
 * Üretimde ayarlanmaz.
 */
function apiBase(): string {
  return process.env.THESPORTSDB_BASE?.trim() || 'https://www.thesportsdb.com/api/v1/json';
}

/**
 * TheSportsDB'nin BELGELENMİŞ ücretsiz anahtarı (dakikada 30 istek).
 * Gizli bir değer değildir; sağlayıcının kendi belgesinde herkese açık yazar.
 * Bu yüzden kurucunun hiçbir yere hiçbir şey yazması gerekmez — modül
 * kutudan çıktığı gibi çalışır. Ücretli anahtar alınırsa THESPORTSDB_KEY
 * ayarlanır ve bu varsayılanı ezer.
 */
const FREE_KEY = '123';

/**
 * Kapsanan ligler. Her kimlik sağlayıcıya TEK TEK sorularak doğrulandı —
 * tahmin edilmedi:
 *
 *   4339 Süper Lig          4676 1. Lig
 *   4480 Şampiyonlar Ligi   4328 Premier Lig
 *   4335 La Liga            4332 Serie A          4331 Bundesliga
 *
 * NEDEN BU KADAR ÇOK: tek ligle, milli arada ya da hafta ortasında akış
 * boşalıyor. Kurucunun ilk canlı denemesinde yalnızca 2-3 maç geldi; sebep
 * kodun arızası değil, o hafta o ligde başka maç olmamasıydı. Yedi lig,
 * akışın her gün dolu kalmasını sağlar.
 *
 * İSTEK BÜTÇESİ: bir bakım koşusunda 7 (yaklaşanlar) + 7 (bitenler) +
 * en fazla 5 (gecikmiş) = 19 istek. Ücretsiz katmanın dakikada 30 istek
 * sınırının altında kalır. Lig eklerken bu hesabı gözden geçir.
 */
const DEFAULT_LEAGUES = '4339,4676,4480,4328,4335,4332,4331';

/** Etkinlik slug'ı dış maç kimliğini taşır: ayrı bir sütuna gerek kalmaz. */
const SLUG_PREFIX = 'mac-';

/**
 * Bir koşuda tek tek sorgulanacak en fazla gecikmiş maç.
 */
const MAX_STRAGGLER_LOOKUPS = 5;

/**
 * ── NEDEN "YAKLAŞANLAR" UCU YETMİYOR ───────────────────────────────────────
 *
 * `eventsnextleague.php` ücretsiz anahtarla lig başına YALNIZCA 1 maç
 * döndürüyor. Ölçüldü: Süper Lig → 1 maç, Premier Lig → 1 maç. Yani yedi lig
 * = yedi maç, hepsi bu. Kurucunun "çok az maç geliyor" gözlemi kodun arızası
 * değil, ucun sınırıydı.
 *
 * Denenen ve ELENEN diğer uçlar:
 *   • `eventsseason.php`  → ücretsiz anahtarla 15 satırda kesiliyor ve
 *                           sezonun BAŞINDAN veriyor; hepsi geçmiş maçlar.
 *   • `eventsday.php`     → tüm dünya için günde 3 satır döndürdü.
 *
 * ÇALIŞAN YOL: `eventsround.php` bir HAFTANIN tamamını veriyor — Süper Lig
 * 5. hafta için 9 maç. Hangi haftada olduğumuzu da "yaklaşanlar" ucundaki tek
 * maçın `intRound` alanı söylüyor. Yani: 1 istekle hafta numarasını öğren,
 * 1 istekle o haftanın tamamını al.
 */
const ROUNDS_AHEAD = 2;

/**
 * ── SAATLER NEDEN TEK TEK SORULUYOR ────────────────────────────────────────
 *
 * `eventsround.php` maç saatlerini YER TUTUCU olarak veriyor. Ölçüldü: aynı
 * maç (2527760) için hafta ucu "13 Eylül 12:00", tekil sorgu ve yaklaşanlar
 * ucu ise "11 Eylül 17:00" diyor — iki kaynak birbirini doğruluyor, hafta ucu
 * yanılıyor.
 *
 * Bu fark önemsiz değil: kapanış saati maçın başlangıcıdır. Yanlış saatle
 * açılan bir etkinlik ya maç başladıktan sonra tahmin almaya devam eder (ki
 * bu yarışı bozar) ya da maçtan iki gün önce kapanır.
 *
 * Bu yüzden hafta ucu yalnızca KEŞİF için kullanılır; her yeni maçın saati
 * `lookupevent.php` ile tek tek doğrulanır.
 */
const MAX_NEW_PER_RUN = 12;

/**
 * Bir koşuda yapılacak en fazla istek.
 *
 * Ücretsiz katman dakikada 30 istek veriyor. Bütçe: 7 lig × (1 yaklaşan +
 * 2 hafta) = 21, üstüne en fazla 12 saat doğrulaması ve 7 biten-maç sorgusu
 * — toplam sınırı aşar. Bu yüzden koşu bütçeyle sınırlanır ve KALDIĞI YERDEN
 * DEĞİL, her seferinde eksik olanla devam eder: katalog birkaç koşuda dolar.
 * Bir koşuda her şeyi almaya çalışmak, sağlayıcının kapıyı yüzümüze
 * kapatmasıyla biter.
 */
const MAX_API_CALLS_PER_RUN = 26;

/** Maçın bittiğini kabul ettiğimiz durumlar. */
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'Match Finished', 'FINISHED']);

/**
 * Maçın bir daha OYNANMAYACAĞI durumlar. Bunlar iade edilir: ertelenen maç
 * aylar sonra oynanabilir ve o zamana kadar kullanıcının çipi askıda kalır.
 */
const ABANDONED_STATUSES = new Set([
  'PST',
  'Postponed',
  'CANC',
  'Cancelled',
  'ABD',
  'Abandoned',
  'AWD',
  'WO',
]);

export type FixtureReport = {
  readonly imported: number;
  readonly resolved: number;
  readonly skipped: number;
};

type ApiEvent = {
  readonly idEvent?: string;
  readonly strHomeTeam?: string | null;
  readonly strAwayTeam?: string | null;
  readonly strTimestamp?: string | null;
  readonly dateEvent?: string | null;
  readonly strTime?: string | null;
  readonly strStatus?: string | null;
  readonly intHomeScore?: string | null;
  readonly intAwayScore?: string | null;
  readonly strHomeTeamBadge?: string | null;
  readonly strAwayTeamBadge?: string | null;
  readonly intRound?: string | null;
  readonly strSeason?: string | null;
};

/**
 * Arma adresi — yalnızca sağlayıcının kendi görsel sunucusundan kabul edilir.
 *
 * Dış adres doğrudan `<img src>` içine konacağı için süzülür: kaynağı
 * denetlenmeyen bir adres, veri kaynağı bir gün ele geçirilirse ya da hatalı
 * veri gönderirse sayfaya istenmeyen içerik taşıyabilir. Beyaz liste, bu
 * riski en başta keser.
 */
function badgeUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return null;
    if (!parsed.hostname.endsWith('thesportsdb.com')) return null;
    return value.slice(0, 300);
  } catch {
    return null;
  }
}

/**
 * Var olan bir etkinliğin EKSİK armalarını tamamlar.
 *
 * `isNull(imageUrl)` koşulu bu işi güvenli kılan şeydir: yalnızca hiç arma
 * olmayan satıra yazar. Koşul olmasaydı, her içeri alma turunda kayıtlı
 * armalar yeniden yazılırdı ve kaynaktaki geçici bir bozulma (boş alan, ölü
 * adres) sessizce iyi veriyi silerdi. Tamamlama, güncelleme değildir.
 *
 * Beraberlik seçeneğine dokunulmaz — bir takım değildir, arması olamaz.
 */
async function backfillBadges(
  eventId: string,
  badges: Readonly<Record<'HOME' | 'AWAY', string | null>>,
): Promise<void> {
  for (const key of ['HOME', 'AWAY'] as const) {
    const url = badges[key];
    if (!url) continue;
    await db
      .update(eventOutcomes)
      .set({ imageUrl: url })
      .where(
        and(
          eq(eventOutcomes.eventId, eventId),
          eq(eventOutcomes.key, key),
          isNull(eventOutcomes.imageUrl),
        ),
      );
  }
}

function apiKey(): string {
  return process.env.THESPORTSDB_KEY?.trim() || FREE_KEY;
}

function leagues(): string[] {
  const raw = process.env.THESPORTSDB_LEAGUES?.trim() || DEFAULT_LEAGUES;
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id));
}

/**
 * Takım adı. Boş ad, cevaplanamayan soru demektir; null döner ve maç atlanır.
 */
function teamName(raw: string | null | undefined): string | null {
  const name = raw?.trim();
  return name && name.length > 0 ? name.slice(0, 80) : null;
}

/**
 * Başlama anı. `strTimestamp` UTC'dir ama sonunda 'Z' TAŞIMAZ; bu, ham hâliyle
 * `new Date()`e verilirse sunucunun yerel saatine göre yorumlanır ve maç
 * saatleri saatlerce kayar. Bu yüzden zaman dilimi eki yoksa açıkça eklenir.
 */
function kickoffAt(event: ApiEvent): Date | null {
  const stamp = event.strTimestamp?.trim();
  if (stamp) {
    const normalized = /[Z+]|-\d{2}:\d{2}$/.test(stamp.slice(10)) ? stamp : `${stamp}Z`;
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const date = event.dateEvent?.trim();
  const time = event.strTime?.trim();
  if (date) {
    const parsed = new Date(`${date}T${time && time.length >= 5 ? time.slice(0, 8) : '00:00:00'}Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

async function callApi(path: string): Promise<{ events?: ApiEvent[] | null } | null> {
  try {
    const response = await fetch(`${apiBase()}/${apiKey()}${path}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      // Anahtar günlüğe YAZILMAZ; yalnızca durum kodu.
      log.error('fixtures.api_failed', {
        operation: 'fixtures.fetch',
        outcome: 'failure',
        status: response.status,
      });
      return null;
    }
    return (await response.json()) as { events?: ApiEvent[] | null };
  } catch (error) {
    log.error('fixtures.api_error', { operation: 'fixtures.fetch', outcome: 'failure', error });
    return null;
  }
}

/** Etkinliği açacak yönetici. Yoksa içe aktarma yapılmaz. */
async function adminId(): Promise<string | null> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'ADMIN'))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Bir maçın etkinliğine NE YAPILACAĞI.
 *
 * ÜÇ AYRI DURUM VARDIR ve bunları birbirine karıştırmak pahalıya patlar:
 *
 *   • BİTMEDİ        → hiç dokunma. Henüz oynanmamış ya da OYNANMAKTA olan
 *                      bir maçı sonuçlandırmak, kullanıcının çipini maç
 *                      sürerken elinden almak demektir.
 *   • BİTTİ          → skoru oku, kazananı yaz.
 *   • BİTTİ AMA SKOR OKUNAMIYOR / MAÇ İPTAL → iade et.
 *
 * İlk sürümde "bitmedi" ile "skor okunamıyor" aynı kefeye konmuştu ve
 * oynanmakta olan maçlar iade ediliyordu. Test bunu yakaladı.
 */
type FixtureDecision =
  | { readonly action: 'skip' }
  | { readonly action: 'resolve'; readonly key: 'HOME' | 'DRAW' | 'AWAY' }
  | { readonly action: 'void' };

function decide(event: ApiEvent): FixtureDecision {
  const status = event.strStatus?.trim() ?? '';

  if (ABANDONED_STATUSES.has(status)) return { action: 'void' };
  if (!FINISHED_STATUSES.has(status)) return { action: 'skip' };

  const home = Number(event.intHomeScore);
  const away = Number(event.intAwayScore);
  if (
    event.intHomeScore == null ||
    event.intAwayScore == null ||
    event.intHomeScore === '' ||
    event.intAwayScore === '' ||
    Number.isNaN(home) ||
    Number.isNaN(away)
  ) {
    return { action: 'void' };
  }
  return { action: 'resolve', key: home > away ? 'HOME' : away > home ? 'AWAY' : 'DRAW' };
}

/**
 * Bir maçtan etkinlik açar. Zaten varsa yalnızca eksik armaları tamamlar.
 *
 * `event` TEKİL SORGUDAN gelmelidir: hafta ucunun saatleri yer tutucudur ve
 * kapanış saati yanlış olursa etkinlik ya maç başladıktan sonra tahmin
 * almaya devam eder ya da maçtan iki gün önce kapanır.
 */
async function upsertFixture(
  event: ApiEvent,
  owner: string,
): Promise<'imported' | 'existed' | 'skipped'> {
  const home = teamName(event.strHomeTeam);
  const away = teamName(event.strAwayTeam);
  const kickoff = kickoffAt(event);
  const id = event.idEvent?.trim();

  // Takım adı, kimlik ya da geçerli saat yoksa etkinlik AÇILMAZ:
  // cevaplanamayan soru üretmemek bu modülün varlık sebebidir.
  if (!id || !home || !away || !kickoff || kickoff <= new Date()) return 'skipped';

  const slug = `${SLUG_PREFIX}${id}`;
  const existing = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.slug, slug))
    .limit(1);

  if (existing[0]) {
    /*
     * ── ESKİ ETKİNLİKLERE ARMA TAMAMLAMA ────────────────────────────────
     *
     * Arma alanı sonradan eklendi. Bu satır olmadan, alan eklenmeden ÖNCE
     * içeri alınmış maçlar ömür boyu armasız kalırdı: içeri alma işi
     * onları "zaten var" diye atlıyor ve bir daha hiç dokunmuyordu.
     * Canlıda tam olarak bu görüldü.
     *
     * YALNIZCA BOŞ OLANI DOLDURUR. Var olan armanın üstüne yazılmaz;
     * etiketler, saatler ve başka hiçbir alan değiştirilmez. Bir tamamlama
     * işi, bir güncelleme işine dönüşmemelidir: kullanıcının gördüğü
     * etiketin altından değişmesi, tahminini neye göre yaptığını
     * belirsizleştirir.
     */
    await backfillBadges(existing[0].id, {
      HOME: badgeUrl(event.strHomeTeamBadge),
      AWAY: badgeUrl(event.strAwayTeamBadge),
    });
    return 'existed';
  }

  await catalogService.createEvent({
    categorySlug: 'spor',
    title: `${home} — ${away}`,
    question: 'Bu maçı kim kazanacak?',
    slug,
    // Tahminler ilk düdükte kapanır: maç başladıktan sonra tahmin alınması
    // yarışı bozar.
    closesAt: kickoff,
    resolvesAt: new Date(kickoff.getTime() + 2.5 * 3600_000),
    outcomes: [
      { key: 'HOME', label: home, imageUrl: badgeUrl(event.strHomeTeamBadge) },
      { key: 'DRAW', label: 'Beraberlik' },
      { key: 'AWAY', label: away, imageUrl: badgeUrl(event.strAwayTeamBadge) },
    ],
    createdById: owner,
    status: 'OPEN',
  });
  return 'imported';
}

export const fixturesService = {
  /**
   * Yaklaşan maçları etkinliğe çevirir.
   *
   * ── ÜÇ ADIM ────────────────────────────────────────────────────────────
   * 1. Lig başına "yaklaşanlar" ucu: tek maç döner ama HANGİ HAFTADA
   *    olduğumuzu söyler (`intRound`) ve saati doğrudur.
   * 2. O hafta ve bir sonraki hafta için "hafta" ucu: haftanın tamamı
   *    (Süper Lig'de 9 maç). Buradan yalnızca KİMLİKLER alınır.
   * 3. Sistemde olmayan her kimlik tek tek sorgulanır — saati oradan gelir.
   *
   * Neden böyle: ölçüldü, "yaklaşanlar" ucu ücretsiz anahtarla lig başına
   * yalnızca 1 maç veriyor. Yedi lig = yedi maç. Hafta ucu ise haftanın
   * tamamını veriyor ama saatleri yer tutucu. İkisi birlikte hem sayıyı hem
   * doğruluğu sağlıyor.
   *
   * İSTEK BÜTÇESİ: bir koşuda en fazla `MAX_API_CALLS_PER_RUN` istek. Bütçe
   * dolunca koşu durur; katalog birkaç koşuda dolar. Bir koşuda her şeyi
   * almaya çalışmak, sağlayıcının kapıyı kapatmasıyla biter.
   */
  async importUpcoming(): Promise<{ imported: number; skipped: number }> {
    const owner = await adminId();
    if (!owner) {
      log.warn('fixtures.no_admin', { operation: 'fixtures.import' });
      return { imported: 0, skipped: 0 };
    }

    let imported = 0;
    let skipped = 0;
    let calls = 0;
    let created = 0;

    /** Bu koşuda görülen, sistemde OLMAYAN maç kimlikleri. */
    const discovered = new Map<string, ApiEvent>();

    for (const league of leagues()) {
      if (calls >= MAX_API_CALLS_PER_RUN) break;

      // ── 1. Hangi haftadayız ───────────────────────────────────────────
      calls += 1;
      const next = await callApi(`/eventsnextleague.php?id=${league}`);
      const upcoming = next?.events ?? [];
      const anchor = upcoming[0];
      if (!anchor) continue;

      /*
       * Bu uçtan gelen maçların saatleri DOĞRUDUR, o yüzden hepsi hemen
       * işlenir — yalnızca ilki değil.
       *
       * Ücretsiz anahtarla bu liste bugün tek satır dönüyor; ama ücretli bir
       * anahtar alınırsa 15 satır dönecek ve o zaman "yalnızca ilkini al"
       * demek, doğru saatli on dört maçı çöpe atmak olurdu. Kod, kaynağın
       * bugünkü cimriliğine göre değil verdiği şeye göre yazılır.
       */
      for (const event of upcoming) {
        const outcome = await upsertFixture(event, owner);
        if (outcome === 'imported') imported += 1;
        else skipped += 1;
      }

      const round = Number(anchor.intRound);
      const season = anchor.strSeason?.trim();
      // Sezon ve hafta numarası TAHMİN EDİLMEZ. Sağlayıcı vermiyorsa bu lig
      // için hafta keşfi yapılmaz; uydurulan bir sezon dizgisi boş yanıt
      // döndürür ve bütçeyi boşa harcar.
      if (!season || !Number.isInteger(round) || round <= 0) continue;

      // ── 2. Haftanın tamamı ────────────────────────────────────────────
      for (let r = round; r < round + ROUNDS_AHEAD; r++) {
        if (calls >= MAX_API_CALLS_PER_RUN) break;
        calls += 1;
        const roundData = await callApi(
          `/eventsround.php?id=${league}&r=${r}&s=${encodeURIComponent(season)}`,
        );
        for (const event of roundData?.events ?? []) {
          const id = event.idEvent?.trim();
          if (!id || discovered.has(id)) continue;
          discovered.set(id, event);
        }
      }
    }

    // ── 3. Saatleri tek tek doğrula ──────────────────────────────────────
    // Sistemde zaten olan maçlar için tekil sorgu YAPILMAZ: bütçe yalnızca
    // gerçekten yeni olanlara harcanır.
    for (const [id] of discovered) {
      if (calls >= MAX_API_CALLS_PER_RUN || created >= MAX_NEW_PER_RUN) break;

      const existing = await db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.slug, `${SLUG_PREFIX}${id}`))
        .limit(1);
      if (existing[0]) continue;

      calls += 1;
      const detail = await callApi(`/lookupevent.php?id=${id}`);
      const event = detail?.events?.[0];
      if (!event) {
        skipped += 1;
        continue;
      }

      const outcome = await upsertFixture(event, owner);
      if (outcome === 'imported') {
        imported += 1;
        created += 1;
      } else {
        skipped += 1;
      }
    }

    log.info('fixtures.imported', {
      operation: 'fixtures.import',
      imported,
      skipped,
      calls,
      discovered: discovered.size,
    });
    return { imported, skipped };
  },

  /**
   * Biten maçların etkinliklerini sonuçlandırır.
   *
   * İki aşama: önce lig başına "son biten maçlar" taranır (ucuz, toplu).
   * Sonra hâlâ açık kalmış GECİKMİŞ maçlar tek tek sorgulanır — bakım işi
   * günlerce çalışmazsa toplu listeden düşen maçlar da eninde sonunda
   * sonuçlanır. Tek tek sorgu sayısı sınırlıdır (istek bütçesi).
   *
   * Yalnızca bu modülün açtığı etkinliklere dokunulur (slug öneki). Elle
   * açılmış etkinlikleri otomatik sonuçlandırmak, yöneticinin kararını
   * gasp etmek olurdu.
   */
  async resolveFinished(): Promise<number> {
    const owner = await adminId();
    if (!owner) return 0;

    const open = await db
      .select({ id: events.id, slug: events.slug })
      .from(events)
      .where(and(like(events.slug, `${SLUG_PREFIX}%`), inArray(events.status, ['OPEN', 'CLOSED'])))
      .limit(200);
    if (open.length === 0) return 0;

    const bySlug = new Map(open.map((e) => [e.slug, e.id]));
    const seen = new Set<string>();
    let resolved = 0;

    const apply = async (event: ApiEvent): Promise<void> => {
      const id = event.idEvent?.trim();
      if (!id) return;
      const slug = `${SLUG_PREFIX}${id}`;
      const eventId = bySlug.get(slug);
      if (!eventId || seen.has(slug)) return;

      const verdict = decide(event);
      // BİTMEMİŞ maça dokunulmaz — `seen`'e de yazılmaz ki sonraki
      // koşuda yeniden bakılabilsin.
      if (verdict.action === 'skip') return;
      seen.add(slug);

      let outcomeId: string | null = null;
      if (verdict.action === 'resolve') {
        const rows = await db
          .select({ id: eventOutcomes.id })
          .from(eventOutcomes)
          .where(and(eq(eventOutcomes.eventId, eventId), eq(eventOutcomes.key, verdict.key)))
          .limit(1);
        outcomeId = rows[0]?.id ?? null;
        if (!outcomeId) return; // beklenmeyen durum: elle bakılsın
      }

      try {
        await resolutionService.resolve({
          eventId,
          outcomeId,
          decision: verdict.action === 'resolve' ? 'RESOLVED' : 'VOID',
          resolvedById: owner,
          note: 'TheSportsDB',
        });
        resolved += 1;
      } catch (error) {
        // Tek maçın hatası diğerlerini durdurmaz.
        log.error('fixtures.resolve_failed', {
          operation: 'fixtures.resolve',
          outcome: 'failure',
          eventId,
          error,
        });
      }
    };

    // 1) Toplu tarama.
    for (const league of leagues()) {
      const data = await callApi(`/eventspastleague.php?id=${league}`);
      for (const event of data?.events ?? []) await apply(event);
    }

    // 2) Gecikmiş maçlar: kapanış saati 3 saatten eski, hâlâ açık.
    const stale = await db
      .select({ slug: events.slug })
      .from(events)
      .where(
        and(
          like(events.slug, `${SLUG_PREFIX}%`),
          inArray(events.status, ['OPEN', 'CLOSED']),
          lt(events.closesAt, new Date(Date.now() - 3 * 3600_000)),
        ),
      )
      .limit(MAX_STRAGGLER_LOOKUPS);

    for (const row of stale) {
      if (seen.has(row.slug)) continue;
      const id = row.slug.slice(SLUG_PREFIX.length);
      if (!/^\d+$/.test(id)) continue;
      const data = await callApi(`/lookupevent.php?id=${id}`);
      for (const event of data?.events ?? []) await apply(event);
    }

    if (resolved > 0) log.info('fixtures.resolved', { operation: 'fixtures.resolve', resolved });
    return resolved;
  },

  /** Bakım işinin çağırdığı tek giriş noktası. */
  async run(): Promise<FixtureReport> {
    const { imported, skipped } = await this.importUpcoming();
    const resolved = await this.resolveFinished();
    return { imported, resolved, skipped };
  },
};
