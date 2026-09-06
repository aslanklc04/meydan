import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentActor } from '@/server/auth';
import { ToastProvider } from '@/components/feedback/Toast';

/**
 * Yönetim kabuğu. Bildirim katmanı burada durur; sayfa içeriği tazelendiğinde
 * layout yerinde kaldığı için onay mesajı hayatta kalır (ADR-20).
 *
 * Yetki İKİ katmanda denetlenir: burada (rota) ve her Server Action içinde
 * `requireRole('ADMIN')` ile (defense in depth).
 */
const SECTIONS = [
  { href: '/admin', label: 'Özet' },
  { href: '/admin/events', label: 'Etkinlikler' },
  { href: '/admin/users', label: 'Kullanıcılar' },
  { href: '/admin/challenges', label: 'Meydan Okumalar' },
  { href: '/admin/predictions', label: 'Tahminler' },
  { href: '/admin/ledger', label: 'Çip Defteri' },
  { href: '/admin/reports', label: 'Bildirimler' },
  { href: '/admin/seasons', label: 'Sezonlar' },
  { href: '/admin/badges', label: 'Rozetler' },
  { href: '/admin/audit', label: 'Denetim' },
] as const;

export default async function AdminLayout({ children }: { readonly children: React.ReactNode }) {
  const actor = await currentActor();
  if (!actor) redirect('/login');
  if (actor.role !== 'ADMIN') redirect('/app/feed');

  return (
    <ToastProvider>
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <nav aria-label="Yönetim bölümleri" className="border-border -mx-4 mb-6 border-b px-4">
          <ul className="flex gap-1 overflow-x-auto">
            {SECTIONS.map((s) => (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className="text-muted flex min-h-11 items-center px-3 text-sm font-semibold whitespace-nowrap"
                >
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div id="icerik">{children}</div>
      </div>
    </ToastProvider>
  );
}
