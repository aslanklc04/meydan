-- FAZ 8 — Gelecek Gazetesi: kullanıcının kendi eseri olan paylaşılabilir kapak.

CREATE TABLE "gazette" (
  "id" text PRIMARY KEY NOT NULL,
  "public_token" text NOT NULL,
  "owner_id" text NOT NULL,
  "title" text NOT NULL,
  "published_day" date NOT NULL,
  "view_count" integer DEFAULT 0 NOT NULL,
  "signup_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "gazette_owner_id_user_id_fk" FOREIGN KEY ("owner_id")
    REFERENCES "user"("id") ON DELETE cascade
);

-- Paylaşım adresinin tekilliği veritabanında garanti edilir. Jeton rastgele
-- üretilir ve çakışma olasılığı yok denecek kadar küçüktür; ama "yok denecek
-- kadar" bir kısıt değildir. Çakışma olursa yazma reddedilir, sessizce başka
-- birinin gazetesinin üstüne yazılmaz.
CREATE UNIQUE INDEX "gazette_public_token_key" ON "gazette" ("public_token");
CREATE INDEX "gazette_owner_idx" ON "gazette" ("owner_id", "created_at" DESC);

-- Başlık boş bırakılamaz ve sınırsız uzayamaz: kapakta tek satır olarak
-- görünecek, taşarsa tasarımı bozar.
ALTER TABLE "gazette" ADD CONSTRAINT "gazette_title_length"
  CHECK (char_length(btrim("title")) BETWEEN 1 AND 70);

-- Sayaçlar geriye gitmez. Negatif bir sayaç, bir yerde çıkarma yapıldığı
-- anlamına gelir ve bunu istemiyoruz.
ALTER TABLE "gazette" ADD CONSTRAINT "gazette_counts_nonnegative"
  CHECK ("view_count" >= 0 AND "signup_count" >= 0);


CREATE TABLE "gazette_item" (
  "id" text PRIMARY KEY NOT NULL,
  "gazette_id" text NOT NULL,
  "prediction_id" text NOT NULL,
  "slot" integer NOT NULL,
  CONSTRAINT "gazette_item_gazette_id_gazette_id_fk" FOREIGN KEY ("gazette_id")
    REFERENCES "gazette"("id") ON DELETE cascade,
  CONSTRAINT "gazette_item_prediction_id_prediction_id_fk" FOREIGN KEY ("prediction_id")
    REFERENCES "prediction"("id") ON DELETE cascade
);

-- ── SEÇİCİ SUNUMA KARŞI ASIL KİLİT ────────────────────────────────────────
--
-- Bir tahmin ömrü boyunca YALNIZCA BİR gazetede yer alabilir.
--
-- Bu kural olmasaydı "manşetler birlikte kilitlenir" kuralı hiçbir işe
-- yaramazdı: kullanıcı sonuçları görür, sonra sadece tutan tahminini içeren
-- yeni bir gazete kurar ve kusursuz bir karne paylaşırdı. Kural burada durur
-- çünkü uygulama kodundaki bir kontrol ileride kolayca atlanabilir; tekil
-- index atlanamaz.
CREATE UNIQUE INDEX "gazette_item_prediction_key" ON "gazette_item" ("prediction_id");

-- Aynı gazetede aynı sıra iki kez olamaz.
CREATE UNIQUE INDEX "gazette_item_slot_key" ON "gazette_item" ("gazette_id", "slot");

-- "En çok üç manşet" kuralı da veriye yazılır; sunum katmanının insafına
-- bırakılmaz.
ALTER TABLE "gazette_item" ADD CONSTRAINT "gazette_item_slot_range"
  CHECK ("slot" BETWEEN 0 AND 2);
