import { createId } from '@paralleldrive/cuid2';
import { index, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { events } from './catalog';
import { users } from './identity';

/**
 * MEYDAN SOHBETİ — etkinlik başına sohbet.
 *
 * ── İKİ FARKLI "GÖRÜNMEZ" HÂLİ ─────────────────────────────────────────────
 * `deleted_at` yazarın kendi kararı, `hidden_at` bizim kararımız. Tek bir
 * alanda birleştirilseydi "kullanıcı mı sildi, biz mi gizledik" sorusunun
 * cevabı kaybolurdu — ve moderasyonun hesabı sorulamaz hâle gelirdi.
 *
 * Silinen yorumun SATIRI durur, metni gider. Satır da silinseydi ona verilmiş
 * cevaplar öksüz kalırdı; okuyucu neye cevap verildiğini anlamazdı.
 */
export const eventComments = pgTable(
  'event_comment',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Yalnızca KÖK yorumu gösterebilir; cevabın cevabı yoktur (serviste). */
    parentId: text('parent_id'),
    body: varchar('body', { length: 500 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    hiddenById: text('hidden_by_id').references(() => users.id),
  },
  (t) => [
    index('event_comment_event_idx').on(t.eventId, t.createdAt.desc()),
    index('event_comment_parent_idx').on(t.parentId, t.createdAt),
    index('event_comment_author_idx').on(t.authorId, t.createdAt.desc()),
  ],
);
