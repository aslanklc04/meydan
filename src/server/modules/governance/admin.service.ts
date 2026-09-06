import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import {
  challenges,
  coinLedger,
  events,
  predictions,
  profiles,
  reports,
  users,
} from '@/server/db/schema';
import { NotFoundError, BusinessRuleError } from '@/server/errors';

/**
 * Yönetim okumaları ve moderasyon eylemleri.
 *
 * Yönetici ekranı teknik değer GÖRÜR (id, durum) — kural 21 son kullanıcı
 * içindir. Yine de ledger gibi hassas veriler yalnızca toplu okunur.
 */

export const adminService = {
  async listUsers(limit = 100) {
    return db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
        followerCount: profiles.followerCount,
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .orderBy(desc(users.createdAt))
      .limit(limit);
  },

  /** Askıya alma: oturumlar geçersiz kılınmaz — kimlik modülü bunu ayrı yapar. */
  async setUserStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<void> {
    const updated = await db
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(users.id, userId), sql`${users.status} <> 'DELETED'`))
      .returning({ id: users.id });

    if (updated.length === 0) {
      throw new NotFoundError('Kullanıcı bulunamadı.');
    }
  },

  async listChallenges(limit = 100) {
    return db
      .select({
        id: challenges.id,
        status: challenges.status,
        mode: challenges.mode,
        settlement: challenges.settlement,
        stakeAmount: challenges.stakeAmount,
        createdAt: challenges.createdAt,
        expiresAt: challenges.expiresAt,
        eventTitle: events.title,
      })
      .from(challenges)
      .innerJoin(events, eq(events.id, challenges.eventId))
      .orderBy(desc(challenges.createdAt))
      .limit(limit);
  },

  async listPredictions(limit = 100) {
    return db
      .select({
        id: predictions.id,
        status: predictions.status,
        result: predictions.result,
        stakeAmount: predictions.stakeAmount,
        createdAt: predictions.createdAt,
        username: users.username,
        eventTitle: events.title,
      })
      .from(predictions)
      .innerJoin(users, eq(users.id, predictions.userId))
      .innerJoin(events, eq(events.id, predictions.eventId))
      .orderBy(desc(predictions.createdAt))
      .limit(limit);
  },

  async recentLedger(limit = 100) {
    return db
      .select({
        id: coinLedger.id,
        amount: coinLedger.amount,
        type: coinLedger.type,
        referenceType: coinLedger.referenceType,
        createdAt: coinLedger.createdAt,
      })
      .from(coinLedger)
      .orderBy(desc(coinLedger.createdAt))
      .limit(limit);
  },

  async listReports(status: 'OPEN' | 'REVIEWED' | 'ALL' = 'OPEN', limit = 100) {
    const base = db
      .select({
        id: reports.id,
        targetType: reports.targetType,
        targetId: reports.targetId,
        reason: reports.reason,
        note: reports.note,
        status: reports.status,
        createdAt: reports.createdAt,
        reporterUsername: users.username,
      })
      .from(reports)
      .innerJoin(users, eq(users.id, reports.reporterId))
      .orderBy(desc(reports.createdAt))
      .limit(limit);

    if (status === 'ALL') return base;
    return status === 'OPEN'
      ? base.where(eq(reports.status, 'OPEN'))
      : base.where(sql`${reports.status} <> 'OPEN'`);
  },

  /** Raporu kapatır. `report_review_consistency` kısıtı alan tutarlılığını korur. */
  async reviewReport(
    reportId: string,
    reviewerId: string,
    decision: 'REVIEWED' | 'DISMISSED',
  ): Promise<void> {
    const updated = await db
      .update(reports)
      .set({ status: decision, reviewedById: reviewerId, reviewedAt: new Date() })
      .where(and(eq(reports.id, reportId), eq(reports.status, 'OPEN')))
      .returning({ id: reports.id });

    if (updated.length === 0) {
      throw new BusinessRuleError('ALREADY_REVIEWED', 'Bu bildirim zaten incelenmiş.');
    }
  },

  /** Özet sayaçlar — yönetim ana ekranı. */
  async counts() {
    const rows = await db.execute<{
      users: string;
      active_users: string;
      events: string;
      open_events: string;
      challenges: string;
      pending_challenges: string;
      predictions: string;
      open_reports: string;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM "user")::text                             AS users,
        (SELECT COUNT(*) FROM "user" WHERE status = 'ACTIVE')::text     AS active_users,
        (SELECT COUNT(*) FROM event)::text                              AS events,
        (SELECT COUNT(*) FROM event WHERE status = 'OPEN')::text        AS open_events,
        (SELECT COUNT(*) FROM challenge)::text                          AS challenges,
        (SELECT COUNT(*) FROM challenge WHERE status = 'PENDING')::text AS pending_challenges,
        (SELECT COUNT(*) FROM prediction)::text                         AS predictions,
        (SELECT COUNT(*) FROM report WHERE status = 'OPEN')::text       AS open_reports
    `);
    const row = rows[0];
    return {
      users: Number(row?.users ?? 0),
      activeUsers: Number(row?.active_users ?? 0),
      events: Number(row?.events ?? 0),
      openEvents: Number(row?.open_events ?? 0),
      challenges: Number(row?.challenges ?? 0),
      pendingChallenges: Number(row?.pending_challenges ?? 0),
      predictions: Number(row?.predictions ?? 0),
      openReports: Number(row?.open_reports ?? 0),
    };
  },
};
