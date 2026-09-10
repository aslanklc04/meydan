'use server';

import { z } from 'zod';
import { currentActor } from '@/server/auth';
import { AuthenticationError, DomainError, InternalError } from '@/server/errors';
import { shareService } from '@/server/modules/share/service';
import { predictionService } from '@/server/modules/prediction/service';
import { enforceSharedRateLimit } from '@/server/security/shared-rate-limit';
import { log, logEvents } from '@/server/observability/logger';
import { serverEnv } from '@/config/env';

export type ShareResult =
  { readonly ok: true; readonly url: string } | { readonly ok: false; readonly message: string };

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/**
 * Bir tahmin için paylaşım bağlantısı ister.
 *
 * MUTLAK ADRES döner. Göreli bir `/m/...` WhatsApp'a yapıştırıldığında
 * bağlantı olmaz, düz metin olur — ve alan adı sunucuda bilinir, istemcide
 * ilk çizimde bilinmez.
 */
export async function createShareLinkAction(eventId: string): Promise<ShareResult> {
  try {
    const actor = await currentActor();
    if (!actor) throw new AuthenticationError();

    const mine = await predictionService.findActiveForUserEvent(actor.id, eventId);
    if (!mine) {
      return {
        ok: false,
        message: 'Önce kendi tahminini yap; paylaşılacak bir şey ancak o zaman olur.',
      };
    }

    const token = await shareService.createForPrediction(mine.id, actor.id);
    return { ok: true, url: `${serverEnv.APP_URL.replace(/\/$/, '')}/m/${token}` };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    log.error(logEvents.unexpectedError, {
      operation: 'share.create',
      outcome: 'failure',
      error,
    });
    return { ok: false, message: new InternalError().message };
  }
}

/**
 * Meydan okuma bağlantısından gelen kişinin cevabı.
 *
 * Tahmini yine ÇEKİRDEK SERVİS kaydeder — buraya ikinci bir tahmin yolu
 * açılmaz. Bu eylemin `predictAction`'dan tek farkı, cevabın hangi
 * bağlantıdan geldiğini SAYMASI. Ayrı bir kayıt yolu açsaydık, çekirdek
 * döngünün kuralları (kapanmış etkinlik, oran sınırı, tekrar tahmin) burada
 * ayrıca uygulanmak zorunda kalır ve er ya da geç biri unutulurdu.
 */
export async function answerFromShareAction(input: {
  publicToken: string;
  outcomeId: string;
}): Promise<{ ok: boolean; message: string }> {
  try {
    const actor = await currentActor();
    if (!actor) throw new AuthenticationError();

    if (!tokenSchema.safeParse(input.publicToken).success) {
      return { ok: false, message: 'Bu bağlantı geçersiz.' };
    }

    /*
     * ETKİNLİK JETONDAN ÇÖZÜLÜR, İSTEMCİDEN ALINMAZ.
     *
     * İstemci hangi etkinliğe cevap verdiğini söyleseydi, paylaşılan sorudan
     * BAŞKA bir etkinliğe cevap göndermek mümkün olurdu — ve o cevap yine bu
     * bağlantının sayacına yazılırdı. Sunucu zaten biliyor; sormak gereksiz
     * bir güven noktası açar.
     */
    const share = await shareService.byToken(input.publicToken, actor.id);
    if (!share) return { ok: false, message: 'Bu meydan okuma artık geçerli değil.' };

    await enforceSharedRateLimit('prediction.create', { userId: actor.id });
    await predictionService.create({
      userId: actor.id,
      eventId: share.eventId,
      outcomeId: input.outcomeId,
    });

    /*
     * Sayaç tahminden SONRA ve hatası yutularak artırılır: bir sayaç
     * yüzünden kaydedilmiş bir tahmin geri alınamaz.
     */
    if (tokenSchema.safeParse(input.publicToken).success) {
      try {
        await shareService.countAnswer(input.publicToken);
      } catch (error) {
        log.warn(logEvents.unexpectedError, { operation: 'share.countAnswer', error });
      }
    }

    return { ok: true, message: 'Tahminin kaydedildi. Bakalım arkadaşın ne demiş.' };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    log.error(logEvents.unexpectedError, {
      operation: 'share.answer',
      outcome: 'failure',
      error,
    });
    return { ok: false, message: new InternalError().message };
  }
}
