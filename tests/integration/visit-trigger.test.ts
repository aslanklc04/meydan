import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrateTestDatabase } from './setup';
import { jobsService } from '../../src/server/modules/governance/jobs.service';

/**
 * ZİYARET TETİKLEYİCİSİ.
 *
 * Bakım işini tetikleyen iki dış yol da fiilen çalışmıyordu (GitHub Actions
 * sırları tanımsız, Vercel cron günde bir). Artık ziyaret de tetikliyor.
 * Buradaki kritik güvence, ÇİFT ÇALIŞMANIN İMKÂNSIZ olmasıdır: aynı iade
 * iki kez yapılırsa çip yoktan var edilir.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE job_run, notification, feed_item, coin_ledger, coin_account,
                           challenge, prediction, event_outcome, event, category, "user" CASCADE`;
});

afterAll(async () => {
  await sql.end();
});

describe('bakım işi', () => {
  it('hiç çalışmamışsa bayat sayılır (tetiklenmeli)', async () => {
    expect(await jobsService.minutesSinceLastSuccess()).toBeNull();
  });

  it('çalıştıktan hemen sonra taze sayılır (tetiklenmemeli)', async () => {
    await jobsService.runScheduled({ jobName: 'maintenance' });
    const minutes = await jobsService.minutesSinceLastSuccess();
    expect(minutes).not.toBeNull();
    expect(minutes!).toBeLessThan(20);
  });

  it('AYNI ANDA iki ziyaret geldiğinde iş İKİ KEZ ÇALIŞMAZ', async () => {
    const [a, b] = await Promise.all([
      jobsService.runScheduled({ jobName: 'maintenance' }),
      jobsService.runScheduled({ jobName: 'maintenance' }),
    ]);
    // Biri kilidi alır, diğeri atlanır. İkisi de çalışırsa iade iki kez yapılır.
    expect([a.skipped, b.skipped].filter(Boolean)).toHaveLength(1);
  });

  it('çip defteri dengeli kalır', async () => {
    await jobsService.runScheduled({ jobName: 'maintenance' });
    await jobsService.runScheduled({ jobName: 'maintenance' });
    const health = await jobsService.ledgerHealth();
    expect(health.balanced).toBe(true);
    expect(health.total).toBe(0);
  });
});
