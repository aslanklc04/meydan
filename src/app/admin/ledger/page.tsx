import type { Metadata } from 'next';
import { adminService } from '@/server/modules/governance/admin.service';
import { jobsService } from '@/server/modules/governance/jobs.service';
import { DataTable } from '@/features/admin/components/DataTable';
import { formatCount } from '@/lib/utils';

export const metadata: Metadata = { title: 'Çip Defteri', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Çift kayıtlı defter denetimi.
 *
 * Değişmez kural: tüm hareketlerin toplamı SIFIR. Sıfırdan sapma, çip
 * yaratıldığı veya kaybolduğu anlamına gelir ve derhal incelenmelidir.
 */
export default async function AdminLedgerPage() {
  const [health, rows] = await Promise.all([
    jobsService.ledgerHealth(),
    adminService.recentLedger(),
  ]);

  return (
    <main className="space-y-4">
      <h1 className="text-ink text-xl font-bold">Çip Defteri</h1>

      <div
        className={[
          'rounded-xl border p-4',
          health.balanced ? 'border-correct' : 'border-incorrect',
        ].join(' ')}
      >
        <p className="text-ink text-base font-bold">
          {health.balanced ? 'Defter dengeli' : 'DEFTER DENGESİZ — İNCELE'}
        </p>
        <p className="text-muted mt-1 text-sm">
          Toplam {health.total} · {formatCount(health.entries)} kayıt
        </p>
      </div>

      <DataTable
        headers={['Tutar', 'Tür', 'Referans', 'Tarih']}
        empty="Defter boş."
        rows={rows.map((l) => [
          <span key="a" className={l.amount < 0 ? 'text-incorrect' : 'text-correct'}>
            {l.amount > 0 ? `+${l.amount}` : l.amount}
          </span>,
          l.type,
          l.referenceType ?? '—',
          l.createdAt.toLocaleString('tr-TR'),
        ])}
      />
    </main>
  );
}
