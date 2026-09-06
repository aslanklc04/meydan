import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db, type Tx } from '@/server/db';
import {
  profiles,
  sessions,
  users,
  verificationTokens,
  type NewUser,
  type User,
} from '@/server/db/schema';

/**
 * Identity repository — veri erişimi. İş kuralı içermez.
 *
 * UI katmanı bu modülü import EDEMEZ (ESLint KURAL 1). Erişim yalnızca
 * `service.ts` üzerinden yapılır.
 */

type Ctx = Tx | typeof db;

export const identityRepository = {
  async findByEmail(email: string, ctx: Ctx = db): Promise<User | undefined> {
    const rows = await ctx.select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0];
  },

  async findByUsernameLower(usernameLower: string, ctx: Ctx = db): Promise<User | undefined> {
    const rows = await ctx
      .select()
      .from(users)
      .where(eq(users.usernameLower, usernameLower))
      .limit(1);
    return rows[0];
  },

  async findById(id: string, ctx: Ctx = db): Promise<User | undefined> {
    const rows = await ctx.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0];
  },

  async identifierTaken(
    email: string,
    usernameLower: string,
    ctx: Ctx = db,
  ): Promise<{ email: boolean; username: boolean }> {
    const rows = await ctx
      .select({ email: users.email, usernameLower: users.usernameLower })
      .from(users)
      .where(or(eq(users.email, email), eq(users.usernameLower, usernameLower)));

    return {
      email: rows.some((r) => r.email === email),
      username: rows.some((r) => r.usernameLower === usernameLower),
    };
  },

  async createUser(data: NewUser, displayName: string, ctx: Ctx = db): Promise<User> {
    const inserted = await ctx.insert(users).values(data).returning();
    const user = inserted[0];
    if (!user) throw new Error('Kullanıcı oluşturulamadı.');

    await ctx.insert(profiles).values({ userId: user.id, displayName });
    return user;
  },

  async markEmailVerified(userId: string, ctx: Ctx = db): Promise<void> {
    await ctx
      .update(users)
      .set({ emailVerified: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));
  },

  async touchLogin(userId: string, ctx: Ctx = db): Promise<void> {
    await ctx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  },

  /**
   * Parolayı değiştirir ve oturum epoch'unu artırır.
   * Epoch artışı, kullanıcının TÜM mevcut oturumlarını tek hamlede geçersiz kılar.
   */
  async setPassword(userId: string, passwordHash: string, ctx: Ctx = db): Promise<void> {
    await ctx
      .update(users)
      .set({
        passwordHash,
        sessionEpoch: sql`${users.sessionEpoch} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  },

  // --- Oturumlar (ADR-06a) --------------------------------------------------

  async createSession(
    data: { userId: string; expiresAt: Date; ipHash?: string; userAgent?: string },
    ctx: Ctx = db,
  ): Promise<{ id: string }> {
    const rows = await ctx
      .insert(sessions)
      .values({
        userId: data.userId,
        expiresAt: data.expiresAt,
        ipHash: data.ipHash ?? null,
        userAgent: data.userAgent ?? null,
      })
      .returning({ id: sessions.id });

    const row = rows[0];
    if (!row) throw new Error('Oturum oluşturulamadı.');
    return row;
  },

  /** Oturum + kullanıcıyı tek sorguda getirir; her istekte çağrılır. */
  async findLiveSession(sessionId: string, ctx: Ctx = db) {
    const rows = await ctx
      .select({
        sessionId: sessions.id,
        expiresAt: sessions.expiresAt,
        revokedAt: sessions.revokedAt,
        userId: users.id,
        username: users.username,
        role: users.role,
        status: users.status,
        sessionEpoch: users.sessionEpoch,
        emailVerified: users.emailVerified,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, sessionId))
      .limit(1);
    return rows[0];
  },

  async revokeSession(sessionId: string, ctx: Ctx = db): Promise<void> {
    await ctx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  },

  /** "Tüm cihazlardan çık" — tek UPDATE. */
  async revokeAllSessions(userId: string, ctx: Ctx = db): Promise<void> {
    await ctx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  },

  async deleteExpiredSessions(now: Date, ctx: Ctx = db): Promise<void> {
    await ctx.delete(sessions).where(lt(sessions.expiresAt, now));
  },

  // --- Tek kullanımlık token'lar -------------------------------------------

  /**
   * Yeni token yazmadan önce aynı amaçlı tüketilmemiş token'ları geçersiz kılar.
   * `verification_one_active_per_purpose` partial unique index bunu zorunlu tutar.
   */
  async issueToken(
    data: {
      userId: string;
      tokenHash: string;
      purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';
      expiresAt: Date;
    },
    ctx: Ctx = db,
  ): Promise<void> {
    await ctx
      .update(verificationTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(verificationTokens.userId, data.userId),
          eq(verificationTokens.purpose, data.purpose),
          isNull(verificationTokens.consumedAt),
        ),
      );

    await ctx.insert(verificationTokens).values(data);
  },

  async findToken(tokenHash: string, ctx: Ctx = db) {
    const rows = await ctx
      .select()
      .from(verificationTokens)
      .where(eq(verificationTokens.tokenHash, tokenHash))
      .limit(1);
    return rows[0];
  },

  /**
   * Token'ı tüketir. Koşullu UPDATE: yalnızca henüz tüketilmemişse etkilenir.
   * Aynı bağlantıya iki kez tıklanması ikinci kez iş yapmaz.
   */
  async consumeToken(tokenHash: string, ctx: Ctx = db): Promise<boolean> {
    const rows = await ctx
      .update(verificationTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(eq(verificationTokens.tokenHash, tokenHash), isNull(verificationTokens.consumedAt)),
      )
      .returning({ tokenHash: verificationTokens.tokenHash });
    return rows.length === 1;
  },
};
