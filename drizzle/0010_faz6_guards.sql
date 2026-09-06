-- ═══════════════════════════════════════════════════════════════════════════
-- FAZ 6 — VERİTABANI KISIT DENETİMİ
--
-- Buradaki her kural, Faz 1–5'te YALNIZCA uygulama kodunda korunuyordu.
-- Uygulama katmanı yeterli değildir: yarış koşulu, elle SQL, gelecekteki bir
-- servis ya da yeniden hesaplama betiği aynı kuralı unutabilir. Değişmezler
-- veritabanında da yazılıysa hiçbir yol onları atlayamaz.
--
-- Gereksiz kısıt EKLENMEDİ: yalnızca (a) sessizce bozulabilecek ve (b)
-- bozulduğunda para/itibar tutarsızlığı üretecek kurallar seçildi.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── İtibar sayaçları ───────────────────────────────────────────────────────

-- Form EWMA'sı bir olasılıktır: [0,1] dışına çıkması hesabın bozulduğunu gösterir.
ALTER TABLE "user_rating" ADD CONSTRAINT user_rating_form_range
  CHECK ("form_score" >= 0 AND "form_score" <= 1);

ALTER TABLE "user_category_stat" ADD CONSTRAINT user_category_form_range
  CHECK ("form_score" >= 0 AND "form_score" <= 1);

-- Σ(w·s) ≤ Σw — ağırlıklı doğru toplamı, ağırlık toplamını AŞAMAZ.
-- Aştığı an zorluk bileşeni 1'i geçer ve puan matematiksel olarak anlamsızlaşır.
ALTER TABLE "user_rating" ADD CONSTRAINT user_rating_weighted_sum_bounded
  CHECK ("difficulty_score_sum" >= 0 AND "difficulty_score_sum" <= "difficulty_weight_sum");

ALTER TABLE "user_category_stat" ADD CONSTRAINT user_category_weighted_sum_bounded
  CHECK ("difficulty_score_sum" >= 0 AND "difficulty_score_sum" <= "difficulty_weight_sum");

-- Son dönem penceresi kendi içinde tutarlı olmalı.
ALTER TABLE "user_rating" ADD CONSTRAINT user_rating_recent_consistent
  CHECK ("recent_count" >= 0 AND "last30_correct" >= 0 AND "last30_correct" <= "last30_total");

-- ── Meydan Okuma uzlaşımı ──────────────────────────────────────────────────

-- Kapanmış bir Meydan Okumanın MUTLAKA bir uzlaşım türü ve zamanı olur;
-- açık olanın ise OLMAZ. Bu kural olmadan "tamamlandı ama parası dağıtılmamış"
-- bir satır sessizce durabilir ve kimse fark etmez.
ALTER TABLE "challenge" ADD CONSTRAINT challenge_settlement_consistency
  CHECK (
    (status IN ('COMPLETED', 'EXPIRED', 'DECLINED', 'CANCELLED')
       AND settlement IS NOT NULL AND settled_at IS NOT NULL)
    OR
    (status IN ('PENDING', 'ACCEPTED')
       AND settlement IS NULL AND settled_at IS NULL)
  );

-- Kazanan yalnızca KAZAN-KAYBET uzlaşımında olur. İade edilen bir Meydan
-- Okumanın kazananı olamaz; olursa liderlik ve rozet sayacı yanlış işler.
ALTER TABLE "challenge" ADD CONSTRAINT challenge_winner_matches_settlement
  CHECK (
    (settlement = 'WIN_LOSS' AND winner_user_id IS NOT NULL)
    OR (settlement IS DISTINCT FROM 'WIN_LOSS' AND winner_user_id IS NULL)
  );

-- ── Sayaçlar ───────────────────────────────────────────────────────────────

ALTER TABLE "event_outcome" ADD CONSTRAINT event_outcome_count_non_negative
  CHECK ("prediction_count" >= 0);

-- ── İş çalıştırma kaydı ────────────────────────────────────────────────────

-- Biten bir işin bitiş zamanı olmalı; çalışan bir işin olmamalı.
ALTER TABLE "job_run" ADD CONSTRAINT job_run_finish_consistency
  CHECK (
    (status = 'RUNNING' AND finished_at IS NULL)
    OR (status <> 'RUNNING' AND finished_at IS NOT NULL)
  );

ALTER TABLE "job_run" ADD CONSTRAINT job_run_duration_non_negative
  CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0);

-- ═══════════════════════════════════════════════════════════════════════════
-- DEĞİŞMEZLİK — ledger ve denetim kaydı
--
-- Bu iki tablo "yalnızca eklenir" olarak TASARLANDI (ADR-28 ve çift kayıtlı
-- defter kuralı). Ancak bugüne kadar bunu yalnızca uygulama kodu koruyordu:
-- elle çalıştırılan tek bir UPDATE, para geçmişini sessizce değiştirebilirdi.
--
-- Tetikleyici bu kuralı veritabanı seviyesine taşır. Silme ve güncelleme
-- REDDEDİLİR; düzeltme yolu ters kayıt yazmaktır (defterin doğası budur).
--
-- NOT: bu koruma uygulamanın bağlandığı rolü kapsar. Üstün yetkili (superuser)
-- bir rol tetikleyiciyi devre dışı bırakabilir — bu yüzden production'da
-- uygulama rolü superuser OLMAMALIDIR (docs/operations.md).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION meydan_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Bu tablo yalnızca eklenebilir: % üzerinde % engellendi',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER coin_ledger_append_only
  BEFORE UPDATE OR DELETE ON "coin_ledger"
  FOR EACH ROW EXECUTE FUNCTION meydan_append_only();

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION meydan_append_only();
