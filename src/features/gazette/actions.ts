'use server';

import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { currentActor } from '@/server/auth';
import { AuthenticationError, DomainError, InternalError } from '@/server/errors';
import { gazetteService } from '@/server/modules/gazette/service';
import { enforceSharedRateLimit } from '@/server/security/shared-rate-limit';
import { log, logEvents } from '@/server/observability/logger';

export type GazetteState =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly message: string; readonly field?: string };

/**
 * Gazete kurma.
 *
 * BAŞARIDA YÖNLENDİRİR, mesaj döndürmez: kullanıcı kapağını hemen görmeli.
 * "Gazeten oluşturuldu" yazan bir kutuda kalmak, paylaşılacak şeyi
 * göstermeden övmek olurdu.
 */
export async function createGazetteAction(
  _prev: GazetteState,
  formData: FormData,
): Promise<GazetteState> {
  let token: string;

  try {
    const actor = await currentActor();
    if (!actor) throw new AuthenticationError();

    /*
     * Oran sınırı: gazete kurmak ucuz bir yazma değildir — her kapak kalıcı,
     * herkese açık bir adres üretir. Sınırsız bırakılırsa tek hesap binlerce
     * adres açabilir.
     */
    await enforceSharedRateLimit('gazette.create', { userId: actor.id });

    const title = String(formData.get('title') ?? '');
    const predictionIds = formData
      .getAll('predictionIds')
      .map((v) => String(v))
      .filter((v) => v.length > 0);

    const result = await gazetteService.create({
      ownerId: actor.id,
      title,
      predictionIds,
    });
    token = result.publicToken;
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof DomainError) {
      return error.field === undefined
        ? { status: 'error', message: error.message }
        : { status: 'error', message: error.message, field: error.field };
    }
    log.error(logEvents.unexpectedError, {
      operation: 'gazette.create',
      outcome: 'failure',
      error,
    });
    return { status: 'error', message: new InternalError().message };
  }

  // `redirect` try bloğunun DIŞINDA: içeride olsaydı kendi kontrol akışı
  // hatası yakalanır ve kullanıcıya "bir sorun oluştu" denirdi.
  redirect(`/g/${token}`);
}
