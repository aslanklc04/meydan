'use server';

import { currentActor } from '@/server/auth';
import { AuthenticationError, DomainError, InternalError } from '@/server/errors';
import { detectiveService } from '@/server/modules/detective/service';
import { enforceSharedRateLimit } from '@/server/security/shared-rate-limit';
import { log, logEvents } from '@/server/observability/logger';

export type FlowResult = { readonly ok: boolean; readonly message: string };

/**
 * Vakaya cevap verir.
 *
 * DOĞRULUK SUNUCUDA HESAPLANIR. İstemciden "doğru bildim" bilgisi gelseydi,
 * tarayıcıda tek satırla herkesin karnesi mükemmel olurdu ve karne bir kanıt
 * olmaktan çıkardı.
 */
export async function vakaCevaplaAction(caseId: string, optionId: string): Promise<FlowResult> {
  try {
    const actor = await currentActor();
    if (!actor) throw new AuthenticationError();

    await enforceSharedRateLimit('detective.answer', { userId: actor.id });

    const { dogruMu } = await detectiveService.answer({
      caseId,
      userId: actor.id,
      optionId,
    });

    return { ok: true, message: dogruMu ? 'Çözdün.' : 'Bu sefer olmadı.' };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    log.error(logEvents.unexpectedError, {
      operation: 'detective.answer',
      outcome: 'failure',
      error,
    });
    return { ok: false, message: new InternalError().message };
  }
}
