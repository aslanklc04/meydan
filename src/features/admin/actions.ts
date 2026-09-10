'use server';

import { z } from 'zod';
import { requireRole } from '@/server/auth';
import { DomainError, InternalError, isUniqueViolation } from '@/server/errors';
import { resolutionService } from '@/server/modules/resolution/service';
import { catalogService } from '@/server/modules/catalog/service';
import { adminService } from '@/server/modules/governance/admin.service';
import { jobsService } from '@/server/modules/governance/jobs.service';
import { rankingService } from '@/server/modules/ranking/service';
import { auditService } from '@/server/modules/governance/audit.service';
import { gazetteService } from '@/server/modules/gazette/service';
import { log, logEvents } from '@/server/observability/logger';
import type { FlowResult } from '@/features/events/actions';

/**
 * Admin sonuçlandırma akışı — MİNİMUM.
 *
 * NOT: burada `revalidatePath` ÇAĞRILMAZ. Server Action içindeki yeniden
 * doğrulama, geçerli rotayı da tazeleyip istemci bileşenini yeniden kuruyor;
 * bu da onay mesajının kullanıcı görmeden kaybolmasına yol açıyordu (E2E'de
 * yakalandı, ürün kuralı 32). Panel yerinde onay gösterir; yönetici "Tamam"
 * dediğinde ekran `router.refresh()` ile tazelenir.
 *
 * Faz 3'te devasa bir admin paneli YAPILMAZ: etkinlik seç → sonuç seç → onayla.
 * Yetki iki katmanlı kontrol edilir: middleware rota seviyesinde, `requireRole`
 * her eylemde tekrar (defense in depth, Spesifikasyon Bölüm 10.2).
 */

const resolveSchema = z.object({
  eventId: z.string().min(1),
  outcomeId: z.string().min(1).nullable(),
  decision: z.enum(['RESOLVED', 'VOID']),
  note: z.string().max(300).optional(),
});

export async function resolveEventAction(input: {
  eventId: string;
  outcomeId: string | null;
  decision: 'RESOLVED' | 'VOID';
  note?: string;
}): Promise<FlowResult> {
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Eksik bilgi.' };

  try {
    // ADMIN olmayan kullanıcı bunu YAPAMAZ.
    const actor = await requireRole('ADMIN');

    const result = await resolutionService.resolve({
      eventId: parsed.data.eventId,
      outcomeId: parsed.data.outcomeId,
      decision: parsed.data.decision,
      resolvedById: actor.id,
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
    });

    if (result.alreadyResolved) {
      return { ok: true, message: 'Bu etkinlik zaten sonuçlandırılmıştı. Hiçbir şey değişmedi.' };
    }

    // Denetim kaydı: sonuçlandırma geri alınamaz; kimin yaptığı kayıt altında olmalı.
    await auditService.record({
      actorId: actor.id,
      action: parsed.data.decision === 'VOID' ? 'EVENT_VOIDED' : 'EVENT_RESOLVED',
      targetType: 'event',
      targetId: parsed.data.eventId,
      metadata: {
        predictionsResolved: result.predictionsResolved,
        challengesSettled: result.challengesSettled,
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
      },
    });

    return {
      ok: true,
      message:
        parsed.data.decision === 'VOID'
          ? `Etkinlik geçersiz sayıldı. ${result.challengesSettled} Meydan Okumada çipler iade edildi.`
          : `Sonuç kaydedildi. ${result.predictionsResolved} tahmin ve ${result.challengesSettled} Meydan Okuma sonuçlandı.`,
    };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    log.error(logEvents.unexpectedError, { where: 'admin.resolve', error });
    return { ok: false, message: new InternalError().message };
  }
}

// ── Faz 4 — genişletilmiş yönetim ────────────────────────────────────────────

/**
 * Etkinlik oluşturma doğrulaması.
 *
 * HER kural kendi TÜRKÇE mesajını taşır. Varsayılan Zod metinleri İngilizcedir
 * ("String must contain at least 5 character(s)") ve doğrudan ekrana basılırsa
 * ürün dilini bozar — kural 19'un ihlali.
 */
const createEventSchema = z.object({
  categorySlug: z.string().min(1, 'Kategori seç.'),
  title: z
    .string()
    .trim()
    .min(5, 'Başlık en az 5 karakter olmalı.')
    .max(200, 'Başlık en fazla 200 karakter olabilir.'),
  question: z
    .string()
    .trim()
    .min(5, 'Soru en az 5 karakter olmalı.')
    .max(200, 'Soru en fazla 200 karakter olabilir.'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Bağlantı adresi en az 3 karakter olmalı.')
    .max(60, 'Bağlantı adresi en fazla 60 karakter olabilir.')
    .regex(/^[a-z0-9-]+$/, 'Bağlantı adresi yalnızca küçük harf, rakam ve tire içerebilir.'),
  closesAt: z.string().min(1, 'Kapanış tarihini seç.'),
  resolvesAt: z.string().min(1, 'Sonuç tarihini seç.'),
  outcomes: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z
          .string()
          .trim()
          .min(1, 'Boş sonuç olamaz.')
          .max(80, 'Sonuç en fazla 80 karakter olabilir.'),
      }),
    )
    .min(2, 'Bir etkinlikte en az iki sonuç olmalı.'),
});

export async function createEventAction(input: {
  categorySlug: string;
  title: string;
  question: string;
  slug: string;
  closesAt: string;
  resolvesAt: string;
  outcomes: { key: string; label: string }[];
}): Promise<FlowResult> {
  const parsed = createEventSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Eksik bilgi.' };
  }

  try {
    const actor = await requireRole('ADMIN');
    const closesAt = new Date(parsed.data.closesAt);
    const resolvesAt = new Date(parsed.data.resolvesAt);

    if (Number.isNaN(closesAt.getTime()) || Number.isNaN(resolvesAt.getTime())) {
      return { ok: false, message: 'Tarih biçimi geçersiz. Tarih ve saati yeniden seç.' };
    }
    // Kapanışı geçmiş bir etkinliğe kimse tahmin yapamaz; sessizce oluşturmak
    // yönetici için de kullanıcı için de şaşırtıcı olur.
    if (closesAt.getTime() <= Date.now()) {
      return {
        ok: false,
        message: 'Kapanış tarihi geçmişte. Tahmin alınabilmesi için ileri bir tarih seç.',
      };
    }
    if (resolvesAt <= closesAt) {
      return {
        ok: false,
        message: 'Sonuç saati, kapanış saatinden sonra olmalı.',
      };
    }
    const labels = parsed.data.outcomes.map((o) => o.label.trim().toLocaleLowerCase('tr-TR'));
    if (new Set(labels).size !== labels.length) {
      return { ok: false, message: 'Aynı sonuç iki kez yazılmış. Her sonuç farklı olmalı.' };
    }

    const { eventId } = await catalogService.createEvent({
      categorySlug: parsed.data.categorySlug,
      title: parsed.data.title,
      question: parsed.data.question,
      slug: parsed.data.slug,
      closesAt,
      resolvesAt,
      outcomes: parsed.data.outcomes,
      createdById: actor.id,
    });

    await auditService.record({
      actorId: actor.id,
      action: 'EVENT_CREATED',
      targetType: 'event',
      targetId: eventId,
      metadata: { slug: parsed.data.slug, outcomes: parsed.data.outcomes.length },
    });

    return { ok: true, message: 'Etkinlik oluşturuldu ve akışta yayınlandı.' };
  } catch (error) {
    // Aynı bağlantı adresi ikinci kez kullanılamaz; bu teknik değil, anlaşılır
    // bir kural olarak anlatılır.
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        message: 'Bu bağlantı adresi zaten kullanılıyor. Farklı bir adres yaz.',
      };
    }
    return adminError(error, 'etkinlik oluşturma');
  }
}

export async function closeEventAction(eventId: string): Promise<FlowResult> {
  if (!eventId) return { ok: false, message: 'Etkinlik seçilmedi.' };
  try {
    const actor = await requireRole('ADMIN');
    await catalogService.closeEvent(eventId);
    await auditService.record({
      actorId: actor.id,
      action: 'EVENT_CLOSED',
      targetType: 'event',
      targetId: eventId,
    });
    return { ok: true, message: 'Tahminler kapatıldı, dağılım donduruldu.' };
  } catch (error) {
    return adminError(error, 'etkinlik kapatma');
  }
}

export async function setUserStatusAction(
  userId: string,
  status: 'ACTIVE' | 'SUSPENDED',
): Promise<FlowResult> {
  if (!userId) return { ok: false, message: 'Kullanıcı seçilmedi.' };
  try {
    const actor = await requireRole('ADMIN');
    await adminService.setUserStatus(userId, status);
    await auditService.record({
      actorId: actor.id,
      action: status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
      targetType: 'user',
      targetId: userId,
    });
    return {
      ok: true,
      message: status === 'SUSPENDED' ? 'Hesap askıya alındı.' : 'Hesap yeniden etkinleştirildi.',
    };
  } catch (error) {
    return adminError(error, 'kullanıcı durumu');
  }
}

export async function reviewReportAction(
  reportId: string,
  decision: 'REVIEWED' | 'DISMISSED',
): Promise<FlowResult> {
  if (!reportId) return { ok: false, message: 'Bildirim seçilmedi.' };
  try {
    const actor = await requireRole('ADMIN');
    await adminService.reviewReport(reportId, actor.id, decision);
    await auditService.record({
      actorId: actor.id,
      action: 'REPORT_REVIEWED',
      targetType: 'report',
      targetId: reportId,
      metadata: { decision },
    });
    return {
      ok: true,
      message: decision === 'REVIEWED' ? 'Bildirim işleme alındı.' : 'Bildirim reddedildi.',
    };
  } catch (error) {
    return adminError(error, 'bildirim inceleme');
  }
}

/**
 * Şikâyet edilen bir gazete kapağını gizler.
 *
 * KAPAK HEM RAFTAN HEM BAĞLANTIDAN DÜŞER. Yalnızca raftan düşürseydik
 * gizleme bir gösteriden ibaret olurdu: içerik, asıl yayıldığı yerde —
 * paylaşıldığı sohbette — okunmaya devam ederdi.
 *
 * Manşetler ve tahminler SİLİNMEZ. Gizleme bir sunum kararıdır; kullanıcının
 * tahmin geçmişini yok etmek bambaşka ve çok daha ağır bir yaptırımdır.
 */
export async function hideGazetteAction(publicToken: string): Promise<FlowResult> {
  if (!publicToken) return { ok: false, message: 'Kapak seçilmedi.' };
  try {
    const actor = await requireRole('ADMIN');
    await gazetteService.hideByModerator(publicToken, actor.id);
    await auditService.record({
      actorId: actor.id,
      action: 'GAZETTE_HIDDEN',
      targetType: 'gazette',
      targetId: publicToken,
    });
    /*
     * `revalidatePath` ÇAĞRILMAZ — bu dosyanın en üstündeki kurala uyulur:
     * Server Action içindeki yeniden doğrulama geçerli rotayı da tazeleyip
     * onay mesajını yönetici görmeden siliyordu. Buna gerek de yok: hem ana
     * sayfa hem kapak sayfası `force-dynamic`, yani bir sonraki istekte
     * zaten taze veriyle çizilirler.
     */
    return { ok: true, message: 'Kapak gizlendi; bağlantısı da artık açılmıyor.' };
  } catch (error) {
    return adminError(error, 'kapak gizleme');
  }
}

export async function generateLeaderboardAction(input: {
  period: 'WEEKLY' | 'MONTHLY' | 'SEASON' | 'ALL_TIME';
}): Promise<FlowResult> {
  try {
    const actor = await requireRole('ADMIN');
    const result = await rankingService.generateLeaderboard({ period: input.period });
    await auditService.record({
      actorId: actor.id,
      action: 'LEADERBOARD_GENERATED',
      targetType: 'leaderboard',
      targetId: result.snapshotId,
      metadata: { period: input.period, entries: result.entries },
    });
    return { ok: true, message: `${result.entries} kişilik sıralama üretildi.` };
  } catch (error) {
    return adminError(error, 'sıralama üretimi');
  }
}

export async function runMaintenanceJobsAction(): Promise<FlowResult> {
  try {
    const actor = await requireRole('ADMIN');
    const report = await jobsService.runAll();
    await auditService.record({
      actorId: actor.id,
      action: 'JOBS_RUN',
      metadata: { ...report },
    });
    return {
      ok: true,
      message: `${report.expiredChallenges} Meydan Okuma süresi doldu, ${report.closedEvents} etkinlik kapandı, ${report.generatedEvents} yeni etkinlik üretildi.`,
    };
  } catch (error) {
    return adminError(error, 'bakım işleri');
  }
}

function adminError(error: unknown, context: string): FlowResult {
  if (error instanceof DomainError) return { ok: false, message: error.message };
  log.error(logEvents.unexpectedError, { where: `admin.${context}`, error });
  return { ok: false, message: new InternalError().message };
}
