import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { events, eventOutcomes, predictions, users } from '@/server/db/schema';
import type { ConsensusSnapshot } from '@/server/db/schema/catalog';
import { socialProof } from '@/config/social-proof';

/** Transaction ya da havuz — servis her ikisiyle de çalışır. */
type Ctx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/**
 * KONSENSÜS — "önce sen söyle, sonra kalabalığı gör" (Faz 8).
 *
 * ── NEDEN SUNUCUDA GİZLENİYOR ──────────────────────────────────────────────
 * Dağılımı istemciye gönderip CSS ile gizlemek, gizlemek DEĞİLDİR: veri
 * sayfanın kaynağındadır, ağ sekmesinde görünür ve meraklı bir kullanıcı
 * saniyeler içinde okur. Daha önemlisi, ürünün kendi ölçümünü bozar.
 *
 * Muchnik, Aral ve Taylor'ın 2013 tarihli rastgele kontrollü saha deneyi
 * (Science 341:647-651), önceden görülen tek bir olumlu oyun sonraki
 * değerlendirmeleri ortalamada %25 yukarı çektiğini gösterdi. Yani kalabalığı
 * önce göstermek, kullanıcının kendi görüşünü kaydetmesini engeller ve
 * topladığın veri artık "insanlar ne düşünüyor" değil, "insanlar çoğunluğa
 * ne kadar uyuyor" olur. Bu, MEYDAN'ın ölçmek istediği şeyin tam tersidir.
 *
 * Bu yüzden kural sunucuda uygulanır: TAHMİN YAPMAMIŞ KULLANICIYA DAĞILIM
 * HİÇ GÖNDERİLMEZ. Gönderilen tek şey toplam katılımcı sayısıdır — o da
 * merak uyandırır ama yön göstermez.
 *
 * ── NEDEN KAPANIŞTA DONDURULUYOR ───────────────────────────────────────────
 * "Topluluğun yalnızca %18'i seninle aynı taraftaydı" ifadesi, tahmin
 * anındaki gerçeği anlatır. Canlı sorguyla üretilirse paylaşılmış bir kart
 * aylar sonra başka bir yüzde gösterir. Bir kez paylaşılan iddianın sonradan
 * değişmesi, ürünün bütün güven vaadini çürütür.
 */

export type ConsensusView =
  | {
      /** Kullanıcı henüz taraf seçmedi: dağılım GÖNDERİLMEZ. */
      readonly revealed: false;
      readonly total: number;
    }
  | {
      readonly revealed: true;
      readonly total: number;
      /** Yalnızca örneklem yeterliyse doldurulur. */
      readonly shares: readonly { readonly outcomeId: string; readonly share: number }[] | null;
      readonly counts: readonly { readonly outcomeId: string; readonly count: number }[];
      /** Kullanıcının kendisi dışındaki katılımcı sayısı. */
      readonly othersTotal: number;
      /** Kullanıcının kendisi dışındakilerden kaçı onunla aynı tarafta. */
      readonly othersWithUser: number;
      /**
       * DİĞERLERİNİN kullanıcıyla aynı taraftaki payı — kullanıcının kendisi
       * bu orana DAHİL DEĞİLDİR. Örneklem yetersizse null.
       */
      readonly userShare: number | null;
      readonly position: 'MINORITY' | 'MAJORITY' | 'SPLIT' | null;
      /** Kapanışta dondurulmuş veriden mi geliyor? */
      readonly frozen: boolean;
    };

/**
 * Canlı sayım — YALNIZCA gerçek kullanıcıların tahminleri.
 *
 * MİSAFİR SEÇİMLERİ BURADA HİÇ YOKTUR ve olamaz: misafir seçimi veritabanına
 * yazılmaz, yalnızca tarayıcıda tutulur. Yani "misafir oyu konsensüse
 * karışmasın" kuralı bir filtreyle değil, bir TASARIM KARARIYLA sağlanır —
 * filtre unutulabilir, var olmayan kayıt sızamaz.
 *
 * Silinmiş hesaplar dışarıda bırakılır. Sahte ya da sistem hesabı yoktur;
 * ürün hiç üretmez.
 */
async function liveCounts(eventId: string, ctx: Ctx = db): Promise<ConsensusSnapshot> {
  const rows = await ctx
    .select({
      outcomeId: predictions.outcomeId,
      count: sql<number>`count(*)::int`,
    })
    .from(predictions)
    .innerJoin(users, eq(users.id, predictions.userId))
    .where(and(eq(predictions.eventId, eventId), isNull(users.deletedAt)))
    .groupBy(predictions.outcomeId);

  const counts: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    counts[row.outcomeId] = row.count;
    total += row.count;
  }
  return { counts, total };
}

function position(share: number): 'MINORITY' | 'MAJORITY' | 'SPLIT' {
  if (share < socialProof.minorityThreshold) return 'MINORITY';
  if (share > socialProof.majorityThreshold) return 'MAJORITY';
  return 'SPLIT';
}

export const consensusService = {
  /**
   * Bir etkinliğin konsensüsünü, İZLEYENİN DURUMUNA GÖRE döndürür.
   *
   * `viewerOutcomeId` null ise (tahmin yapılmamışsa) dağılım hiç hesaplanmaz
   * ve gönderilmez.
   */
  async view(
    eventId: string,
    viewerOutcomeId: string | null,
    ctx: Ctx = db,
  ): Promise<ConsensusView> {
    const rows = await ctx
      .select({
        snapshot: events.consensusSnapshot,
        frozenAt: events.consensusFrozenAt,
      })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    const frozen = rows[0]?.snapshot ?? null;
    const data = frozen ?? (await liveCounts(eventId, ctx));

    if (!viewerOutcomeId) {
      // Toplam sayı güvenle gösterilebilir: merak uyandırır, yön göstermez.
      return { revealed: false, total: data.total };
    }

    const counts = Object.entries(data.counts).map(([outcomeId, count]) => ({
      outcomeId,
      count: Number(count),
    }));
    const enough = data.total >= socialProof.minSampleForPercentage;

    // Örneklem yetersizse yüzde ÜRETİLMEZ. Yuvarlanmış bir "%67", arkasında
    // üç kişi varken sahte sosyal kanıttır.
    const shares = enough
      ? counts.map((c) => ({ outcomeId: c.outcomeId, share: c.count / data.total }))
      : null;

    /*
     * ── KENDİ CEVABINI KALABALIKTAN ÇIKAR ───────────────────────────────────
     *
     * Dağılım çubukları HERKESİ sayar — "10 kişiden 4'ü ev sahibi dedi"
     * etkinlik hakkında bir olgudur ve kullanıcı da o ondan biridir.
     *
     * Ama "azınlıktasın / çoğunluktasın" farklı bir cümledir: kullanıcının
     * DIŞINDAKİLER hakkında bir iddiadır. Kendini de sayarsan kendini kendinle
     * doğrulamış olursun ve sayı küçüldükçe yanılgı büyür. Uç örnek: tek
     * tahmin sahibi sensin, kendini sayarsan payın %100 çıkar ve ürün sana
     * "çoğunluktasın" der — oysa ortada senden başka kimse yoktur.
     *
     * Doğru bölen `total - 1`, doğru pay `own - 1`'dir. Kullanıcı verinin
     * içinde bulunamazsa (silinmiş hesap, donmadan sonra yazılmış kayıt gibi
     * beklenmedik durumlar) çıkarma yapılmaz; olmayan bir kaydı çıkarmak
     * sayıyı bozar.
     */
    const own = data.counts[viewerOutcomeId] ?? 0;
    const viewerCounted = own > 0 && data.total > 0;
    const othersTotal = viewerCounted ? data.total - 1 : data.total;
    const othersWithUser = viewerCounted ? own - 1 : own;

    // Yüzde eşiği artık DİĞERLERİNİN sayısına bakar: eşiğin amacı "arkasında
    // kaç kişi var" sorusuydu ve o kişilerin arasında kullanıcının kendisi yok.
    const userShare =
      othersTotal >= socialProof.minSampleForPercentage ? othersWithUser / othersTotal : null;

    return {
      revealed: true,
      total: data.total,
      shares,
      counts,
      othersTotal,
      othersWithUser,
      userShare,
      position:
        userShare !== null && othersTotal >= socialProof.minSampleForPosition
          ? position(userShare)
          : null,
      frozen: frozen !== null,
    };
  },

  /**
   * Kapanışta konsensüsü dondurur. İDEMPOTENT: bir kez donan değişmez.
   *
   * `WHERE consensus_frozen_at IS NULL` koşulu bilinçlidir — bakım işi iki
   * kez çalışsa ya da iki örnek aynı anda kapatmaya çalışsa bile ilk yazan
   * kazanır ve geçmiş bir daha değişmez.
   */
  async freeze(eventId: string, ctx: Ctx = db): Promise<ConsensusSnapshot | null> {
    const snapshot = await liveCounts(eventId, ctx);

    const updated = await ctx
      .update(events)
      .set({ consensusSnapshot: snapshot, consensusFrozenAt: new Date() })
      .where(and(eq(events.id, eventId), isNull(events.consensusFrozenAt)))
      .returning({ id: events.id });

    return updated[0] ? snapshot : null;
  },

  /**
   * 🐺 YALNIZ KURT uygunluğu.
   *
   * Üç şart birlikte aranır: tahmin doğru, etkinlik yeterince kalabalık,
   * kazanan taraf gerçekten azınlıkta. Kalabalık şartı olmadan üç kişilik
   * bir etkinlikte rozet dağıtılırdı ve rozet değersizleşirdi.
   *
   * Yalnızca DONDURULMUŞ konsensüs kullanılır: rozet, kapanış anındaki
   * gerçeğe dayanmalıdır.
   */
  async isLoneWolf(eventId: string, winningOutcomeId: string, ctx: Ctx = db): Promise<boolean> {
    const rows = await ctx
      .select({ snapshot: events.consensusSnapshot })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    const snapshot = rows[0]?.snapshot;
    if (!snapshot || snapshot.total < socialProof.loneWolf.minParticipants) return false;

    const share = (snapshot.counts[winningOutcomeId] ?? 0) / snapshot.total;
    return share < socialProof.loneWolf.maxWinningSideShare;
  },

  /**
   * Etkinliğin sonuç seçenekleri — arayüzün etiketleri için.
   *
   * SIRALAMA ŞART. Bu satır olmadan PostgreSQL satırları istediği sırada
   * döndürür ve canlıda tam olarak şu görüldü: başlık
   * "PSV Eindhoven — Shakhtar Donetsk" derken düğmeler
   * "Beraberlik / Shakhtar / PSV" sırasıyla çıktı. Kullanıcı ev sahibini
   * ortada arar, yanlış düğmeye basar.
   *
   * `sortOrder` etkinlik açılırken yazılır (ev sahibi, beraberlik, deplasman);
   * doğru sıra veride zaten var, yalnızca istenmiyordu.
   */
  async outcomesOf(eventId: string, ctx: Ctx = db) {
    return ctx
      .select({
        id: eventOutcomes.id,
        key: eventOutcomes.key,
        label: eventOutcomes.label,
        imageUrl: eventOutcomes.imageUrl,
      })
      .from(eventOutcomes)
      .where(eq(eventOutcomes.eventId, eventId))
      .orderBy(asc(eventOutcomes.sortOrder));
  },
};
