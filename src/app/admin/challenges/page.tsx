import type { Metadata } from 'next';
import { adminService } from '@/server/modules/governance/admin.service';
import { DataTable } from '@/features/admin/components/DataTable';
import { challengeStatusLabel } from '@/features/predictions/labels';

export const metadata: Metadata = {
  title: 'Meydan Okumalar',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function AdminChallengesPage() {
  const rows = await adminService.listChallenges();

  return (
    <main className="space-y-4">
      <h1 className="text-ink text-xl font-bold">Meydan Okumalar</h1>
      <DataTable
        headers={['Etkinlik', 'Tür', 'Durum', 'Sonuç', 'Çip', 'Oluşturma']}
        empty="Meydan Okuma yok."
        rows={rows.map((c) => [
          c.eventTitle,
          c.mode === 'OPEN' ? 'Açık' : 'Doğrudan',
          challengeStatusLabel[c.status] ?? c.status,
          c.settlement ?? '—',
          c.stakeAmount,
          c.createdAt.toLocaleString('tr-TR'),
        ])}
      />
    </main>
  );
}
