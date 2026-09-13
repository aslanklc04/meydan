/**
 * İLK VAKALAR — Kısa Dedektif'in açılış kadrosu.
 *
 * ── NEDEN BETİK, NEDEN ELLE YAZILMIŞ ───────────────────────────────────────
 * Vakalar üretilmiyor, YAZILIYOR. Ürün kuralı açık: gerçek bir sağlayıcı
 * olmadan "yapay zekâ üretti" denmez, ve uydurma bir olayı gerçekmiş gibi
 * anlatmak da bu ürünün baştan beri kaçındığı şey.
 *
 * Bu yüzden vakaların hepsi KURGU olduğu belli olan, çözümü metnin içindeki
 * ipuçlarından çıkarılabilen mantık vakaları. Hiçbiri gerçek bir kişiyi,
 * kurumu ya da olayı anlatmıyor.
 *
 * ── İYİ VAKANIN ÜÇ ŞARTI ───────────────────────────────────────────────────
 *   1. Cevap metinde GİZLİ ama var — tahmin değil çıkarım gerektirir.
 *   2. Yanlış seçenekler de makul görünür; biri bariz saçma olursa oyun biter.
 *   3. Çözüm metni, yanılanı da bir şey öğrenmiş hâlde bırakır.
 *
 * Kullanım: npx tsx scripts/dedektif-vakalari.ts
 */

import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { detectiveCases, users } from '@/server/db/schema';
import { detectiveService } from '@/server/modules/detective/service';

type Vaka = {
  slug: string;
  title: string;
  scenario: string;
  question: string;
  explanation: string;
  difficulty: number;
  options: { label: string; correct: boolean }[];
};

const VAKALAR: Vaka[] = [
  {
    slug: 'kirik-saat',
    title: 'Duran Saat',
    difficulty: 1,
    scenario: `Bir kasabada tek bir saat kulesi var ve herkes saatini ona göre ayarlıyor.

Salı sabahı kule saati 07.10'u gösterirken durmuş. Kimse fark etmemiş; kasabalı gün boyu saatine bakıp işine gitmiş.

Akşam fırıncı diyor ki: "Bugün ekmekleri her zamanki gibi 17.00'de çıkardım, ama sokak çoktan kararmıştı."

Bakkal ise şaşkın: "Ben de dükkânı 19.00'da kapattım, ama eve vardığımda karım 'bu saatte mi geldin' diye kızdı."

Kulenin durduğu saat sabah 07.10'du ve o gün kimse kuleyi kurmadı.`,
    question: 'Kasabalı gerçekte ne yapmış oldu?',
    options: [
      { label: 'Herkes günü olması gerekenden geç yaşadı', correct: true },
      { label: 'Herkes günü olması gerekenden erken yaşadı', correct: false },
      { label: 'Saat durduğu için kimsenin günü değişmedi', correct: false },
      { label: 'Fırıncı ve bakkal farklı yönlerde şaşırdı', correct: false },
    ],
    explanation: `Kule 07.10'da durdu. O andan sonra kule hep 07.10 gösterdi — yani zaman kulede ilerlemedi.

Kasabalı saatine baktığında hep "daha erken" gördü. Gerçekte saat 12 iken kule 07.10 diyordu. Herkes "daha vaktim var" diye düşünüp işini erteledi.

Sonuç: işler gerçek saatten GEÇ yapıldı. Fırıncı kuleye göre 17.00'de ekmek çıkardı ama dışarısı kararmıştı, çünkü gerçek saat çok daha geçti. Bakkal kuleye göre 19.00'da kapattı; eve vardığında karısının kızması da bunu doğruluyor.

İki tanık da AYNI yönde şaşırıyor — bu, dördüncü seçeneği eleyen ipucu.`,
  },
  {
    slug: 'iki-anahtar',
    title: 'İki Anahtar',
    difficulty: 2,
    scenario: `Bir depoda tek kapı var ve kapıda iki ayrı kilit bulunuyor. Kapının açılması için ikisinin de açılması gerekiyor.

Anahtarlardan biri gündüz vardiyasındaki Hale'de, diğeri gece vardiyasındaki Bora'da. Vardiyalar birbirini görmüyor: Hale 08.00-16.00, Bora 16.00-24.00 çalışıyor ve devir teslim kapının önünde değil, ofiste yapılıyor.

Pazartesi sabahı depo boş bulunuyor. Kapı kilitli, iki kilit de sağlam, kırılma izi yok. Pencere yok.

Hale: "Cuma akşamı çıkarken depo doluydu, ben kendi kilidimi kapattım."
Bora: "Cuma gecesi ben hiç depoya gitmedim, anahtarım cebimdeydi."

İkisi de doğru söylüyor.`,
    question: 'Depo nasıl boşaltılmış olabilir?',
    options: [
      { label: 'Cuma akşamı Hale çıkarken kapı henüz tam kilitlenmemişti', correct: false },
      { label: 'Depo zaten cuma gündüz boşaltıldı, Hale son hâlini görmedi', correct: true },
      { label: 'Biri iki anahtarı da kopyaladı', correct: false },
      { label: 'Bora yalan söylüyor', correct: false },
    ],
    explanation: `Sorunun cevabı kapıda değil, cümlelerdeki zamanda.

Hale "cuma akşamı ÇIKARKEN depo doluydu" diyor. Ama depoyu en son ne zaman gördüğünü söylemiyor — kilidi kapatmak için içeri bakmak gerekmez.

Dikkat: iki tanık da "doğru söylüyor" deniyor. Yani yalan arayan her seçenek (üçüncü ve dördüncü) baştan eleniyor. Birinci seçenek de eleniyor, çünkü metin "iki kilit de sağlam, kırılma izi yok" diyor.

Geriye tek ihtimal kalıyor: depo Hale'nin vardiyası içinde, yani gündüz, kapı açıkken boşaltıldı. Hale bunu fark etmedi çünkü çıkarken içeriye bakmadı — yalnızca kilidi kapattı.

Bu vakanın öğrettiği şey şu: "herkes doğru söylüyor" denen bir durumda çelişki tanıklarda değil, VARSAYIMDA aranır. Buradaki gizli varsayım, "kilidi kapatan kişi içeriyi görmüştür"dü.`,
  },
  {
    slug: 'ucuncu-mektup',
    title: 'Üçüncü Mektup',
    difficulty: 3,
    scenario: `Bir apartmanda üç komşu her ay birbirine mektup bırakıyor: Ayla, Cem ve Deniz. Kural basit — herkes ayda tam bir mektup yazar ve kendisine yazmaz.

Mart ayında posta kutuları şöyle bulunuyor:
· Ayla'nın kutusunda 2 mektup
· Cem'in kutusunda 1 mektup
· Deniz'in kutusunda 0 mektup

Deniz kızgın: "Demek ki ikiniz de bana yazmadınız."

Cem sakin: "Ben her ay aynı kişiye yazıyorum, bu ay da değiştirmedim."

Ayla: "Ben de bu ay geçen ay yazdığım kişiye yazmadım."

Şubat ayında ise kutular şöyleydi: Ayla'da 1, Cem'de 1, Deniz'de 1.`,
    question: 'Mart ayında Ayla kime yazdı?',
    options: [
      { label: 'Cem’e', correct: true },
      { label: 'Deniz’e', correct: false },
      { label: 'Hiç yazmadı', correct: false },
      { label: 'Bu bilgilerle belirlenemez', correct: false },
    ],
    explanation: `Üç mektup var ve Deniz'in kutusu boş. Yani mart ayında iki mektup Ayla'ya, bir mektup Cem'e gitti.

Ayla kendine yazamaz. O hâlde Ayla'nın kutusundaki 2 mektubun ikisi de Cem ve Deniz'den geliyor — yani Cem ve Deniz'in ikisi de Ayla'ya yazmış.

Cem Ayla'ya yazdıysa, Cem'in kutusundaki tek mektup Ayla'dan gelmiş olmalı. Çünkü Deniz'in mektubu Ayla'ya gitti ve Cem kendine yazamaz.

Yani Ayla, Cem'e yazdı.

Şimdi tutarlılığı kontrol edelim: Cem "her ay aynı kişiye yazıyorum" diyor — şubatta da Ayla'ya yazmış olmalı. Ayla ise "bu ay geçen ay yazdığım kişiye yazmadım" diyor; martta Cem'e yazdıysa şubatta Deniz'e yazmış. Şubat kutuları (herkeste 1) bununla uyumlu.

Buradaki asıl numara, Deniz'in kızgın cümlesinin bir bilgi değil bir ÇIKARIM olması. Deniz "kimse bana yazmadı" diyor ve bu doğru — ama bunu kanıt olarak değil, başlangıç noktası olarak kullanmak gerekiyordu.`,
  },
  {
    slug: 'yanlis-durak',
    title: 'Yanlış Durak',
    difficulty: 1,
    scenario: `Bir otobüs hattında dokuz durak var ve otobüs her durakta duruyor.

Şoför her sabah aynı şeyi yapıyor: ilk duraktan kalkıyor, son durakta hattı bitiriyor.

Bir yolcu diyor ki: "Ben her sabah bu otobüse biniyorum ve tam beş durak sonra iniyorum. Ama bugün acelem vardı, otobüsü ters yönde olan durakta bekledim ve yine bindim, yine beş durak sonra indim."

Yolcu her iki durumda da doğru yerde indiğini söylüyor ve yalan söylemiyor.`,
    question: 'Bu nasıl mümkün olabilir?',
    options: [
      { label: 'Yolcunun ineceği durak, hattın tam ortasındaki duraktır', correct: true },
      { label: 'Yolcu ikinci seferde daha uzun yürümek zorunda kaldı', correct: false },
      { label: 'Otobüs ters yönde farklı bir güzergâh izliyor', correct: false },
      { label: 'Yolcu iki farklı yerde oturuyor', correct: false },
    ],
    explanation: `Dokuz durak var. Yolcu bindiği duraktan beş durak sonra iniyor.

Ters yönden bindiğinde de beş durak sonra aynı yere varabiliyorsa, bindiği iki durak hattın iki ucundan eşit uzaklıkta olmalı — ve indiği durak ikisinin de tam ortasında.

Dokuz durakta orta durak beşinci duraktır: birinci duraktan beş durak sonra beşinci durağa, dokuzuncu duraktan beş durak sonra yine beşinci durağa varılır.

Yani yolcu hattın iki ucunda oturmuyor; İNDİĞİ yer ortada. Simetri onun evinde değil, işinde.

Vakanın öğrettiği: "iki farklı yoldan aynı yere varılıyorsa, sabit olan varış noktasıdır."`,
  },
];

async function calistir() {
  const yonetici = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'ADMIN'))
    .limit(1);
  const olusturanId = yonetici[0]?.id;
  if (!olusturanId) {
    console.error('ADMIN rolünde kullanıcı yok; vakalar eklenemedi.');
    process.exit(1);
  }

  let eklenen = 0;
  for (const v of VAKALAR) {
    const varMi = await db
      .select({ id: detectiveCases.id })
      .from(detectiveCases)
      .where(eq(detectiveCases.slug, v.slug))
      .limit(1);
    if (varMi[0]) {
      console.log(`  · zaten var: ${v.slug}`);
      continue;
    }
    await detectiveService.createCase({ ...v, createdById: olusturanId, publish: true });
    console.log(`  ✓ eklendi: ${v.slug}`);
    eklenen += 1;
  }
  console.log(`\n${eklenen} vaka eklendi.`);
  process.exit(0);
}

void calistir();
