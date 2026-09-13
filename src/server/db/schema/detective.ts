import { createId } from '@paralleldrive/cuid2';
import {
  boolean,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * KISA DEDEKTİF — cevabı belli ama saklı vakalar.
 *
 * Tahminden farkı zamandır: tahminin sonucu gelecekte, vakanın cevabı çoktan
 * var. Bu fark ürünün üç sorununu birden çözüyor — geri bildirim anında
 * geliyor, oyun tek kişiyle oynanabiliyor ve sonuç şansa değil beceriye
 * bağlı olduğu için hukuki zemin bambaşka.
 */
export const detectiveCases = pgTable('detective_case', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  title: varchar('title', { length: 120 }).notNull(),
  scenario: text('scenario').notNull(),
  question: varchar('question', { length: 200 }).notNull(),
  /** Cevaptan SONRA gösterilir — oyunun asıl değeri burada. */
  explanation: text('explanation').notNull(),
  difficulty: smallint('difficulty').notNull().default(1),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdById: text('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  attemptCount: integer('attempt_count').notNull().default(0),
  correctCount: integer('correct_count').notNull().default(0),
});

export const detectiveOptions = pgTable(
  'detective_option',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    caseId: text('case_id')
      .notNull()
      .references(() => detectiveCases.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 200 }).notNull(),
    isCorrect: boolean('is_correct').notNull().default(false),
    sortOrder: smallint('sort_order').notNull().default(0),
  },
  (t) => [index('detective_option_case_idx').on(t.caseId, t.sortOrder)],
);

export const detectiveAttempts = pgTable(
  'detective_attempt',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    caseId: text('case_id')
      .notNull()
      .references(() => detectiveCases.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    optionId: text('option_id')
      .notNull()
      .references(() => detectiveOptions.id),
    correct: boolean('correct').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Bir vakaya BİR cevap — ikincisi, cevabı öğrendikten sonra verilirdi. */
    uniqueIndex('detective_one_attempt_per_user').on(t.caseId, t.userId),
    index('detective_attempt_user_idx').on(t.userId, t.createdAt.desc()),
  ],
);
