# Karar Kayıtları (ADR)

Her karar: **bağlam → karar → şema/kod etkisi → kabul edilen bedel**.
ADR-01…ADR-14 için `MEYDAN — Teknik Mimari ve Ürün Spesifikasyonu v1.0` Bölüm 12'ye bakın.

---

## ADR-15 · Açık Meydan Okuma MVP kapsamına alındı

**Durum:** Kabul edildi · 3 Eylül 2026 · Faz 7'de uygulanacak, şema etkisi Faz 3'te

### Bağlam

MVP'de Meydan Okuma 1v1 ve rakip adı zorunluydu. Lansmanda kullanıcının tanıdığı
kimse olmadığı için ürünün ana mekaniği çalışmaz — Ek A.1'deki 1 numaralı risk.

### Karar

**Açık Meydan Okuma** MVP kapsamındadır. Bir kullanıcı rakip belirtmeden, bir
etkinlikte tahminini ve çip miktarını açıklayarak meydan okuma yayınlar; **ilk uygun
kullanıcı** karşı taraf olarak kabul eder.

Meydan Okuma iki modda bulunur:

| Mod | Rakip | Kabul eden |
| --- | --- | --- |
| `DIRECT` | Oluştururken belirtilir | Yalnızca adı verilen kullanıcı |
| `OPEN` | Yok | İlk uygun kullanıcı |

### Bağlayıcı kurallar

1. **Sahte/bot rakip kesinlikle kullanılmaz.** Karşı taraf her zaman gerçek, doğrulanmış
   ve `ACTIVE` durumda bir kullanıcı hesabıdır. Sistem hiçbir koşulda kendi adına
   meydan okuma kabul etmez, dolduramaz veya "eşleştirme" için sahte hesap üretmez.
2. Kabul anında **mevcut atomik kabul yolu aynen uygulanır**: satır kilidi
   (`SELECT … FOR UPDATE`), koşullu `UPDATE … WHERE status = 'PENDING'`, deterministik
   sırayla bakiye kilidi, yetersiz bakiye reddi, idempotent stake kaydı. Açık mod için
   **ayrı ve gevşek bir kabul yolu yoktur.**
3. Kabul eden, oluşturanın seçtiğinden **farklı** bir sonuç seçmek zorundadır.
4. Kullanıcı kendi açık meydan okumasını kabul edemez.
5. Engellenmiş taraflar arasında kabul gerçekleşmez.
6. Yarış: aynı açık meydan okumayı iki kullanıcı aynı anda kabul ederse **yalnızca biri**
   başarılı olur; diğeri `CHALLENGE_ALREADY_CLAIMED` (409) alır ve çipi düşülmez.

### Şema etkisi

```
model Challenge {
  mode         ChallengeMode  @default(DIRECT)   // DIRECT | OPEN
  opponentId   String?                           // OPEN'da kabul anına kadar null
  claimedAt    DateTime?                         // açık meydan okumanın kapıldığı an
  ...
}

enum ChallengeMode { DIRECT OPEN }
```

Constraint ve index değişiklikleri:

```sql
-- Kendine meydan okuma yasağı, opponentId null olabildiği için NULL-güvenli yazılır
ALTER TABLE "Challenge" ADD CONSTRAINT challenge_not_self
  CHECK ("opponentId" IS NULL OR "creatorId" <> "opponentId");

-- DIRECT modda rakip zorunlu; OPEN modda PENDING iken rakip boş olmalıdır
ALTER TABLE "Challenge" ADD CONSTRAINT challenge_mode_opponent
  CHECK (
    ("mode" = 'DIRECT' AND "opponentId" IS NOT NULL)
    OR ("mode" = 'OPEN'  AND ("status" = 'PENDING') = ("opponentId" IS NULL))
  );

-- Aynı çift arasında tekrarlanan açık meydan okuma engeli yalnızca DIRECT için geçerli
DROP INDEX IF EXISTS challenge_no_duplicate_open;
CREATE UNIQUE INDEX challenge_no_duplicate_direct
  ON "Challenge" ("eventId", "creatorId", "opponentId")
  WHERE "mode" = 'DIRECT' AND status IN ('PENDING','ACCEPTED','ACTIVE');

-- OPEN modda: bir kullanıcı aynı etkinlikte birden fazla bekleyen açık meydan okuma açamaz
CREATE UNIQUE INDEX challenge_one_open_per_creator_event
  ON "Challenge" ("eventId", "creatorId")
  WHERE "mode" = 'OPEN' AND status = 'PENDING';

-- Kabul akışının yarış koruması (mevcut desen korunur)
CREATE INDEX challenge_open_discovery
  ON "Challenge" ("eventId", "status", "createdAt" DESC)
  WHERE "mode" = 'OPEN' AND status = 'PENDING';
```

**Migration ihtiyacı:** Faz 3'teki ilk şema bu alanları baştan içerir; ayrı bir
geriye dönük migration gerekmez. Şema Faz 3'ten sonra değişirse, `mode` için
`DEFAULT 'DIRECT'` ile eklenir ve mevcut satırlar etkilenmez.

### Bedel

Keşif yüzeyi gerekir: "Açık Meydan Okumalar" listesi (etkinlik sayfası ve akış).
Kabul yarışı 409 üretebilir; UI bunu hata değil, "bu meydan okuma kapıldı" olarak
göstermelidir.

---

## ADR-16 · Tekrarlayan etkinlik üretimi (EventTemplate) Faz 4 kapsamına alındı

**Durum:** Kabul edildi · 3 Eylül 2026 · Faz 4'te uygulanacak

### Bağlam

Tüm etkinlikler admin tarafından elle üretilirse günlük içerik darboğaza girer ve ürün
"yapacak bir şey yok" hissi verir — Ek A.1'deki 5 numaralı risk. Finansal etkinliklerin
büyük bölümü doğası gereği tekrarlıdır: "BTC bugün yükselişle mi kapatacak?" her gün
aynı kalıptan üretilebilir.

### Karar

`EventTemplate` modeli eklenir. Şablon, etkinliğin **kalıbını** ve **tekrar kuralını**
tutar; zamanlanmış bir iş, gelecek pencere için etkinlik örneklerini üretir.

```
model EventTemplate {
  id                 String       @id @default(cuid())
  slug               String       @unique        // "btc-gunluk-kapanis"
  categoryId         String
  instrumentId       String?
  titlePattern       String       // "BTC {date} tarihinde yükselişle mi kapatacak?"
  questionPattern    String
  slugPattern        String       // "btc-yukselis-{date}"
  outcomes           Json         // [{key:"UP",label:"Yükseliş"}, ...]

  recurrence         Recurrence   // DAILY | WEEKDAYS | WEEKLY | MONTHLY
  recurrenceConfig   Json?        // haftanın günleri, ayın günü vb.
  timezone           String       // "UTC" | "Europe/Istanbul" — seans günü bu dilimde belirlenir

  deadlineOffsetMin  Int          // resolutionAt'e göre tahmin kapanışı (negatif = önce)
  resolutionTimeLocal String      // "23:59:59" — timezone'a göre yorumlanır

  resultProviderType ProviderType
  resolutionRule     Json

  generateAheadDays  Int          @default(3)   // kaç gün ileriye üretilsin
  active             Boolean      @default(true)
  lastGeneratedFor   String?      // son üretilen occurrenceKey

  @@index([active, categoryId])
}

enum Recurrence { DAILY WEEKDAYS WEEKLY MONTHLY }
```

`Event` tarafında iki alan eklenir:

```
model Event {
  templateId    String?
  occurrenceKey String?   // "2026-09-03" — şablonun takvimindeki örnek kimliği
  ...
}
```

### Duplicate engeli — iki katmanlı

**1. Veritabanı (nihai savunma):**

```sql
CREATE UNIQUE INDEX event_template_occurrence_unique
  ON "Event" ("templateId", "occurrenceKey")
  WHERE "templateId" IS NOT NULL;
```

Aynı şablonun aynı takvim örneği ikinci kez yazılamaz. İş iki kez çalışsa,
iki worker aynı anda tetiklense veya admin elle üretmeyi denese `23505` alınır.

**2. İş idempotency'si:**

Üretim işi `template:{templateId}:occurrence:{occurrenceKey}` anahtarıyla çalışır.
`23505` hatası bir arıza değildir; "zaten üretilmiş" olarak yorumlanır ve iş başarıyla
tamamlanır.

`occurrenceKey`, **şablonun kendi saat diliminde** hesaplanır (`Europe/Istanbul` bir
BIST şablonu için, `UTC` bir kripto şablonu için). Bu yüzden yaz saati geçişlerinde
gün kaymaz ve aynı gün iki kez üretilmez.

### Kapsam sınırı

Spor fikstürü sağlayıcısı entegrasyonu **bu karara dâhil değildir**; Faz 14 sonrasında
ayrı olarak değerlendirilir. Faz 4'te üretilen şablonlar elle tanımlanan kalıplardır.

### Bedel

Şablonlar yanlış yapılandırılırsa hatalı etkinlik seli üretebilir. Bu yüzden:
üretim işi `generateAheadDays` ile sınırlıdır, şablonlar `active` bayrağıyla anında
durdurulabilir ve üretilen her etkinlik `DRAFT` değil `OPEN` olarak doğar ama admin
panelinde "şablondan üretildi" etiketiyle listelenir.

---

## ADR-17 · Uzun vadeli ticari yön ve MVP sınırı

**Durum:** Kabul edildi · 3 Eylül 2026 · Stratejik kayıt — MVP'de uygulama etkisi yoktur

### Bağlam

MEYDAN'ın uzun vadeli ticari hedefi, **gerekli hukuki inceleme ve lisans/izinler
alınabilirse**, gerçek ekonomik değere sahip bir modeli değerlendirmektir. Bu kayıt,
o ihtimalin bugünkü mimariyi nasıl etkilediğini (ve etkilemediğini) tanımlar.

### Karar

**MVP'de kesin sınırlar — istisnasız:**

- Gerçek para yatırma **yok**.
- Gerçek para çekme **yok**.
- Gümüş Çip satın alma **yok**.
- Gümüş Çip nakde çevrilemez, gerçek para karşılığı transfer edilemez.

Gümüş Çip, MVP'de tamamen sanal, oyun içi bir puandır ve yalnızca sistem ödülleriyle
dağıtılır, yalnızca Meydan Okuma içinde el değiştirir.

**Gelecekteki olası model bugünkü MVP'ye dâhil edilmez.** Ne özellik, ne bayrak, ne
"ileride açılacak" gizli kod yolu. Yapılacak tek şey, mimarinin ileride
genişletilebilir kalmasıdır — ki bu zaten iyi mühendisliktir:

| Bugün alınan tedbir | İleride neyi mümkün kılar |
| --- | --- |
| Immutable, çift kayıtlı ledger; `SUM(amount) = 0` invariant'ı | Denetlenebilir bir değer defteri — dış denetim gerekirse yeniden yazım gerekmez |
| Her hareket `idempotencyKey` ile tekilleştirilmiş | Ödeme sağlayıcısı entegrasyonunun temel gereksinimi |
| Tutarlar tam sayı; kayan nokta hiçbir yerde yok | Yuvarlama sapması olmayan muhasebe |
| `PaymentTransaction` modeli ve sağlayıcı adaptörü soyutlanmış | Abonelik ödemesi zaten bu yolu kullanacak |
| `AuditLog` append-only; admin düzeltmesi ters kayıtla yapılır | İşlem geçmişinin geriye dönük değiştirilemezliği |
| KYC/kimlik doğrulama **yok** ama `User` modeli genişletilebilir | Gerekirse ayrı bir modül olarak eklenir, mevcut şema bozulmaz |

### Bağlayıcı sınırlar — bu kayıt neyi değiştirmez

1. Ürün dili ve arayüz **bugün de yarın da** kumar/bahis estetiğine yaklaşmaz: sabit
   oran (odds), payout tablosu, bookmaker mekaniği yoktur.
2. Platform yatırım tavsiyesi vermez; finans/kripto içerikleri kullanıcı görüşüdür.
3. Kullanıcıya, çipin ileride gerçek değer taşıyacağına dair **hiçbir ima, vaat veya
   beklenti** iletilmez — pazarlama metinlerinde de, ürün içinde de.
4. Bu kararın MVP kod tabanında karşılığı yoktur; yalnızca yön kaydıdır.

### Hukuki çerçeve — açık uyarı

Gerçek ekonomik değere sahip bir model; şans oyunları, sermaye piyasası, ödeme
hizmetleri, elektronik para, tüketicinin korunması, vergi ve KVKK mevzuatı bakımından
**ayrı ve kapsamlı bir hukuki inceleme** gerektirir. Hangi lisans veya izinlerin
gerekli olduğu, hatta böyle bir modelin ilgili ülkelerde mümkün olup olmadığı
**bu belgede sonuçlandırılmamıştır ve sonuçlandırılamaz.**

Bu bir mühendislik kaydıdır, hukuki görüş değildir. Sınıflandırma, ilgili
yargı bölgelerinde yetkili hukuk danışmanları tarafından yapılmalıdır; teknik ekip
bu konuda varsayımda bulunmaz. Böyle bir modele geçiş, ancak o inceleme tamamlandıktan
ve gerekli izinler alındıktan sonra **yeni bir karar kaydıyla** gündeme gelebilir.

---

## ADR-04a · ORM: Prisma yerine Drizzle

**Durum:** Kabul edildi · 3 Eylül 2026 · Faz 2 · ADR-04'ün yerine geçer

### Bağlam

ADR-04 Prisma'yı seçmişti. Uygulama sırasında Prisma CLI'ın Rust tabanlı
`schema-engine` binary'sini `binaries.prisma.sh` üzerinden indirmesi gerektiği ve
kısıtlı ağ ortamlarında bunun tamamen bloke olduğu görüldü. Bu durumda migration
üretilemiyor, istemci generate edilemiyor, entegrasyon testi ve build çalıştırılamıyor;
yani **yazılan hiçbir şey doğrulanamıyor.**

### Karar

Veri katmanı **Drizzle ORM + postgres.js** ile kurulur. `drizzle-kit` düz SQL
migration üretir; harici binary indirilmez.

### Neden bu proje için doğru seçim

| İhtiyaç | Drizzle |
| --- | --- |
| Partial unique index (tek aktif tahmin, açık meydan okuma tekilliği) | Doğal SQL migration — ADR-04'te Prisma'nın **zayıf yanı olarak zaten kaydedilmişti** |
| CHECK constraint (negatif bakiye, kendine meydan okuma) | Aynı |
| `SELECT … FOR UPDATE` satır kilidi | Doğrudan destekleniyor |
| Şemanın okunabilirliği | TypeScript dosyaları; tipler şemadan türer |
| Auth.js entegrasyonu | Resmî `@auth/drizzle-adapter` |
| Doğrulanabilirlik | Migration, entegrasyon testi ve build kısıtlı ortamda dahi çalışır |

### Bedel

- ADR-04'ün "şema tek dosyada okunabilir" avantajı kısmen kaybedilir; şema
  context başına TypeScript dosyalarına bölünür (bu, modüler monolit sınırlarıyla
  aslında daha tutarlıdır).
- Drizzle'ın ekosistemi Prisma'dan küçüktür; Studio ve introspection daha sadedir.
- Ekip Prisma biliyorsa kısa bir öğrenme maliyeti doğar.

### Not

Bu değişikliğin tetikleyicisi bir geliştirme ortamı kısıtıydı; ancak karar,
projenin şema ihtiyaçları (partial index + CHECK ağırlıklı) göz önüne alındığında
bağımsız olarak da savunulabilir. Karar kullanıcı onayıyla alınmıştır.

---

## ADR-06a · Auth.js v5 + credentials ile oturum iptali

**Durum:** Kabul edildi · Faz 2 · ADR-06'yı tamamlar

### Bağlam

ADR-06, oturumun anında iptal edilebilmesi için database session seçmişti. Ancak
Auth.js v5'te **credentials provider yalnızca JWT oturum stratejisiyle çalışır**;
adapter tabanlı database session credentials ile desteklenmez.

### Karar

Hibrit yaklaşım: Auth.js JWT stratejisi kullanılır, ancak token bir **`sessionId`**
taşır ve bu kimlik veritabanındaki `Session` satırına işaret eder. Her istekte
`session` callback'i satırı doğrular: var mı, süresi geçmiş mi, `revokedAt` dolu mu.

Böylece ADR-06'nın asıl amacı korunur:

- Hesap askıya alındığında → oturumlar anında geçersiz.
- Parola değiştiğinde → kullanıcının tüm oturumları iptal edilir.
- "Tüm cihazlardan çık" → tek `UPDATE`.
- Kullanıcı aktif cihazlarını görebilir.

### Bedel

Her istekte bir oturum sorgusu. Faz 11'de Redis oturum önbelleği (kısa TTL + iptalde
anında invalidasyon) ile giderilir. JWT'nin kendisi kısa ömürlüdür ve içinde yetki
bilgisi taşımaz — yetki her zaman veritabanından okunur.

---

## ADR-18 · Karşı sonucun deterministik atanması

**Durum:** Kabul edildi · 4 Eylül 2026 · Faz 3'te uygulandı

### Bağlam

Ürün kuralı 9B ve 25: Açık Meydan Okumayı kabul eden kullanıcıdan "sen hangi
tarafı seçiyorsun?" diye tekrar seçim İSTENMEZ; karşıt sonuç otomatik atanır.

Ancak "Galatasaray — Fenerbahçe — Beraberlik" gibi ÜÇ sonuçlu bir etkinlikte
"karşıt sonuç" tanımsızdır. Emir "Galatasaray" derse, karşı taraf "Fenerbahçe"
mi yoksa "Beraberlik" mi olmalıdır?

### Karar

Karşı sonuç, meydan okuma **oluşturulurken** deterministik olarak atanır ve
veritabanında `challenge.opponent_outcome_id` alanında saklanır:

> **Kural:** `sortOrder`'a göre sıralı sonuçlar arasında, oluşturanın seçmediği
> **ilk** sonuç karşı taraf olur.

```
GS(0) — FB(1) — Beraberlik(2)
  oluşturan GS         → karşı FB
  oluşturan FB         → karşı GS
  oluşturan Beraberlik → karşı GS
```

Kabul kartında **her iki taraf da açıkça gösterilir**:

```
@Emir: Galatasaray
Sen:   Fenerbahçe
Ortaya konan: 50 Gümüş Çip
[ Meydan Okumayı Kabul Et ]
```

Kullanıcı ekstra seçim yapmaz ama ne aldığını görür. Beğenmezse kabul etmez.

### Neden adil

Üçüncü bir sonuç çıkarsa (beraberlik) **iki taraf da yanılır** ve ekonomi
`REFUND_BOTH` ile herkesin çipini iade eder. Yani deterministik atama kimseye
kayıp yüklemez; yalnızca "hangi iki taraf karşı karşıya" sorusunu çözer.
Bu davranış `tests/integration/resolution.test.ts` içinde doğrulanmıştır.

### Zorlama

Üç katman:
1. `pickCounterOutcome()` saf domain fonksiyonu (birim testli)
2. Servis: kabul sırasında yeniden doğrulanır
3. Veritabanı: `CHECK (creator_outcome_id <> opponent_outcome_id)`

### Bedel

İki sonuçlu etkinliklerde kural görünmezdir. Üç+ sonuçlu etkinliklerde
oluşturan, karşı tarafın kim olacağını doğrudan seçemez. İleride "karşı tarafı
ben seçeyim" seçeneği eklenebilir; şema bunu destekler (alan zaten mevcuttur).

---

## ADR-19 · Etkinlik durumu: tek alan, ayrı `resolutionStatus` yok

**Durum:** Kabul edildi · 4 Eylül 2026 · Faz 3

### Bağlam

Faz 3 talimatı `status` ve `resolutionStatus` alanlarının ikisini de öneriyordu.

### Karar

Yaşam döngüsü **tek** bir `status` alanında tutulur:

```
DRAFT → OPEN → CLOSED → RESOLVING → RESOLVED | VOID | CANCELLED
```

Ayrı bir `resolutionStatus` alanı **eklenmemiştir**.

### Gerekçe

İki durum alanı aynı gerçeği iki yerde tutar ve zamanla ayrışır: `status =
RESOLVED` iken `resolutionStatus = PENDING` kalan bir satır, hangisinin doğru
olduğu belirsiz bir sistem üretir. Bu, para hareketi olan bir üründe kabul
edilemez bir belirsizliktir.

Talimatın asıl amacı — "geçmişte kalmış, kapanmış ve çözülmüş durumları
birbirine karıştırma" — tek alanla zaten karşılanır:

| Soru | Cevap |
| --- | --- |
| Tahmin alınabilir mi? | `status = OPEN` **ve** `now < closesAt` |
| Kapanmış ama çözülmemiş mi? | `status = CLOSED` |
| Çözülmüş mü? | `status IN (RESOLVED, VOID)` |

Sonucun *kaynağı* ve *içeriği* ayrı alanlarda tutulur: `resolution_source`,
`resolved_outcome_id`, `resolved_at`, `void_reason`. Ayrıca her sonuçlandırma
`event_resolution` tablosuna denetim kaydı olarak yazılır.

### Zorlama

```sql
CHECK (
  (status = 'RESOLVED' AND resolved_outcome_id IS NOT NULL AND resolved_at IS NOT NULL)
  OR (status <> 'RESOLVED' AND resolved_outcome_id IS NULL)
)
```

Durum ile sonuç böylece asla ayrışamaz.

---

## ADR-20 · Onay mesajları layout seviyesinde gösterilir

**Durum:** Kabul edildi · 5 Eylül 2026 · Faz 3 · E2E'de keşfedildi

### Bağlam

Ürün kuralı 32: her önemli işlemden sonra kullanıcı ne olduğunu açıkça
anlamalı. İlk uygulamada başarı mesajı, işlemi tetikleyen kartın içinde
gösteriliyordu.

### Problem

E2E testi bunu yakaladı: Server Action tamamlandığında Next.js geçerli rotayı
yeniden render ediyor. Kabul edilen Meydan Okuma "bekleyenler" listesinden
düştüğü için **kart tamamen kayboluyor** — mesajıyla birlikte. Kullanıcı ne
olduğunu hiç göremiyordu. Aynı sorun admin sonuçlandırma panelinde de vardı.

### Karar

Başarı mesajları `ToastProvider` ile **layout seviyesinde** gösterilir. Layout,
sayfa içeriği tazelenirken yerinde kaldığı için mesaj hayatta kalır.

- **Başarı** → toast (layout'ta, `role="status"`)
- **Hata** → kartın içinde (hata durumunda kart zaten kaybolmaz)

### Bedel

Bir sağlayıcı bileşeni daha. Buna karşılık mesajlar artık her akışta güvenilir
biçimde görünüyor ve E2E ile doğrulanabiliyor.

---

## ADR-21 · Akış "okuma anında" birleştirilir (fan-out on read)

**Durum:** Kabul edildi · 5 Eylül 2026 · Faz 4

### Bağlam

Sosyal akış iki klasik yoldan biriyle kurulur: yazma anında her takipçinin
kutusuna satır kopyalamak (fan-out on write) ya da okuma anında takip edilenlerin
olaylarını birleştirmek (fan-out on read).

### Karar

MVP'de **okuma anında birleştirme** kullanılır. `feed_item` tablosuna olay başına
TEK satır yazılır; akış, takip edilenlerin id listesiyle tek sorguda okunur.

### Gerekçe

Yazma anında kopyalama, takipçi sayısıyla doğru orantılı depolama ve yazma yükü
üretir. Bu ölçekte (henüz yayında olmayan bir ürün) bu maliyet karşılıksızdır.
Ayrıca takip/engelleme değişince kopyalanmış satırları temizlemek gerekir —
tutarsızlık kaynağı.

### Bedel

Çok fazla kişiyi takip eden bir kullanıcının akışı, takip listesi büyüdükçe
yavaşlar. Eşik aşıldığında (ölçüm gerektirir) yalnızca "çok takip edenler" için
kopyalamaya geçilebilir; `socialService.feed()` imzası değişmeyeceği için bu
geçiş çağıranları etkilemez.

### Sayfalama

Cursor `(createdAt, id)` ÇİFTİDİR. Yalnızca `createdAt` kullanmak, aynı
milisaniyede oluşan iki öğeden birini sessizce atlar. Bu davranış
`tests/integration/social.test.ts` içinde beş öğeyle sınanır.

---

## ADR-22 · Rozetler veriden gelir, koddan değil

**Durum:** Kabul edildi · 5 Eylül 2026 · Faz 4

### Karar

Rozet tanımları `badge` tablosunda durur. Her satır bir **kural adı**
(`CORRECT_PREDICTIONS`, `CHALLENGE_WINS`, `PREDICTION_POWER`,
`COMPLETED_PREDICTIONS`, `CATEGORY_EXPERT`, `LEADERBOARD_RANK`) ve bir
**kural ayarı** (`ruleConfig` JSON) taşır. Kod, sonlu sayıda kuralı bilir;
rozetlerin kendisini bilmez.

### Gerekçe

"10 Doğru" ve "50 Doğru" iki farklı rozet değil, aynı kuralın iki ayarıdır.
Yeni rozet eklemek için kod değişikliği, kod incelemesi ve yeniden dağıtım
gerekmemelidir.

### Bedel

Kural motoru, tanımadığı bir kural adıyla karşılaşırsa o rozeti sessizce
atlar. Bu bilinçlidir: hatalı bir veri satırı uygulamayı çökertmemelidir.

### Değişmez kural

Bir rozet kullanıcıya **yalnızca bir kez** verilir. Bunu `user_badge`
üzerindeki bileşik birincil anahtar ve `onConflictDoNothing` birlikte garanti
eder; bildirim de `dedupeKey` sayesinde tekrarlanmaz. Sınandığı yer:
`tests/integration/ranking.test.ts`.

---

## ADR-23 · Liderlikte asgari tahmin eşiği

**Durum:** Kabul edildi · 5 Eylül 2026 · Faz 4

### Problem

Tahmin Gücü, az sayıda tahminle de yüksek çıkabilir. Eşiksiz bir liderlik
tablosunun zirvesi, üç tahmin yapıp üçünü de tutturmuş hesaplarla dolar.
Bu, tabloyu hem anlamsız hem de kötüye kullanıma açık hale getirir: çok sayıda
hesap açıp yalnızca şanslı olanları öne sürmek ucuz bir stratejiye dönüşür.

### Karar

Genel liderlik için en az `expertise.leaderboardMinPredictions` (varsayılan 20),
kategori liderliği için `leaderboardMinCategoryPredictions` tamamlanmış tahmin
şartı aranır. Eşik snapshot'a **yazılır**, böylece geçmiş bir tablonun hangi
kuralla üretildiği sonradan da bilinir.

### Bedel

Yeni kullanıcı, ne kadar isabetli olursa olsun bir süre listede görünmez.
Bunun karşılığında liderlik tablosu bir şans ölçütü değil, bir istikrar ölçütü
olur. Eşik `src/config/expertise.ts` içinde tek yerdedir.

---

## ADR-24 · Bakım işleri süreç içinde, kuyruksuz

**Durum:** Kabul edildi · 5 Eylül 2026 · Faz 4

### Bağlam

Faz 3'ün bilinen açığı: kabul edilmemiş bir Meydan Okumanın çipi, etkinlik
sonuçlanana kadar askıda kalıyordu. Süresi dolduğunda iade edilmesi gerekir.

### Karar

Bakım işleri (`jobsService`) sıradan servis fonksiyonlarıdır ve
`npm run jobs` ile çalıştırılır. Kuyruk, işçi süreci veya zamanlayıcı
altyapısı **kurulmadı**.

### Gerekçe

Tüm işler idempotenttir: koşullu UPDATE, ledger idempotency anahtarı ve
bildirim `dedupeKey` üçlüsü, aynı işin iki kez çalışmasını zararsız kılar.
"Tam olarak bir kez çalıştırma" garantisi gerekmediği için kuyruk altyapısının
karmaşıklığı bu aşamada karşılıksızdır.

### Bedel

İşlerin çalışması dış bir zamanlayıcıya (cron, systemd timer, platform
scheduler) bağlıdır; unutulursa iadeler gecikir. Yönetim ekranındaki
"Bakım işlerini çalıştır" düğmesi elle tetikleme imkânı bırakır.

---

## ADR-25 · Tekrarlayan etkinliklerde doğal anahtar `occurrence_key`

**Durum:** Kabul edildi · 5 Eylül 2026 · Faz 4 · testte keşfedildi

### Bağlam

ADR-16'da şablondan etkinlik üretimi Faz 4'e bırakılmıştı. İlk uygulamada
kopya engelleme `event.slug` üzerinden yapılıyordu.

### Problem

Entegrasyon testi, veritabanındaki `event_template_needs_occurrence` CHECK
kısıtının bunu reddettiğini gösterdi: `template_id` doluysa `occurrence_key` de
dolu olmalıdır. Şema, üretimin doğal anahtarını (hangi şablon, hangi gün)
zaten tanımlamıştı; slug ise yalnızca bir görüntü alanıdır ve deseni değişirse
kopya engelleme çöker.

### Karar

Kopya engelleme `(template_id, occurrence_key)` üzerinden yapılır.
`occurrence_key`, üretilen günün `YYYY-MM-DD` biçimidir. `event.slug`
üzerindeki UNIQUE index ikinci savunma olarak kalır.

### Sonuç

Üretim üç katmanda idempotenttir: (1) üretilmiş günlerin önden elenmesi,
(2) `(template_id, occurrence_key)` UNIQUE index, (3) `slug` UNIQUE index.
Sınandığı yer: `tests/integration/recurring.test.ts`.

---

## ADR-26 · Karşılama bir kez gösterilir; ilgi alanı filtre değil sıralamadır

**Durum:** Kabul edildi · 6 Eylül 2026 · Faz 5

### Karar

`profile.onboarded_at` dolduğunda karşılama ekranı BİR DAHA gösterilmez.
"Şimdilik geç" de bu alanı doldurur. Seçilen ilgi alanları `user_interest`
tablosunda tutulur ve akışta **sıralamayı** etkiler; içeriği **gizlemez**.

### Gerekçe

İki ayrı hata bilinçli olarak engellendi:

1. **Atlayanı cezalandırmak.** Karşılamayı geçen kullanıcıyı her girişte aynı
   ekranla karşılamak, verdiği kararı yok saymaktır.
2. **İlgi alanını filtreye çevirmek.** Üç kategori seçen yeni bir kullanıcı, o
   kategorilerde açık etkinlik yoksa BOŞ bir akışla karşılaşırdı. Boş akış,
   ilgisiz içerikten çok daha kötüdür. Bu yüzden seçilenler öne alınır,
   diğerleri listede kalır.

### Bedel

İlgi alanı seçmenin etkisi ilk bakışta zayıf görünebilir ("hepsini
görüyorum"). Karşılığında hiçbir kullanıcı boş ekranla karşılaşmaz. Katalog
büyüdüğünde filtreye geçmek `listOpenEvents`'in imzasını değiştirmez.

---

## ADR-27 · Meydan Okuma var olan tahmini yeniden kullanır

**Durum:** Kabul edildi · 6 Eylül 2026 · Faz 5 · E2E'de keşfedildi

### Problem

Faz 3 denetiminde "tahmin yaptım, şimdi bununla Meydan Okuyayım" akışının
eksikliği not edilmişti. Faz 5'te düğme eklendiğinde akış hata verdi:
`prediction_one_active_per_user_event` kısmi tekil index'i, aynı etkinlikte
ikinci bir tahmin satırına izin vermiyor — ve **doğru olan da bu**: bir kişinin
bir etkinlikte tek tahmini olur.

### Karar

`challengeService.create`, kullanıcının o etkinlikteki aktif tahminini arar:

| Durum | Davranış |
|---|---|
| Tahmin yok | Yeni tahmin açılır (eski davranış) |
| Aynı sonuç, boşta | **Var olan tahmin kullanılır**, üzerine çip yazılır |
| Farklı sonuç | Reddedilir — kişi bir etkinlikte taraf değiştiremez |
| Zaten bir Meydan Okumada | Reddedilir |

"Zaten bir Meydan Okumada mı?" sorusu `prediction.is_locked` ile **yanıtlanmaz**:
o bayrak ancak karşı taraf kabul edince kalkar. Doğru kaynak, tahmini işaret
eden aktif bir `challenge` satırıdır — `challenge_creator_prediction_unique`
index'i de bunu zorlar.

### Sonuç

Tahmin sayacı şişmez, tek tahmin kuralı korunur ve akış tıkanmaz. Hata
mesajları da belirsiz olmaktan çıktı: "zaten bir tahminin veya Meydan Okuman
var" yerine hangisi olduğu yazılıyor.

---

## ADR-28 · Denetim kaydı değişmezdir ve asıl işlemi düşürmez

**Durum:** Kabul edildi · 6 Eylül 2026 · Faz 5

### Karar

`audit_log` yalnızca **eklenir**. Güncelleme veya silme fonksiyonu yoktur.
Yazma hatası asıl işlemi geri almaz: `auditService.record` hatayı yutar,
olayı günlüğe düşürür ve akış devam eder.

### Gerekçe

Sonradan düzeltilebilen bir denetim kaydının denetim değeri kalmaz. Öte yandan
sonuçlandırılmış bir etkinliğin, denetim satırı yazılamadı diye geri alınması
çok daha büyük bir zarardır: sonuçlandırma para (çip) hareketi üretir ve
idempotenttir; denetim satırı ise yalnızca bir izdir.

### Hassas veri

`metadata` alanına parola, oturum kimliği, token, çerez ve ham IP
**yazılmaz**. `server/observability/logger.ts` bu alan adlarını son savunma
olarak ayrıca temizler, ama asıl kural çağıranın bunları hiç göndermemesidir.

---

## ADR-29 · Kullanıcı metinleri testle korunur

**Durum:** Kabul edildi · 6 Eylül 2026 · Faz 5

### Karar

`tests/unit/error-messages.test.ts`, kaynaktaki **dize sabitlerini** tarar ve
kullanıcıya gidebilecek bir cümlede teknik terim (`DrizzleError`, `constraint`,
`uuid`, `eventId`, `500`…) bulursa CI'ı kırar.

### Yöntem ve sınırı

Yalnızca dize sabitleri taranır; açıklama satırları ve tanımlayıcı adları
(`isUniqueViolation` gibi) kullanıcıya gösterilmez. Şablon dizelerindeki
`${...}` ifadeleri **koddur**, metin değildir — tarama öncesi ayıklanır. Ham
SQL şablonları da elenir.

Bu tam bir kanıt değildir: bir hata mesajı çalışma anında birleştirilirse
tarama yakalayamaz. Buna karşılık ucuzdur ve gerçek regresyonları yakalar;
`InternalError` gibi tek çıkış noktaları ayrıca birim testiyle sınanır.

---

## ADR-30 · Tahmin Gücü sürüm 2: deneyim puan eklemez, güven kapısıdır

**Durum:** Kabul edildi · 6 Eylül 2026 · Faz 6 · matematiksel kök neden

### Problem

Sürüm 1: `PP = 100 × (0.40·Â + 0.25·D̂ + 0.20·Ê + 0.15·F̂)`

Bu biçimde **yanlış bir tahmin puanı yükseltebiliyordu.** Faz 4'te bu, "ilk
yanlış tahminde ~+0,02 puan" olarak fark edilmiş ve "Faz 9'da kalibre edilecek"
notuyla bırakılmıştı. Faz 6'da kök nedeni arandı ve sorunun bir sabit seçimi
değil, **modelin biçimi** olduğu görüldü.

### Kök neden — marjinal analiz

Bir tahmin daha eklendiğinde bileşenlerin değişimi:

| Bileşen | Marjinal değişim | Sönüm hızı |
|---|---|---|
| Deneyim kazancı | `0.20 / ((1+t)·ln(1+T))` | `1/t` |
| Doğruluk kaybı | `0.40 · (c+α) / (t+α+β)²` | `1/t²` |

İki eğri **farklı hızda söndüğü** için deneyim kazancı iki bölgede doğruluk
kaybını geçer:

1. **t = 0** — `Ê` 0'dan 0,150'ye sıçrar (log eğrisinin en dik yeri), doğruluk
   ise yalnızca 0,5'ten 0,4545'e iner. Net: **+0,0245 puan.**
2. **t ≳ 46, c = 0** — hiç doğru bilememiş kullanıcıda doğruluk kaybı `1/t²` ile
   yok olurken deneyim kazancı `1/t` ile sürer. Net: yine pozitif.

Yani **toplamsal bir hacim ödülü, sonuçlarda monoton olamaz.** Hangi sabit
seçilirse seçilsin bir aralıkta sonuç ters döner.

### Karar

```
S  = (0.40·Â + 0.25·D̂ + 0.15·F̂) / 0.80      (beceri karışımı, nötrü 0,5)
PP = 100 × [ 0.5 + Ê(t) · (S − 0.5) ]
```

Deneyim artık puana eklenmez; **puanın ortalamadan ne kadar uzaklaşabileceğini**
belirler. Ağırlıkların birbirine oranı (40 : 25 : 15) korunur.

**Monotonluk kanıtı:** yanlış bir sonuç Â, D̂ ve F̂'nin üçünü birden düşürür
(F̂ artık ham EWMA'dır, bkz. aşağıda), yani `S` kesin azalır; `Ê` ise yalnızca
`S − 0.5` sapmasını ölçekler. `S ≤ 0.5` iken sonuç doğrudan çıkar; `S > 0.5`
iken küçük örneklemde göreli düşüş, güven kazancından büyüktür.
`tests/unit/prediction-power-v2.test.ts` bunu **12 uzunluğa kadar TÜM
dizilerde (8191 adım)** ve 120 tahminlik üç uç desende tüketici olarak
doğrular — örnek seçmez.

### Yan karar: formda çift kapı kaldırıldı

Sürüm 1'de form hem kendi içinde (`recentCount / formMinSample`) hem de
dolaylı olarak sönümleniyordu. Bu çift kapı küçük örneklemde F̂'nin yanlış bir
tahminden sonra **artmasına** yol açabiliyordu (n = 1 → 2'de iç çarpan iki
katına çıkarken sapma yalnızca %20 azalır). Artık tek kapı vardır: `Ê`.

### Ürün sonucu

Yeni kullanıcı **40 değil 50** ile başlar. "Hiçbir şey kanıtlamadan
ortalamanın altında sayılmak" savunulabilir değildi; public açıklama sayfası
da zaten "ortadan başlar" diyordu. Ayrıca **yalnızca çok tahmin yaparak puan
yükseltmek artık imkânsızdır**: becerisi ortalama olan biri kaç tahmin yaparsa
yapsın 50'de kalır.

### Geçiş

`rating.algorithmVersion` 1 → 2. Saklanan puanlar eski formülün ürünüdür ve
yeni puanlarla aynı tabloda sıralanamaz. `npm run ratings:recompute`
geçmişi kronolojik olarak yeniden oynar; **varsayılan kuru çalıştırmadır**,
yazmak için `--apply` gerekir. Yeniden oynatma mümkündür çünkü zorluk
girdisi `consensus_share` kapanışta dondurulur.

---

## ADR-31 · Bakım işleri HTTP ucundan tetiklenir, advisory lock ile korunur

**Durum:** Kabul edildi · 6 Eylül 2026 · Faz 6

### Karar

Bakım işleri `POST /api/cron/jobs` ucundan çalışır; uç `CRON_SECRET` ile
sabit zamanlı karşılaştırmayla korunur. Çift çalıştırmayı **PostgreSQL
advisory lock** engeller. Her çalıştırma `job_run` tablosuna yazılır.

### Neden ayrı işçi/kuyruk YOK

Uygulama zaten bir sunucu olarak çalışıyor. Ayrı bir işçi süreci, kuyruk ya da
konteyner bu ölçekte karşılığı olmayan bir maliyet ve ikinci bir dağıtım
yüzeyidir. HTTP ucu **elde olan her zamanlayıcıyla** çalışır: Vercel Cron,
GitHub Actions, sistem cron, elle `curl`.

### Neden İKİ zamanlayıcı

Vercel Cron dağıtım platformuna bağlıdır; platform değişirse ya da plan
sessizce durursa iadeler gecikir. GitHub Actions ücretsiz katmanda çalışan
bağımsız bir ikinci gözdür. İkisinin çakışması sorun değildir — kilit bunu
zaten çözer.

### Neden advisory lock (kuyruk değil)

Kilit zaten sahip olduğumuz veritabanındadır, bağlantı düşerse **otomatik
serbest kalır** (ölü kilit bırakmaz) ve sıfır ek altyapı ister. İşlerin kendisi
zaten idempotenttir; kilit doğruluk için değil, boş yere iki kez çalışmamak
içindir.

### Sessiz ölüme karşı

Zamanlanmış işin en tehlikeli arızası sessizliktir: hata görünmez, yalnızca
iadeler durur. Bu yüzden yönetim ana ekranında "son başarılı çalıştırma"
sürekli görünür ve 90 dakikayı geçerse kırmızıya döner.

---

## ADR-32 · Oran sınırlama PostgreSQL'de paylaşılır; kimliksiz istek ortak kovaya düşmez

**Durum:** Kabul edildi · 6 Eylül 2026 · Faz 6

### Problem

Faz 4–5'teki sayaç süreç belleğindeydi: iki instance'ta etkin limit ikiye
katlanıyordu. Ayrıca `config/limits.ts` içinde **auth kuralları tanımlıydı ama
hiçbir yerden çağrılmıyordu** — kayıt, giriş ve parola sıfırlama uçları
tamamen sınırsızdı. Bu, Faz 6 güvenlik denetiminin en somut bulgusudur.

### Karar

Sayaç PostgreSQL'de tek bir atomik UPSERT ile tutulur (`rate_limit_counter`).
Redis kurulmadı: yeni altyapı ve yeni aylık gider demekti, kazanç bu ölçekte
ölçülemezdi. Auth uçları artık gerçekten sınırlanıyor.

### Sabit pencere — bilinen ödün

Kayan pencere yerine sabit pencere kullanılır. İki pencerenin sınırında kısa
süreliğine limitin iki katına izin verilebilir. Kayan pencerenin doğruluğu bu
iş için gereğinden pahalıdır; ödün kabul edilmiştir.

### Veritabanı erişilemezse

Üç yol vardı: açık bırak (güvenlik açığı), kapalı bırak (veritabanı
sarsıntısında giriş dâhil her şey durur), ya da **süreç içi sayaca düş**.
Üçüncüsü seçildi: koruma zayıflar ama sıfırlanmaz, uygulama ayakta kalır,
olay günlüğe düşer.

### Kimlik çıkarılamıyorsa ortak kova YOK

Önceki davranışta kimliği belirlenemeyen istekler tek bir "anonim" kovaya
düşüyordu. Ters vekil `x-forwarded-for` yazmadığında bunun sonucu şudur:
**siteye giren herkes aynı sayacı paylaşır ve saatte üçüncü kayıttan sonra
kimse kayıt olamaz.** Bir yapılandırma hatası, tüm kullanıcılar için hizmet
kesintisine dönüşür.

Bu yüzden kimliksiz istekte IP kuralı uygulanmaz ama olay **gürültülü biçimde**
günlüğe düşer. Kaybedilen koruma yalnızca oturumsuz uçlardadır ve orada tek
savunma oran sınırı değildir (parola kuralları, e-posta doğrulama, çıraklık
çarpanı).

---

## ADR-33 · Ledger ve denetim kaydı veritabanı tetikleyicisiyle değişmezdir

**Durum:** Kabul edildi · 6 Eylül 2026 · Faz 6

### Problem

`coin_ledger` ve `audit_log` "yalnızca eklenir" olarak tasarlanmıştı, ama bunu
yalnızca **uygulama kodu** koruyordu. Elle çalıştırılan tek bir `UPDATE` para
geçmişini ya da denetim kaydını sessizce değiştirebilirdi.

### Karar

`meydan_append_only()` tetikleyicisi bu iki tabloda `UPDATE` ve `DELETE`
işlemlerini reddeder (migration `0010`). Düzeltme yolu **ters kayıt yazmaktır** —
çift kayıtlı defterin doğası budur.

### Sınır — dürüstçe

Koruma, uygulamanın bağlandığı rolü kapsar. **Superuser bir rol tetikleyiciyi
devre dışı bırakabilir.** Bu yüzden üretimde uygulama rolü superuser olmamalıdır;
kural `docs/operations.md §1` içinde yazılıdır ve `CREATE ROLE … NOSUPERUSER`
örneğiyle birlikte verilir.

### Aynı fazda eklenen diğer kısıtlar

Uygulama koduna bırakılmış 10 değişmez daha veritabanına taşındı: form
skorunun [0,1] aralığı, `Σ(w·s) ≤ Σw`, son dönem sayaç tutarlılığı, Meydan
Okuma uzlaşım/kazanan tutarlılığı, iş çalıştırma kaydı tutarlılığı. CHECK
kısıtı sayısı 41 → 51.

### Neden hepsi değil

Yalnızca (a) sessizce bozulabilecek ve (b) bozulduğunda **para veya itibar**
tutarsızlığı üretecek kurallar seçildi. "Her kuralı DB'ye koy" yaklaşımı
migration gürültüsü üretir ve şemayı okunmaz hale getirir.

---

## ADR-34 · E-posta sağlayıcısı tek bir HTTP adaptörüyle soyutlanır

**Durum:** Kabul edildi · 6 Eylül 2026 · Faz 6

### Karar

`Mailer` arayüzü korunur; sağlayıcı `EMAIL_PROVIDER` ile seçilir:
`console` (geliştirme, varsayılan) veya `http` (üretim).

### Neden sağlayıcıya özel SDK yok

Resend, Postmark, Brevo, Mailgun — hepsi aynı şeyi yapar: bir uca Bearer
anahtarıyla JSON POST. Her biri için SDK bağımlılığı eklemek paket boyutu ve
sağlayıcı kilitlenmesi demektir. Tek bir `fetch` yeterlidir; sağlayıcı değişimi
iki ortam değişkeni değişimidir. Hepsinin ücretsiz katmanı bu aşamadaki hacmi
karşılar; yeni aylık gider doğmaz.

### Gönderim hatası akışı DÜŞÜRMEZ

E-posta gönderilemezse hata fırlatılmaz, günlüğe yazılır. Sebep: kullanıcının
hesabı oluşmuştur ve doğrulama bağlantısı yeniden istenebilir. Hatayı yukarı
fırlatmak, sağlayıcının kısa bir kesintisinde kayıt akışını tamamen durdururdu.

### Değişmez kural

Ham doğrulama/sıfırlama token'ı **yalnızca bu sınırdan geçer**. Günlüğe, hata
izlemeye, analytics'e veya denetim kaydına asla yazılmaz.
