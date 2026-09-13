import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrateTestDatabase } from './setup';
import { jobsService } from '../../src/server/modules/governance/jobs.service';
import { rankingService } from '../../src/server/modules/ranking/service';

/**
 * LİDERLİK LİSTESİ KENDİLİĞİNDEN ÜRETİLİR.
 *
 * ── NEDEN BU TEST VAR ──────────────────────────────────────────────────────
 * Liderlik ekranı Faz 4'ten beri duruyordu ve dönemleri (haftalık, aylık,
 * sezon, tüm zamanlar) da vardı. Ama listeyi ÜRETEN iş yalnızca yönetim
 * panelindeki bir düğmeye bağlıydı: kurucu her hafta o düğmeye basmadıkça
 * "Haftalık" listesi hiç değişmiyordu.
 *
 * Ekran çalışıyor görünüyordu; içindeki veri donuktu. Bu projede aynı kalıbı
 * defalarca gördük — yazılmış ama çalışmayan özellik, yazılmamış özelliktir.
 *
 * Test, işin ADIMINI korur: bakım işi çalıştığında liderlik de üretilmiş
 * olmalı.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE event_comment, leaderboard_entry, leaderboard_snapshot,
                           prediction_share, gazette_item, gazette, notification, feed_item,
                           coin_ledger, coin_account, challenge, prediction, event_outcome,
                           event, category, "user" CASCADE`;
});

afterAll(async () => {
  await sql.end();
});

describe('bakım işi liderliği üretir', () => {
  it('dört dönemin hepsi üretilir', async () => {
    const report = await jobsService.runAll();
    expect(report.leaderboards).toBe(4);
  });

  it('üretilen liste OKUNABİLİR hâle gelir', async () => {
    /*
     * Kimse eşiği geçmemişse liste BOŞ olur — bu doğru davranıştır ve
     * "hata" değildir. Önemli olan anlık görüntünün var olması: ekran artık
     * dünden kalma bir listeyi değil, bugünün (boş da olsa) listesini
     * gösterir.
     */
    await jobsService.runAll();
    const board = await rankingService.getLeaderboard({ period: 'WEEKLY' });
    expect(board).toBeDefined();
    expect(Array.isArray(board.entries)).toBe(true);
  });

  it('iş İKİ KEZ çalışsa da patlamaz', async () => {
    // Bakım işi günde birkaç kez tetikleniyor; üretim idempotent olmalı.
    await jobsService.runAll();
    const ikinci = await jobsService.runAll();
    expect(ikinci.leaderboards).toBe(4);
  });
});
