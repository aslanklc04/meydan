'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireActor } from '@/server/auth';
import { DomainError, InternalError } from '@/server/errors';
import { onboardingService } from '@/server/modules/identity/onboarding.service';
import { log, logEvents } from '@/server/observability/logger';
import type { FlowResult } from '@/features/events/actions';

/**
 * Karşılama akışı eylemleri.
 *
 * "Atla" da tamamlama sayılır — kullanıcı ekranı bir kez görür. Boş seçim
 * geçerlidir: ilgi alanı seçmeyen kullanıcıya tüm kategoriler gösterilir.
 */

const slugsSchema = z.array(z.string().trim().min(1).max(40)).max(20);

export async function completeOnboardingAction(slugs: string[]): Promise<FlowResult> {
  const parsed = slugsSchema.safeParse(slugs);
  if (!parsed.success) return { ok: false, message: 'Seçimini kaydedemedik. Tekrar dener misin?' };

  try {
    const actor = await requireActor();
    const { saved } = await onboardingService.complete(actor.id, parsed.data);
    log.info('onboarding.completed', { interests: saved });
    return {
      ok: true,
      message: saved > 0 ? 'Akışın ilgi alanlarına göre düzenlendi.' : 'Hazırsın. İyi tahminler!',
    };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    log.error(logEvents.unexpectedError, { where: 'onboarding.complete', error });
    return { ok: false, message: new InternalError().message };
  }
}

/** İlgi alanı seçmeden geç — yine de karşılama bir daha gösterilmez. */
export async function skipOnboardingAction(): Promise<void> {
  const actor = await requireActor();
  await onboardingService.complete(actor.id, []);
  log.info('onboarding.skipped');
  redirect('/app/feed');
}
