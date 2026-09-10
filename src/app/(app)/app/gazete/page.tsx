import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentActor } from '@/server/auth';
import { gazetteService } from '@/server/modules/gazette/service';
import { EmptyState } from '@/components/feedback/EmptyState';
import { formatCount } from '@/lib/utils';

export const metadata: Metadata = { title: 'Gazetelerim', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * KULLANICININ KENDİ GAZETELERİ — ve paylaşımın işe yarayıp yaramadığı.
 *
 * ── NEDEN SAYILAR BURADA ───────────────────────────────────────────────────
 * Paylaşım bir kere yapılıp unutulan bir eylem değil; kullanıcı paylaştığı
 * şeyin bir karşılığı olduğunu görmezse bir daha paylaşmaz. "12 kişi baktı"
 * cümlesi, hiçbir rozetin veremeyeceği bir geri bildirimdir.
 *
 * Sayılar KİMSEYİ İSİMLENDİRMEZ. "Kim baktı" bilgisi tutulmuyor; tutulsaydı
 * ürün, kullanıcıların birbirini izlediği bir yere dönerdi ve kimse buna izin
 * vermedi.
 */
export default async function MyGazettesPage() {
  const actor = await currentActor();
  if (!actor) redirect('/login');

  const rows = await gazetteService.listMine(actor.id);

  return (
    <main className="space-y-5">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-ink text-xl font-bold">
          <span aria-hidden="true">📰 </span>Gazetelerim
        </h1>
        <Link href="/app/gazete/yeni" className="text-brand text-sm font-semibold">
          Yeni kur →
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="📰"
          title="Henüz gazete kurmadın"
          hint="Üç tahminini bir kapakta topla ve paylaş. Arkadaşların sonucu görmek için geri gelir."
          action={{ href: '/app/gazete/yeni', label: 'İlk gazeteni kur' }}
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((g) => (
            <li key={g.publicToken} className="border-border rounded-xl border p-4">
              <Link href={`/g/${g.publicToken}`} className="text-ink text-base font-bold">
                {g.title}
              </Link>
              <p className="text-muted mt-1 text-xs">
                {g.publishedDay}
                <span aria-hidden="true"> · </span>
                {/* Kullanıcı kapağının nerede durduğunu bilmeli: "paylaştım
                    ama kimse görmüyor" ile "ana sayfada duruyor" arasındaki
                    fark, onun kararıydı ve hatırlatılmalı. */}
                {g.hiddenAt !== null
                  ? 'Yönetim tarafından gizlendi'
                  : g.visibility === 'PUBLIC'
                    ? 'Ana sayfa rafında'
                    : 'Sadece bağlantıyla'}
              </p>
              <p className="text-muted mt-2 text-sm">
                <span aria-hidden="true">👁️ </span>
                {formatCount(g.viewCount)} kez görüntülendi
                {g.signupCount > 0 && (
                  <>
                    {' · '}
                    <span aria-hidden="true">🎉 </span>
                    <strong className="text-ink">
                      {formatCount(g.signupCount)} kişi bu kapaktan katıldı
                    </strong>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
