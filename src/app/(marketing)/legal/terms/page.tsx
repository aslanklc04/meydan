import type { Metadata } from 'next';
import Link from 'next/link';
import { brand } from '@/config';
import { TERMS_VERSION } from '@/server/modules/identity/service';
import { LegalPage, Section } from '../LegalPage';

export const metadata: Metadata = {
  title: 'Kullanım Koşulları',
  description: `${brand.appName} kullanım koşulları: sanal ${brand.currencyName}, tahmin kuralları, hesap sorumlulukları ve sonuçlandırma.`,
  alternates: { canonical: '/legal/terms' },
};

/**
 * KULLANIM KOŞULLARI.
 *
 * NEDEN VAR: kayıt formundaki onay kutusu bu sayfaya bağlanıyordu ama sayfa
 * YOKTU — bağlantı 404 dönüyordu. Kullanıcıya okuyamadığı bir metni kabul
 * ettirmek, onayı anlamsız kılar.
 *
 * SÜRÜM: kabul edilen sürüm kullanıcı kaydına yazılıyor (`termsVersion`).
 * Buradaki sürüm o sabitten okunur; ikisi elle senkronize edilmez, çünkü
 * eninde sonunda biri unutulur.
 */
export default function TermsPage() {
  return (
    <LegalPage title="Kullanım Koşulları" version={TERMS_VERSION} updated="1 Eylül 2026">
      <Section title="1. MEYDAN nedir?">
        <p>
          {brand.appName}, gerçek dünyadaki olaylar hakkında tahmin yapıp bu tahminlerin zamanla
          doğru çıkıp çıkmadığını gördüğün bir beceri ve itibar oyunudur. Amaç, kimin gerçekten iyi
          öngördüğünün zaman içinde ortaya çıkmasıdır.
        </p>
        <p>
          Hesap açarak bu koşulları kabul etmiş olursun. Kabul etmiyorsan {brand.appName}&apos;ı
          kullanma.
        </p>
      </Section>

      <Section title="2. Gerçek para yoktur">
        <p>
          <strong>
            {brand.currencyName} tamamen sanal, oyun içi bir puandır. Gerçek para değildir.
          </strong>{' '}
          Nakde çevrilemez, çekilemez, gerçek parayla satın alınamaz, başka bir kullanıcıya para
          karşılığı devredilemez ve hiçbir maddi değeri temsil etmez.
        </p>
        <p>
          {brand.appName}&apos;da para yatırma, para çekme, ödeme, satın alma ya da herhangi bir
          finansal işlem yoktur. Böyle bir şey vaat eden kişi ya da site {brand.appName} ile ilgili
          değildir.
        </p>
        <p>
          {brand.currencyName} bakiyen teknik bir hata, kötüye kullanım ya da hesap kapatma
          durumunda düzeltilebilir veya sıfırlanabilir. Bunun karşılığında hiçbir tazminat talebin
          olmaz, çünkü bakiye bir varlık değildir.
        </p>
      </Section>

      <Section title="3. Yaş sınırı">
        <p>
          {brand.appName}&apos;ı kullanmak için <strong>18 yaşını doldurmuş olman</strong> gerekir.
          Hesap açarak bu şartı sağladığını beyan etmiş olursun. 18 yaşından küçük olduğu tespit
          edilen hesaplar kapatılır.
        </p>
      </Section>

      <Section title="4. Hesabın senin sorumluluğunda">
        <p>
          Parolanı gizli tutmak senin sorumluluğundadır. Hesabından yapılan işlemlerden sen
          sorumlusun. Hesabının başkası tarafından kullanıldığını düşünüyorsan hemen parolanı
          değiştir.
        </p>
        <p>Her kişi tek hesap açabilir. Çok sayıda hesapla sıralamayı etkilemek yasaktır.</p>
      </Section>

      <Section title="5. Yasak davranışlar">
        <p>Aşağıdakiler hesabının askıya alınmasına ya da kapatılmasına yol açar:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>Sahte hesap açmak, başkasının kimliğine bürünmek</li>
          <li>Otomatik araçla tahmin üretmek, sıralamayı ya da istatistikleri manipüle etmek</li>
          <li>Başka kullanıcıları taciz etmek, tehdit etmek, hedef göstermek</li>
          <li>Yasa dışı içerik paylaşmak</li>
          <li>Sistemdeki bir açığı bildirmek yerine kullanmak</li>
          <li>
            {brand.currencyName}&apos;i gerçek para ya da başka bir değer karşılığı alıp satmak
          </li>
        </ul>
      </Section>

      <Section title="6. Tahminler geri alınamaz">
        <p>
          Bir tahmin yaptıktan sonra, etkinliğin kapanış saatinden sonra onu değiştiremezsin. Bu
          bilinçli bir kuraldır: &quot;ben demiştim&quot; ifadesinin bir anlamı olması için söylenen
          sözün kayıtlı ve değiştirilemez kalması gerekir.
        </p>
        <p>
          Tahminlerin ve sonuçların, katıldığın etkinliklerle birlikte herkese açık profilinde
          görünebilir.
        </p>
      </Section>

      <Section title="7. Sonuçlandırma">
        <p>
          Etkinlikler, ilan edilen sonuç kaynağına göre sonuçlandırılır. Spor karşılaşmaları
          otomatik olarak resmî skor verisinden okunur.
        </p>
        <p>
          Sonuç okunamıyorsa, etkinlik iptal olduysa ya da ertelendiyse etkinlik{' '}
          <strong>geçersiz sayılır ve bağlanan {brand.currencyName} iade edilir</strong>. Kimse
          haksız kaybetmez.
        </p>
        <p>
          Veri kaynağındaki bir hata sonradan fark edilirse düzeltme yapılabilir. Sonuçlandırmayla
          ilgili kararlar {brand.appName} tarafından verilir.
        </p>
      </Section>

      <Section title="8. Yatırım tavsiyesi değildir">
        <p>
          {brand.appName}&apos;daki finans ve kripto içerikleri yalnızca kullanıcıların kendi
          tahminlerini yansıtır. Yatırım tavsiyesi, alım-satım önerisi veya finansal danışmanlık
          değildir. Yatırım kararların kendi sorumluluğundadır.
        </p>
      </Section>

      <Section title="9. Hizmetin sürekliliği">
        <p>
          {brand.appName} geliştirme aşamasındadır. Hizmet kesintiye uğrayabilir, özellikler
          değişebilir veya kaldırılabilir. Kesintisiz ya da hatasız çalışacağı garanti edilmez.
        </p>
        <p>
          Hesabını istediğin zaman kapatabilirsin. Bu koşulları ihlal edersen hesabın kapatılabilir.
        </p>
      </Section>

      <Section title="10. Değişiklikler">
        <p>
          Bu koşullar güncellenebilir. Önemli bir değişiklikte sürüm numarası değişir ve
          kullanıcılar bilgilendirilir. Değişiklikten sonra kullanmaya devam etmen yeni sürümü kabul
          ettiğin anlamına gelir.
        </p>
      </Section>

      <Section title="11. Uygulanacak hukuk ve iletişim">
        <p>Bu koşullara Türkiye Cumhuriyeti hukuku uygulanır.</p>
        <p>
          Soru, şikâyet ve bildirimler için:{' '}
          <Link href="/legal/privacy" className="text-brand underline">
            gizlilik politikasındaki
          </Link>{' '}
          iletişim adresini kullanabilirsin.
        </p>
      </Section>
    </LegalPage>
  );
}
