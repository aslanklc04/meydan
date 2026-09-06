import { brand, economy, rating } from '@/config';
import { FinancialDisclaimer } from '@/components/disclaimers/FinancialDisclaimer';

/**
 * Faz 1 yer tutucusu. Gerçek landing page Faz 4 ve Faz 19'da inşa edilir.
 * Buradaki amaç: config katmanının uçtan uca bağlı olduğunu görünür kılmak.
 */
export default function Home() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <p className="text-muted text-xs font-medium tracking-widest uppercase">Faz 1 · Kurulum</p>

      <h1 className="text-ink mt-3 text-5xl font-bold tracking-tight">{brand.appName}</h1>
      <div className="bg-brand mt-3 h-1 w-24 rounded-full" />

      <p className="text-ink mt-6 text-xl">{brand.tagline}</p>
      <p className="text-muted mt-2 leading-relaxed">{brand.description}</p>

      <dl className="border-border mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-[var(--border)] sm:grid-cols-3">
        <Stat label="Başlangıç bakiyesi" value={`${economy.initialGrant} ${brand.currencyShort}`} />
        <Stat label={`Yeni ${brand.ratingName}`} value={String(rating.coldStartPower)} />
        <Stat label="Meydan Okuma süresi" value={`${economy.challengeTtlHours} saat`} />
      </dl>

      <p className="text-muted mt-10 text-sm leading-relaxed">
        {brand.currencyName} tamamen sanal, oyun içi bir puandır. Gerçek para değildir; nakde
        çevrilemez, çekilemez, gerçek para ile satın alınamaz.
      </p>

      <FinancialDisclaimer variant="full" className="mt-6" />
    </main>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="bg-background px-4 py-3">
      <dt className="text-muted text-xs">{label}</dt>
      <dd className="text-ink mt-1 text-lg font-semibold">{value}</dd>
    </div>
  );
}
