import type { Metadata } from 'next';
import { brand, legalContactEmail } from '@/config';
import { TERMS_VERSION } from '@/server/modules/identity/service';
import { LegalPage, Section } from '../LegalPage';

export const metadata: Metadata = {
  title: 'Gizlilik Politikası',
  description: `${brand.appName} hangi verileri topluyor, neden topluyor, kimlerle paylaşıyor ve senin hakların neler.`,
  alternates: { canonical: '/legal/privacy' },
};

/**
 * GİZLİLİK POLİTİKASI.
 *
 * BURADAKİ HER MADDE KODDAN DOĞRULANMIŞTIR. Toplanmayan bir veriyi
 * "topluyoruz" diye yazmak da, toplanan bir veriyi gizlemek de yanlıştır.
 * Ham IP'nin saklanmadığı iddiası uydurma değil: oran sınırlama sayacı
 * yalnızca IP_PEPPER ile HMAC'lenmiş özeti tutar (rate_limit_counter).
 *
 * Yeni bir alan toplanmaya başlandığında ya da yeni bir hizmet sağlayıcı
 * eklendiğinde BU SAYFA da güncellenmelidir.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Gizlilik Politikası" version={TERMS_VERSION} updated="1 Eylül 2026">
      <Section title="Kısaca">
        <p>
          Hesabın için gereken en az veriyi topluyoruz. Verilerini satmıyoruz, reklam için
          kullanmıyoruz ve reklam ağlarıyla paylaşmıyoruz. Parolanı biz de göremiyoruz. IP adresini
          ham hâlde saklamıyoruz.
        </p>
      </Section>

      <Section title="Topladığımız veriler">
        <p>
          <strong>Hesap bilgileri:</strong> kullanıcı adın, e-posta adresin, parolanın kriptografik
          özeti, kayıt tarihin, son giriş zamanın, kabul ettiğin koşul sürümü.
        </p>
        <p>
          <strong>Parolan hiçbir zaman düz metin olarak saklanmaz.</strong> Argon2id ile özetlenir;
          bu özetten parolan geri elde edilemez. Parolanı unutursan biz de bilemeyiz, ancak
          sıfırlayabilirsin.
        </p>
        <p>
          <strong>Ürün içindeki etkinliğin:</strong> yaptığın tahminler ve zamanları, Meydan
          Okumalar, {brand.currencyName} hareketleri, {brand.ratingName} geçmişin, rozetlerin, takip
          ettiklerin, bildirimlerin ve varsa profil metnin.
        </p>
        <p>
          <strong>Teknik veri:</strong> kötüye kullanımı engellemek için IP adresinin{' '}
          <em>şifreli özeti</em>. Ham IP adresi hiçbir yerde saklanmaz ve günlüklere yazılmaz;
          yalnızca gizli bir anahtarla üretilmiş, geri çevrilemeyen bir özet tutulur ve bu özet
          belirli bir süre sonra silinir.
        </p>
        <p>
          Reklam çerezi, üçüncü taraf izleme pikseli veya reklam ağı kullanmıyoruz. Oturumun için
          gereken çerezler kullanılır.
        </p>
      </Section>

      <Section title="Neden topluyoruz">
        <ul className="list-disc space-y-1 pl-6">
          <li>Hesabını açmak, girişini sağlamak ve güvenliğini korumak</li>
          <li>Tahminlerini kaydetmek, sonuçlandırmak ve {brand.ratingName}&apos;nü hesaplamak</li>
          <li>Sıralamaları ve herkese açık profilleri oluşturmak</li>
          <li>E-posta doğrulama ve parola sıfırlama iletileri göndermek</li>
          <li>Sahtecilik, spam ve kötüye kullanımı engellemek</li>
        </ul>
        <p>
          Verilerini bu amaçların dışında kullanmıyoruz. Sana ürün dışı pazarlama e-postası
          göndermiyoruz.
        </p>
      </Section>

      <Section title="Herkese açık olanlar">
        <p>
          Kullanıcı adın, {brand.ratingName} puanın, tahmin geçmişin, rozetlerin ve sıralamadaki
          yerin <strong>herkese açıktır</strong> — ürünün amacı zaten bu: kimin iyi öngördüğünün
          görülebilmesi.
        </p>
        <p>
          <strong>E-posta adresin herkese açık değildir</strong> ve profilinde görünmez. Parolan,
          bildirimlerin ve {brand.currencyName} bakiye geçmişin de sana özeldir.
        </p>
      </Section>

      <Section title="Hizmet sağlayıcılar">
        <p>
          {brand.appName}&apos;ı çalıştırmak için birkaç dış hizmet kullanıyoruz. Bunlar verilerini
          yalnızca bize hizmet vermek için işler:
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <strong>Vercel</strong> — sitenin çalıştığı sunucular. Sunucu bölgesi Frankfurt.
          </li>
          <li>
            <strong>Neon</strong> — veritabanı. Frankfurt (AWS eu-central-1).
          </li>
          <li>
            <strong>Resend</strong> — doğrulama ve parola sıfırlama e-postalarının gönderimi.
            İrlanda (eu-west-1).
          </li>
          <li>
            <strong>TheSportsDB</strong> — maç fikstürü ve skor verisi. Bu servise{' '}
            <strong>hiçbir kullanıcı verisi gönderilmez</strong>; yalnızca herkese açık maç
            bilgisini okuruz.
          </li>
        </ul>
        <p>Verilerini kimseye satmıyoruz ve pazarlama amacıyla paylaşmıyoruz.</p>
      </Section>

      <Section title="Ne kadar süre saklıyoruz">
        <p>
          Hesap verilerin hesabın açık olduğu sürece saklanır. Kötüye kullanım önleme amaçlı teknik
          özetler kısa sürelidir ve otomatik silinir.
        </p>
        <p>
          Hesabını kapattığında hesabın kullanılamaz hâle gelir. Tahmin geçmişin, sıralamaların ve
          sonuçların bütünlüğü için kullanıcı adına bağlı olarak anonimleştirilmiş biçimde
          kalabilir; e-posta adresin gibi kimliğini doğrudan gösteren veriler silinir.
        </p>
      </Section>

      <Section title="Hakların">
        <p>
          6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında; verilerine erişme,
          düzeltilmesini isteme, silinmesini isteme, işlenmesine itiraz etme ve verilerinin bir
          kopyasını isteme hakların vardır.
        </p>
        <p>Bu haklarını kullanmak için aşağıdaki iletişim bölümünden bize ulaşabilirsin.</p>
      </Section>

      <Section title="Güvenlik">
        <p>
          Bağlantı HTTPS ile şifrelenir, parolalar Argon2id ile özetlenir, oturumlar her istekte
          veritabanından doğrulanır ve parola değişiminde eski oturumların tümü geçersiz olur.
        </p>
        <p>
          Hiçbir sistem kusursuz değildir. Bir güvenlik açığı fark edersen kullanmak yerine bize
          bildir.
        </p>
      </Section>

      <Section title="İletişim">
        {legalContactEmail ? (
          <p>
            Gizlilikle ilgili her konu için:{' '}
            <a href={`mailto:${legalContactEmail}`} className="text-brand underline">
              {legalContactEmail}
            </a>
          </p>
        ) : (
          /*
            Adres tanımlı değilse UYDURMA BİR ADRES GÖSTERİLMEZ. Çalışmayan bir
            iletişim kutusu göstermek, hiç göstermemekten kötüdür: kullanıcı
            yazdığını sanır, kimse okumaz.
          */
          <p>
            İletişim adresi kamuya açık beta öncesinde buraya eklenecektir. O zamana kadar{' '}
            {brand.appName} hesabındaki bildirimler üzerinden bize ulaşabilirsin.
          </p>
        )}
      </Section>
    </LegalPage>
  );
}
