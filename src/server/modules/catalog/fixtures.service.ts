import { and, eq, inArray, like } from 'drizzle-orm';
import { db } from '@/server/db';
import { events, eventOutcomes } from '@/server/db/schema';
import { users } from '@/server/db/schema';
import { log } from '@/server/observability/logger';
import { catalogService } from './service';
import { resolutionService } from '@/server/modules/resolution/service';

/**
 * FİKSTÜR ENTEGRASYONU — football-data.org (Faz 7).
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
 * ── KAPSAM: YALNIZCA "KİM KAZANIR" ────────────────────────────────────────
 * Üç sonuç üretilir: ev sahibi / beraberlik / deplasman. Alt-üst, çifte şans,
 * karşılıklı gol gibi bahis kuponu türleri BİLİNÇLİ OLARAK YOKTUR. Bunlar
 * bahis ürünlerinin pazar menüsüdür; MEYDAN'ın terminoloji kuralı (Faz 5) bu
 * dili yasaklar ve ürünün "beceriye dayalı tahmin oyunu" konumunu zayıflatır.
 *
 * ── NEDEN KENDİ KENDİNE SONUÇLANDIRIYOR ───────────────────────────────────
 * Sonuçlandırılmayan etkinlik, kullanıcının bağladığı çipin süresiz askıda
 * kalması demektir. Elle sonuçlandırma haftada onlarca maçta sürdürülemez ve
 * ilk unutulan maçta kullanıcı güvenini kaybedersin. Maç bittiğinde skor
 * zaten API'de olduğuna göre, sonucu okumak ve yazmak doğal olanıdır.
 *
 * Sonuçlandırma mevcut `resolutionService` üzerinden yapılır — çip defteri,
 * Meydan Okuma kapanışı ve itibar güncellemesi aynı yoldan geçer. Yan kapı
 * yoktur.
 *
 * ── ANAHTAR YOKSA ─────────────────────────────────────────────────────────
 * `FOOTBALL_DATA_TOKEN` tanımlı değilse modül sessizce devre dışı kalır ve
 * bakım işi çalışmaya devam eder. Bir içerik kaynağının eksikliği, iade ve
 * kapanış gibi kritik işleri durdurmamalıdır.
 */

const API_BASE = 'https://api.football-data.org/v4';

/**
 * Ücretsiz katmanın kapsadığı turnuvalar. Süper Lig ücretsiz katmanda YOKTUR
 * (football-data.org kapsam tablosundan doğrulandı); Şampiyonlar Ligi vardır
 * ve Türk takımları orada oynar.
 */
const DEFAULT_COMPETITIONS = 'CL,PL,PD,SA,BL1,FL1';

/** Etkinlik slug'ı dış maç kimliğini taşır: ayrı bir sütuna gerek kalmaz. */
const SLUG_PREFIX = 'mac-';

export type FixtureReport = {
  readonly imported: number;
  readonly resolved: number;
  readonly skipped: number;
};

type ApiMatch = {
  readonly id: number;
  readonly utcDate: string;
  readonly status: string;
  readonly competition?: { readonly name?: string };
  readonly homeTeam?: { readonly name?: string; readonly shortName?: string };
  readonly awayTeam?: { readonly name?: string; readonly shortName?: string };
  readonly score?: { readonly winner?: string | null };
};

function token(): string | undefined {
  return process.env.FOOTBALL_DATA_TOKEN?.trim() || undefined;
}

function competitions(): string {
  return process.env.FOOTBALL_DATA_COMPETITIONS?.trim() || DEFAULT_COMPETITIONS;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Takım adı: kısa ad varsa o (arayüzde daha okunur), yoksa tam ad. */
function teamName(team: ApiMatch['homeTeam']): string | null {
  const name = team?.shortName?.trim() || team?.name?.trim();
  return name && name.length > 0 ? name.slice(0, 80) : null;
}

async function callApi(path: string): Promise<{ matches?: ApiMatch[] } | null> {
  const key = token();
  if (!key) return null;

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { 'X-Auth-Token': key },
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
    return (await response.json()) as { matches?: ApiMatch[] };
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

export const fixturesService = {
  /**
   * Önümüzdeki günlerin maçlarını etkinliğe çevirir.
   *
   * TEK İSTEK: bütün turnuvalar `competitions` parametresiyle birlikte
   * sorgulanır. Ücretsiz plan dakikada 10 istek verir; her turnuva için ayrı
   * istek atmak hem gereksiz hem sınırı zorlar.
   */
  async importUpcoming(daysAhead = 3): Promise<{ imported: number; skipped: number }> {
    const owner = await adminId();
    if (!owner) {
      log.warn('fixtures.no_admin', { operation: 'fixtures.import' });
      return { imported: 0, skipped: 0 };
    }

    const from = new Date();
    const to = new Date(from.getTime() + daysAhead * 24 * 3600_000);
    const data = await callApi(
      `/matches?competitions=${competitions()}&dateFrom=${iso(from)}&dateTo=${iso(to)}`,
    );
    if (!data?.matches) return { imported: 0, skipped: 0 };

    let imported = 0;
    let skipped = 0;

    for (const match of data.matches) {
      if (match.status !== 'SCHEDULED' && match.status !== 'TIMED') {
        skipped += 1;
        continue;
      }

      const home = teamName(match.homeTeam);
      const away = teamName(match.awayTeam);
      const kickoff = new Date(match.utcDate);

      // Takım adı ya da geçerli saat yoksa etkinlik AÇILMAZ: cevaplanamayan
      // soru üretmemek bu modülün varlık sebebidir.
      if (!home || !away || Number.isNaN(kickoff.getTime()) || kickoff <= new Date()) {
        skipped += 1;
        continue;
      }

      const slug = `${SLUG_PREFIX}${match.id}`;
      const existing = await db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.slug, slug))
        .limit(1);
      if (existing[0]) {
        skipped += 1;
        continue;
      }

      await catalogService.createEvent({
        categorySlug: 'spor',
        title: `${home} — ${away}`,
        question: 'Bu maçı kim kazanacak?',
        slug,
        // Tahminler ilk düdükte kapanır: maç başladıktan sonra tahmin
        // alınması yarışı bozar.
        closesAt: kickoff,
        resolvesAt: new Date(kickoff.getTime() + 2.5 * 3600_000),
        outcomes: [
          { key: 'HOME', label: home },
          { key: 'DRAW', label: 'Beraberlik' },
          { key: 'AWAY', label: away },
        ],
        createdById: owner,
        status: 'OPEN',
      });
      imported += 1;
    }

    if (imported > 0) log.info('fixtures.imported', { operation: 'fixtures.import', imported });
    return { imported, skipped };
  },

  /**
   * Biten maçların etkinliklerini sonuçlandırır.
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
      .limit(100);

    if (open.length === 0) return 0;

    const ids = open.map((e) => e.slug.slice(SLUG_PREFIX.length)).filter((id) => /^\d+$/.test(id));
    if (ids.length === 0) return 0;

    const data = await callApi(`/matches?ids=${ids.join(',')}`);
    if (!data?.matches) return 0;

    const bySlug = new Map(open.map((e) => [e.slug, e.id]));
    let resolved = 0;

    for (const match of data.matches) {
      if (match.status !== 'FINISHED') continue;

      const eventId = bySlug.get(`${SLUG_PREFIX}${match.id}`);
      if (!eventId) continue;

      // API'nin kazanan alanı MEYDAN'ın sonuç anahtarına eşlenir.
      const winner = match.score?.winner;
      const key =
        winner === 'HOME_TEAM'
          ? 'HOME'
          : winner === 'AWAY_TEAM'
            ? 'AWAY'
            : winner === 'DRAW'
              ? 'DRAW'
              : null;

      // Kazanan belirsizse (hükmen, iptal, eksik veri) etkinlik BOŞA
      // ÇIKARILIR: çipler iade edilir, kimse haksız kaybetmez.
      const decision: 'RESOLVED' | 'VOID' = key ? 'RESOLVED' : 'VOID';

      let outcomeId: string | null = null;
      if (key) {
        const rows = await db
          .select({ id: eventOutcomes.id })
          .from(eventOutcomes)
          .where(and(eq(eventOutcomes.eventId, eventId), eq(eventOutcomes.key, key)))
          .limit(1);
        outcomeId = rows[0]?.id ?? null;
        if (!outcomeId) continue; // beklenmeyen durum: elle bakılsın
      }

      try {
        await resolutionService.resolve({
          eventId,
          outcomeId,
          decision,
          resolvedById: owner,
          note: 'football-data.org',
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
    }

    if (resolved > 0) log.info('fixtures.resolved', { operation: 'fixtures.resolve', resolved });
    return resolved;
  },

  /** Bakım işinin çağırdığı tek giriş noktası. */
  async run(): Promise<FixtureReport> {
    if (!token()) return { imported: 0, resolved: 0, skipped: 0 };

    const { imported, skipped } = await this.importUpcoming();
    const resolved = await this.resolveFinished();
    return { imported, resolved, skipped };
  },
};
