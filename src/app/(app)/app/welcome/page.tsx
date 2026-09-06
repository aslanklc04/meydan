import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentActor } from '@/server/auth';
import { onboardingService } from '@/server/modules/identity/onboarding.service';
import { InterestPicker } from '@/features/onboarding/components/InterestPicker';
import { skipOnboardingAction } from '@/features/onboarding/actions';
import { brand } from '@/config';

export const metadata: Metadata = { title: 'Hoş geldin', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Karşılama — kullanıcının gördüğü İLK ekran.
 *
 * Üç cümle ve bir seçim. Uzun bir tanıtım turu yok: ürünü anlatmanın en iyi
 * yolu kullandırmaktır. "Şimdilik geç" her zaman görünür.
 */
export default async function WelcomePage() {
  const actor = await currentActor();
  if (!actor) redirect('/login');

  const [categories, selected] = await Promise.all([
    onboardingService.selectableCategories(),
    onboardingService.interestSlugs(actor.id),
  ]);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-ink text-2xl font-bold">
          {brand.appName}&apos;A HOŞ GELDİN, @{actor.username}
        </h1>
        <p className="text-foreground mt-3 text-base">
          Kendi tahminini ortaya koy. İstersen başkasına Meydan Oku. Sonuçları zamanla görelim.
        </p>
        <p className="text-muted mt-2 text-sm">
          Başlangıç için hesabına 1.000 {brand.currencyName} tanımlandı. {brand.currencyName}{' '}
          tamamen oyun içi bir puandır; gerçek para değildir, nakde çevrilemez.
        </p>
      </header>

      <section>
        <h2 className="text-ink mb-1 text-base font-bold">Neyle ilgileniyorsun?</h2>
        <p className="text-muted mb-3 text-sm">
          Seçtiklerin akışında önce gösterilir. Sonradan değiştirebilirsin.
        </p>
        <InterestPicker categories={categories} initiallySelected={selected} />
      </section>

      <form action={skipOnboardingAction}>
        <button
          type="submit"
          className="text-muted focus-visible:outline-ink min-h-12 w-full text-sm underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Şimdilik geç
        </button>
      </form>
    </main>
  );
}
