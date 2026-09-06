/**
 * İtibar yeniden hesaplama — `npm run ratings:recompute [-- --apply]`.
 *
 * VARSAYILAN KURU ÇALIŞTIRMADIR. Hiçbir satır değişmez; yalnızca kaç
 * kullanıcının puanının değişeceği ve en büyük farkın ne olduğu raporlanır.
 * Yazmak için açıkça `--apply` verilir. Sebep: itibar kullanıcıya gösterilen
 * ve başkalarıyla karşılaştırılan bir sayıdır; sessizce toplu değiştirilmesi
 * kabul edilemez.
 *
 * ÖNCE YEDEK ALIN (docs/operations.md).
 */
import { recomputeService } from '../src/server/modules/reputation/recompute.service';
import { rating } from '../src/config';

async function main() {
  const apply = process.argv.includes('--apply');

  const report = await recomputeService.recomputeAll({ dryRun: !apply });

  console.log(apply ? 'UYGULANDI' : 'KURU ÇALIŞTIRMA (hiçbir satır değişmedi)');
  console.log(`  Algoritma sürümü        : ${rating.algorithmVersion}`);
  console.log(`  Kullanıcı               : ${report.users}`);
  console.log(`  Oynatılan tahmin        : ${report.predictions}`);
  console.log(`  Kategori istatistiği    : ${report.categoryStats}`);
  console.log(`  Puanı değişen kullanıcı : ${report.changed}`);
  console.log(`  En büyük fark           : ${report.maxDelta} puan`);

  if (!apply) {
    console.log('\nUygulamak için: npm run ratings:recompute -- --apply');
  } else {
    const stale = await recomputeService.staleVersionCount();
    console.log(`  Eski sürümde kalan      : ${stale}`);
    if (stale > 0) process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error('Yeniden hesaplama başarısız:', error);
    process.exit(1);
  });
