-- FAZ 8 — Meydan Okumayı kabul eden kendi tarafını seçer.

-- ── NEDEN DEĞİŞTİ ──────────────────────────────────────────────────────────
--
-- ADR-18 karşı tarafı OLUŞTURMA anında deterministik olarak atıyordu: sıralı
-- sonuçlar arasında oluşturanın seçmediği İLK sonuç. Gerekçesi kabul akışına
-- fazladan bir adım koymamaktı.
--
-- Bu, iki sonuçlu etkinliklerde doğrudur (karşı taraf zaten tektir). ÜÇ
-- sonuçlu bir maçta ise haksızlık üretiyor:
--
--   Ev sahibi(0) — Beraberlik(1) — Deplasman(2)
--   Oluşturan "ev sahibi" derse, kabul edene BERABERLİK veriliyordu.
--
-- Kabul eden kişi, maçların azınlığında gerçekleşen bir sonucu almış oluyor;
-- oluşturan ise en olası sonucu seçmiş. Üçüncü sonuç çıkınca iki taraf da
-- iade alıyor, ama pozisyonlar eşit değil: oluşturan kazanır ya da iade alır,
-- kabul eden kaybeder ya da iade alır. ADR-18'deki "deterministik atama
-- kimseye haksızlık üretmez" cümlesi üç sonuçlu etkinlikler için YANLIŞTI.
--
-- Yeni kural: karşı taraf KABUL ANINDA, kabul eden kişi tarafından seçilir.
-- İki sonuçlu etkinlikte seçenek zaten tektir ve arayüz onu hazır işaretler —
-- yani "fazladan adım koymama" gerekçesi tasarlandığı yerde korunur.

ALTER TABLE "challenge" ALTER COLUMN "opponent_outcome_id" DROP NOT NULL;

-- ── AYNI TARAF MEYDAN OKUMA DEĞİLDİR ──────────────────────────────────────
--
-- İki taraf aynı sonucu seçerse ortada bir iddia yoktur: ikisi de kazanır ya
-- da ikisi de kaybeder, çipler yer değiştirmez. Kural şimdiye kadar yalnızca
-- uygulama kodundaydı; artık veritabanında.
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_sides_differ"
  CHECK ("opponent_outcome_id" IS NULL OR "opponent_outcome_id" <> "creator_outcome_id");

-- ── KABUL EDİLMİŞ MEYDAN OKUMANIN TARAFI BELLİ OLMALI ─────────────────────
--
-- Kabul edildiyse rakip de, rakibin tarafı da yazılı olmak zorundadır. Yarım
-- doldurulmuş bir satır, sonuçlandırma anında "kim neyi savundu" sorusunu
-- cevapsız bırakır ve çipler yanlış tarafa gider.
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_accepted_complete"
  CHECK (
    "status" NOT IN ('ACCEPTED', 'COMPLETED')
    OR ("opponent_id" IS NOT NULL AND "opponent_outcome_id" IS NOT NULL)
  );
