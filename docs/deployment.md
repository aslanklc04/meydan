# MEYDAN — Dağıtım ve Geri Alma

Bu belge kodu üretime almanın ve **yanlış giderse geri dönmenin** prosedürüdür.

---

## 1. Ortamlar

| Ortam | Veritabanı | Amaç |
|---|---|---|
| local | `meydan` (yerel PostgreSQL) | Geliştirme |
| test | `meydan_test` | Entegrasyon testleri (her koşuda temizlenir) |
| production | Yönetilen PostgreSQL | Gerçek kullanıcı |

**`meydan_test` ile production veritabanı ASLA aynı olmaz.** Entegrasyon
testleri tabloları `TRUNCATE` eder.

---

## 2. Gerekli ortam değişkenleri

| Değişken | Zorunlu | Not |
|---|---|---|
| `DATABASE_URL` | ✅ | Uygulama rolü — **superuser değil** (bkz. operations.md §1) |
| `AUTH_SECRET` | ✅ | ≥32 karakter. Değişirse **tüm oturumlar düşer** |
| `APP_URL` | ✅ | Mutlak adres; canonical ve e-posta bağlantıları buradan üretilir |
| `IP_PEPPER` | ✅ | ≥32 karakter. Değişirse eski IP hash'leri eşleşmez |
| `CRON_SECRET` | ✅ | ≥32 karakter. Bakım ucunu korur |
| `EMAIL_PROVIDER` | — | `console` (varsayılan) \| `http` |
| `EMAIL_FROM` / `EMAIL_API_URL` / `EMAIL_API_KEY` | `http` ise ✅ | Sağlayıcı bilgileri |
| `ADMIN_EMAIL` | — | Bu adresle kayıtlı hesap dağıtımda yöneticiye yükseltilir (§8) |
| `ADMIN_USERNAME` | — | Adres bilinmiyorsa kullanıcı adıyla yükseltme (§8) |
| `NEXT_PUBLIC_APP_NAME` | — | Varsayılan `MEYDAN` |
| `THESPORTSDB_KEY` | — | **Gerekmez.** Ücretsiz anahtar koda gömülü (§9) |
| `THESPORTSDB_LEAGUES` | — | Varsayılan `4339,4480,4328` (§9) |

**Bu listenin kaynağı `src/config/env.ts`'tir.** Ad tahmin edilmez; değişken
eklenirse önce şemaya, sonra buraya yazılır.

### 2.2 `DATABASE_URL` — panelden kopyalanan adres

Sağlayıcı panelinden gelen adres **aynen** yapıştırılır; kırpılması gerekmez.
Neon gibi sağlayıcılar `libpq` biçiminde parametre ekler:

```
postgresql://…/neondb?sslmode=require&channel_binding=require
```

`postgres.js` tanımadığı parametreyi sunucuya *başlangıç parametresi* olarak
yollar; PostgreSQL `channel_binding`'i tanımadığı için bağlantıyı reddeder ve
**uygulama hiç açılmaz**. Bu yüzden adres, sınırda `src/server/db/url.ts`
tarafından temizlenir: sürücünün anladığı parametreler (`sslmode` dâhil)
korunur, tanınmayanlar düşürülür ve adları günlüğe yazılır.

İzin listesi bilinçlidir: yarın başka bir sağlayıcı bilmediğimiz bir parametre
eklerse en kötü sonuç "yok sayıldı" olur, "site açılmadı" değil.

**Havuzlanmış (pooled) değil, doğrudan adres kullanılır.** Kapalı beta
ölçeğinde örnek başına 3 bağlantı yeterlidir ve doğrudan bağlantı, migration
sırasındaki `pg_advisory_lock`'un doğru çalışmasını garanti eder — advisory
lock oturuma bağlıdır ve pgbouncer'ın transaction modunda oturum sabit
kalmaz. Trafik büyürse `DATABASE_URL` havuzlanmış adresle değiştirilir;
`prepare: false` zaten ayarlıdır.

`RATE_LIMIT_MULTIPLIER` **üretimde ayarlanmaz** — yalnızca test ortamı içindir.

Sır üretimi: `openssl rand -base64 48`

**Hiçbiri depoya girmez.** `.env.example` yalnızca şablondur.

### 2.1 Ters vekil ve istemci adresi

Oran sınırlamanın IP tabanlı kuralları (kayıt, giriş, parola sıfırlama)
uygulamanın önündeki ters vekilin `x-forwarded-for` (ya da
`x-vercel-forwarded-for` / `x-real-ip`) başlığını yazmasına bağlıdır.

Başlık yoksa uygulama **IP kuralını uygulamaz ve günlüğe uyarı yazar**:

```json
{"event":"security.rate_limited","reason":"kimlik_yok","operation":"auth.register"}
```

Bu satır üretimde görülüyorsa vekil yapılandırması eksiktir. Alternatif
davranış — herkesi tek bir "anonim" sayaca koymak — bir yapılandırma hatasını
tüm kullanıcılar için hizmet kesintisine çevirirdi; bu yüzden seçilmedi.

Ham IP hiçbir yerde saklanmaz veya günlüğe yazılmaz; yalnızca `IP_PEPPER` ile
HMAC'i kullanılır.

---

## 3. Dağıtım sırası

```
1. CI yeşil mi?            npm run verify   (biçim + lint + tip + test + build)
2. YEDEK AL                pg_dump          (operations.md §2)
3. DAĞIT                   platform dağıtımı
     └─ build komutu: npm run deploy:setup && npm run build
        deploy:setup = migration + başlangıç içeriği + yönetici kurulumu
4. SMOKE TEST              npm run smoke -- --url https://…
5. İZLE                    ilk 15 dakika günlükler + yönetim panosu
```

### 3.1 `deploy:setup` — üretim kurulumu

`scripts/deploy.ts` dört işi de **idempotent** yapar: migration, başlangıç
içeriği (kategori/rozet/sezon/şablon), yönetici yükseltme, açılış etkinlikleri.
Sonunda çip defteri toplamını doğrular; sıfır değilse **çıkış kodu 1** verir.

Build komutunun ilk adımı olması bilinçlidir:

- **Migration istek başına ÇALIŞMAZ.** Her soğuk başlangıçta şema kilidi
  aramak, eşzamanlı örneklerin birbirini ezmesi ve migration hatasının
  kullanıcıya 500 olarak sızması böylece imkânsızdır.
- **Başarısız migration = başarısız dağıtım.** Bozuk şemayla yeni kod aynı anda
  canlıya çıkamaz; platform bir önceki dağıtımı yayında tutar.
- **Çift dağıtım güvenlidir.** PostgreSQL advisory lock ikinci build'i bekletir;
  ikinci build uygulanacak migration bulamaz ve sorunsuz geçer.
- **Önizleme dağıtımları atlanır.** `VERCEL_ENV !== 'production'` ise betik
  hiçbir şey yapmadan çıkar.

`npm run db:seed` **geliştirme içindir** ve demo kullanıcı üretir; üretimde
çalıştırılmaz (betik `NODE_ENV=production` altında kendini durdurur).

---

## 3.2 Zamanlayıcı planı ve ücretsiz katman

| Tetikleyici | Sıklık | Neden |
|---|---|---|
| GitHub Actions (`.github/workflows/cron.yml`) | **Saatte bir** | Asıl zamanlayıcı |
| Vercel Cron (`vercel.json`) | **Günde bir** | Bağımsız emniyet ağı |

Vercel'in ücretsiz (Hobby) planında cron **günde yalnızca bir kez** çalışabilir;
`*/15 * * * *` gibi bir ifade **dağıtımı başarısız eder**. Bu yüzden asıl
tetikleyici GitHub Actions'tır.

GitHub Actions özel depolarda ayda 2000 ücretsiz dakika verir ve her koşu en az
1 dakika sayılır. Saatte bir ≈ ayda 720 dakika — sınırın rahat içinde. Yarım
saatte bir (~1440 dakika) sınıra tehlikeli biçimde yaklaşırdı.

**Sonuç:** süresi dolan bir Meydan Okumanın iadesi en geç **bir saat** içinde
yapılır. Vercel Pro'ya geçilirse `vercel.json` planı 15 dakikaya çekilebilir.

Elle tetikleme (terminal gerekmez): GitHub → **Actions** → *Bakım işleri* →
**Run workflow**.

### Neden migration dağıtımdan ÖNCE

Yeni kod eski şemayla karşılaşırsa **hemen ve gürültülü** biçimde patlar. Eski
kod yeni şemayla genelde çalışmaya devam eder (eklenen sütunu görmez). Bu
yüzden şema her zaman bir adım önde gider.

Bunun karşılığında **her migration geriye dönük uyumlu olmalıdır**: bir sütun
silinecekse iki dağıtıma bölünür — önce kod kullanmayı bırakır, sonraki
dağıtımda sütun düşer.

---

## 4. Başarısızlık senaryoları

### 4.1 Migration başarısız oldu

Drizzle her migration'ı **tek transaction** içinde çalıştırır: dosya yarım
uygulanmış olarak kalmaz — ya hepsi geçer ya hiçbiri.

```
Durum:   şema eski hâlinde, uygulama eski sürümde çalışıyor.
Yapılacak: DAĞITMA. Hatayı oku, migration'ı düzelt, baştan çalıştır.
Risk:    yok — kullanıcı hiçbir şey görmez.
```

**İstisna:** `CREATE INDEX CONCURRENTLY` transaction dışında çalışır. Depoda
böyle bir migration **yoktur**; eklenirse bu belge güncellenmelidir.

### 4.2 Dağıtım başarısız oldu (migration geçtikten sonra)

```
Durum:   şema yeni, kod eski.
Yapılacak: platformdan bir önceki dağıtıma dön.
Risk:    düşük — migration'lar toplamsaldır (yalnızca ekleme), eski kod
         yeni sütunları görmezden gelir.
```

### 4.3 Dağıtım geçti ama üründe sorun var

```
Yapılacak: platformdan önceki dağıtıma DÖN. Veritabanına DOKUNMA.
```

**Kod geri alınır, veritabanı geri alınmaz.** Neden: şema geriye uyumludur ve
veri geri alma işlemi (yedekten dönme) araya giren gerçek kullanıcı işlemlerini
siler — kaybedilen çipler ve tahminler geri gelmez.

Veritabanını geri almanın tek meşru sebebi **veri bozulmasıdır**, hatalı kod
değil.

### 4.4 Migration'ı geri almak gerekirse

Otomatik "down" yoktur ve olmayacaktır (operations.md §4.2). Yol:

1. **Toplamsal migration** (sütun/tablo/index/enum ekleme) → geri almaya
   gerek yoktur. Eski kod onları görmez. Bırakın.
2. **Yıkıcı migration** → yalnızca yedekten geri yükleme. Yedek alındığı andan
   sonraki tüm işlemler kaybedilir. Bu yüzden yıkıcı migration'lar iki dağıtıma
   bölünür ve tek başına asla dağıtılmaz.

---

## 5. Duman testi (smoke test)

Dağıtımdan sonra çekirdek döngü gerçekten çalışıyor mu?

```bash
npm run smoke -- --url https://meydan.example
```

Betik gerçek HTTP ile şunları dener: ana sayfa, `robots.txt`, `sitemap.xml`,
public etkinlik sayfası, Tahmin Gücü sayfası, kayıt ve giriş sayfaları,
korumalı rotanın **giriş istemesi** ve yetkisiz cron denemesinin **401 alması**.

Tarayıcı gerektiren tam döngü (kayıt → tahmin → Meydan Okuma → kabul →
sonuç → profil) Playwright ile ayrıca koşulur:

```bash
APP_URL=https://meydan.example npx playwright test tests/e2e --project=chromium
APP_URL=https://meydan.example npx playwright test tests/e2e --project=mobile
```

> Bu koşu **veri yazar** (kullanıcı ve tahmin oluşturur). Production'da
> çalıştırılacaksa ayrı bir "staging" ortamı tercih edilir.

---

## 6. Dağıtım sonrası kontrol listesi

- [ ] Ana sayfa açılıyor
- [ ] Giriş yapılabiliyor
- [ ] Yönetim → **Çip Defteri**: toplam **0**
- [ ] Yönetim → **Zamanlayıcı**: son çalıştırma yeşil
- [ ] Günlüklerde `job.failed` / `ledger.imbalance` yok
- [ ] `sitemap.xml` ve `robots.txt` doğru `APP_URL` içeriyor
- [ ] E-posta sağlayıcısı `http` ise: bir kayıt denemesiyle doğrulama e-postası ulaşıyor

---

## 7. İlk kurulum (yeni ortam)

1. Boş bir yönetilen PostgreSQL veritabanı ve uygulama rolü (operations.md §1).
2. Ortam değişkenlerini platformun sır deposuna gir (§2).
3. Dağıt. Build komutu `deploy:setup`'ı çalıştırır: şema kurulur, başlangıç
   içeriği yazılır.
4. Siteye **kendi gerçek e-postanla kaydol** (§8).
5. `ADMIN_EMAIL`'i o adrese ayarla ve **yeniden dağıt**. Hesabın yönetici olur
   ve açılış etkinlikleri açılır.
6. Duman testi (§5) ve dağıtım sonrası kontrol listesi (§6).

---

## 8. Yönetici hesabı — neden `ADMIN_EMAIL`

Rol **hiçbir zaman istemciden gelen bir alanla** atanmaz: kayıt formunda `role`
diye bir alan yoktur ve olmayacaktır. Böyle bir alan, "kayıt olurken
`role=admin` gönder" saldırısını tek satırlık bir iş hâline getirirdi.

Yükseltmenin tek yolu şudur: dağıtım ortamındaki `ADMIN_EMAIL` değişkeninde
yazan adres, o adresle **gerçekten kayıt olmuş** bir hesaba denk geliyorsa
`scripts/deploy.ts` onu ADMIN yapar (büyük/küçük harf duyarsız).

Bunun üç sonucu vardır:

- **Parola hiçbir yerde saklanmaz.** Kurucu parolasını kendi belirler; ne kodda
  ne ortam değişkeninde ne de bu belgede yazar.
- **SQL yazmak gerekmez.** Yönetici kurulumu için veritabanına elle girilmez.
- **Yetkiyi yalnızca dağıtım paneline erişebilen değiştirebilir.**

Hesap henüz yoksa adım sessizce atlanır; kayıt olduktan sonraki ilk dağıtımda
yükseltme kendiliğinden gerçekleşir.

---

## 9. Fikstür kaynağı — TheSportsDB

### Neden bağlandı

Faz 3'ten kalan tekrarlayan şablon her gün şu etkinliği üretiyordu:

> "2026-09-08 tarihli günün maçını ev sahibi mi kazanacak?"

**Hangi maç?** Takım adı olmayan bir soru ne tahmin edilebilir ne
sonuçlandırılabilir. Şablon `scripts/deploy.ts` içinde pasifleştirildi;
yerine bu modül geldi.

### Neden football-data.org değil

Önce football-data.org bağlanmıştı. İki sebeple terk edildi:

1. **Anahtarsız sessiz boşluk.** Anahtar olmadan `/matches` ucu hata
   döndürmüyor, `{"resultSet":{"count":0},"matches":[]}` döndürüyor.
   Entegrasyon "çalışıyor" görünüp sonsuza kadar sıfır maç getirir ve kimse
   sebebini anlamaz. Arızanın en kötü türü budur: sessiz olanı. (Lige özel
   uçlar anahtarsız 403 verir.)
2. **Süper Lig ücretsiz katmanda yok.** Türk kullanıcıya Bundesliga
   göstermek, ürünün en güçlü kancasını çöpe atmaktır.

### Kurulum gerektirmez

TheSportsDB'nin **belgelenmiş ücretsiz anahtarı** koda gömülüdür. Gizli bir
değer değildir; sağlayıcının kendi belgesinde herkese açık yazar. Bu yüzden
panele hiçbir şey yazmadan maçlar akmaya başlar. Ücretli anahtar alınırsa
`THESPORTSDB_KEY` varsayılanı ezer.

Varsayılan ligler: **4339** Süper Lig, **4480** Şampiyonlar Ligi,
**4328** Premier Lig.

### İstek bütçesi

Ücretsiz katman dakikada 30 istek verir. Bir bakım koşusunda lig başına iki
istek gider (yaklaşanlar + bitenler), yani varsayılan üç ligde altı istek.
Buna ek olarak, gecikmiş maçlar için koşu başına en fazla 10 tekil sorgu
yapılır.

### Kapsam: yalnızca "kim kazanır"

Üç sonuç üretilir — ev sahibi / beraberlik / deplasman. Alt-üst, çifte şans,
karşılıklı gol gibi türler **bilinçli olarak yoktur**: bunlar bahis
ürünlerinin pazar menüsüdür ve Faz 5 terminoloji kuralı bu dili yasaklar.
Testler bu kelimelerin sonuç etiketlerinde geçmediğini doğrular.

### Sonuçlandırma — üç ayrı durum

Bunları birbirine karıştırmak pahalıya patlar:

| Durum | Yapılan | Neden |
|---|---|---|
| Maç bitmedi (`NS`, `1H`, `2H`, `HT`) | **Dokunulmaz** | Oynanmakta olan maçı sonuçlandırmak, kullanıcının çipini maç sürerken elinden almaktır |
| Maç bitti, skor okunuyor | Kazanan yazılır | — |
| Maç bitti ama skor okunamıyor | **İade** | Kimse haksız kaybetmez |
| Ertelendi / iptal (`PST`, `CANC`, `ABD`) | **İade** | Ertelenen maç aylar sonra oynanabilir; çip o kadar askıda kalmamalı |

İlk sürümde "bitmedi" ile "skor okunamıyor" aynı kefeye konmuştu ve devam
eden maçlar iade ediliyordu; bunu entegrasyon testi yakaladı.

Sonuçlandırma `resolutionService.resolve()` üzerinden yapılır — çip defteri,
Meydan Okuma kapanışı ve itibar güncellemesi aynı yoldan geçer, yan kapı
yoktur.

Yalnızca bu modülün açtığı etkinliklere dokunulur (`mac-` slug öneki). Elle
açılmış etkinlikleri otomatik sonuçlandırmak, yöneticinin kararını gasp
etmek olurdu.

### Gecikmiş maçlar

Toplu liste lig başına son 15 biten maçı verir. Bakım işi günlerce
çalışmazsa bu listeden düşen maçlar olabilir; bu yüzden kapanış saati 3
saatten eski ve hâlâ açık olan etkinlikler tek tek sorgulanır (koşu başına
en fazla 10). Böylece hiçbir çip süresiz askıda kalmaz.

### Yönetici gerekliliği

Etkinliğin bir sahibi olmak zorundadır. **Sistemde ADMIN rolünde hesap yoksa
hiç maç içe aktarılmaz** ve günlüğe `fixtures.no_admin` düşer (bkz. §10).

### Arıza davranışı

Sağlayıcı çökerse ya da istek zaman aşımına uğrarsa modül hata günlüğü yazar
ve sıfır maçla döner. Fikstür işi bakım işinin **en sonunda** ve `try/catch`
içinde çalışır: dış bir kaynağın kesintisi iadeleri ve kapanışları geri
alamaz.

---

## 10. Yönetici kurulumu neden koddaki bir sabite de bakıyor

`scripts/deploy.ts` yöneticiyi üç kaynaktan sırayla arar:

1. `ADMIN_EMAIL` — panelde yazan adres
2. `ADMIN_USERNAME` — panelde yazan kullanıcı adı
3. `FOUNDER_USERNAME` — koddaki kurucu kullanıcı adı
4. `FOUNDER_EMAIL` — koddaki kurucu adresi

Son ikisi birbirinin **yedeğidir**, alternatifi değil: hangisi tutarsa o
hesap yükseltilir. İkisinin birden olmasının sebebi, kurucunun siteye hangi
adresle kaydolduğunun kesin bilinmemesidir. Yanlış olan sessizce eşleşmez.
Hiçbiri tutmazsa **kimse yükseltilmez** — yanlışlıkla yönetici doğmaz.

Üçüncü basamak **isteyerek** eklendi ve gerekçesi şudur: yönetici kurulumu
yalnızca ortam değişkenine bağlıyken, teknik olmayan kurucu değişkeni panele
dört denemede kaydedemedi. Sonuç, yöneticisiz ve dolayısıyla **hiç etkinliği
olmayan bir üründü** — kurulum adımının kendisi ürünü boş bırakıyordu.

E-posta yerine kullanıcı adı seçildi: kurucunun hangi adresle kaydolduğu
belirsizdi, kullanıcı adı ise arayüzde görünür ve doğrulanabilir.

**Rol ataması zayıflamadı:**

- Rol hâlâ istemciden gelen bir alanla atanmıyor; kayıt formunda `role` alanı
  yok. Saldırı yüzeyi değişmedi.
- Kullanıcı adı eşsizdir (`user_username_lower_key`) ve kurucunun elindedir;
  başkası aynı adı alıp yükseltilemez.
- Sabiti değiştirebilen kişinin zaten depo yazma ve dağıtım yetkisi vardır;
  o kişi bu satır olmadan da her şeyi yapabilir.
- Parola hiçbir yolda saklanmıyor.

Yükseltme aynı anda `email_verified` alanını da doldurur: kurucu, e-posta
sağlayıcısı bağlanmadan önce kaydolduğu için doğrulama kodu hiç gelmemişti.

**Yönetici devri** gerektiğinde panele `ADMIN_EMAIL` yazmak yeterlidir; o
değer sabiti ezer ve bu satıra dokunmak gerekmez.
