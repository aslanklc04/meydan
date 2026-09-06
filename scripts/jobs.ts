/**
 * Bakım işleri — `npm run jobs`.
 *
 * Bu betik bir zamanlayıcıdan (cron, systemd timer, platform scheduler) dakikada
 * bir çağrılabilir. İşler idempotenttir; "tam olarak bir kez çalıştırma"
 * garantisi gerekmez.
 *
 * MVP'de ayrı bir kuyruk/işçi altyapısı KURULMADI (Faz 4 talimatı: gereksiz
 * bağımlılık ekleme). Yük arttığında bu dosyanın çağırdığı servisler
 * değişmeden bir kuyruğa taşınabilir.
 */
import { jobsService } from '../src/server/modules/governance/jobs.service';

async function main() {
  const started = Date.now();

  // Kilitli yol kullanılır: yerelde de iki terminalden aynı anda
  // çalıştırıldığında ikincisi sessizce atlanır ve kayıt tutulur.
  const result = await jobsService.runScheduled({ jobName: 'maintenance' });

  if (result.skipped) {
    console.log('Bakım işleri ZATEN ÇALIŞIYOR — bu çalıştırma atlandı.');
    return;
  }

  const report = result.report!;
  console.log('Bakım işleri tamamlandı:');
  console.log(`  Süresi dolan Meydan Okuma  : ${report.expiredChallenges}`);
  console.log(`  Tahminleri kapatılan etkinlik: ${report.closedEvents}`);
  console.log(`  Üretilen tekrarlayan etkinlik: ${report.generatedEvents}`);
  console.log(`  Atlanan (zaten var)          : ${report.skippedEvents}`);
  console.log(`  Temizlenen sayaç             : ${report.prunedCounters}`);
  console.log(`  Süre: ${Date.now() - started} ms`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Bakım işleri başarısız:', error);
    process.exit(1);
  });
