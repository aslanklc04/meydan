-- DÜZELTME: Açık Meydan Okuma hiç kabul edilmeden sonlanabilir.
--
-- Önceki kural "OPEN modda rakip boşluğu ile PENDING durumu birebir örtüşür"
-- diyordu. Bu, kimse kabul etmeden süresi dolan bir Açık Meydan Okumayı
-- (EXPIRED + opponent_id NULL) yasaklıyordu — sonuçlandırma sırasında yakalandı.
--
-- Doğru kural:
--   DIRECT                → rakip her zaman zorunlu
--   OPEN + PENDING        → rakip boş olmalı (henüz kimse kapmadı)
--   OPEN + ACCEPTED/COMPLETED → rakip dolu olmalı
--   OPEN + EXPIRED/CANCELLED/DECLINED → rakip boş olabilir (hiç kapılmadı)

ALTER TABLE "challenge" DROP CONSTRAINT challenge_mode_opponent;

ALTER TABLE "challenge" ADD CONSTRAINT challenge_mode_opponent
  CHECK (
    ("mode" = 'DIRECT' AND "opponent_id" IS NOT NULL)
    OR (
      "mode" = 'OPEN' AND (
        ("status" = 'PENDING' AND "opponent_id" IS NULL)
        OR ("status" IN ('ACCEPTED', 'COMPLETED') AND "opponent_id" IS NOT NULL)
        OR ("status" IN ('EXPIRED', 'CANCELLED', 'DECLINED'))
      )
    )
  );
