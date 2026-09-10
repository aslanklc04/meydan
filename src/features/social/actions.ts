'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireActor } from '@/server/auth';
import { DomainError, InternalError } from '@/server/errors';
import { enforceSharedRateLimit } from '@/server/security/shared-rate-limit';
import { socialService } from '@/server/modules/social/service';
import { notificationService } from '@/server/modules/social/notification.service';
import type { FlowResult } from '@/features/events/actions';

/** Sosyal eylemler — takip, reaksiyon, moderasyon, bildirim. */

function toResult(error: unknown): FlowResult {
  if (error instanceof DomainError) return { ok: false, message: error.message };
  console.error('[social] beklenmeyen hata', error);
  return { ok: false, message: new InternalError().message };
}

const usernameSchema = z.string().trim().min(3).max(20);

export async function toggleFollowAction(
  username: string,
  currentlyFollowing: boolean,
): Promise<FlowResult> {
  const parsed = usernameSchema.safeParse(username);
  if (!parsed.success) return { ok: false, message: 'Bu kullanıcıyı bulamadık.' };

  try {
    const actor = await requireActor();
    await enforceSharedRateLimit('follow.toggle', { userId: actor.id });

    if (currentlyFollowing) {
      await socialService.unfollow(actor.id, parsed.data);
      revalidatePath(`/u/${parsed.data}`);
      return { ok: true, message: `@${parsed.data} takipten çıkarıldı.` };
    }

    await socialService.follow(actor.id, parsed.data);
    revalidatePath(`/u/${parsed.data}`);
    return { ok: true, message: `@${parsed.data} takip ediliyor.` };
  } catch (error) {
    return toResult(error);
  }
}

export async function toggleReactionAction(
  targetType: 'PREDICTION' | 'EVENT',
  targetId: string,
): Promise<FlowResult> {
  if (!targetId) return { ok: false, message: 'İçerik bulunamadı.' };

  try {
    const actor = await requireActor();
    await enforceSharedRateLimit('reaction.toggle', { userId: actor.id });
    const { reacted } = await socialService.toggleReaction(actor.id, targetType, targetId);
    return { ok: true, message: reacted ? 'Beğendin.' : 'Beğeni kaldırıldı.' };
  } catch (error) {
    return toResult(error);
  }
}

const reportSchema = z.object({
  targetType: z.enum(['USER', 'PREDICTION', 'EVENT', 'GAZETTE']),
  targetId: z.string().min(1),
  reason: z.enum(['SPAM', 'ABUSE', 'IMPERSONATION', 'CHEATING', 'OTHER']),
  note: z.string().trim().max(500).optional(),
});

export async function reportAction(input: {
  targetType: 'USER' | 'PREDICTION' | 'EVENT' | 'GAZETTE';
  targetId: string;
  reason: 'SPAM' | 'ABUSE' | 'IMPERSONATION' | 'CHEATING' | 'OTHER';
  note?: string;
}): Promise<FlowResult> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Eksik bilgi.' };

  try {
    const actor = await requireActor();
    await socialService.report({
      reporterId: actor.id,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      reason: parsed.data.reason,
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
    });
    return { ok: true, message: 'Bildirimin bize ulaştı. Teşekkürler.' };
  } catch (error) {
    return toResult(error);
  }
}

export async function blockAction(username: string): Promise<FlowResult> {
  const parsed = usernameSchema.safeParse(username);
  if (!parsed.success) return { ok: false, message: 'Bu kullanıcıyı bulamadık.' };

  try {
    const actor = await requireActor();
    await socialService.block(actor.id, parsed.data);
    revalidatePath(`/u/${parsed.data}`);
    return { ok: true, message: `@${parsed.data} engellendi.` };
  } catch (error) {
    return toResult(error);
  }
}

export async function markNotificationsReadAction(): Promise<FlowResult> {
  try {
    const actor = await requireActor();
    await notificationService.markAllRead(actor.id);
    revalidatePath('/app/notifications');
    return { ok: true, message: 'Bildirimler okundu olarak işaretlendi.' };
  } catch (error) {
    return toResult(error);
  }
}
