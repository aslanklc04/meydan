import { and, desc, eq } from 'drizzle-orm';
import { db, type Tx } from '@/server/db';
import { auditLogs, users } from '@/server/db/schema';
import { log, logEvents } from '@/server/observability/logger';

/**
 * Yönetici denetim kaydı — Faz 5.
 *
 * DEĞİŞMEZ: yalnızca eklenir. Güncelleme/silme fonksiyonu bilinçli olarak
 * yoktur; bir denetim kaydı sonradan düzeltilebiliyorsa denetim kaydı değildir.
 *
 * Kayıt yazımı ASLA asıl işlemi düşürmez: denetim yazımı hata verirse olay
 * günlüğe düşer, çağıran akış devam eder. Sonuçlandırılmış bir etkinliğin
 * denetim satırı yazılamadı diye geri alınması, ondan çok daha kötüdür.
 */

type Ctx = Tx | typeof db;

export type AuditAction =
  | 'EVENT_CREATED'
  | 'EVENT_CLOSED'
  | 'EVENT_RESOLVED'
  | 'EVENT_VOIDED'
  | 'USER_SUSPENDED'
  | 'USER_REACTIVATED'
  | 'REPORT_REVIEWED'
  | 'LEADERBOARD_GENERATED'
  | 'JOBS_RUN'
  | 'CHALLENGE_REFUNDED'
  | 'RATINGS_RECOMPUTED';

export type AuditInput = {
  readonly actorId: string | null;
  readonly action: AuditAction;
  readonly targetType?: string;
  readonly targetId?: string;
  /** Hassas veri İÇERMEZ — parola, token, oturum, ham IP yazılmaz. */
  readonly metadata?: Record<string, unknown>;
};

export const auditService = {
  async record(input: AuditInput, ctx: Ctx = db): Promise<void> {
    try {
      await ctx.insert(auditLogs).values({
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: input.metadata ?? null,
      });
    } catch (error) {
      // Denetim yazımı asıl işlemi DÜŞÜRMEZ.
      log.error(logEvents.unexpectedError, { where: 'audit.record', action: input.action, error });
      return;
    }

    log.info(logEvents.adminAction, {
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
    });
  },

  /**
   * Denetim kaydı listesi — yönetim ekranı için filtrelenebilir.
   *
   * Filtreler DAR tutuldu (eylem türü ve hedef): denetim kaydına bakan kişi
   * "şu etkinliğe ne oldu?" ya da "kim askıya alındı?" sorusunu sorar.
   */
  async list(
    limit = 100,
    filter: { readonly action?: AuditAction; readonly targetId?: string } = {},
    ctx: Ctx = db,
  ) {
    const conditions = [
      filter.action ? eq(auditLogs.action, filter.action) : undefined,
      filter.targetId ? eq(auditLogs.targetId, filter.targetId) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    const base = ctx
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
        actorUsername: users.username,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    return conditions.length > 0 ? base.where(and(...conditions)) : base;
  },
};

/** Yönetim ekranında gösterilecek insan diline çevrilmiş eylem adları. */
export const auditActionLabel: Record<AuditAction, string> = {
  EVENT_CREATED: 'Etkinlik oluşturuldu',
  EVENT_CLOSED: 'Tahminler kapatıldı',
  EVENT_RESOLVED: 'Etkinlik sonuçlandırıldı',
  EVENT_VOIDED: 'Etkinlik geçersiz sayıldı',
  USER_SUSPENDED: 'Hesap askıya alındı',
  USER_REACTIVATED: 'Hesap yeniden etkinleştirildi',
  REPORT_REVIEWED: 'Bildirim incelendi',
  LEADERBOARD_GENERATED: 'Sıralama üretildi',
  JOBS_RUN: 'Bakım işleri çalıştırıldı',
  CHALLENGE_REFUNDED: 'Meydan Okuma iade edildi',
  RATINGS_RECOMPUTED: 'İtibar yeniden hesaplandı',
};
