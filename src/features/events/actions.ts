'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireActor } from '@/server/auth';
import { DomainError, InternalError } from '@/server/errors';
import { predictionService } from '@/server/modules/prediction/service';
import { challengeService } from '@/server/modules/challenge/service';
import { economy } from '@/config';
import { enforceSharedRateLimit } from '@/server/security/shared-rate-limit';

/**
 * Etkinlik akışının Server Action'ları.
 *
 * Kullanıcıya ASLA teknik hata gösterilmez (ürün kuralı 22). Beklenen iş
 * kuralı hataları zaten Türkçe mesaj taşır; beklenmeyenler tek tip mesaja
 * çevrilir ve teknik detay yalnızca log'a gider.
 */

export type FlowResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly message: string };

function toResult(error: unknown): FlowResult {
  if (error instanceof DomainError) return { ok: false, message: error.message };
  console.error('[events] beklenmeyen hata', error);
  return { ok: false, message: new InternalError().message };
}

const stakeSchema = z
  .number()
  .int()
  .refine((v) => (economy.stakePresets as readonly number[]).includes(v), {
    message: 'Geçersiz çip miktarı.',
  });

const predictSchema = z.object({
  eventId: z.string().min(1),
  outcomeId: z.string().min(1),
});

const challengeSchema = z.object({
  eventId: z.string().min(1),
  outcomeId: z.string().min(1),
  stakeAmount: stakeSchema,
  opponentUsername: z.string().trim().min(3).max(20).optional(),
});

/** Sadece tahmin — çip ortaya konmaz. */
export async function predictAction(input: {
  eventId: string;
  outcomeId: string;
}): Promise<FlowResult> {
  const parsed = predictSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Bir şeyler eksik görünüyor.' };

  try {
    const actor = await requireActor();
    await enforceSharedRateLimit('prediction.create', { userId: actor.id });
    await predictionService.create({
      userId: actor.id,
      eventId: parsed.data.eventId,
      outcomeId: parsed.data.outcomeId,
    });
    revalidatePath('/app/feed');
    return { ok: true, message: 'Tahminin kaydedildi.' };
  } catch (error) {
    return toResult(error);
  }
}

/** Meydan Okuma — rakip adı verilirse doğrudan, verilmezse Açık Meydan Okuma. */
export async function challengeAction(input: {
  eventId: string;
  outcomeId: string;
  stakeAmount: number;
  opponentUsername?: string;
}): Promise<FlowResult> {
  const parsed = challengeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Bir şeyler eksik görünüyor.' };
  }

  try {
    const actor = await requireActor();
    await enforceSharedRateLimit('challenge.create', { userId: actor.id });
    await challengeService.create({
      creatorId: actor.id,
      eventId: parsed.data.eventId,
      outcomeId: parsed.data.outcomeId,
      stakeAmount: parsed.data.stakeAmount,
      ...(parsed.data.opponentUsername ? { opponentUsername: parsed.data.opponentUsername } : {}),
    });

    revalidatePath('/app/feed');
    revalidatePath('/app/challenges');

    return {
      ok: true,
      message: parsed.data.opponentUsername
        ? `Meydan Okuman @${parsed.data.opponentUsername} kullanıcısına gönderildi. ${parsed.data.stakeAmount} Gümüş Çip ortaya kondu.`
        : `Açık Meydan Okuman yayınlandı. ${parsed.data.stakeAmount} Gümüş Çip ortaya kondu.`,
    };
  } catch (error) {
    return toResult(error);
  }
}
