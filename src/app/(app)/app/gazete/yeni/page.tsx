import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentActor } from '@/server/auth';
import { gazetteService } from '@/server/modules/gazette/service';
import { GazetteComposer } from '@/features/gazette/components/GazetteComposer';
import type { ComposerItem } from '@/features/gazette/components/GazetteComposer';
import { EmptyState } from '@/components/feedback/EmptyState';
import { timeRemaining } from '@/features/predictions/labels';

export const metadata: Metadata = { title: 'Gazeteni kur', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * GAZETE KURMA — paylaşılabilir çıktının üretildiği yer.
 *
 * ── NEDEN İKİNCİ ADIM ──────────────────────────────────────────────────────
 * Bu ekran tahmin YAPTIRMAZ; yapılmış tahminleri toplar. Gazeteyi giriş kapısı
 * yapmak, ilk tahminin önüne üç seçimlik bir form koymak olurdu — sürtünmenin
 * en pahalı olduğu anda eklenen sürtünme. Önce tahmin ucuz kalır, gazete
 * sonra gelir.
 *
 * Bu yüzden hiç uygun tahmin yoksa BU EKRAN BOŞ DEĞİL, YÖNLENDİRİCİDİR:
 * kullanıcıyı akışa geri gönderir. "Hiçbir şey yok" diyen bir ekran,
 * kullanıcının ne yapması gerektiğini söylemeyen bir ekrandır.
 */
export default async function NewGazettePage() {
  const actor = await currentActor();
  if (!actor) redirect('/login');

  const rows = await gazetteService.eligible(actor.id);

  const items: ComposerItem[] = rows.map((r) => ({
    predictionId: r.predictionId,
    eventTitle: r.eventTitle,
    question: r.question,
    outcomeLabel: r.outcomeLabel,
    outcomeImageUrl: r.outcomeImageUrl,
    closesLabel: `Kapanışa ${timeRemaining(r.closesAt)}`,
  }));

  return (
    <main className="space-y-5">
      <div>
        <h1 className="text-ink text-xl font-bold">
          <span aria-hidden="true">📰 </span>Gelecek Gazetesi
        </h1>
        <p className="text-muted mt-1 text-sm">
          En çok üç tahminini bir kapakta topla, paylaş. Arkadaşların sonucu görmek için geri gelir.
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="📰"
          title="Kapağa koyacak açık tahminin yok"
          hint="Gazete, sonucu HENÜZ BELLİ OLMAYAN tahminlerden kurulur. Önce açık bir etkinliğe tahmin yap, sonra buraya dön."
          action={{ href: '/app/feed', label: 'Tahmin yapmaya git' }}
        />
      ) : (
        <GazetteComposer items={items} />
      )}

      <p className="text-muted text-xs">
        <Link href="/app/gazete" className="text-brand font-semibold">
          Önceki gazetelerin →
        </Link>
      </p>
    </main>
  );
}
