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
      // İşaretlenmemiş bir onay kutusu forma HİÇ gelmez; bu yüzden yokluk
      // "gizli" demektir. Varsayılanı burada da açıkça yazmak, formun
      // biçimi değişirse kuralın sessizce tersine dönmesini engeller.
      isPublic: formData.get('isPublic') === 'true',
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

export type FlowResult = { readonly ok: boolean; readonly message: string };

/**
 * Sahibi kapağını raftan çeker. TEK YÖNLÜ.
 *
 * Manşetler yerinde kalır, bağlantı çalışmaya devam eder; değişen tek şey
 * sitede listelenmemesidir. Kullanıcı "gizle" derken bir şeyi silmediğini
 * bilmelidir.
 */
export async function makeGazettePrivateAction(publicToken: string): Promise<FlowResult> {
  try {
    const actor = await currentActor();
    if (!actor) throw new AuthenticationError();
    await gazetteService.makePrivate(publicToken, actor.id);
    /*
     * `revalidatePath` ÇAĞRILMAZ (ürün kuralı 32): Server Action içinde
     * yeniden doğrulama, geçerli rotayı tazeleyip istemci bileşenini
     * yeniden kuruyor ve onay mesajı kullanıcı görmeden kayboluyor. Kapak
     * sayfası ve ana sayfa `force-dynamic` olduğu için bir sonraki istekte
     * zaten güncel gelirler.
     */
    return { ok: true, message: 'Kapağın raftan çekildi. Bağlantısı çalışmaya devam ediyor.' };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    log.error(logEvents.unexpectedError, {
      operation: 'gazette.makePrivate',
      outcome: 'failure',
      error,
    });
    return { ok: false, message: new InternalError().message };
  }
}
