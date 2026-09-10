import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { challenges, predictions } from '../../src/server/db/schema';
import { challengeService } from '../../src/server/modules/challenge/service';
import { predictionService } from '../../src/server/modules/prediction/service';
import { coinService } from '../../src/server/modules/economy/service';
import { economy } from '../../src/config';
import { acceptChallenge, createEvent, createUser, forceCloseDeadline } from '../factories';

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE coin_ledger, coin_account, challenge, prediction, event_outcome, event, category, "user" CASCADE`;
});

afterAll(async () => {
  await sql.end();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('tahmin', () => {
  it('tahmin oluşturulur ve sayaçlar artar', async () => {
    const emir = await createUser('emir');
    const event = await createEvent();

    const { predictionId } = await predictionService.create({
      userId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
    });

    expect(predictionId).toBeTruthy();
    const [row] = await sql`SELECT prediction_count FROM event WHERE id = ${event.eventId}`;
    expect(row?.prediction_count).toBe(1);
  });

  it('aynı etkinliğe İKİNCİ aktif tahmin yapılamaz', async () => {
    const emir = await createUser('emir');
    const event = await createEvent();

    await predictionService.create({
      userId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
    });

    await expect(
      predictionService.create({
        userId: emir.userId,
        eventId: event.eventId,
        outcomeId: event.outcomes[1]!.id,
      }),
    ).rejects.toThrow(/zaten yaptın/i);
  });

  it('tahmin süresi dolmuş etkinliğe tahmin yapılamaz', async () => {
    const emir = await createUser('emir');
    const event = await createEvent();
    await forceCloseDeadline(event.eventId);

    await expect(
      predictionService.create({
        userId: emir.userId,
        eventId: event.eventId,
        outcomeId: event.outcomes[0]!.id,
      }),
    ).rejects.toThrow(/tahmin süresi doldu/i);
  });

  it('başka etkinliğin sonucu seçilemez — IDOR koruması', async () => {
    const emir = await createUser('emir');
    const event = await createEvent();
    const other = await createEvent();

    await expect(
      predictionService.create({
        userId: emir.userId,
        eventId: event.eventId,
        outcomeId: other.outcomes[0]!.id,
      }),
    ).rejects.toThrow(/geçersiz seçim/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('doğrudan Meydan Okuma', () => {
  it('oluşturulur, çip stake edilir ve karşı sonuç otomatik atanır', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const event = await createEvent();

    const { challengeId, balance } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id, // Galatasaray
      stakeAmount: 50,
      opponentUsername: mert.username,
    });

    expect(balance).toBe(economy.initialGrant - 50);

    const [row] = await db.select().from(challenges).where(eq(challenges.id, challengeId));
    expect(row?.mode).toBe('DIRECT');
    expect(row?.status).toBe('PENDING');
    expect(row?.opponentId).toBe(mert.userId);
    /*
     * Karşı taraf OLUŞTURMADA ATANMAZ (göç 0018).
     *
     * Eskiden sortOrder'daki ilk farklı sonuç otomatik atanıyordu. Üç sonuçlu
     * bir maçta bu, kabul edene BERABERLİK'i veriyordu: oluşturan en olası
     * sonucu seçiyor, kabul eden azınlıkta kalanı alıyordu. Artık taraf,
     * kabul eden kişinin kararı.
     */
    expect(row?.opponentOutcomeId).toBeNull();
  });

  it('kabul edilir: karşı taraf OTOMATİK atanır, tekrar seçim istenmez', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const event = await createEvent();

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 50,
      opponentUsername: mert.username,
    });

    const { balance } = await acceptChallenge(challengeId, mert.userId);
    expect(balance).toBe(economy.initialGrant - 50);

    const [row] = await db.select().from(challenges).where(eq(challenges.id, challengeId));
    expect(row?.status).toBe('ACCEPTED');
    expect(row?.opponentPredictionId).toBeTruthy();

    const opponentPrediction = await db
      .select()
      .from(predictions)
      .where(eq(predictions.id, row!.opponentPredictionId!));
    expect(opponentPrediction[0]?.outcomeId).toBe(event.outcomes[1]!.id);
    expect(opponentPrediction[0]?.isLocked).toBe(true);
  });

  it('davet edilmeyen kullanıcı kabul EDEMEZ', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const can = await createUser('can');
    const event = await createEvent();

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 50,
      opponentUsername: mert.username,
    });

    await expect(acceptChallenge(challengeId, can.userId)).rejects.toThrow(/sana gönderilmedi/i);
  });

  it('kendine Meydan Okunamaz', async () => {
    const emir = await createUser('emir');
    const event = await createEvent();

    await expect(
      challengeService.create({
        creatorId: emir.userId,
        eventId: event.eventId,
        outcomeId: event.outcomes[0]!.id,
        stakeAmount: 50,
        opponentUsername: emir.username,
      }),
    ).rejects.toThrow(/kendine meydan okuyamazsın/i);
  });

  it('reddedilirse çip iade edilir', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const event = await createEvent();

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 50,
      opponentUsername: mert.username,
    });
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant - 50);

    await challengeService.decline(challengeId, mert.userId);
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);
  });

  it('süresi dolmuş Meydan Okuma kabul edilemez', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const event = await createEvent();

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 50,
      opponentUsername: mert.username,
    });

    await sql`UPDATE challenge SET expires_at = now() - interval '1 minute' WHERE id = ${challengeId}`;

    await expect(acceptChallenge(challengeId, mert.userId)).rejects.toThrow(/süresi doldu/i);
  });

  it('yetersiz bakiyeyle Meydan Okuma açılamaz', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const event = await createEvent();

    await expect(
      challengeService.create({
        creatorId: emir.userId,
        eventId: event.eventId,
        outcomeId: event.outcomes[0]!.id,
        stakeAmount: economy.maxStake + 1,
        opponentUsername: mert.username,
      }),
    ).rejects.toThrow(/çip koyabilirsin|yeterli Gümüş Çipin yok/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Açık Meydan Okuma (ADR-15)', () => {
  it('rakip belirtmeden açılır', async () => {
    const emir = await createUser('emir');
    const event = await createEvent();

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 50,
    });

    const [row] = await db.select().from(challenges).where(eq(challenges.id, challengeId));
    expect(row?.mode).toBe('OPEN');
    expect(row?.opponentId).toBeNull();
  });

  it('ilk uygun kullanıcı kabul eder', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const event = await createEvent();

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 50,
    });

    await acceptChallenge(challengeId, mert.userId);

    const [row] = await db.select().from(challenges).where(eq(challenges.id, challengeId));
    expect(row?.status).toBe('ACCEPTED');
    expect(row?.opponentId).toBe(mert.userId);
  });

  it('kullanıcı KENDİ açık Meydan Okumasını kabul edemez', async () => {
    const emir = await createUser('emir');
    const event = await createEvent();

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 50,
    });

    await expect(acceptChallenge(challengeId, emir.userId)).rejects.toThrow(
      /kendi meydan okumanı/i,
    );
  });

  it('aynı etkinlikte ikinci BEKLEYEN açık Meydan Okuma açılamaz', async () => {
    const emir = await createUser('emir');
    const event = await createEvent();

    await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 50,
    });

    // FAZ 5: mesaj artık SEBEBİ söylüyor — "zaten bir tahminin VEYA Meydan
    // Okuman var" gibi belirsiz bir cümle yerine hangisi olduğunu yazar.
    await expect(
      challengeService.create({
        creatorId: emir.userId,
        eventId: event.eventId,
        outcomeId: event.outcomes[1]!.id,
        stakeAmount: 50,
      }),
    ).rejects.toThrow(/zaten bir Meydan Okuman var/i);
  });

  it('AYNI sonuçla ikinci Meydan Okuma da açılamaz — tahmin zaten kilitli', async () => {
    const emir = await createUser('emir');
    const event = await createEvent();

    await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 50,
    });

    await expect(
      challengeService.create({
        creatorId: emir.userId,
        eventId: event.eventId,
        outcomeId: event.outcomes[0]!.id,
        stakeAmount: 50,
      }),
    ).rejects.toThrow(/zaten bir Meydan Okuman var/i);
  });

  // ── FAZ 5: "Bu tahminle Meydan Oku" köprüsü ──────────────────────────────
  it('SERBEST TAHMİN yapmış kullanıcı aynı tahminle Meydan Okuyabilir', async () => {
    const emir = await createUser('emir');
    const event = await createEvent();

    // Önce çipsiz tahmin.
    const { predictionId } = await predictionService.create({
      userId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
    });
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);

    // Sonra aynı tahminle Meydan Okuma: YENİ tahmin satırı AÇILMAZ, var olan
    // kullanılır. Faz 5'ten önce burada "zaten bir tahminin var" hatası
    // alınıyor ve akış tıkanıyordu.
    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 25,
    });

    expect(challengeId).toBeTruthy();
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant - 25);

    // Tahmin sayısı ARTMADI: hâlâ tek tahmin var ve aynı satır kullanıldı.
    const rows = await sql`
      SELECT id, is_locked, stake_amount FROM prediction WHERE user_id = ${emir.userId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(predictionId);
    expect(rows[0]?.stake_amount).toBe(25);
    // Kilit KABUL anında kurulur; sıfırdan açılan Meydan Okumada da böyledir.
    expect(rows[0]?.is_locked).toBe(false);

    const [event_] = await sql`SELECT prediction_count FROM event WHERE id = ${event.eventId}`;
    expect(event_?.prediction_count).toBe(1);
  });

  it('FARKLI sonuçla Meydan Okuma açmak reddedilir — taraf değiştirilemez', async () => {
    const emir = await createUser('emir');
    const event = await createEvent();

    await predictionService.create({
      userId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
    });

    await expect(
      challengeService.create({
        creatorId: emir.userId,
        eventId: event.eventId,
        outcomeId: event.outcomes[1]!.id,
        stakeAmount: 25,
      }),
    ).rejects.toThrow(/başka bir sonuca tahmin yapmışsın/i);

    // Çip harcanmadı.
    expect(await coinService.getBalance(emir.userId)).toBe(economy.initialGrant);
  });

  it('etkinlikte zaten tahmini olan kullanıcı kabul edemez', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const event = await createEvent();

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 50,
    });

    await predictionService.create({
      userId: mert.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[2]!.id,
    });

    await expect(acceptChallenge(challengeId, mert.userId)).rejects.toThrow(
      /zaten bir tahminin var/i,
    );
  });

  /**
   * ÇİFTE KABUL KESİNLİKLE MÜMKÜN OLMAMALI (ürün kuralı 11).
   */
  it('eşzamanlı iki kabul denemesinden yalnızca BİRİ başarılı olur', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const can = await createUser('can');
    const event = await createEvent();

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 50,
    });

    const results = await Promise.all([
      acceptChallenge(challengeId, mert.userId).then(
        () => 'mert',
        () => null,
      ),
      acceptChallenge(challengeId, can.userId).then(
        () => 'can',
        () => null,
      ),
    ]);

    const winners = results.filter(Boolean);
    expect(winners).toHaveLength(1);

    const [row] = await db.select().from(challenges).where(eq(challenges.id, challengeId));
    expect(row?.status).toBe('ACCEPTED');

    // Kaybeden taraftan çip DÜŞÜLMEZ.
    const loserId = winners[0] === 'mert' ? can.userId : mert.userId;
    expect(await coinService.getBalance(loserId)).toBe(economy.initialGrant);

    // Yalnızca bir tane rakip tahmini oluşmuş olmalı.
    const opponentPredictions = await sql`
      SELECT count(*)::int AS n FROM prediction
      WHERE event_id = ${event.eventId} AND user_id <> ${emir.userId}`;
    expect(opponentPredictions[0]?.n).toBe(1);
  });

  it('kabul edilen Meydan Okuma ikinci kez kabul edilemez', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const can = await createUser('can');
    const event = await createEvent();

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 50,
    });

    await acceptChallenge(challengeId, mert.userId);
    await expect(acceptChallenge(challengeId, can.userId)).rejects.toThrow(
      /başka bir kullanıcı tarafından kabul edildi/i,
    );
    expect(await coinService.getBalance(can.userId)).toBe(economy.initialGrant);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('karşıt sonuç kuralı', () => {
  it('iki taraf ASLA aynı sonucu tutamaz — veritabanı seviyesinde', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const event = await createEvent();

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 50,
      opponentUsername: mert.username,
    });

    // Doğrudan SQL ile aynı sonuca zorlamak CHECK tarafından reddedilir.
    await expect(
      sql`UPDATE challenge SET opponent_outcome_id = creator_outcome_id WHERE id = ${challengeId}`,
    ).rejects.toThrow(/challenge_opposing_outcomes/);
  });

  it('iki sonuçlu etkinlikte kabul edenin tek seçeneği vardır', async () => {
    // Fazladan adım kaygısı burada doğmuştu ve burada da çözülüyor: seçenek
    // tekse arayüz onu hazır işaretler, kullanıcı için akış değişmez.
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const event = await createEvent({
      outcomes: [
        { key: 'UP', label: 'Yükseliş' },
        { key: 'DOWN', label: 'Düşüş' },
      ],
    });

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 50,
    });

    await acceptChallenge(challengeId, mert.userId);

    const [row] = await db.select().from(challenges).where(eq(challenges.id, challengeId));
    expect(row?.opponentOutcomeId).toBe(event.outcomes[1]!.id);
  });

  it('KABUL EDEN kendi tarafını seçer — üç sonuçlu maçta beraberlik dayatılmaz', async () => {
    /*
     * Canlıda fark edilen sorun buydu: kurucu açık bir Meydan Okumayı kabul
     * etti ve kendisine sorulmadan beraberlik tarafı verildi. Üç sonuçlu bir
     * maçta beraberlik, çoğu zaman en düşük olasılıklı sonuçtur; oluşturanla
     * kabul edenin pozisyonu eşit olmuyordu.
     */
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const event = await createEvent(); // HOME · DRAW · AWAY

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id, // ev sahibi
      stakeAmount: 50,
    });

    // Kabul eden DEPLASMANI seçiyor — eski kural ona beraberliği verirdi.
    await acceptChallenge(challengeId, mert.userId, event.outcomes[2]!.id);

    const [row] = await db.select().from(challenges).where(eq(challenges.id, challengeId));
    expect(row?.opponentOutcomeId).toBe(event.outcomes[2]!.id);
    expect(row?.opponentOutcomeId).not.toBe(event.outcomes[1]!.id);
  });

  it('AYNI tarafı seçmek reddedilir — ortada iddia kalmaz', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const event = await createEvent();

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 50,
    });

    await expect(acceptChallenge(challengeId, mert.userId, event.outcomes[0]!.id)).rejects.toThrow(
      /aynı tarafta/i,
    );
  });

  it('BAŞKA ETKİNLİĞİN sonucu kabul edilemez', async () => {
    // Kimlik tek başına aidiyet kanıtı değildir.
    const emir = await createUser('emir');
    const mert = await createUser('mert');
    const event = await createEvent();
    const other = await createEvent();

    const { challengeId } = await challengeService.create({
      creatorId: emir.userId,
      eventId: event.eventId,
      outcomeId: event.outcomes[0]!.id,
      stakeAmount: 50,
    });

    await expect(acceptChallenge(challengeId, mert.userId, other.outcomes[1]!.id)).rejects.toThrow(
      /Geçersiz seçim/,
    );
  });
});
