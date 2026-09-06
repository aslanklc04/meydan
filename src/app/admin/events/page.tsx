import type { Metadata } from 'next';
import Link from 'next/link';
import { catalogService } from '@/server/modules/catalog/service';
import { ResolvePanel } from '@/features/admin/components/ResolvePanel';
import { CreateEventForm } from '@/features/admin/components/CreateEventForm';
import { ActionButton } from '@/features/admin/components/ActionButton';
import { closeEventAction } from '@/features/admin/actions';
import { formatCount } from '@/lib/utils';

export const metadata: Metadata = { title: 'Etkinlikler', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Etkinlik yönetimi.
 *
 * Sonuç girişi hem AÇIK hem KAPALI etkinlikler için mümkündür — kapatma ayrı
 * bir adımdır, zorunlu değil. Bu, Faz 3'te çalışan sonuçlandırma akışını
 * OLDUĞU GİBİ korur.
 */
export default async function AdminEventsPage() {
  const [events, categories] = await Promise.all([
    catalogService.listAwaitingResolution(),
    catalogService.listCategories(),
  ]);

  // N+1 YOK: tüm sonuçlar tek sorguda okunur (Faz 5 performans denetimi).
  const outcomeMap = await catalogService.getOutcomesFor(events.map((e) => e.id));
  const withOutcomes = events.map((e) => ({ ...e, outcomes: outcomeMap.get(e.id) ?? [] }));

  return (
    <main className="space-y-8">
      <section>
        <h1 className="text-ink text-xl font-bold">Sonuç Girişi</h1>
        <p className="text-muted mt-1 mb-4 text-sm">
          Sonuçlandırılmayı bekleyen {withOutcomes.length} etkinlik.
        </p>

        {withOutcomes.length === 0 ? (
          <p className="border-border rounded-xl border border-dashed p-6 text-center text-sm">
            Bekleyen etkinlik yok.
          </p>
        ) : (
          <div className="space-y-4">
            {withOutcomes.map((e) => (
              <div key={e.id} className="space-y-2">
                <ResolvePanel
                  eventId={e.id}
                  title={e.title}
                  question={e.question}
                  predictionCount={e.predictionCount}
                  challengeCount={e.challengeCount}
                  outcomes={e.outcomes.map((o) => ({ id: o.id, label: o.label }))}
                />
                <div className="flex flex-wrap items-center gap-2 px-1">
                  <span className="text-muted text-xs">
                    Kapanış {e.closesAt.toLocaleString('tr-TR')} · {formatCount(e.predictionCount)}{' '}
                    tahmin
                  </span>
                  {e.status === 'OPEN' && (
                    <ActionButton
                      label="Tahminleri kapat"
                      confirm="Tahminler kapatılacak ve kalabalık dağılımı dondurulacak. Onaylıyor musun?"
                      action={closeEventAction.bind(null, e.id)}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <CreateEventForm categories={categories.map((c) => ({ slug: c.slug, name: c.name }))} />
      </section>

      <p className="text-sm">
        <Link href="/admin" className="text-brand underline">
          ← Özet
        </Link>
      </p>
    </main>
  );
}
