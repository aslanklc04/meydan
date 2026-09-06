import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { jobsService } from '@/server/modules/governance/jobs.service';
import { auditService } from '@/server/modules/governance/audit.service';
import { serverEnv } from '@/config/env';
import { log, logEvents, newCorrelationId } from '@/server/observability/logger';

/**
 * ZAMANLANMIŞ BAKIM İŞLERİ — HTTP tetikleyici (Faz 6).
 *
 * NEDEN HTTP: uygulama zaten bir sunucu olarak çalışıyor. Ayrı bir işçi
 * süreci, kuyruk ya da konteyner eklemek bu ölçekte karşılığı olmayan bir
 * maliyettir (Faz 6 talimatı: gereksiz altyapı ekleme). Bir HTTP ucu, elde
 * olan HER zamanlayıcıyla çalışır:
 *
 *   • Vercel Cron        → `vercel.json` içindeki `crons` girdisi
 *   • GitHub Actions     → `.github/workflows/cron.yml`
 *   • sistem cron / curl → `curl -H "Authorization: Bearer $CRON_SECRET" ...`
 *
 * GÜVENLİK: uç herkese açıktır, bu yüzden `CRON_SECRET` ile imzalanır.
 * Karşılaştırma SABİT ZAMANLIDIR: `===` ile karşılaştırmak, yanıt süresinden
 * sırrı harf harf çıkarmaya (timing attack) kapı aralar.
 *
 * DAVRANIŞ: iş zaten çalışıyorsa 200 + `skipped: true` döner. Zamanlayıcı için
 * bu bir HATA DEĞİLDİR; tekrar denemesine gerek yoktur.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : header;

  const expected = serverEnv.CRON_SECRET;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Uzunluk farkı da sızıntıdır; önce uzunluk eşitlenir.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();

  if (!authorized(request)) {
    log.warn(logEvents.authFailed, { where: 'cron.jobs', correlationId });
    // 404 değil 401: zamanlayıcı yanlış yapılandırıldığında bunu görmeli.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const result = await jobsService.runScheduled({ correlationId });

    if (result.skipped) {
      return NextResponse.json({ ok: true, skipped: true, correlationId });
    }

    // Denetim kaydı: bakım işleri para hareketi (iade) üretebilir.
    await auditService.record({
      actorId: null,
      action: 'JOBS_RUN',
      targetType: 'job_run',
      ...(result.runId ? { targetId: result.runId } : {}),
      metadata: { ...result.report, correlationId, trigger: 'cron' },
    });

    return NextResponse.json({
      ok: true,
      skipped: false,
      correlationId,
      report: result.report,
    });
  } catch (error) {
    log.error(logEvents.jobFailed, { where: 'cron.jobs', correlationId, error });
    // Gövdede teknik detay YOK; ayrıntı sunucu günlüğünde.
    return NextResponse.json({ ok: false, correlationId }, { status: 500 });
  }
}

/**
 * Bazı zamanlayıcılar (Vercel Cron dâhil) GET gönderir.
 * Aynı yetkilendirme ve aynı davranış.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}
