-- FAZ 8 — Tek soruluk meydan okuma bağlantısı.

CREATE TABLE "prediction_share" (
  "id" text PRIMARY KEY NOT NULL,
  "public_token" text NOT NULL,
  "prediction_id" text NOT NULL,
  "view_count" integer DEFAULT 0 NOT NULL,
  "answer_count" integer DEFAULT 0 NOT NULL,
  "signup_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "prediction_share_prediction_id_prediction_id_fk" FOREIGN KEY ("prediction_id")
    REFERENCES "prediction"("id") ON DELETE cascade
);

-- Paylaşım adresinin tekilliği veritabanında garanti edilir. Jeton rastgele
-- üretilir; çakışma olasılığı yok denecek kadar küçüktür ama "yok denecek
-- kadar" bir kısıt değildir.
CREATE UNIQUE INDEX "prediction_share_token_key" ON "prediction_share" ("public_token");

-- ── BİR TAHMİN, BİR BAĞLANTI ──────────────────────────────────────────────
--
-- Her "paylaş"a basışta yeni jeton üretilseydi aynı tahmin için onlarca adres
-- oluşur, sayaçlar o adreslere bölünür ve hangisinin işe yaradığı
-- söylenemezdi. Daha kötüsü: aynı tahmin farklı kişilere farklı adreslerle
-- gider, biri açılır biri açılmaz ve ölçüm anlamını yitirir.
CREATE UNIQUE INDEX "prediction_share_prediction_key" ON "prediction_share" ("prediction_id");

CREATE INDEX "prediction_share_created_idx" ON "prediction_share" ("created_at" DESC);

-- Sayaçlar geriye gitmez.
ALTER TABLE "prediction_share" ADD CONSTRAINT "prediction_share_counts_nonnegative"
  CHECK ("view_count" >= 0 AND "answer_count" >= 0 AND "signup_count" >= 0);
