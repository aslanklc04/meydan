import type { Metadata } from 'next';
import { rankingService } from '@/server/modules/ranking/service';
import { DataTable } from '@/features/admin/components/DataTable';

export const metadata: Metadata = { title: 'Rozetler', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Rozetler VERİTABANINDAN okunur — kural motoru geneldir.
 * Yeni rozet eklemek için kod değişikliği gerekmez; satır eklemek yeter.
 */
export default async function AdminBadgesPage() {
  const rows = await rankingService.listBadges();

  return (
    <main className="space-y-4">
      <h1 className="text-ink text-xl font-bold">Rozetler</h1>
      <p className="text-muted text-sm">
        Rozet kuralları veriden gelir. Yeni rozet eklemek kod değişikliği gerektirmez.
      </p>

      <DataTable
        headers={['Rozet', 'Anahtar', 'Kural', 'Ayar', 'Durum']}
        empty="Rozet tanımlı değil."
        rows={rows.map((b) => [
          `${b.icon} ${b.name}`,
          b.slug,
          b.rule,
          JSON.stringify(b.ruleConfig ?? {}),
          b.active ? 'Etkin' : 'Kapalı',
        ])}
      />
    </main>
  );
}
