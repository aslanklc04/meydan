import Link from 'next/link';
import { brand, economy, rating } from '@/config';
import { FinancialDisclaimer } from '@/components/disclaimers/FinancialDisclaimer';
import { featuredService } from '@/server/modules/catalog/featured.service';
import { consensusService } from '@/server/modules/catalog/consensus.service';
import { catalogService } from '@/server/modules/catalog/service';
import { formatCount } from '@/lib/utils';
import { DailyMeydan } from '@/features/daily/components/DailyMeydan';
import { timeRemaining } from '@/features/predictions/labels';

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

/*
 * Ana sayfa her istekte üretilir: Günün Meydanı ve katılımcı sayısı canlı
 * veridir. Statik üretilseydi ziyaretçi dünkü soruyu görürdü.
 */
export const dynamic = 'force-dynamic';

export default async function Home() {
  /*
   * GÜNÜN MEYDANI — hero'nun hemen altında.
   *
   * Kayıt duvarı ÖNCE değil SONRA gelir: ziyaretçi ürünün ne olduğunu
   * anlatan bir metin değil, ürünün kendisini görür ve bir tıklamayla
   * içine girer. Değeri görmeden hesap istemek, en pahalı adımı en başa
   * koymaktır.
   */
  const featured = await featuredService.today();

  /*
   * Giriş yapmamış ziyaretçi TAHMİN YAPMAMIŞ sayılır, bu yüzden dağılım
   * hiç istenmez — yalnızca toplam katılımcı sayısı okunur. Sunucu o veriyi
   * üretmediği için sayfa kaynağına da düşmez.
   */
  const consensus = featured ? await consensusService.view(featured.id, null) : null;
  const outcomes = featured ? await consensusService.outcomesOf(featured.id) : [];

  /*
   * BUGÜN AÇIK OLANLAR — ziyaretçi ürünün yaşadığını görsün.
   *
   * Ana sayfada tek bir soru varken site "kurulmuş ama kimse yok" hissi
   * verir. Burada gösterilenler GERÇEK açık etkinliklerdir; sahte sayı,
   * sahte etkinlik ya da doldurma içerik yok. Hiç yoksa bölüm hiç
   * görünmez — boş bir liste göstermek, hiç göstermemekten kötüdür.
   *
   * Günün Meydanı listeden çıkarılır: hemen yukarıda zaten duruyor.
   */
  const openEvents = (await catalogService.listOpenEvents(null, 7))
    .filter((e) => e.id !== featured?.id)
    .slice(0, 6);
  return (
    <main id="icerik" className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <h1 className="text-ink text-5xl font-bold tracking-tight">{brand.appName}</h1>
      <div className="bg-brand mt-3 h-1 w-24 rounded-full" />

      <p className="text-ink mt-6 text-xl">{brand.tagline}</p>
      <p className="text-muted mt-2 leading-relaxed">{brand.description}</p>

      {featured && outcomes.length > 0 ? (
        <div className="mt-10">
          <DailyMeydan
            slug={featured.slug}
            title={featured.title}
            question={featured.question}
            outcomes={outcomes.map((o) => ({ id: o.id, label: o.label, imageUrl: o.imageUrl }))}
            total={consensus?.total ?? 0}
            closesInLabel={timeRemaining(featured.closesAt)}
            categoryIcon={featured.categoryIcon}
            categoryName={featured.categoryName}
          />
          {featured.isFinancial && (
            <div className="mt-3">
              <FinancialDisclaimer />
            </div>
          )}
        </div>
      ) : null}

      {openEvents.length > 0 && (
        <section className="mt-10">
          <h2 className="text-ink text-lg font-bold">
            <span aria-hidden="true">⚡ </span>
            Şu an açık olanlar
          </h2>
          <p className="text-muted mt-1 text-sm">
            Tahminler kapanmadan tarafını seç. Sonucu birlikte göreceğiz.
          </p>

          <ul className="mt-4 space-y-2">
            {openEvents.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/event/${e.slug}`}
                  className="border-border hover:border-brand focus-visible:outline-ink flex items-center gap-3 rounded-xl border px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <div className="flex shrink-0 -space-x-2">
                    {e.outcomes
                      .filter((o) => o.imageUrl)
                      .slice(0, 2)
                      .map((o) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={o.id}
                          src={o.imageUrl!}
                          alt=""
                          aria-hidden="true"
                          width={28}
                          height={28}
                          loading="lazy"
                          className="bg-background h-7 w-7 rounded-full object-contain"
                        />
                      ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-ink truncate text-sm font-semibold">{e.title}</p>
                    <p className="text-muted truncate text-xs">
                      <span aria-hidden="true">{e.categoryIcon} </span>
                      {e.categoryName}
                      <span aria-hidden="true"> · </span>
                      Kapanmasına {timeRemaining(e.closesAt)}
                      {e.predictionCount > 0 && (
                        <>
                          <span aria-hidden="true"> · </span>
                          {formatCount(e.predictionCount)} tahmin
                        </>
                      )}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

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
