import type { Metadata } from 'next';
import { rankingService } from '@/server/modules/ranking/service';
import { DataTable } from '@/features/admin/components/DataTable';
import { ActionButton } from '@/features/admin/components/ActionButton';
import { generateLeaderboardAction } from '@/features/admin/actions';

export const metadata: Metadata = { title: 'Sezonlar', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const seasonStatusLabel: Record<string, string> = {
  UPCOMING: 'Yaklaşan',
  ACTIVE: 'Etkin',
  CLOSED: 'Kapalı',
};

export default async function AdminSeasonsPage() {
  const seasons = await rankingService.listSeasons();

  return (
    <main className="space-y-4">
      <h1 className="text-ink text-xl font-bold">Sezonlar</h1>
      <p className="text-muted text-sm">
        Aynı anda yalnızca BİR sezon etkin olabilir; bu kural veritabanında kısmi tekil index ile
        korunur.
      </p>

      <DataTable
        headers={['Sezon', 'Başlangıç', 'Bitiş', 'Durum']}
        empty="Sezon tanımlı değil."
        rows={seasons.map((s) => [
          s.name,
          s.startAt.toLocaleDateString('tr-TR'),
          s.endAt.toLocaleDateString('tr-TR'),
          seasonStatusLabel[s.status] ?? s.status,
        ])}
      />

      <div className="flex flex-wrap gap-2">
        {/*
          Ok fonksiyonuyla sarmak sayfayı düşürür — bkz. src/app/admin/page.tsx
          içindeki açıklama. Argüman `.bind` ile bağlanır.
        */}
        <ActionButton
          label="Sezon sıralamasını üret"
          action={generateLeaderboardAction.bind(null, { period: 'SEASON' })}
        />
        <ActionButton
          label="Aylık sıralamayı üret"
          action={generateLeaderboardAction.bind(null, { period: 'MONTHLY' })}
        />
      </div>
    </main>
  );
}
