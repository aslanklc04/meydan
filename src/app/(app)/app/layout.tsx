import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentActor } from '@/server/auth';
import { logoutAction } from '@/features/auth/actions';
import { triggerMaintenanceAfterResponse } from '@/server/modules/governance/visit-trigger';
import { coinService } from '@/server/modules/economy/service';
import { reputationService } from '@/server/modules/reputation/service';
import { notificationService } from '@/server/modules/social/notification.service';
import { brand } from '@/config';
import { formatCount } from '@/lib/utils';
import { ToastProvider } from '@/components/feedback/Toast';

/**
 * Oturum içi kabuk — MOBİL ÖNCELİKLİ.
 *
 * Üstte tek satırda bakiye, Tahmin Gücü ve bildirim; altta tek elle
 * erişilebilir beş sekmeli navigasyon. Kullanıcı karmaşık bir panel görmez;
 * hiçbir teknik değer (id, durum, JSON) ekrana çıkmaz.
 */
export default async function AppLayout({ children }: { readonly children: React.ReactNode }) {
  const actor = await currentActor();
  if (!actor) redirect('/login');

  const [balance, rating, unread] = await Promise.all([
    coinService.getBalance(actor.id),
    reputationService.getSummary(actor.id),
    notificationService.unreadCount(actor.id),
  ]);

  // Bakım işi ziyaretle tetiklenir; mantık tek yerde (visit-trigger.ts).
  triggerMaintenanceAfterResponse();

  return (
    <ToastProvider>
      <div className="flex min-h-full flex-col">
        <header className="border-border bg-background sticky top-0 z-10 border-b">
          <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-3">
            <Link href="/app/feed" className="text-ink text-lg font-bold tracking-tight">
              {brand.appName}
            </Link>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-ink font-semibold" title={brand.currencyName}>
                <span aria-hidden="true">🪙</span> {formatCount(balance)}
              </span>
              <span className="text-ink font-semibold" title={brand.ratingName}>
                <span aria-hidden="true">🧠</span> {Math.round(rating.power)}
              </span>
              {/*
                YÖNETİM BAĞLANTISI — yalnızca yöneticiye görünür.

                Panel (üye sayısı, kim kayıt olmuş, etkinlik açma, çip defteri
                denetimi) baştan beri vardı ama arayüzde ona giden HİÇBİR
                bağlantı yoktu; kurucu adresini bilmediği için panelin
                varlığından habersizdi. Yazılmış ama ulaşılamayan özellik,
                yazılmamış özelliktir.
              */}
              {actor.role === 'ADMIN' || actor.role === 'MODERATOR' ? (
                <Link
                  href="/admin"
                  aria-label="Yönetim paneli"
                  className="text-ink focus-visible:outline-ink flex min-h-11 min-w-11 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span aria-hidden="true" className="text-lg">
                    ⚙️
                  </span>
                </Link>
              ) : null}
              <Link
                href="/app/search"
                aria-label="Ara"
                className="text-ink focus-visible:outline-ink flex min-h-11 min-w-11 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <span aria-hidden="true" className="text-lg">
                  🔍
                </span>
              </Link>
              <Link
                href="/app/notifications"
                aria-label={
                  unread > 0 ? `Bildirimler, ${formatCount(unread)} okunmamış` : 'Bildirimler'
                }
                className="text-ink focus-visible:outline-ink relative flex min-h-11 min-w-11 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <span aria-hidden="true" className="text-lg">
                  🔔
                </span>
                {unread > 0 && (
                  <span className="bg-incorrect text-brand-fg absolute top-1 right-0 min-w-5 rounded-full px-1 text-center text-[11px] leading-5 font-bold">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </Link>

              {/*
                ÇIKIŞ — üst çubukta.
                Çıkış zaten vardı ama profil sayfasının EN ALTINDA, soluk bir
                düğme olarak duruyordu; kurucu bulamadı. Bulunamayan bir çıkış
                yolu, olmayan çıkış yoludur — ve hesabından çıkamamak, ortak
                kullanılan bir bilgisayarda güvenlik meselesidir.
              */}
              <form action={logoutAction}>
                <button
                  type="submit"
                  aria-label="Oturumu kapat"
                  title="Oturumu kapat"
                  className="text-muted focus-visible:outline-ink flex min-h-11 min-w-11 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span aria-hidden="true" className="text-lg">
                    ⏻
                  </span>
                </button>
              </form>
            </div>
          </div>
        </header>

        <div
          id="icerik"
          className="mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-24 lg:max-w-3xl lg:pb-8"
        >
          {children}
        </div>

        <nav
          aria-label="Ana gezinme"
          className="border-border bg-background fixed inset-x-0 bottom-0 border-t"
        >
          <div className="mx-auto flex w-full max-w-2xl">
            <NavLink href="/app/feed" icon="🏠" label={brand.nav.feed} />
            <NavLink href="/app/trending" icon="🔥" label={brand.nav.trending} />
            <NavLink href="/app/challenges" icon="⚔️" label={brand.nav.challenges} />
            <NavLink href="/app/leaderboard" icon="🏆" label={brand.nav.leaderboard} />
            <NavLink href="/app/profile" icon="👤" label={brand.nav.profile} />
          </div>
        </nav>
      </div>
    </ToastProvider>
  );
}

function NavLink({
  href,
  icon,
  label,
}: {
  readonly href: string;
  readonly icon: string;
  readonly label: string;
}) {
  return (
    <Link
      href={href}
      className="text-muted flex min-h-16 flex-1 flex-col items-center justify-center gap-1 px-1 text-center text-[11px] leading-tight"
    >
      <span aria-hidden="true" className="text-xl">
        {icon}
      </span>
      {label}
    </Link>
  );
}
