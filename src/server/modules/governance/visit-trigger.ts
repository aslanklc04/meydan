import { after } from 'next/server';
import { jobsService } from './jobs.service';
import { log } from '@/server/observability/logger';

/**
 * ZİYARET TETİKLEYİCİSİ — bakım işi kendi kendine yürüsün.
 *
 * ── NEDEN VAR ──────────────────────────────────────────────────────────────
 * Bakım işini (maç çekme, biten maçı sonuçlandırma, süresi dolan Meydan
 * Okumayı iade etme, etkinlik kapatma, Günün Meydanı seçme) iki şey
 * tetikliyordu ve ikisi de yetmedi: GitHub Actions depoda iki sır tanımlı
 * olmadığı için hiç çalışmadı, Vercel cron ücretsiz planda günde bir kez
 * çalışıyor. Bu yüzden iş, birisi siteyi ziyaret ettiğinde BAYATLAMIŞSA
 * çalıştırılır.
 *
 * ── NEDEN AYRI DOSYA ───────────────────────────────────────────────────────
 * Bu tetikleyici yalnızca OTURUM İÇİ kabukta duruyordu. Sonucu canlıda şu
 * oldu: kurucu bir gün giriş yapmayınca hiç maç çekilmedi, Günün Meydanı
 * seçilmedi ve ANA SAYFA BOŞ KALDI — hem de tam olarak siteyi ilk kez gören
 * ziyaretçiler için.
 *
 * Mantık bir kez yazılır ve iki kabuk da onu çağırır. İki yere kopyalansaydı,
 * eşik ya da hata yönetimi birinde değişip diğerinde kalırdı.
 *
 * ── NEDEN GÜVENLİ ──────────────────────────────────────────────────────────
 * • `after()` işi YANITTAN SONRA çalıştırır: ziyaretçi beklemez.
 * • Bayatlık denetimi tek ucuz sorgudur; iş çoğu ziyarette hiç başlamaz.
 * • `runScheduled` PostgreSQL advisory lock alır: aynı anda gelen ikinci
 *   ziyaret `skipped` alır. Aynı iade iki kez yapılamaz.
 * • Hata YUTULUR: bakım işinin arızası sayfayı düşürmemeli.
 */

/**
 * İş bu kadar dakikadan eskiyse yeniden çalıştırılır.
 *
 * 20 dakika bilinçli: Meydan Okuma iadesi en geç bu kadar gecikir, ama
 * sıradan bir gezinme sırasında iş sürekli yeniden tetiklenmez.
 */
export const STALE_AFTER_MINUTES = 20;

export function triggerMaintenanceAfterResponse(): void {
  after(async () => {
    try {
      const minutes = await jobsService.minutesSinceLastSuccess();
      if (minutes !== null && minutes < STALE_AFTER_MINUTES) return;
      await jobsService.runScheduled({ jobName: 'maintenance' });
    } catch (error) {
      log.error('jobs.visit_trigger_failed', { operation: 'jobs.visit', error });
    }
  });
}
