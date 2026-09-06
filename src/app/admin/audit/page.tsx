import type { Metadata } from 'next';
import Link from 'next/link';
import {
  auditService,
  auditActionLabel,
  type AuditAction,
} from '@/server/modules/governance/audit.service';
import { DataTable } from '@/features/admin/components/DataTable';
import { EmptyState } from '@/components/feedback/EmptyState';

export const metadata: Metadata = {
  title: 'Denetim Kaydı',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * Denetim kaydı — kim, ne zaman, neyi değiştirdi.
 *
 * Salt okunurdur. Kaydı düzenleme veya silme arayüzü YOKTUR; düzeltilebilen
 * bir denetim kaydının denetim değeri kalmaz.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ eylem?: string; hedef?: string }>;
}) {
  const { eylem, hedef } = await searchParams;
  const action = (Object.keys(auditActionLabel) as AuditAction[]).find((a) => a === eylem);

  const rows = await auditService.list(100, {
    ...(action ? { action } : {}),
    ...(hedef ? { targetId: hedef } : {}),
  });

  return (
    <main className="space-y-4">
      <h1 className="text-ink text-xl font-bold">Denetim Kaydı</h1>
      <p className="text-muted text-sm">
        Yönetici işlemleri kalıcı olarak kaydedilir. Değiştirilemez ve silinemez — bu kural
        veritabanı tetikleyicisiyle zorlanır, uygulama koduna bırakılmamıştır.
      </p>

      {/* Filtre: "şu etkinliğe ne oldu?" ve "kim askıya alındı?" soruları. */}
      <nav aria-label="Denetim kaydı filtresi" className="-mx-4 flex gap-2 overflow-x-auto px-4">
        <Link
          href="/admin/audit"
          className={[
            'min-h-10 shrink-0 rounded-full px-3 text-xs leading-10 font-medium',
            action ? 'border-border text-muted border' : 'bg-ink text-background',
          ].join(' ')}
        >
          Tümü
        </Link>
        {(Object.keys(auditActionLabel) as AuditAction[]).map((a) => (
          <Link
            key={a}
            href={`/admin/audit?eylem=${a}`}
            className={[
              'min-h-10 shrink-0 rounded-full px-3 text-xs leading-10 font-medium whitespace-nowrap',
              action === a ? 'bg-ink text-background' : 'border-border text-muted border',
            ].join(' ')}
          >
            {auditActionLabel[a]}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          title="Henüz denetim kaydı yok."
          hint="Bir etkinlik oluşturduğunda ya da sonuçlandırdığında burada görünür."
        />
      ) : (
        <DataTable
          headers={['Ne zaman', 'Kim', 'İşlem', 'Hedef', 'Ayrıntı']}
          empty="Kayıt yok."
          rows={rows.map((r) => [
            r.createdAt.toLocaleString('tr-TR'),
            r.actorUsername ? `@${r.actorUsername}` : 'sistem',
            auditActionLabel[r.action as AuditAction] ?? r.action,
            r.targetType ?? '—',
            r.metadata ? JSON.stringify(r.metadata) : '—',
          ])}
        />
      )}
    </main>
  );
}
