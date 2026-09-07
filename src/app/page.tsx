import Link from 'next/link';
import { brand, economy, rating } from '@/config';
import { FinancialDisclaimer } from '@/components/disclaimers/FinancialDisclaimer';

/**
 * Karşılama sayfası — sitenin ön kapısı.
 *
 * FAZ 7 DÜZELTMESİ: burası Faz 1'den kalma bir yer tutucuydu ve üzerinde
 * "Faz 1 · Kurulum" etiketi taşıyordu. Daha kötüsü, KAYIT VE GİRİŞ BAĞLANTISI
 * YOKTU: site yayına alındığında ziyaretçinin hesap açmasının hiçbir yolu
 * bulunmuyordu. Kapısı olmayan bir bina.
 *
 * Buradaki amaç zengin bir tanıtım sayfası yapmak değil (o Faz 19'un işi);
 * amaç ön kapıyı ÇALIŞIR hale getirmek: ne olduğunu söyle, içeri gir.
 *
 * Yasal uyarılar kaldırılmadı ve kaldırılmayacak: Gümüş Çip'in sanal olduğu ve
 * finansal içeriğin yatırım tavsiyesi olmadığı, kullanıcı daha kaydolmadan
 * görünür olmalıdır.
 */
export const metadata = {
  alternates: { canonical: '/' },
};

export default function Home() {
  return (
    <main id="icerik" className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <h1 className="text-ink text-5xl font-bold tracking-tight">{brand.appName}</h1>
      <div className="bg-brand mt-3 h-1 w-24 rounded-full" />

      <p className="text-ink mt-6 text-xl">{brand.tagline}</p>
      <p className="text-muted mt-2 leading-relaxed">{brand.description}</p>

      {/* ── Ön kapı ─────────────────────────────────────────────────────── */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/register"
          className="bg-brand text-brand-fg focus-visible:outline-ink flex min-h-13 flex-1 items-center justify-center rounded-lg text-base font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Hesap oluştur
        </Link>
        <Link
          href="/login"
          className="border-border text-ink focus-visible:outline-ink flex min-h-13 flex-1 items-center justify-center rounded-lg border text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Giriş yap
        </Link>
      </div>

      <dl className="border-border mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-[var(--border)] sm:grid-cols-3">
        <Stat label="Başlangıç bakiyesi" value={`${economy.initialGrant} ${brand.currencyShort}`} />
        <Stat label={`Yeni ${brand.ratingName}`} value={String(rating.coldStartPower)} />
        <Stat label="Meydan Okuma süresi" value={`${economy.challengeTtlHours} saat`} />
      </dl>

      <p className="text-muted mt-6 text-sm">
        <Link href="/tahmin-gucu" className="underline underline-offset-4">
          {brand.ratingName} nasıl hesaplanır?
        </Link>
      </p>

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
