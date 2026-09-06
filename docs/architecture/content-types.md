# Mimari Notu — İçerik Türleri ve `Prediction → Event` Bağımlılığı

**Durum:** bilgilendirme · 6 Eylül 2026 · Faz 6
**Karar:** bu fazda HİÇBİR yeni içerik türü eklenmedi ve şema değiştirilmedi.

Bu belge bir plan değildir. Bugünkü modelin sınırını **yazılı hale getirir** ki
gelecekte bir içerik türü eklenmek istendiğinde neyin nerede kırılacağı
tartışma konusu olmasın.

---

## 1. Bugünkü model

```
Category ──< Event ──< EventOutcome
                │           │
                │           └──< Prediction >── User
                │                    │
                └──< Challenge ──────┘
                          │
                     Resolution → Ledger → Rating
```

Zincirin tamamı tek bir varsayıma dayanır:

> **Her tahmin, sonlu ve önceden tanımlı sonuçları olan bir etkinliğe aittir;
> ve o etkinliğin bir gün tek bir doğru sonucu belirlenir.**

Bu varsayım tesadüf değil, ürünün özüdür: Gümüş Çip uzlaşımı, Tahmin Gücü ve
liderlik **doğrulanabilir bir sonuç** olmadan hesaplanamaz.

---

## 2. Bağımlılığın somut noktaları

Bir içerik türü eklenmek istendiğinde şu noktalar tek tek karşılanmalıdır.
Liste, koddan çıkarılmıştır:

| # | Yer | Bağımlılık | Neden var |
|---|---|---|---|
| 1 | `prediction.event_id` | `NOT NULL` + FK | Tahminin neyle ilgili olduğu |
| 2 | `prediction.outcome_id` | `NOT NULL` + FK | Hangi sonucun seçildiği |
| 3 | `prediction_one_active_per_user_event` | Kısmi tekil index | Kişi başına etkinlikte tek tahmin |
| 4 | `challenge.event_id` / `creator_outcome_id` / `opponent_outcome_id` | `NOT NULL` | İki tarafın karşıt seçimi |
| 5 | `pickCounterOutcome()` | En az iki sonuç | ADR-18 karşı taraf ataması |
| 6 | `resolutionService.resolve()` | Etkinlik başına tek sonuç | Uzlaşımın tetikleyicisi |
| 7 | `difficultyWeight()` | `event_outcome.consensus_share` | Zorluk bileşeni |
| 8 | `event_resolution` | Etkinlik başına tek satır | Sonuçlandırma idempotency'si |
| 9 | `feed_item` | `event_id` / `prediction_id` / `challenge_id` | Akış öğesinin hedefi |
| 10 | `user_category_stat` | `event.category_id` | Kategori uzmanlığı |

En sert olanı **6 ve 8**'dir: ekonomi ve itibar, "etkinlik sonuçlandı" olayına
bağlıdır. Sonucu olmayan bir içerik türü bu iki sistemin hiçbirine giremez.

---

## 3. Gelecekteki türlerin neyi gerektireceği

Ürün tarafında konuşulan türler iki gruba ayrılır — ve grupların maliyeti
**çok farklıdır**:

### 3.1 Sonucu OLAN türler (ucuz)

Örnek: farklı bir kabuk altında sunulan tahmin biçimleri.

Bunlar bugünkü modele **şema değişikliği olmadan** oturur. Gereken tek şey
sunum katmanıdır. `Event` zaten "sonlu sonuçlu, sonuçlandırılabilir bir şey"
soyutlamasıdır; adının farklı görünmesi mimari sorun değildir.

### 3.2 Sonucu OLMAYAN türler (pahalı)

Örnek: fikir, topluluk dileği, oy toplama, video paylaşımı.

Bunlar tahmin değildir; **doğru cevabı yoktur**. Dolayısıyla:

- çip uzlaşımına giremezler (kim kazandı sorusu tanımsız),
- Tahmin Gücü'ne giremezler (isabet tanımsız),
- liderliğe giremezler.

Bunları `Prediction` tablosuna sokmaya çalışmak — örneğin `event_id`'yi
nullable yapmak — **yanlış çözümdür**. Sonucu:

1. `prediction_one_active_per_user_event` index'i anlamını kaybeder,
2. `resolutionService` her satırda "bu sonuçlandırılabilir mi?" diye dallanır,
3. itibar hesabı, itibara girmemesi gereken satırları filtrelemek zorunda kalır,
4. ve bu filtre bir gün unutulur; puan sessizce bozulur.

**Doğru yol ayrı bir toplam (aggregate) açmaktır**: kendi tablosu, kendi
akış öğesi türü, ekonomi ve itibarla HİÇBİR bağı olmayan. `feed_item` zaten
tür ayrımı yapan bir enum taşıdığı için akışta yan yana görünmeleri sorun
değildir — asıl ayrım veri modelindedir.

---

## 4. Faz 6'da alınan karar

- `prediction.event_id` **nullable YAPILMADI.**
- Gelecekteki modeller **oluşturulmadı.**
- Yukarıdaki 10 maddelik bağımlılık listesi **belgelendi.**

Gerekçe: bugün var olmayan bir gereksinim için soyutlama açmak, bugünkü
sistemin okunabilirliğini kesin olarak azaltır ve gelecekteki gereksinimi
doğru tahmin ettiğini varsayar. Bağımlılığı yazmak ise bedava ve kalıcıdır.

Bir sonraki adım, yeni bir tür gerçekten kararlaştırıldığında bu listeyi
gözden geçirmek ve §3.2'deki "ayrı toplam" yolunu izlemektir.
