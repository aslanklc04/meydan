import type { Metadata } from 'next';
import { adminService } from '@/server/modules/governance/admin.service';
import { DataTable } from '@/features/admin/components/DataTable';
import { predictionResultLabel, predictionStatusLabel } from '@/features/predictions/labels';

export const metadata: Metadata = { title: 'Tahminler', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminPredictionsPage() {
  const rows = await adminService.listPredictions();

  return (
    <main className="space-y-4">
      <h1 className="text-ink text-xl font-bold">Tahminler</h1>
      <DataTable
        headers={['Kullanıcı', 'Etkinlik', 'Durum', 'Sonuç', 'Çip', 'Tarih']}
        empty="Tahmin yok."
        rows={rows.map((p) => [
          `@${p.username}`,
          p.eventTitle,
          predictionStatusLabel[p.status] ?? p.status,
          p.result ? (predictionResultLabel[p.result] ?? p.result) : '—',
          p.stakeAmount,
          p.createdAt.toLocaleString('tr-TR'),
        ])}
      />
    </main>
  );
}
