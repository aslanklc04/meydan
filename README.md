# MEYDAN

Sosyal tahmin platformu. Kullanıcılar gerçek dünyadaki olaylarda taraf seçer,
birbirlerine **Meydan Okur**, sanal **Gümüş Çip** ortaya koyar ve zaman içinde
**Tahmin Gücü** itibar skorlarını oluşturur.

> **Durum:** Faz 3 — çekirdek kullanıcı döngüsü çalışıyor:
> **Etkinlik → Tahmin → Meydan Okuma → Kabul → Sonuç**
> Mimari tanımı için `MEYDAN — Teknik Mimari ve Ürün Spesifikasyonu v1.0` belgesine bakın.

---

## Ürün sınırları — önce bunu okuyun

MEYDAN bir bahis sitesi, yatırım platformu, broker veya kripto borsası **değildir**.

- **Gümüş Çip** tamamen sanal, oyun içi bir puandır. Gerçek para değildir; nakde
  çevrilemez, çekilemez, gerçek para ile satın alınamaz, kullanıcılar arasında gerçek
  para karşılığı transfer edilemez.
- Sabit oran (odds), payout tablosu, bookmaker mekaniği **kullanılmaz**.
- Platform **yatırım tavsiyesi vermez**. Finans ve kripto içerikleri yalnızca kullanıcıların
  kendi tahminlerini yansıtır; alım-satım önerisi veya finansal danışmanlık değildir.
  Zorunlu uyarı tek kaynaktan gelir: `src/components/disclaimers/FinancialDisclaimer.tsx`.
- Para yatırma/çekme, trading, kaldıraç, marj ve gerçek para ile staking kapsam dışıdır.

**Hukuki uygunluk varsayılmamıştır.** Sanal para ekonomisi, ödül mekanikleri, kullanıcı
üretimli finansal içerik ve abonelik modeli; Türkiye başta olmak üzere hedeflenen
ülkelerde şans oyunları, sermaye piyasası, tüketici hukuku ve KVKK mevzuatı bakımından
**lansman öncesinde profesyonel hukuk ve regülasyon incelemesi gerektirir**.

---

## Ürün dili

Ana sosyal mekanik **Meydan Okuma**'dır. Kumar argosundan gelen ifadeler hiçbir katmanda
kullanılmaz — UI metni, kod, veritabanı enum'ları, analytics olay adları ve bildirim
metinleri dâhil. Kural `tests/unit/terminology.test.ts` tarafından otomatik zorlanır ve
ihlal CI'da build'i kırar.

Tüm görünen isimler `src/config/brand.ts` üzerinden gelir; marka adı koda gömülmez.

---

## Teknoloji

| Katman | Seçim |
| --- | --- |
| Çalışma zamanı | Node.js 22 LTS |
| Çatı | Next.js 16 (App Router, RSC) · React 19 · TypeScript 5 (strict) |
| Stil | Tailwind CSS 4 |
| Veri | PostgreSQL 16 · Drizzle ORM · Redis 7 (Faz 11) |
| Doğrulama | Zod |
| Kimlik | Auth.js v5 + DB-doğrulamalı oturum (ADR-06a) · argon2id |
| Test | Vitest (birim + entegrasyon, gerçek Postgres) · Playwright |
| İşler | pg-boss (Faz 8) |

> Spesifikasyonda Next.js 15 yazıyordu; kurulumda güncel kararlı sürüm olan **16** kullanıldı.
> ORM olarak Prisma yerine **Drizzle** seçildi — gerekçe ve bedeli `docs/decisions.md` (ADR-04a).
> App Router mimarisi ve diğer kararlar değişmedi.

---

## Yerel kurulum

```bash
# 1) Bağımlılıklar
npm ci

# 2) Ortam değişkenleri
cp .env.example .env.local
# AUTH_SECRET, IP_PEPPER, CRON_SECRET değerlerini üretin:
#   openssl rand -base64 48

# 3) Durum tutan servisler (postgres + redis + mailpit)
npm run db:up

# 4) Şema
npm run db:migrate

# 5) Geliştirme sunucusu
npm run dev        # http://localhost:3000
```

E-posta kutusu (doğrulama ve parola sıfırlama akışları): http://localhost:8025

## Komutlar

| Komut | İş |
| --- | --- |
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` / `npm run start` | Üretim derlemesi ve sunucu |
| `npm run lint` | ESLint — katman sınırı kuralları dâhil |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run test` | Birim ve entegrasyon testleri |
| `npm run test:coverage` | Kapsam raporu |
| `npm run test:e2e` | Playwright E2E |
| `npm run format` / `format:check` | Prettier |
| `npm run verify` | **Tüm çıkış kriterleri**: format → lint → typecheck → test → build |
| `npm run db:up` / `db:down` | Docker Compose servisleri |
| `npm run db:generate` | Şema değişikliğinden migration üretir |
| `npm run db:migrate` | Migration'ları uygular |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:seed` | Kategoriler, demo kullanıcılar ve etkinlikler (idempotent) |
| `npm run db:reset` | Migration + seed |

---

## Mimari

Domain-oriented **modüler monolit**. Bağımlılık yönü her zaman yukarıdan aşağıya:

```
app / features / components     →  UI bileşimi (iş kuralı YOK)
src/server/modules/<context>/   →  use-case servisleri (transaction sınırı)
        └── domain/             →  saf iş kuralları (I/O yok, test edilebilir)
src/server/db, security, jobs   →  altyapı
```

Bu sınırlar **lint ile zorlanır** (`eslint.config.mjs`):

1. UI katmanı repository veya Prisma import edemez — yalnızca servis çağırır.
2. `domain/**` hiçbir I/O bağımlılığı (Prisma, Redis, Next.js) import edemez.
3. Bir modül başka modülün repository'sini import edemez.
4. İstemci bileşenleri `@/config/env` (sunucu sırları) import edemez.
5. `src/config/**` dışında sabit sayı (magic number) bulunmaz.

### Çekirdek döngü

```
Etkinlik (admin oluşturur)
   ↓  kullanıcı sonucu seçer
Tahmin  ──────────────────────────► serbest tahmin (çip yok)
   ↓  çip koyar
Meydan Okuma ── DIRECT (rakip adı)  veya  OPEN (ilk kabul eden)
   ↓  karşı taraf kabul eder — karşıt sonuç OTOMATİK atanır (ADR-18)
Kabul   ── iki taraftan da çip stake edilir (atomik)
   ↓  admin sonucu girer
Sonuç   ── tahminler + meydan okumalar + ledger + Tahmin Gücü
           TEK transaction, tamamen idempotent
```

Beraberlik veya VOID durumunda kimse kaybetmez: `REFUND_BOTH` ile çipler iade edilir.

### Gümüş Çip ekonomisi

- **Immutable ledger** — `coin_ledger` yalnızca `INSERT` alır; bakiye türev değerdir.
- **Çift kayıt** — her hareket bir `SYSTEM` karşı kaydıyla yazılır, `SUM(amount) = 0`.
- **İdempotency** — her ödeme `idempotency_key` ile tekilleştirilir (UNIQUE index).
- **Negatif bakiye** dört katmanda engellenir: istemci → servis → koşullu `UPDATE` → `CHECK`.

### Bounded context'ler

`identity` · `catalog` · `prediction` · `challenge` · `economy` · `reputation` ·
`social` · `ranking` · `resolution` · `monetization` · `governance` · `analytics`

### Konfigürasyon

Tüm eşikler ve katsayılar `src/config/` altındadır ve ortam değişkeniyle geçersiz
kılınabilir: `brand.ts` · `economy.ts` · `rating.ts` · `expertise.ts` · `limits.ts` · `env.ts`

`env.ts` uygulama açılışında Zod ile doğrular — eksik sırla süreç **başlamaz**.
Sırsız ortamlarda (CI lint/build) `SKIP_ENV_VALIDATION=1` kullanılır.

---

## Yol haritası

| Kilometre taşı | Fazlar | Sonuç |
| --- | --- | --- |
| M0 Temel | 0–4 | ✅ Kimlik, veritabanı, kategori ve etkinlik yönetimi |
| M1 Çekirdek Döngü | 5–9 | ✅ Tahmin, Gümüş Çip, Meydan Okuma, sonuçlandırma, Tahmin Gücü |
| M2 Sosyal Katman | 10–13 | Uzmanlık, akış, takip, bildirim, liderlik, sezon, rozet |
| M3 Lansman | 14–20 | Finans/kripto, premium, admin, güvenlik, test, SEO, dağıtım |

Bir faz, çıkış kriterleri sağlanmadan kapanmaz. `npm run verify` dördünü birden çalıştırır.

---

## Katkı

- Yeni iş kuralı **servis katmanına** yazılır, bileşen içine değil.
- Eşik veya katsayı gerekiyorsa `src/config/` altına eklenir.
- Para ve itibar etkileyen her değişiklik test ister; `domain/**` saf tutulur.
- Commit öncesi: `npm run verify`.
