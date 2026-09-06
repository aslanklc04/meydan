# MEYDAN — Operasyon El Kitabı

Bu belge çalışan bir MEYDAN kurulumunu ayakta tutmak içindir. Kod değil, **karar
ve prosedür** içerir.

> Bu belgede **hiçbir gerçek kimlik bilgisi, parola veya bağlantı dizesi
> bulunmaz.** Sırlar dağıtım platformunun sır deposunda tutulur; depoya asla
> girmez.

---

## 1. Roller ve erişim

| Rol | Ne yapar | Kimde olmalı |
|---|---|---|
| Uygulama rolü (`meydan`) | Uygulamanın bağlandığı rol | Yalnızca uygulamada |
| Yedek rolü | Salt okunur, `pg_dump` çalıştırır | Yedek işinde |
| Yönetici rolü | Şema değişikliği, geri yükleme | İnsan operatörde |

**Uygulama rolü `superuser` OLMAMALIDIR.** Sebep teknik ve kesindir: `coin_ledger`
ve `audit_log` tablolarının değişmezliği tetikleyicilerle korunur (migration
`0010`). Üstün yetkili bir rol bu tetikleyicileri devre dışı bırakabilir; sıradan
bir rol bırakamaz. Para geçmişinin ve denetim kaydının korunması buna bağlıdır.

```sql
-- Kurulumda bir kez. Gerçek parolayı buraya YAZMAYIN.
CREATE ROLE meydan LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE meydan TO meydan;
GRANT USAGE ON SCHEMA public TO meydan;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO meydan;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO meydan;
```

---

## 2. Yedekleme

### 2.1 Ne yedeklenir

Yalnızca **PostgreSQL**. Uygulamanın kendisi depodan yeniden kurulabilir; durum
tamamen veritabanındadır. Yüklenen dosya yoktur.

### 2.2 Günlük tam yedek

```bash
# Zaman damgalı, sıkıştırılmış, özel biçim (seçmeli geri yüklemeye izin verir).
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="meydan-$(date -u +%Y%m%dT%H%M%SZ).dump" \
  "$DATABASE_URL"
```

`--format=custom` bilinçli bir seçimdir: düz SQL dökümünün aksine tek tabloyu
geri yüklemeye ve paralel geri yüklemeye izin verir.

### 2.3 Saklama

| Yaş | Kaç kopya | Nerede |
|---|---|---|
| Son 7 gün | Günlük | Veritabanı sağlayıcısının otomatik yedeği |
| Son 4 hafta | Haftalık | Ayrı bir nesne deposu (farklı sağlayıcı) |
| Son 12 ay | Aylık | Aynı nesne deposu |

**Yedek, veritabanıyla AYNI sağlayıcıda tek başına tutulmaz.** Sağlayıcı hesabının
kaybı hem veriyi hem yedeği götürür.

### 2.4 Yönetilen sağlayıcı kullanılıyorsa

Neon, Supabase, RDS gibi sağlayıcıların "point-in-time recovery" özelliği açık
olmalıdır. Bu, yukarıdaki dökümün **yerine geçmez**: sağlayıcı yedeği sağlayıcı
hesabına bağlıdır.

---

## 3. Geri yükleme

### 3.1 Prosedür

```bash
# 1. Uygulamayı bakım moduna al ya da durdur (çift yazma olmasın).
# 2. BOŞ bir hedef veritabanı oluştur.
createdb meydan_restore

# 3. Geri yükle.
pg_restore --dbname="$RESTORE_URL" --no-owner --no-privileges --jobs=4 yedek.dump

# 4. Doğrula (aşağıdaki kontroller).
# 5. Bağlantı dizesini yeni veritabanına çevir ve uygulamayı başlat.
```

**Üzerine geri yükleme YAPILMAZ.** Yeni bir veritabanına yüklenir, doğrulanır,
sonra geçilir. Bozuk bir yedeği canlı veritabanının üzerine yazmak tek adımda
her şeyi kaybettirir.

### 3.2 Geri yükleme sonrası doğrulama

Bu üç sorgu geçmeden geri yükleme **başarılı sayılmaz**:

```sql
-- (a) Çift kayıtlı defter dengeli mi? SIFIR olmalı.
SELECT COALESCE(SUM(amount), 0) AS ledger_total FROM coin_ledger;

-- (b) Hesap bakiyeleri defterle uyuşuyor mu? Hiç satır dönmemeli.
SELECT a.owner_id, a.balance, COALESCE(SUM(l.amount), 0) AS ledger_sum
  FROM coin_account a
  LEFT JOIN coin_ledger l ON l.owner_id = a.owner_id
 GROUP BY a.owner_id, a.balance
HAVING a.balance <> COALESCE(SUM(l.amount), 0);

-- (c) Migration sayısı beklenenle aynı mı?
SELECT count(*) FROM drizzle.__drizzle_migrations;
```

Uygulamadan: yönetim ekranındaki **Çip Defteri** sayfası (a) ve (b)'yi zaten
gösterir.

### 3.3 Geri yükleme TATBİKATI

Yedek, geri yüklenmeden yedek sayılmaz.

- **Sıklık:** ayda bir.
- **Nasıl:** son yedek geçici bir veritabanına yüklenir, §3.2 kontrolleri
  çalıştırılır, veritabanı silinir.
- **Kayıt:** tarih, yedeğin yaşı, geri yükleme süresi ve sonuç yazılır.

Ölçülmesi gereken sayı: **geri yükleme ne kadar sürdü?** Bu sayı, gerçek bir
felakette kurtarma süresidir.

---

## 4. Migration

### 4.1 Sıra

```
1. YEDEK AL          ← atlanamaz
2. npm run db:migrate
3. Doğrula (§3.2)
4. Uygulamayı dağıt
```

**Migration dağıtımdan ÖNCE çalıştırılır.** Yeni kod eski şemayla karşılaşırsa
hemen patlar; eski kod yeni şemayla genelde çalışmaya devam eder. Bu yüzden
şema önce ilerler.

### 4.2 Geri alınamaz migration'lar

Drizzle "down" migration üretmez ve bu **bilinçli bir kabuldür**: veri kaybettiren
bir geri alma, sorunu düzeltmez, ikinci bir olay yaratır.

| Migration türü | Geri alınabilir mi | Ne yapılır |
|---|---|---|
| Sütun/tablo EKLEME | Evet, zararsız | Eski kod alanı görmez, çalışmaya devam eder |
| Index/CHECK ekleme | Evet | `DROP INDEX` / `DROP CONSTRAINT` |
| Enum'a değer ekleme | **Hayır** | PostgreSQL enum değeri silmez; zararsızdır, bırakılır |
| Sütun/tablo SİLME | **Hayır** | Yalnızca yedekten dönülür |
| Sütun türü değiştirme | **Hayır** | Yalnızca yedekten dönülür |

Faz 6 sonu itibarıyla depodaki 13 migration'ın hiçbiri veri silmez.

### 4.3 İtibar sürüm geçişi

Tahmin Gücü algoritması değiştiğinde saklanan puanlar eski formülün ürünüdür.

```bash
npm run ratings:recompute            # KURU çalıştırma — hiçbir satır değişmez
npm run ratings:recompute -- --apply # uygular (önce yedek alın)
```

Kuru çalıştırma kaç kullanıcının etkileneceğini ve en büyük farkı yazar. Fark
beklenenden büyükse **uygulamayın**; önce nedenini bulun.

---

## 5. Zamanlanmış bakım işleri

### 5.1 Ne yapar

| İş | Neden kritik |
|---|---|
| Süresi dolan Meydan Okumaları kapatır | Çalışmazsa kullanıcının çipi askıda kalır |
| Kapanışı geçen etkinlikleri kapatır | Kalabalık dağılımı donmaz, zorluk puanı bozulur |
| Tekrarlayan etkinlikleri üretir | Akış boşalır |
| Gündemi yeniler | Gündem eskir |
| Oran sınırlama sayaçlarını temizler | Tablo süresiz büyür |

### 5.2 Nasıl tetiklenir

```
POST /api/cron/jobs
Authorization: Bearer $CRON_SECRET
```

İki bağımsız zamanlayıcı yapılandırılmıştır:

- **GitHub Actions** — `.github/workflows/cron.yml`, **saatte bir** (asıl)
- **Vercel Cron** — `vercel.json`, **günde bir** (emniyet ağı)

Vercel'in ücretsiz planında cron günde bir kezden sık çalışamaz; sık bir ifade
dağıtımı başarısız eder. Gerekçe ve maliyet hesabı: deployment.md §3.2.

İkisinin aynı anda tetiklemesi **sorun değildir**: uç PostgreSQL advisory lock
ile korunur, ikinci tetikleyici `skipped: true` alır ve hiçbir iş iki kez
yapılmaz. İki zamanlayıcının sebebi tek noktaya bağımlılığı kırmaktır.

Elle çalıştırma:

```bash
npm run jobs                                   # yerel
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/jobs"
```

### 5.3 Çalışmadığı nasıl anlaşılır

Yönetim ana ekranındaki **Zamanlayıcı** panosu son başarılı çalıştırmayı
gösterir; 90 dakikayı geçerse kırmızıya döner (saatlik plan + gecikme payı).
Aynı bilgi SQL'den:

```sql
SELECT job_name, status, started_at, duration_ms, error
  FROM job_run ORDER BY started_at DESC LIMIT 20;
```

**En tehlikeli arıza sessiz olandır**: hata görünmez, yalnızca iadeler durur.
Bu yüzden "son çalıştırma ne zaman?" sorusu panoda sürekli görünür.

---

## 6. Gözlemlenebilirlik

### 6.1 Günlük biçimi

Her satır tek satırlık JSON'dur:

```json
{"ts":"2026-09-06T11:02:39.278Z","level":"info","event":"job.succeeded",
 "correlationId":"mtppd7q","operation":"maintenance","outcome":"success","durationMs":50}
```

Alan adları sabittir: `correlationId`, `operation`, `userId`, `eventId`,
`challengeId`, `outcome`, `durationMs`, `errorCode`.

### 6.2 Hassas veri

Parola, token, oturum kimliği, çerez, ham IP, e-posta ve telefon **yazılmaz**.
`logger.ts` bunları alan adından tanıyıp `[gizlendi]` ile değiştirir; asıl kural
çağıranın hiç göndermemesidir. `tests/unit/logger.test.ts` iki yönü de sınar:
sızıntı ve **gereğinden fazla gizleme**.

### 6.3 Aranacak olaylar

| Olay | Anlamı |
|---|---|
| `job.failed` | Bakım işi patladı — çipler askıda kalabilir |
| `job.skipped` | İki tetikleyici çakıştı; normal |
| `ledger.imbalance` | **ACİL** — defter dengesi bozuldu |
| `security.rate_limited` | Oran sınırı devrede |
| `auth.failed` | Başarısız giriş / yetkisiz cron denemesi |
| `email.failed` | E-posta gitmedi; kullanıcı doğrulama bağlantısı alamadı |

---

## 7. Acil durum kontrol listesi

### "Çipler kaybolmuş" / defter dengesiz

1. Yönetim → Çip Defteri: toplam sıfır mı?
2. Değilse §3.2 (b) sorgusuyla hangi hesabın uyuşmadığını bul.
3. **Elle UPDATE ÇALIŞTIRMA.** Ledger değişmezdir; düzeltme yolu ters kayıt
   yazmaktır. Önce nedeni bul.

### "Meydan Okumam süresi doldu ama çipim gelmedi"

1. `job_run` tablosuna bak: iş çalışıyor mu?
2. Çalışmıyorsa elle tetikle (§5.2).
3. İş idempotenttir; tetiklemek zararsızdır.

### "Kimse giriş yapamıyor"

1. Oran sınırlaması olabilir: `rate_limit_counter` tablosuna bak.
2. Veritabanı erişilemiyorsa sınırlayıcı süreç içi sayaca düşer ve
   `error.unexpected` + `fallback: in_process` günlüğe yazar.
3. `AUTH_SECRET` değiştiyse tüm oturumlar geçersizdir — bu beklenen davranıştır.
