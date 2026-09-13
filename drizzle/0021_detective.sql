-- KISA DEDEKTİF — eksik bilgiyle akıl yürütme.
--
-- ── NEDEN TAHMİN DEĞİL, VAKA ────────────────────────────────────────────────
-- MEYDAN'ın bugüne kadarki bütün mekaniği GELECEĞE bakıyordu: tahminini yap,
-- üç gün bekle, sonucu gör. Bu üç sorunu birden doğuruyordu:
--
--   1. Döngü yavaş. Ödül üç gün sonra geliyor; alışkanlık kurmak için çok geç.
--   2. Tek kişiyle çalışmıyor. Kalabalık yoksa karşılaştıracak kimse yok.
--   3. Hukuken dar. Sonucu talihe bağlı olan her şey kumar tanımına yakın.
--
-- Kısa Dedektif'te cevap ZATEN BELLİ ama saklı. Kullanıcı ipuçlarından
-- çıkarım yapıyor ve cevabı ANINDA öğreniyor. Üç sorun da aynı anda çözülüyor:
-- geri bildirim saniyeler içinde geliyor, tek başına oynanabiliyor ve sonuç
-- şansa değil BECERİYE bağlı olduğu için yasal zemin bambaşka.
--
-- ── CEVAP DEĞİŞTİRİLEMEZ ────────────────────────────────────────────────────
-- Tahminlerde olduğu gibi: bir vakaya bir kez cevap verilir ve o cevap
-- sonradan değişmez. Karnenin anlamı buna bağlı — cevabını düzeltebilen bir
-- kullanıcının karnesi bir kanıt değil, bir vitrindir.

CREATE TABLE IF NOT EXISTS "detective_case" (
  "id"            text PRIMARY KEY NOT NULL,
  "slug"          varchar(80) NOT NULL UNIQUE,
  "title"         varchar(120) NOT NULL,
  -- Vakanın kendisi: olayın anlatıldığı, ipuçlarını içeren metin.
  "scenario"      text NOT NULL,
  "question"      varchar(200) NOT NULL,
  -- Cevaptan SONRA gösterilen çözüm. Oyunun asıl değeri burada: kullanıcı
  -- yanıldıysa bile neden yanıldığını öğrenerek çıkar.
  "explanation"   text NOT NULL,
  "difficulty"    smallint NOT NULL DEFAULT 1,
  "published_at"  timestamptz,
  "created_by_id" text REFERENCES "user"("id"),
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "attempt_count" integer NOT NULL DEFAULT 0,
  "correct_count" integer NOT NULL DEFAULT 0
);

ALTER TABLE "detective_case" ADD CONSTRAINT "detective_case_difficulty_range"
  CHECK ("difficulty" BETWEEN 1 AND 3);
ALTER TABLE "detective_case" ADD CONSTRAINT "detective_case_counts_sane"
  CHECK ("attempt_count" >= 0 AND "correct_count" >= 0 AND "correct_count" <= "attempt_count");

CREATE TABLE IF NOT EXISTS "detective_option" (
  "id"         text PRIMARY KEY NOT NULL,
  "case_id"    text NOT NULL REFERENCES "detective_case"("id") ON DELETE CASCADE,
  "label"      varchar(200) NOT NULL,
  "is_correct" boolean NOT NULL DEFAULT false,
  "sort_order" smallint NOT NULL DEFAULT 0
);

-- HER VAKANIN TAM OLARAK BİR DOĞRU CEVABI VAR.
-- İki doğru cevaplı bir vaka, puanlamayı sessizce bozar ve kimse fark etmez;
-- doğru cevapsız bir vaka ise herkesi haksız yere yanıltır. Kural veritabanında
-- durur çünkü vakaları elle gireceğiz ve elle girilen her şey yanlış girilir.
CREATE UNIQUE INDEX IF NOT EXISTS "detective_one_correct_per_case"
  ON "detective_option" ("case_id") WHERE "is_correct";

CREATE INDEX IF NOT EXISTS "detective_option_case_idx"
  ON "detective_option" ("case_id", "sort_order");

CREATE TABLE IF NOT EXISTS "detective_attempt" (
  "id"         text PRIMARY KEY NOT NULL,
  "case_id"    text NOT NULL REFERENCES "detective_case"("id") ON DELETE CASCADE,
  "user_id"    text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "option_id"  text NOT NULL REFERENCES "detective_option"("id"),
  "correct"    boolean NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- BİR VAKAYA BİR CEVAP. İkinci deneme, ilk cevabı öğrendikten sonra yapılırdı
-- ve karneyi anlamsızlaştırırdı.
CREATE UNIQUE INDEX IF NOT EXISTS "detective_one_attempt_per_user"
  ON "detective_attempt" ("case_id", "user_id");

CREATE INDEX IF NOT EXISTS "detective_attempt_user_idx"
  ON "detective_attempt" ("user_id", "created_at" DESC);

-- ── VERİLEN CEVAP DONAR ─────────────────────────────────────────────────────
-- Tahminlerdeki kuralın aynısı (göç 0020). Ekranda "cevabın değişmez" yazacaksa
-- arkasında ekran değil veritabanı durmalı.
CREATE OR REPLACE FUNCTION detective_freeze_answer() RETURNS trigger AS $$
BEGIN
  IF NEW."option_id" IS DISTINCT FROM OLD."option_id" THEN
    RAISE EXCEPTION 'detective_answer_immutable: verilen cevap değiştirilemez';
  END IF;
  IF NEW."correct" IS DISTINCT FROM OLD."correct" THEN
    RAISE EXCEPTION 'detective_result_immutable: sonuç sonradan değiştirilemez';
  END IF;
  IF NEW."user_id" IS DISTINCT FROM OLD."user_id" THEN
    RAISE EXCEPTION 'detective_author_immutable: cevap başkasına devredilemez';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "detective_freeze_answer_trg" ON "detective_attempt";
CREATE TRIGGER "detective_freeze_answer_trg"
  BEFORE UPDATE ON "detective_attempt"
  FOR EACH ROW EXECUTE FUNCTION detective_freeze_answer();
