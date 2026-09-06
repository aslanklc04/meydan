import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { notificationService } from '../../src/server/modules/social/notification.service';
import { createUser } from '../factories';

/**
 * Bildirim — üretim, okunmamış sayacı, okundu işaretleme.
 *
 * Asıl sınanan şey `dedupeKey` üzerindeki TEKİL index'tir: aynı olay iki kez
 * bildirilemez. Bu, sonuçlandırmanın idempotent olmasının görünen yüzüdür —
 * sonuçlandırma iki kez çalışsa bile kullanıcı iki bildirim almaz.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE notification, "user" CASCADE`;
});

afterAll(async () => {
  await sql.end();
});

describe('bildirim', () => {
  it('üretilir ve okunmamış sayılır', async () => {
    const emir = await createUser('emir');

    const created = await notificationService.create(db, {
      userId: emir.userId,
      type: 'NEW_FOLLOWER',
      body: 'Biri seni takip etmeye başladı.',
      dedupeKey: 'test:1',
    });

    expect(created).toBe(true);
    expect(await notificationService.unreadCount(emir.userId)).toBe(1);
  });

  it('AYNI dedupeKey ile ikinci üretim SESSİZCE yok sayılır', async () => {
    const emir = await createUser('emir');

    await notificationService.create(db, {
      userId: emir.userId,
      type: 'NEW_FOLLOWER',
      body: 'Biri seni takip etmeye başladı.',
      dedupeKey: 'test:1',
    });
    const second = await notificationService.create(db, {
      userId: emir.userId,
      type: 'NEW_FOLLOWER',
      body: 'Biri seni takip etmeye başladı.',
      dedupeKey: 'test:1',
    });

    expect(second).toBe(false);
    expect(await notificationService.unreadCount(emir.userId)).toBe(1);
  });

  it('toplu üretimde kopyalar elenir', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');

    const inserted = await notificationService.createMany(db, [
      { userId: emir.userId, type: 'BADGE_EARNED', body: 'Rozet!', dedupeKey: 'b:1' },
      { userId: mert.userId, type: 'BADGE_EARNED', body: 'Rozet!', dedupeKey: 'b:2' },
    ]);
    expect(inserted).toBe(2);

    const again = await notificationService.createMany(db, [
      { userId: emir.userId, type: 'BADGE_EARNED', body: 'Rozet!', dedupeKey: 'b:1' },
    ]);
    expect(again).toBe(0);
  });

  it('hepsini okundu işaretlemek sayacı sıfırlar', async () => {
    const emir = await createUser('emir');

    for (let i = 0; i < 3; i += 1) {
      await notificationService.create(db, {
        userId: emir.userId,
        type: 'NEW_FOLLOWER',
        body: 'Yeni takipçi.',
        dedupeKey: `f:${i}`,
      });
    }
    expect(await notificationService.unreadCount(emir.userId)).toBe(3);

    await notificationService.markAllRead(emir.userId);
    expect(await notificationService.unreadCount(emir.userId)).toBe(0);

    // Liste kaybolmaz; yalnızca okundu damgası düşer.
    const list = await notificationService.list(emir.userId);
    expect(list.items).toHaveLength(3);
    expect(list.items.every((i) => i.readAt !== null)).toBe(true);
  });

  it('tek tek okundu işaretleme YALNIZCA sahibinin bildirimini etkiler', async () => {
    const emir = await createUser('emir');
    const mert = await createUser('mert');

    await notificationService.create(db, {
      userId: mert.userId,
      type: 'NEW_FOLLOWER',
      body: 'Yeni takipçi.',
      dedupeKey: 'm:1',
    });
    const mertList = await notificationService.list(mert.userId);

    // Emir, Mert'in bildirimini okundu yapamaz.
    await notificationService.markRead(emir.userId, [mertList.items[0]!.id]);
    expect(await notificationService.unreadCount(mert.userId)).toBe(1);
  });

  it('cursor sayfalama öğe atlamaz', async () => {
    const emir = await createUser('emir');
    for (let i = 0; i < 5; i += 1) {
      await notificationService.create(db, {
        userId: emir.userId,
        type: 'NEW_FOLLOWER',
        body: `Bildirim ${i}`,
        dedupeKey: `n:${i}`,
      });
    }

    const first = await notificationService.list(emir.userId, { limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toBeTruthy();

    const second = await notificationService.list(emir.userId, {
      limit: 3,
      cursor: first.nextCursor!,
    });

    const ids = new Set([...first.items, ...second.items].map((i) => i.id));
    expect(ids.size).toBe(5);
  });
});
