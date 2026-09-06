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
| `NEXT_PUBLIC_APP_NAME` | — | Varsayılan `MEYDAN` |

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
