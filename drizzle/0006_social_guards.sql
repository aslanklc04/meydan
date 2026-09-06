-- Sosyal katman bütünlük kuralları.

-- ═══════════════════════════════════════════════════════════════════════════
-- TAKİP
-- ═══════════════════════════════════════════════════════════════════════════

-- Kullanıcı kendini takip edemez. Takipçi sayısı şişirmenin en basit yolu budur.
ALTER TABLE "follow" ADD CONSTRAINT follow_not_self
  CHECK ("follower_id" <> "following_id");

-- ═══════════════════════════════════════════════════════════════════════════
-- ENGELLEME
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "block" ADD CONSTRAINT block_not_self
  CHECK ("blocker_id" <> "blocked_id");

-- ═══════════════════════════════════════════════════════════════════════════
-- RAPORLAMA
-- ═══════════════════════════════════════════════════════════════════════════

-- İncelenmiş rapor, inceleyeni ve tarihi taşımak zorundadır.
ALTER TABLE "report" ADD CONSTRAINT report_review_consistency
  CHECK (
    ("status" = 'OPEN' AND "reviewed_by_id" IS NULL AND "reviewed_at" IS NULL)
    OR ("status" <> 'OPEN' AND "reviewed_by_id" IS NOT NULL AND "reviewed_at" IS NOT NULL)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- AKIŞ
-- ═══════════════════════════════════════════════════════════════════════════

-- Her akış öğesi türüne uygun referansı taşımalıdır; boş kart üretilemez.
ALTER TABLE "feed_item" ADD CONSTRAINT feed_item_reference_required
  CHECK (
    ("kind" = 'PREDICTION_CREATED' AND "prediction_id" IS NOT NULL)
    OR ("kind" IN ('CHALLENGE_CREATED', 'CHALLENGE_COMPLETED') AND "challenge_id" IS NOT NULL)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- SEZON
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "season" ADD CONSTRAINT season_dates_ordered
  CHECK ("start_at" < "end_at");

-- Aynı anda yalnızca TEK sezon aktif olabilir.
CREATE UNIQUE INDEX season_single_active
  ON "season" (("status")) WHERE "status" = 'ACTIVE';

-- ═══════════════════════════════════════════════════════════════════════════
-- LİDERLİK
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "leaderboard_snapshot" ADD CONSTRAINT leaderboard_period_ordered
  CHECK ("period_start" < "period_end");

ALTER TABLE "leaderboard_snapshot" ADD CONSTRAINT leaderboard_min_positive
  CHECK ("min_predictions" >= 0);

ALTER TABLE "leaderboard_entry" ADD CONSTRAINT leaderboard_rank_positive
  CHECK ("rank" > 0);

ALTER TABLE "leaderboard_entry" ADD CONSTRAINT leaderboard_counts_consistent
  CHECK ("correct_predictions" >= 0 AND "correct_predictions" <= "completed_predictions");

-- Bir snapshot içinde aynı sıra iki kez verilemez.
CREATE UNIQUE INDEX leaderboard_entry_unique_rank
  ON "leaderboard_entry" ("snapshot_id", "rank");

-- ═══════════════════════════════════════════════════════════════════════════
-- GÜNDEM
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "trending_snapshot" ADD CONSTRAINT trending_rank_positive
  CHECK ("rank" > 0);
