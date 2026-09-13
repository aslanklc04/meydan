/**
 * BOT LABORATUVARI — siteyi açmadan önceki son deneme.
 *
 * ── NEDEN VAR ──────────────────────────────────────────────────────────────
 * Bugüne kadar MEYDAN'ı en fazla üç kişi aynı anda kullandı. Ürün "20 kişiyi
 * davet edelim" noktasına geldiğinde şu soruların cevabı hâlâ bilinmiyordu:
 *
 *   • Elli kişi aynı anda tahmin yaparsa çip defteri tutar mı?
 *   • Aynı anda kabul edilen iki Meydan Okuma bakiyeyi eksiye düşürür mü?
 *   • Sorgular kaç kullanıcıda yavaşlamaya başlıyor?
 *
 * Bunları gerçek insanlarla öğrenmek pahalıdır: hata canlıda çıkarsa davet
 * ettiğin yirmi kişinin yirmisini birden kaybedersin. Botlar bu soruları
 * kimseyi kaybetmeden cevaplar.
 *
 * ── BU BOTLAR SAHTE KULLANICI DEĞİLDİR ─────────────────────────────────────
 * Ürün kuralı nettir: FAKE USER YOK, FAKE ENGAGEMENT YOK. Bu betik o kuralı
 * ÇİĞNEMEZ çünkü ürettiği hesaplar canlıya asla dokunmaz — aşağıdaki koruma
 * bunu imkânsız kılar. Botlar bir ölçüm aletidir; ürünün içeriği değil.
 *
 * ── ÜÇ KIRMIZI ÇİZGİ ───────────────────────────────────────────────────────
 * Deneme "çalıştı/çalışmadı" demez; şu üçünden birini ihlal ederse DURUR:
 *   1. Doğruluk  — bakiye eksiye düşemez, defter tutmalı, çift tahmin olmamalı
 *   2. Dayanıklılık — hiçbir işlem beklenmedik hatayla düşmemeli
 *   3. Hız — ortalama işlem süresi eşiği aşmamalı
 *
 * Kullanım (yalnızca yerelde):
 *   npx tsx scripts/bot-laboratuvari.ts 30
 *   npx tsx scripts/bot-laboratuvari.ts 100
 *   npx tsx scripts/bot-laboratuvari.ts 500
 */

import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { coinAccounts, coinLedger, events, predictions, users } from '@/server/db/schema';
import { identityService } from '@/server/modules/identity/service';
import { catalogService } from '@/server/modules/catalog/service';
import { predictionService } from '@/server/modules/prediction/service';
import { challengeService } from '@/server/modules/challenge/service';
import { commentService } from '@/server/modules/comment/service';
import { coinService } from '@/server/modules/economy/service';
import { onboardingService } from '@/server/modules/identity/onboarding.service';
import { economy } from '@/config';

/** Çift kayıt defterinin karşı hesabı — eksi bakiyesi tasarım gereğidir. */
const SYSTEM_HESABI = economy.systemAccountId;

/*
 * ── CANLI KORUMASI ─────────────────────────────────────────────────────────
 *
 * Bu betiğin canlı veritabanına bağlanma ihtimali TEK BAŞINA kabul edilemez
 * bir risktir: bir kez yanlış ortam değişkeniyle çalıştırılırsa ürünün en
 * temel kuralı ("sahte kullanıcı yok") geri alınamaz biçimde çiğnenir ve
 * ölçüm ekranındaki bütün sayılar kalıcı olarak kirlenir.
 *
 * Bu yüzden koruma "dikkatli ol" uyarısı değil, çalışmayı REDDETME kararıdır
 * ve üç şartı birden arar. Şüphe varsa çalışmaz.
 */
function canliyiKoru(): void {
  const url = process.env.DATABASE_URL ?? '';
  const yerel = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const denemeVeritabani = /\/[a-z_]*test[a-z_]*(\?|$)/i.test(url);
  const zorlama = process.env.BOT_LAB === 'evet';

  if (!yerel || !denemeVeritabani || !zorlama) {
    console.error(
      [
        '',
        'BOT LABORATUVARI ÇALIŞMADI — ve bu doğru davranış.',
        '',
        'Bu betik yalnızca YEREL DENEME veritabanında çalışır. Üç şart birden gerekir:',
        `  1. adres localhost/127.0.0.1 olmalı      → ${yerel ? 'tamam' : 'DEĞİL'}`,
        `  2. veritabanı adında "test" geçmeli      → ${denemeVeritabani ? 'tamam' : 'DEĞİL'}`,
        `  3. BOT_LAB=evet açıkça verilmiş olmalı   → ${zorlama ? 'tamam' : 'DEĞİL'}`,
        '',
        'Sebep: bu botlar canlıya dokunursa "sahte kullanıcı yok" kuralı geri',
        'alınamaz biçimde çiğnenir ve ölçüm ekranı kalıcı olarak kirlenir.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
}

/** Bir botun kişiliği — herkes aynı şeyi yapsaydı gerçek yükü ölçmezdik. */
type Kisilik = 'gelipGecen' | 'duzenli' | 'tartismaci';

type Bot = {
  readonly userId: string;
  readonly username: string;
  readonly kisilik: Kisilik;
};

type Olcum = { ad: string; sure: number; hata: string | null };

const olcumler: Olcum[] = [];

/** Bir işi ölçerek çalıştırır; hatayı yutmaz, kaydeder. */
async function olc<T>(ad: string, fn: () => Promise<T>): Promise<T | null> {
  const basla = performance.now();
  try {
    const sonuc = await fn();
    olcumler.push({ ad, sure: performance.now() - basla, hata: null });
    return sonuc;
  } catch (error) {
    olcumler.push({
      ad,
      sure: performance.now() - basla,
      hata: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

const rastgele = <T>(liste: readonly T[]): T => liste[Math.floor(Math.random() * liste.length)]!;

async function botUret(sira: number): Promise<Bot | null> {
  const username = `bot${sira}x${Date.now().toString(36).slice(-4)}`;
  const sonuc = await olc('kayıt', () =>
    identityService.register({
      username,
      email: `${username}@bot.test`,
      password: 'meydan-bot-deneme-2026',
      acceptTerms: true,
    }),
  );
  if (!sonuc) return null;
  await olc('karşılama', () => onboardingService.complete(sonuc.userId, []));

  const kisilik: Kisilik =
    sira % 5 === 0 ? 'tartismaci' : sira % 3 === 0 ? 'duzenli' : 'gelipGecen';
  return { userId: sonuc.userId, username, kisilik };
}

async function botDavran(bot: Bot, acikEtkinlikler: { id: string; outcomes: string[] }[]) {
  // Kişiliğe göre kaç etkinliğe dokunacağı değişir.
  const kacTahmin = bot.kisilik === 'gelipGecen' ? 1 : bot.kisilik === 'duzenli' ? 4 : 3;

  const secilenler = [...acikEtkinlikler].sort(() => Math.random() - 0.5).slice(0, kacTahmin);

  for (const etkinlik of secilenler) {
    const outcomeId = rastgele(etkinlik.outcomes);
    const tahmin = await olc('tahmin', () =>
      predictionService.create({ userId: bot.userId, eventId: etkinlik.id, outcomeId }),
    );
    if (!tahmin) continue;

    // Tartışmacı bot sohbete de yazar.
    if (bot.kisilik === 'tartismaci') {
      await olc('yorum', () =>
        commentService.create({
          eventId: etkinlik.id,
          authorId: bot.userId,
          body: rastgele([
            'Bence ev sahibi bu maçı alır.',
            'Deplasman formda, ben oradan devam.',
            'Beraberlik bana daha olası geliyor.',
          ]),
        }),
      );
    }

    // Düzenli bot açık meydan okuma açar.
    if (bot.kisilik === 'duzenli' && Math.random() < 0.4) {
      await olc('meydan okuma', () =>
        challengeService.create({
          creatorId: bot.userId,
          eventId: etkinlik.id,
          outcomeId,
          stakeAmount: rastgele([25, 50, 100]),
        }),
      );
    }
  }
}

/**
 * ── YARIŞ DENEMELERİ ───────────────────────────────────────────────────────
 *
 * Yukarıdaki genel koşu "çok kullanıcı" durumunu sınıyor ama asıl tehlikeli
 * olan şey o değil: AYNI ANDA AYNI KAYNAĞA saldırmak. Bakiye hatalarının ve
 * çift harcamanın ortaya çıktığı tek yer burasıdır ve sıradan bir yük
 * denemesi bunu asla yakalamaz.
 *
 * İki şeyi sınıyoruz:
 *   1. Aynı açık Meydan Okumayı yirmi kişi aynı anda kabul ederse ne olur?
 *      → TAM OLARAK BİRİ kabul edebilmeli. İkisi kabul ederse oluşturanın
 *        çipi iki kez bağlanmış, yani yoktan çip üretilmiş olur.
 *   2. Bir kullanıcı bakiyesinden fazlasını aynı anda ortaya koymaya
 *      kalkarsa ne olur? → Bakiye asla eksiye düşmemeli.
 */
async function yarisDenemeleri(etkinlikId: string, outcomes: string[]): Promise<string[]> {
  const ihlaller: string[] = [];

  // ── 1. Aynı Meydan Okumaya yirmi kişi birden ───────────────────────────
  const kurucu = await botUret(90001);
  if (!kurucu) return ['yarış denemesi için bot üretilemedi'];
  await predictionService.create({
    userId: kurucu.userId,
    eventId: etkinlikId,
    outcomeId: outcomes[0]!,
  });
  const meydan = await challengeService.create({
    creatorId: kurucu.userId,
    eventId: etkinlikId,
    outcomeId: outcomes[0]!,
    stakeAmount: 100,
  });

  const yarisanlar = (
    await Promise.all(Array.from({ length: 20 }, (_, i) => botUret(91000 + i)))
  ).filter((b): b is Bot => b !== null);

  const sonuclar = await Promise.allSettled(
    yarisanlar.map((b) => challengeService.accept(meydan.challengeId, b.userId, outcomes[1]!)),
  );
  const kabulEden = sonuclar.filter((r) => r.status === 'fulfilled').length;
  console.log(`  aynı meydana 20 eşzamanlı kabul → başarılı: ${kabulEden}`);
  if (kabulEden !== 1) {
    ihlaller.push(`aynı Meydan Okumayı ${kabulEden} kişi kabul etti (1 olmalıydı)`);
  }

  // ── 2. Bakiyeden fazlasını aynı anda ortaya koymak ──────────────────────
  const savurgan = await botUret(92001);
  if (savurgan) {
    await predictionService.create({
      userId: savurgan.userId,
      eventId: etkinlikId,
      outcomeId: outcomes[0]!,
    });
    const bakiye = await coinService.getBalance(savurgan.userId);

    /*
     * ── BU SATIRIN BİR HİKÂYESİ VAR ──────────────────────────────────────
     * İlk hâlinde bakiyenin YARISI ortaya konuyordu ve yirmi denemenin
     * yirmisi de başarısız oldu. "Bakiye korunuyor" diye okudum — oysa
     * korunan bir şey yoktu: ürünün "tek meydan okumada bakiyenin en fazla
     * %25'i" kuralı bütün denemeleri daha yarışa girmeden reddetmişti.
     *
     * Yani deneme geçmiş gibi görünüyordu ama hiçbir şeyi sınamıyordu. Bu,
     * bir testin verebileceği en tehlikeli cevaptır: yanlış güven.
     *
     * Doğrusu, kuralın İZİN VERDİĞİ en büyük tutarı kullanmak. Bakiye 1000
     * ve pay 250 ise en çok dört tanesi geçebilmeli; beşincisi geçerse
     * bakiye eksiye düşer ve gerçek bir hata yakalamış oluruz.
     */
    const izinliPay = Math.floor(bakiye * economy.maxStakeRatio);
    const deneme = 10;
    const sonuc = await Promise.allSettled(
      Array.from({ length: deneme }, () =>
        challengeService.create({
          creatorId: savurgan.userId,
          eventId: etkinlikId,
          outcomeId: outcomes[0]!,
          stakeAmount: izinliPay,
        }),
      ),
    );
    const basarili = sonuc.filter((r) => r.status === 'fulfilled').length;
    const sonBakiye = await coinService.getBalance(savurgan.userId);
    const beklenenEnCok = Math.floor(bakiye / izinliPay);
    console.log(
      `  ${deneme} eşzamanlı × ${izinliPay} çip → başarılı: ${basarili} (en çok ${beklenenEnCok} olmalı)`,
    );
    console.log(`  bakiye ${bakiye} → ${sonBakiye}`);
    if (sonBakiye < 0) ihlaller.push(`eşzamanlı harcamada bakiye EKSİYE düştü: ${sonBakiye}`);
    if (basarili > beklenenEnCok) {
      ihlaller.push(`bakiyenin izin verdiğinden FAZLA meydan okuma açıldı: ${basarili}`);
    }
    if (basarili === 0) {
      ihlaller.push('hiçbir meydan okuma açılamadı — deneme aslında hiçbir şeyi sınamadı');
    }
  }

  return ihlaller;
}

/** ── KIRMIZI ÇİZGİ 1: DOĞRULUK ──────────────────────────────────────────── */
async function dogrulukDenetimi(): Promise<string[]> {
  const ihlaller: string[] = [];

  /*
   * ── SYSTEM HESABI HARİÇ ───────────────────────────────────────────────
   * İlk koşuda bu denetim "1 hesabın bakiyesi eksi" dedi ve bir an ürünün
   * bozuk olduğunu sandım. Değildi: defter ÇİFT KAYITLI ve SYSTEM, çipin
   * çıktığı karşı hesap — eksi olması tasarımın kendisi (ekonomi servisi
   * bunu açıkça yazıyor: "negatif bakiyeye izin verilen tek hesap").
   *
   * Yani kusur üründe değil ÖLÇÜMDEYDİ. Ölçüm aleti yanlışsa ürün hakkında
   * verilen her karar da yanlış olur; bu yüzden düzeltmesi denemenin
   * kendisinden önemliydi.
   */
  const eksiBakiye = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(coinAccounts)
    .where(sql`${coinAccounts.balance} < 0 AND ${coinAccounts.ownerId} <> ${SYSTEM_HESABI}`);
  if (Number(eksiBakiye[0]?.n ?? 0) > 0) {
    ihlaller.push(`${eksiBakiye[0]!.n} KULLANICI hesabının bakiyesi EKSİ`);
  }

  /*
   * ── ÇİPLER YOKTAN VAR OLMAMALI ────────────────────────────────────────
   * Çift kayıtlı defterde bütün bakiyelerin toplamı SIFIR olmak zorundadır.
   * Sıfır değilse bir yerde çip yaratılmış ya da yok edilmiştir. Oyun parası
   * bile olsa bu, ürünün güvenilirliğini bitiren türden bir hatadır —
   * ve yalnızca eşzamanlı yük altında ortaya çıkar.
   */
  const toplam = await db
    .select({ t: sql<number>`coalesce(sum(balance),0)::int` })
    .from(coinAccounts);
  if (Number(toplam[0]?.t ?? 0) !== 0) {
    ihlaller.push(
      `defterin TOPLAMI sıfır değil: ${toplam[0]?.t} — çip yoktan var olmuş ya da yok olmuş`,
    );
  }

  /*
   * Defter ile bakiye tutmalı: her hesabın bakiyesi, o hesaba yazılmış
   * hareketlerin toplamına eşit olmalı. Tutmuyorsa bir yerde çip yoktan var
   * olmuş ya da yok olmuş demektir — bu, oyun parası bile olsa ürünün
   * güvenilirliğini bitirir.
   */
  const tutmayan = await db.execute(sql`
    SELECT a."owner_id"
    FROM "coin_account" a
    LEFT JOIN (
      SELECT "owner_id", sum("amount") AS toplam FROM "coin_ledger" GROUP BY "owner_id"
    ) d ON d."owner_id" = a."owner_id"
    WHERE a."balance" <> coalesce(d.toplam, 0)
  `);
  const tutmayanSayisi = (tutmayan as unknown as unknown[]).length;
  if (tutmayanSayisi > 0) ihlaller.push(`${tutmayanSayisi} hesapta defter ile bakiye TUTMUYOR`);

  const ciftTahmin = await db.execute(sql`
    SELECT "user_id", "event_id" FROM "prediction"
    GROUP BY "user_id", "event_id" HAVING count(*) > 1
  `);
  const ciftSayisi = (ciftTahmin as unknown as unknown[]).length;
  if (ciftSayisi > 0) ihlaller.push(`${ciftSayisi} kullanıcı aynı etkinliğe İKİ KEZ tahmin yapmış`);

  return ihlaller;
}

async function calistir() {
  canliyiKoru();

  const hedef = Number(process.argv[2] ?? '30');
  if (!Number.isInteger(hedef) || hedef < 1 || hedef > 2000) {
    console.error('Kullanım: npx tsx scripts/bot-laboratuvari.ts <bot sayısı 1-2000>');
    process.exit(1);
  }

  console.log(`\n── BOT LABORATUVARI · ${hedef} bot ──────────────────────────\n`);

  const acik = await catalogService.listOpenEvents(null, 50);
  if (acik.length === 0) {
    console.error('Açık etkinlik yok. Önce tohum verisini kur.');
    process.exit(1);
  }
  const etkinlikler = acik.map((e) => ({ id: e.id, outcomes: e.outcomes.map((o) => o.id) }));
  console.log(`açık etkinlik: ${etkinlikler.length}`);

  const baslangic = performance.now();

  /*
   * Botlar PARTİLER hâlinde ve paralel koşar. Tek tek koşsalardı eşzamanlılık
   * hiç sınanmazdı — oysa aradığımız hataların çoğu (bakiye yarışı, kilit
   * çakışması) yalnızca aynı anda çalışırken ortaya çıkar.
   */
  const PARTI = 20;
  const botlar: Bot[] = [];
  for (let i = 0; i < hedef; i += PARTI) {
    const parti = await Promise.all(
      Array.from({ length: Math.min(PARTI, hedef - i) }, (_, k) => botUret(i + k)),
    );
    botlar.push(...parti.filter((b): b is Bot => b !== null));
    process.stdout.write(`\r  kayıt: ${botlar.length}/${hedef}`);
  }
  console.log('');

  for (let i = 0; i < botlar.length; i += PARTI) {
    await Promise.all(botlar.slice(i, i + PARTI).map((b) => botDavran(b, etkinlikler)));
    process.stdout.write(`\r  davranış: ${Math.min(i + PARTI, botlar.length)}/${botlar.length}`);
  }
  console.log('');

  const toplamSure = performance.now() - baslangic;

  // ── Rapor ────────────────────────────────────────────────────────────────
  const grupla = new Map<string, { adet: number; toplam: number; hata: number }>();
  for (const o of olcumler) {
    const g = grupla.get(o.ad) ?? { adet: 0, toplam: 0, hata: 0 };
    g.adet += 1;
    g.toplam += o.sure;
    if (o.hata) g.hata += 1;
    grupla.set(o.ad, g);
  }

  console.log('\n── İŞLEMLER ─────────────────────────────────────────────────');
  for (const [ad, g] of grupla) {
    console.log(
      `  ${ad.padEnd(14)} ${String(g.adet).padStart(5)} adet · ` +
        `ort ${(g.toplam / g.adet).toFixed(0).padStart(5)} ms · hata ${g.hata}`,
    );
  }

  const hatalar = olcumler.filter((o) => o.hata);
  const beklenenHata = /zaten|already|Bu etkinliğe|yeterli çip|kapandı/i;
  const beklenmeyen = hatalar.filter((h) => !beklenenHata.test(h.hata ?? ''));

  console.log('\n── YARIŞ DENEMELERİ ─────────────────────────────────────────');
  const yarisIhlalleri = await yarisDenemeleri(etkinlikler[0]!.id, etkinlikler[0]!.outcomes);

  console.log('\n── ÜÇ KIRMIZI ÇİZGİ ─────────────────────────────────────────');
  const ihlaller = [...(await dogrulukDenetimi()), ...yarisIhlalleri];
  console.log(`  1. DOĞRULUK      ${ihlaller.length === 0 ? '✅ temiz' : '❌ İHLAL'}`);
  for (const i of ihlaller) console.log(`       → ${i}`);

  console.log(
    `  2. DAYANIKLILIK  ${beklenmeyen.length === 0 ? '✅ beklenmeyen hata yok' : `❌ ${beklenmeyen.length} beklenmeyen hata`}`,
  );
  for (const h of beklenmeyen.slice(0, 5)) console.log(`       → ${h.ad}: ${h.hata}`);

  const ortalama = olcumler.reduce((t, o) => t + o.sure, 0) / olcumler.length;
  const ESIK_MS = 400;
  console.log(
    `  3. HIZ           ${ortalama <= ESIK_MS ? '✅' : '❌'} ortalama ${ortalama.toFixed(0)} ms (eşik ${ESIK_MS} ms)`,
  );

  const kullanici = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  const tahmin = await db.select({ n: sql<number>`count(*)::int` }).from(predictions);
  const etkinlik = await db.select({ n: sql<number>`count(*)::int` }).from(events);
  const defter = await db.select({ n: sql<number>`count(*)::int` }).from(coinLedger);

  console.log('\n── SONUÇ ────────────────────────────────────────────────────');
  console.log(`  süre        : ${(toplamSure / 1000).toFixed(1)} sn`);
  console.log(`  kullanıcı   : ${kullanici[0]?.n}`);
  console.log(`  etkinlik    : ${etkinlik[0]?.n}`);
  console.log(`  tahmin      : ${tahmin[0]?.n}`);
  console.log(`  defter satırı: ${defter[0]?.n}`);

  const gecti = ihlaller.length === 0 && beklenmeyen.length === 0 && ortalama <= ESIK_MS;
  console.log(`\n  ${gecti ? '✅ ÜÇ ÇİZGİ DE TEMİZ' : '❌ EN AZ BİR ÇİZGİ İHLAL EDİLDİ'}\n`);
  process.exit(gecti ? 0 : 1);
}

void calistir();
