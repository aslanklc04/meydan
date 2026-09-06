import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';

/**
 * Identity context — Spesifikasyon Bölüm 2.2.
 *
 * Birincil anahtarlar cuid2: ardışık integer ID enumeration/IDOR yüzeyini açar.
 */

export const userRole = pgEnum('user_role', ['USER', 'MODERATOR', 'ADMIN']);
export const userStatus = pgEnum('user_status', ['ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED']);

export const users = pgTable(
  'user',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    /** Görünen yazım: "Emir" */
    username: varchar('username', { length: 20 }).notNull(),
    /** Eşsizlik ve /u/emir çözümlemesi büyük/küçük harften bağımsızdır. */
    usernameLower: varchar('username_lower', { length: 20 }).notNull(),

    email: varchar('email', { length: 255 }).notNull(),
    emailVerified: timestamp('email_verified', { withTimezone: true }),

    /** OAuth-only hesapta null olabilir. Argon2id özeti. */
    passwordHash: text('password_hash'),

    role: userRole('role').notNull().default('USER'),
    status: userStatus('status').notNull().default('ACTIVE'),

    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }).notNull(),
    termsVersion: varchar('terms_version', { length: 20 }).notNull(),

    /** Parola değişiminde artar; bu andan eski tüm oturumlar geçersiz sayılır. */
    sessionEpoch: integer('session_epoch').notNull().default(0),

    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('user_username_lower_key').on(t.usernameLower),
    uniqueIndex('user_email_key').on(t.email),
    index('user_status_created_idx').on(t.status, t.createdAt),
  ],
);

export const profiles = pgTable('profile', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: varchar('display_name', { length: 50 }).notNull(),
  bio: varchar('bio', { length: 280 }),
  avatarUrl: text('avatar_url'),
  followerCount: integer('follower_count').notNull().default(0),
  followingCount: integer('following_count').notNull().default(0),
  isCreator: boolean('is_creator').notNull().default(false),
  /**
   * Karşılama akışının tamamlandığı an (Faz 5).
   * NULL ise kullanıcı onboarding'i henüz görmedi; "atla" da bu alanı doldurur —
   * karşılama ekranı ikinci kez gösterilmez.
   */
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Oturumlar — ADR-06a.
 *
 * Auth.js v5'te credentials provider JWT stratejisi gerektirir; ancak token bir
 * sessionId taşır ve her istekte bu satır doğrulanır. Böylece oturum ANINDA iptal
 * edilebilir: hesap askıya alma, parola değişimi, "tüm cihazlardan çık".
 */
export const sessions = pgTable(
  'session',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Ham IP saklanmaz — HMAC-SHA256(ip, IP_PEPPER). */
    ipHash: varchar('ip_hash', { length: 64 }),
    userAgent: varchar('user_agent', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('session_user_idx').on(t.userId), index('session_expires_idx').on(t.expiresAt)],
);

/** OAuth sağlayıcıları — Auth.js adapter sözleşmesi (Faz 2'de credentials, ileride OAuth). */
export const accounts = pgTable(
  'account',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 32 }).notNull(),
    provider: varchar('provider', { length: 64 }).notNull(),
    providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: varchar('token_type', { length: 32 }),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index('account_user_idx').on(t.userId),
  ],
);

export const tokenPurpose = pgEnum('token_purpose', ['EMAIL_VERIFICATION', 'PASSWORD_RESET']);

/**
 * Tek kullanımlık token'lar.
 * Ham token ASLA saklanmaz; yalnızca sha256 özeti tutulur.
 */
export const verificationTokens = pgTable(
  'verification_token',
  {
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: tokenPurpose('purpose').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('verification_user_purpose_idx').on(t.userId, t.purpose),
    index('verification_expires_idx').on(t.expiresAt),
  ],
);

/** Route çakışması veya kimlik taklidi yaratabilecek adlar (config'ten seed edilir). */
export const reservedUsernames = pgTable('reserved_username', {
  slug: varchar('slug', { length: 20 }).primaryKey(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
