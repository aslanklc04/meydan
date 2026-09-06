import type { Metadata } from 'next';
import Link from 'next/link';
import { brand } from '@/config';

export const metadata: Metadata = {
  title: `${brand.ratingName} nedir?`,
  description: `${brand.appName}'da ${brand.ratingName}, bir kullanıcının tahminlerinin doğruluğunu, zorluğunu, deneyimini ve son dönem formunu birlikte değerlendiren 0–100 arası bir itibar puanıdır.`,
  alternates: { canonical: '/tahmin-gucu' },
};

/**
 * Tahmin Gücü açıklaması — public.
 *
 * NEDEN AYRI SAYFA: itibar puanı, kullanıcının başkalarına gösterdiği şeydir.
 * Nasıl hesaplandığı anlaşılmıyorsa güvenilmez. Burada MATEMATİK GÖSTERİLMEZ;
 * hangi dört şeyin sayıldığı ve neden sayıldığı anlatılır. Formülün kendisi
 * teknik dokümantasyondadır.
 */
export default function PredictionPowerPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="text-ink text-2xl font-bold">
        <span aria-hidden="true">🧠 </span>
        {brand.ratingName} nedir?
      </h1>

      <p className="text-foreground mt-4 text-base">
        {brand.ratingName}, 0 ile 100 arasında bir puandır ve bir kişinin tahminlerinde ne kadar iyi
        olduğunu tek sayıda özetler. Ham başarı yüzdesinden farklıdır: üç tahmin yapıp üçünü de
        tutturmak, üç yüz tahminde istikrarlı olmakla aynı şey değildir.
      </p>

      <h2 className="text-ink mt-8 text-lg font-bold">Neye bakılır?</h2>
      <dl className="mt-3 space-y-4">
        <Item
          icon="🎯"
          title="Doğruluk"
          text="Tahminlerinin ne kadarı tuttu. En ağır basan bileşen budur."
        />
        <Item
          icon="⚖️"
          title="Zorluk"
          text="Kalabalığın çoğunlukla yanıldığı bir sonucu bilmek, herkesin bildiği bir sonucu bilmekten daha değerlidir. Zorluk, tahmin kapandığı andaki kalabalık dağılımından hesaplanır ve sonradan değişmez."
        />
        <Item
          icon="📚"
          title="Deneyim"
          text="Kaç tahminin sonuçlandı. Az sayıda tahmin, yüksek bir orana rağmen puanı temkinli tutar; şansla istikrar karışmasın diye."
        />
        <Item
          icon="🔥"
          title="Form"
          text="Son dönemdeki isabetin. Eski başarılar tek başına yeterli değildir; yakın zamandaki performans puanı canlı tutar."
        />
      </dl>

      <h2 className="text-ink mt-8 text-lg font-bold">Neden hemen yükselmiyor?</h2>
      <p className="text-foreground mt-2 text-base">
        Yeni bir hesap ortadan başlar. İlk birkaç tahmin puanı çok az oynatır; çünkü birkaç sonuç,
        bir kişinin ne kadar iyi olduğunu göstermeye yetmez. Tahminlerin sonuçlandıkça puan yerine
        oturur.
      </p>

      <h2 className="text-ink mt-8 text-lg font-bold">Liderlik listesiyle ilişkisi</h2>
      <p className="text-foreground mt-2 text-base">
        Liderlik listesine girmek için belirli sayıda tahminin sonuçlanmış olması gerekir. Bu eşik,
        iki tahmin yapıp ikisini de tutturan hesapların listenin başına çıkmasını engeller.
      </p>

      <h2 className="text-ink mt-8 text-lg font-bold">{brand.currencyName} ile ilişkisi</h2>
      <p className="text-foreground mt-2 text-base">
        Yoktur. {brand.currencyName} Meydan Okumalarda ortaya konan oyun içi bir puandır;{' '}
        {brand.ratingName} ise tahmin isabetini ölçer. Çok {brand.currencyName} biriktirmek{' '}
        {brand.ratingName} kazandırmaz. {brand.currencyName} gerçek para değildir, nakde çevrilemez
        ve gerçek parayla satın alınamaz.
      </p>

      <p className="mt-10">
        <Link href="/app/feed" className="text-brand underline">
          Akışa dön
        </Link>
      </p>
    </main>
  );
}

function Item({
  icon,
  title,
  text,
}: {
  readonly icon: string;
  readonly title: string;
  readonly text: string;
}) {
  return (
    <div className="border-border rounded-xl border p-4">
      <dt className="text-ink text-base font-semibold">
        <span aria-hidden="true">{icon} </span>
        {title}
      </dt>
      <dd className="text-foreground mt-1 text-sm">{text}</dd>
    </div>
  );
}
