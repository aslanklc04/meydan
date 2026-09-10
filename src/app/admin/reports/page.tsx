import type { Metadata } from 'next';
import { adminService } from '@/server/modules/governance/admin.service';
import { DataTable } from '@/features/admin/components/DataTable';
import { ActionButton } from '@/features/admin/components/ActionButton';
import { hideGazetteAction, reviewReportAction } from '@/features/admin/actions';

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
          r.targetType === 'GAZETTE' ? (
            <a
              key="t"
              href={`/g/${r.targetId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline"
            >
              Gazete kapağı
            </a>
          ) : (
            r.targetType
          ),
          reasonLabel[r.reason] ?? r.reason,
          r.note ?? '—',
          r.createdAt.toLocaleString('tr-TR'),
          <span key="a" className="flex flex-wrap gap-2">
            {/*
              Gazete kapağı için AYRI bir eylem: "işleme aldım" demek
              bildirimi kapatır ama içeriği yerinde bırakır. Şikâyet edilen
              kapağın gerçekten kaldırılması için gizleme düğmesi gerekir,
              yoksa moderasyon kuyruğu temizlenir ve içerik durur.
            */}
            {r.targetType === 'GAZETTE' && (
              <ActionButton
                label="Kapağı gizle"
                tone="danger"
                action={hideGazetteAction.bind(null, r.targetId)}
              />
            )}
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
