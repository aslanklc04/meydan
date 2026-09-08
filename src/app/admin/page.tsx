import type { Metadata } from 'next';
import Link from 'next/link';
import { adminService } from '@/server/modules/governance/admin.service';
import { jobsService } from '@/server/modules/governance/jobs.service';
import { ActionButton } from '@/features/admin/components/ActionButton';
import { runMaintenanceJobsAction, generateLeaderboardAction } from '@/features/admin/actions';
import { formatCount } from '@/lib/utils';

export const metadata: Metadata = { title: 'Yönetim', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminHomePage() {
  const [counts, ledger, pending, runs, minutesSinceJob] = await Promise.all([
    adminService.counts(),
    jobsService.ledgerHealth(),
    jobsService.pendingResolutionCount(),
    jobsService.recentRuns(5),
    jobsService.minutesSinceLastSuccess(),
  ]);

  /*
   * ZAMANLAYICI SAĞLIĞI.
   *
   * Zamanlanmış iş, en tehlikeli arıza türüne sahiptir: SESSİZ ölüm. Hiçbir
   * hata görünmez, yalnızca iadeler yapılmaz ve etkinlikler kapanmaz.
   * Eşik, cron planından (15 dk) belirgin biçimde büyük seçildi ki geçici
   * gecikmeler yanlış alarm üretmesin.
   */
  const jobStale = minutesSinceJob === null || minutesSinceJob > 90;

  return (
    <main className="space-y-6">
      <h1 className="text-ink text-xl font-bold">Özet</h1>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Kullanıcı" value={formatCount(counts.users)} />
        <Stat label="Etkin hesap" value={formatCount(counts.activeUsers)} />
        <Stat label="Etkinlik" value={formatCount(counts.events)} />
        <Stat label="Açık etkinlik" value={formatCount(counts.openEvents)} />
        <Stat label="Tahmin" value={formatCount(counts.predictions)} />
        <Stat label="Meydan Okuma" value={formatCount(counts.challenges)} />
        <Stat label="Yanıt bekleyen" value={formatCount(counts.pendingChallenges)} />
        <Stat label="Açık bildirim" value={formatCount(counts.openReports)} />
        <Stat label="Sonuç bekleyen" value={formatCount(pending)} />
      </dl>

      <section className="border-border rounded-xl border p-4">
        <h2 className="text-ink text-base font-bold">Çip Defteri Denetimi</h2>
        <p className="text-muted mt-1 text-sm">
          Çift kayıtlı defterde tüm hareketlerin toplamı sıfır olmalıdır. Sıfır değilse çip yoktan
          var edilmiş ya da yok olmuş demektir.
        </p>
        <p className="mt-2 text-sm">
          <span className="text-muted">Toplam: </span>
          <strong className={ledger.balanced ? 'text-correct' : 'text-incorrect'}>
            {ledger.total}
          </strong>
          <span className="text-muted"> · {formatCount(ledger.entries)} kayıt · </span>
          <strong className={ledger.balanced ? 'text-correct' : 'text-incorrect'}>
            {ledger.balanced ? 'DENGELİ' : 'DENGESİZ — İNCELE'}
          </strong>
        </p>
      </section>

      <section
        className={['rounded-xl border p-4', jobStale ? 'border-incorrect' : 'border-correct'].join(
          ' ',
        )}
      >
        <h2 className="text-ink text-base font-bold">Zamanlayıcı</h2>
        <p className="text-ink mt-1 text-sm">
          {minutesSinceJob === null
            ? 'Bakım işi HİÇ çalışmadı. Zamanlayıcı bağlı mı?'
            : jobStale
              ? `Son başarılı çalıştırma ${minutesSinceJob} dakika önce — BEKLENENDEN ESKİ.`
              : `Son başarılı çalıştırma ${minutesSinceJob} dakika önce.`}
        </p>
        <p className="text-muted mt-1 text-xs">
          Bakım işi süresi dolan Meydan Okumaların çipini iade eder. Çalışmazsa çipler askıda kalır.
        </p>

        {runs.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs">
            {runs.map((r) => (
              <li key={r.id} className="text-muted">
                {r.startedAt.toLocaleString('tr-TR')} · {r.status}
                {r.durationMs !== null && ` · ${r.durationMs} ms`}
                {r.error && ` · ${r.error}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-border rounded-xl border p-4">
        <h2 className="text-ink text-base font-bold">İşler</h2>
        <p className="text-muted mt-1 mb-3 text-sm">
          Bakım işleri idempotenttir; iki kez çalıştırmak zararsızdır.
        </p>
        <div className="flex flex-wrap gap-2">
          {/*
            DİKKAT — action prop'una OK FONKSİYONU sarma.

            ActionButton bir istemci bileşenidir. Sunucu bileşeninden istemci
            bileşenine geçirilen bir fonksiyon, ancak SUNUCU EYLEMİNİN KENDİSİ
            ise serileştirilebilir. Onu bir ok fonksiyonuyla sarmak sıradan bir
            closure üretir; React bunu serileştiremez ve SAYFANIN TAMAMI
            "Yönetim ekranı yüklenemedi" hatasıyla düşer.

            Bu hata derlemede ve tip denetiminde GÖRÜNMEZ; yalnızca sayfa
            gerçekten açıldığında ortaya çıkar. Özet ve Sezonlar sayfaları
            tam olarak bu yüzden açılmıyordu.

            Doğru yol argüman bağlamaktır: `.bind(null, ...)` sunucu eylemi
            kimliğini korur.
          */}
          <ActionButton label="Bakım işlerini çalıştır" action={runMaintenanceJobsAction} />
          <ActionButton
            label="Haftalık sıralamayı üret"
            action={generateLeaderboardAction.bind(null, { period: 'WEEKLY' })}
          />
          <ActionButton
            label="Tüm zamanlar sıralaması"
            action={generateLeaderboardAction.bind(null, { period: 'ALL_TIME' })}
          />
        </div>
      </section>

      <p className="text-sm">
        <Link href="/admin/events" className="text-brand underline">
          Sonuç girişi ve etkinlik yönetimi →
        </Link>
      </p>
    </main>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="border-border rounded-lg border px-3 py-3">
      <dt className="text-muted text-xs">{label}</dt>
      <dd className="text-ink mt-1 text-xl font-bold">{value}</dd>
    </div>
  );
}
