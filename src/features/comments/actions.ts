'use server';

import { currentActor } from '@/server/auth';
import { AuthenticationError, DomainError, InternalError } from '@/server/errors';
import { commentService } from '@/server/modules/comment/service';
import { socialService } from '@/server/modules/social/service';
import { enforceSharedRateLimit } from '@/server/security/shared-rate-limit';
import { log, logEvents } from '@/server/observability/logger';

export type SohbetState =
  | { readonly status: 'idle' }
  | { readonly status: 'ok' }
  | { readonly status: 'error'; readonly message: string };

/**
 * Sohbete yazma.
 *
 * ── ORAN SINIRI NEDEN BURADA ───────────────────────────────────────────────
 * Yorum, sitedeki en ucuz yazma işlemidir ve en kolay kötüye kullanılanıdır.
 * Sınır, kimliğin doğrulanmasından SONRA ama işten ÖNCE uygulanır.
 */
export async function yorumYazAction(_prev: SohbetState, formData: FormData): Promise<SohbetState> {
  try {
    const actor = await currentActor();
    if (!actor) throw new AuthenticationError();

    await enforceSharedRateLimit('comment.create', { userId: actor.id });

    const eventId = String(formData.get('eventId') ?? '');
    const body = String(formData.get('body') ?? '');
    const parentIdRaw = String(formData.get('parentId') ?? '');

    await commentService.create({
      eventId,
      authorId: actor.id,
      body,
      parentId: parentIdRaw.length > 0 ? parentIdRaw : null,
    });

    return { status: 'ok' };
  } catch (error) {
    if (error instanceof DomainError) {
      return { status: 'error', message: error.message };
    }
    log.error(logEvents.unexpectedError, {
      operation: 'comment.create',
      outcome: 'failure',
      error,
    });
    return { status: 'error', message: new InternalError().message };
  }
}

export type FlowResult = { readonly ok: boolean; readonly message: string };

/** Yazar kendi yorumunu siler — metni gider, cevapları yerinde kalır. */
export async function yorumSilAction(commentId: string): Promise<FlowResult> {
  try {
    const actor = await currentActor();
    if (!actor) throw new AuthenticationError();
    await commentService.removeOwn(commentId, actor.id);
    return { ok: true, message: 'Yorumun silindi.' };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    log.error(logEvents.unexpectedError, {
      operation: 'comment.remove',
      outcome: 'failure',
      error,
    });
    return { ok: false, message: new InternalError().message };
  }
}

/**
 * Yorumu bildir.
 *
 * Yeni bir şikâyet sistemi kurulmadı: mevcut `report` tablosu hedef türüyle
 * çalışıyor ve yönetim ekranı zaten onu okuyor. İkinci bir sistem, iki ayrı
 * gelen kutusu ve er ya da geç bakılmayan bir kuyruk demek olurdu.
 */
export async function yorumBildirAction(commentId: string): Promise<FlowResult> {
  try {
    const actor = await currentActor();
    if (!actor) throw new AuthenticationError();
    await enforceSharedRateLimit('report.create', { userId: actor.id });
    await socialService.report({
      reporterId: actor.id,
      targetType: 'COMMENT',
      targetId: commentId,
      reason: 'ABUSE',
    });
    return { ok: true, message: 'Bildirdin. Teşekkürler — bakacağız.' };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    log.error(logEvents.unexpectedError, {
      operation: 'comment.report',
      outcome: 'failure',
      error,
    });
    return { ok: false, message: new InternalError().message };
  }
}
