import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentActor } from '@/server/auth';
import { notificationService } from '@/server/modules/social/notification.service';
import { MarkAllReadButton } from '@/features/social/components/MarkAllReadButton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { notificationIcon, timeAgo } from '@/features/predictions/labels';

export const metadata: Metadata = { title: 'Bildirimler', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Bildirimler.
 *
 * Her satır üç şey taşır: NE olduğunu anlatan bir ikon, hazır yazılmış bir
 * cümle ve TIKLANABİLİR bir hedef. Bildirim tıklanamıyorsa yarım kalmıştır —
 * kullanıcı "ne olmuş?" diye sorup ilgili sayfayı kendi aramak zorunda kalır.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ imlec?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect('/login');

  const { imlec } = await searchParams;
  const { items, nextCursor } = await notificationService.list(
    actor.id,
    imlec ? { limit: 30, cursor: imlec } : { limit: 30 },
  );
  const hasUnread = items.some((n) => n.readAt === null);

  return (
    <main className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-ink text-xl font-bold">Bildirimler</h1>
        {hasUnread && <MarkAllReadButton />}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="🔔"
          title="Henüz bildirimin yok."
          hint="Birini takip et ya da bir Meydan Okuma başlat; burası dolmaya başlar."
          action={{ href: '/app/feed', label: 'Akışa git' }}
        />
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((n) => {
              const unread = n.readAt === null;
              const body = (
                <div
                  className={[
                    'flex min-h-16 items-start gap-3 rounded-lg border px-3 py-3 text-sm',
                    unread ? 'border-brand bg-surface' : 'border-border',
                  ].join(' ')}
                >
                  <span aria-hidden="true" className="text-xl leading-none">
                    {notificationIcon[n.type] ?? '🔔'}
                  </span>
                  <span className="flex-1">
                    <span className="text-ink block">{n.body}</span>
                    <span className="text-muted mt-1 block text-xs">
                      {timeAgo(n.createdAt)}
                      {/* Okunmamış olma durumu renkten BAĞIMSIZ olarak da yazılır. */}
                      {unread && ' · yeni'}
                    </span>
                  </span>
                </div>
              );
              return (
                <li key={n.id}>
                  {n.href ? (
                    <Link href={n.href} className="block">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>

          {nextCursor && (
            <Link
              href={`/app/notifications?imlec=${encodeURIComponent(nextCursor)}`}
              className="border-border text-ink flex min-h-12 items-center justify-center rounded-lg border text-sm font-semibold"
            >
              Daha eskisini göster
            </Link>
          )}
        </>
      )}
    </main>
  );
}
