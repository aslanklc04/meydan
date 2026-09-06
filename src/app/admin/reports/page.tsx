import type { Metadata } from 'next';
import { adminService } from '@/server/modules/governance/admin.service';
import { DataTable } from '@/features/admin/components/DataTable';
import { ActionButton } from '@/features/admin/components/ActionButton';
import { reviewReportAction } from '@/features/admin/actions';

export const metadata: Metadata = { title: 'Bildirimler', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const reasonLabel: Record<string, string> = {
  SPAM: 'İstenmeyen içerik',
  ABUSE: 'Taciz / hakaret',
  IMPERSONATION: 'Kimlik taklidi',
  CHEATING: 'Kural ihlali',
  OTHER: 'Diğer',
};

export default async function AdminReportsPage() {
  const rows = await adminService.listReports('OPEN');

  return (
    <main className="space-y-4">
      <h1 className="text-ink text-xl font-bold">Açık Bildirimler</h1>
      <p className="text-muted text-sm">Bildirim otomatik yaptırım üretmez. Karar insanda kalır.</p>

      <DataTable
        headers={['Bildiren', 'Hedef', 'Sebep', 'Not', 'Tarih', 'Eylem']}
        empty="Açık bildirim yok."
        rows={rows.map((r) => [
          `@${r.reporterUsername}`,
          r.targetType,
          reasonLabel[r.reason] ?? r.reason,
          r.note ?? '—',
          r.createdAt.toLocaleString('tr-TR'),
          <span key="a" className="flex gap-2">
            <ActionButton
              label="İşleme al"
              action={reviewReportAction.bind(null, r.id, 'REVIEWED')}
            />
            <ActionButton
              label="Reddet"
              tone="danger"
              action={reviewReportAction.bind(null, r.id, 'DISMISSED')}
            />
          </span>,
        ])}
      />
    </main>
  );
}
