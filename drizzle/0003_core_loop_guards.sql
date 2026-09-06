-- Çekirdek döngü bütünlük kuralları.
--
-- Bunların hepsinin uygulama katmanında da karşılığı vardır. Buradakiler SON
-- SAVUNMA HATTIDIR: kod hatası, yarış koşulu, elle SQL veya migration hatası
-- durumunda transaction'ı geri alır.
--
-- ADR-15 ve ADR-16'nın DDL'i, Faz 2'de `adr_probe` geçici şemasında doğrulanmıştı;
-- burada kalıcı tablolara taşınıyor.

-- ═══════════════════════════════════════════════════════════════════════════
-- ETKİNLİK
-- ═══════════════════════════════════════════════════════════════════════════

-- Tahmin kapanışı, sonuç anından ÖNCE olmalıdır. Aksi hâlde kullanıcı sonucu
-- gördükten sonra tahmin yapabilir.
ALTER TABLE "event" ADD CONSTRAINT event_closes_before_resolves
  CHECK ("closes_at" <= "resolves_at");

-- Başlangıç varsa kapanıştan önce olmalıdır.
ALTER TABLE "event" ADD CONSTRAINT event_starts_before_closes
  CHECK ("starts_at" IS NULL OR "starts_at" <= "closes_at");

-- Sonuç yalnızca RESOLVED durumunda dolu olabilir; VOID'de sonuç yoktur.
ALTER TABLE "event" ADD CONSTRAINT event_resolution_consistency
  CHECK (
    ("status" = 'RESOLVED' AND "resolved_outcome_id" IS NOT NULL AND "resolved_at" IS NOT NULL)
    OR ("status" <> 'RESOLVED' AND "resolved_outcome_id" IS NULL)
  );

ALTER TABLE "event" ADD CONSTRAINT event_counts_non_negative
  CHECK ("prediction_count" >= 0 AND "challenge_count" >= 0);

-- ADR-16: aynı şablonun aynı takvim örneği İKİNCİ KEZ üretilemez.
CREATE UNIQUE INDEX event_template_occurrence_unique
  ON "event" ("template_id", "occurrence_key")
  WHERE "template_id" IS NOT NULL;

-- Şablondan üretilen etkinlikte örnek anahtarı zorunludur.
ALTER TABLE "event" ADD CONSTRAINT event_template_needs_occurrence
  CHECK (("template_id" IS NULL) = ("occurrence_key" IS NULL));

-- Sonuç, o etkinliğe ait bir outcome olmalıdır.
ALTER TABLE "event" ADD CONSTRAINT event_resolved_outcome_fk
  FOREIGN KEY ("resolved_outcome_id") REFERENCES "event_outcome"("id");

ALTER TABLE "event_outcome" ADD CONSTRAINT event_outcome_consensus_range
  CHECK ("consensus_share" IS NULL OR ("consensus_share" >= 0 AND "consensus_share" <= 1));

-- ═══════════════════════════════════════════════════════════════════════════
-- TAHMİN
-- ═══════════════════════════════════════════════════════════════════════════

-- Bir kullanıcı aynı etkinliğe aynı anda BİRDEN FAZLA aktif tahmin yapamaz.
-- Uygulama kontrolü çift tıklamada/iki sekmede yarışı kaybeder; index kaybetmez.
CREATE UNIQUE INDEX prediction_one_active_per_user_event
  ON "prediction" ("user_id", "event_id")
  WHERE "status" IN ('OPEN', 'LOCKED');

ALTER TABLE "prediction" ADD CONSTRAINT prediction_stake_non_negative
  CHECK ("stake_amount" >= 0);

-- Sonuç yalnızca sonuçlanmış tahminde bulunur.
ALTER TABLE "prediction" ADD CONSTRAINT prediction_result_consistency
  CHECK (
    ("status" IN ('RESOLVED', 'VOID') AND "result" IS NOT NULL)
    OR ("status" IN ('OPEN', 'LOCKED') AND "result" IS NULL)
  );

ALTER TABLE "prediction" ADD CONSTRAINT prediction_difficulty_range
  CHECK ("difficulty_score" IS NULL OR ("difficulty_score" >= 0 AND "difficulty_score" <= 1));

-- ═══════════════════════════════════════════════════════════════════════════
-- MEYDAN OKUMA  (ADR-15)
-- ═══════════════════════════════════════════════════════════════════════════

-- Kullanıcı kendine meydan okuyamaz. opponent_id null olabildiği için NULL-güvenli.
ALTER TABLE "challenge" ADD CONSTRAINT challenge_not_self
  CHECK ("opponent_id" IS NULL OR "creator_id" <> "opponent_id");

-- EN ÖNEMLİ KURAL: iki taraf ASLA aynı sonucu tutamaz.
-- Bu, veritabanı seviyesinde garanti edilir; UI ve servis de ayrıca engeller.
ALTER TABLE "challenge" ADD CONSTRAINT challenge_opposing_outcomes
  CHECK ("creator_outcome_id" <> "opponent_outcome_id");

-- DIRECT'te rakip zorunlu; OPEN'da PENDING iken rakip boş olmalıdır.
ALTER TABLE "challenge" ADD CONSTRAINT challenge_mode_opponent
  CHECK (
    ("mode" = 'DIRECT' AND "opponent_id" IS NOT NULL)
    OR ("mode" = 'OPEN' AND (("status" = 'PENDING') = ("opponent_id" IS NULL)))
  );

ALTER TABLE "challenge" ADD CONSTRAINT challenge_stake_positive
  CHECK ("stake_amount" > 0);

-- Kabul edilmiş meydan okumada rakibin tahmini zorunludur.
ALTER TABLE "challenge" ADD CONSTRAINT challenge_accepted_needs_prediction
  CHECK (
    "status" NOT IN ('ACCEPTED', 'COMPLETED')
    OR ("opponent_prediction_id" IS NOT NULL AND "accepted_at" IS NOT NULL)
  );

-- Kazanan yalnızca taraflardan biri olabilir.
ALTER TABLE "challenge" ADD CONSTRAINT challenge_winner_is_participant
  CHECK (
    "winner_user_id" IS NULL
    OR "winner_user_id" = "creator_id"
    OR "winner_user_id" = "opponent_id"
  );

-- Aynı çift arasında aynı etkinlikte tekrarlanan DIRECT meydan okuma engellenir.
CREATE UNIQUE INDEX challenge_no_duplicate_direct
  ON "challenge" ("event_id", "creator_id", "opponent_id")
  WHERE "mode" = 'DIRECT' AND "status" IN ('PENDING', 'ACCEPTED');

-- Bir kullanıcı aynı etkinlikte birden fazla BEKLEYEN açık meydan okuma açamaz.
CREATE UNIQUE INDEX challenge_one_open_per_creator_event
  ON "challenge" ("event_id", "creator_id")
  WHERE "mode" = 'OPEN' AND "status" = 'PENDING';

-- Açık meydan okuma keşif sorgusu.
CREATE INDEX challenge_open_discovery
  ON "challenge" ("event_id", "created_at" DESC)
  WHERE "mode" = 'OPEN' AND "status" = 'PENDING';

-- Bir tahmin yalnızca TEK bir meydan okumaya bağlanabilir.
CREATE UNIQUE INDEX challenge_creator_prediction_unique
  ON "challenge" ("creator_prediction_id");
CREATE UNIQUE INDEX challenge_opponent_prediction_unique
  ON "challenge" ("opponent_prediction_id")
  WHERE "opponent_prediction_id" IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- EKONOMİ  —  Gümüş Çip (sanal, gerçek para değil)
-- ═══════════════════════════════════════════════════════════════════════════

-- Bakiye ASLA negatif olamaz. Tek istisna, dağıtılan arzı temsil eden SYSTEM
-- hesabıdır. Bu CHECK, eşzamanlı iki harcamanın uygulama kontrolünü birlikte
-- geçtiği durumda transaction'ı geri alır.
ALTER TABLE "coin_account" ADD CONSTRAINT coin_balance_non_negative
  CHECK ("balance" >= 0 OR "owner_id" = 'SYSTEM');

ALTER TABLE "coin_account" ADD CONSTRAINT coin_version_non_negative
  CHECK ("version" >= 0);

-- Sıfır tutarlı hareket anlamsızdır ve mutabakatı gürültüye boğar.
ALTER TABLE "coin_ledger" ADD CONSTRAINT coin_ledger_amount_non_zero
  CHECK ("amount" <> 0);

-- ═══════════════════════════════════════════════════════════════════════════
-- İTİBAR
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "user_rating" ADD CONSTRAINT user_rating_power_range
  CHECK ("prediction_power" >= 0 AND "prediction_power" <= 100);

ALTER TABLE "user_rating" ADD CONSTRAINT user_rating_counts_consistent
  CHECK (
    "completed_predictions" >= 0
    AND "correct_predictions" >= 0
    AND "correct_predictions" <= "completed_predictions"
  );

ALTER TABLE "user_category_stat" ADD CONSTRAINT user_category_power_range
  CHECK ("prediction_power" >= 0 AND "prediction_power" <= 100);

ALTER TABLE "user_category_stat" ADD CONSTRAINT user_category_counts_consistent
  CHECK (
    "completed_predictions" >= 0
    AND "correct_predictions" >= 0
    AND "correct_predictions" <= "completed_predictions"
  );

-- Sonuçlandırma kararı sınırlı bir kümedir.
ALTER TABLE "event_resolution" ADD CONSTRAINT event_resolution_decision_valid
  CHECK ("decision" IN ('RESOLVED', 'VOID'));

-- RESOLVED kararında sonuç zorunlu, VOID'de yasaktır.
ALTER TABLE "event_resolution" ADD CONSTRAINT event_resolution_outcome_consistency
  CHECK (
    ("decision" = 'RESOLVED' AND "outcome_id" IS NOT NULL)
    OR ("decision" = 'VOID' AND "outcome_id" IS NULL)
  );
