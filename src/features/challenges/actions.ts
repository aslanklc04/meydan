'use server';

import { z } from 'zod';
import { requireActor } from '@/server/auth';
import { DomainError, InternalError } from '@/server/errors';
import { challengeService } from '@/server/modules/challenge/service';
import type { FlowResult } from '@/features/events/actions';

const idSchema = z.string().min(1);

function toResult(error: unknown): FlowResult {
  if (error instanceof DomainError) return { ok: false, message: error.message };
  console.error('[challenges] beklenmeyen hata', error);
  return { ok: false, message: new InternalError().message };
}

/**
 * NOT: Bu eylemlerden sonra `revalidatePath` ÇAĞRILMAZ.
 *
 * Gerekçe (E2E'de yakalandı): yeniden doğrulama, kabul edilen Meydan Okuma
 * kartını listeden anında kaldırıyor ve kullanıcı "ne oldu" mesajını hiç
 * göremiyordu — ürün kuralı 32'nin ihlali. Bunun yerine kart yerinde bir onay
 * gösteriyor; kullanıcı onayladığında ekran tazeleniyor (`router.refresh()`).
 */

/**
 * Meydan Okumayı kabul et.
 *
 * Karşı sonuç ADR-18 uyarınca zaten atanmıştır ve kabul kartında gösterilir —
 * kullanıcıdan tekrar seçim İSTENMEZ (ürün kuralı 9B ve 25).
 */
export async function acceptChallengeAction(challengeId: string): Promise<FlowResult> {
  if (!idSchema.safeParse(challengeId).success) {
    return { ok: false, message: 'Bu Meydan Okuma bulunamadı.' };
  }

  try {
    const actor = await requireActor();
    const { balance } = await challengeService.accept(challengeId, actor.id);
    return {
      ok: true,
      message: `Meydan Okumayı kabul ettin. Kalan bakiyen ${balance} Gümüş Çip.`,
    };
  } catch (error) {
    return toResult(error);
  }
}

export async function declineChallengeAction(challengeId: string): Promise<FlowResult> {
  if (!idSchema.safeParse(challengeId).success) {
    return { ok: false, message: 'Bu Meydan Okuma bulunamadı.' };
  }

  try {
    const actor = await requireActor();
    await challengeService.decline(challengeId, actor.id);
    return { ok: true, message: 'Meydan Okumayı reddettin.' };
  } catch (error) {
    return toResult(error);
  }
}

export async function cancelChallengeAction(challengeId: string): Promise<FlowResult> {
  if (!idSchema.safeParse(challengeId).success) {
    return { ok: false, message: 'Bu Meydan Okuma bulunamadı.' };
  }

  try {
    const actor = await requireActor();
    await challengeService.cancel(challengeId, actor.id);
    return { ok: true, message: 'Meydan Okuman iptal edildi, çipin iade edildi.' };
  } catch (error) {
    return toResult(error);
  }
}
