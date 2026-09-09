-- FAZ 8 — Günün Meydanı ve dondurulmuş konsensüs.

CREATE TYPE "featured_type" AS ENUM ('DAILY_PRIMARY', 'DAILY_SECONDARY');

ALTER TABLE "event"
  ADD COLUMN "featured_type" "featured_type",
  ADD COLUMN "featured_date" date,
  ADD COLUMN "consensus_frozen_at" timestamptz,
  ADD COLUMN "consensus_snapshot" jsonb;

CREATE INDEX "event_featured_idx" ON "event" ("featured_date", "featured_type");

-- ── GÜNDE TEK BİR "GÜNÜN MEYDANI" ──────────────────────────────────────────
--
-- Kural uygulama koduna BIRAKILMAZ. İki yönetici aynı anda seçtiğinde, bir
-- betik ikinci kez çalıştığında ya da bir dağıtım yarıda kaldığında sessizce
-- iki "günün maçı" oluşur ve ana sayfa hangisini göstereceğini bilemez.
--
-- Kısmi tekil index: yalnızca DAILY_PRIMARY satırları için geçerlidir;
-- ikincil öne çıkan etkinlikler aynı güne birden fazla eklenebilir.
CREATE UNIQUE INDEX "event_daily_primary_key"
  ON "event" ("featured_date")
  WHERE "featured_type" = 'DAILY_PRIMARY';

-- ── ÖNE ÇIKARMA TUTARLILIĞI ────────────────────────────────────────────────
--
-- Tür varsa tarih de olmalı, tarih varsa tür de. Yarım doldurulmuş bir satır
-- ana sayfada "bugünün Meydanı yok" ile "var ama tarihsiz" arasında belirsiz
-- bir duruma yol açar.
ALTER TABLE "event" ADD CONSTRAINT "event_featured_complete"
  CHECK (("featured_type" IS NULL) = ("featured_date" IS NULL));

-- ── KONSENSÜS DONDURMA TUTARLILIĞI ─────────────────────────────────────────
--
-- Anlık görüntü ve donma zamanı birlikte yazılır; biri olmadan diğeri
-- "donduruldu mu, dondurulmadı mı" sorusunu cevapsız bırakır.
ALTER TABLE "event" ADD CONSTRAINT "event_consensus_complete"
  CHECK (("consensus_frozen_at" IS NULL) = ("consensus_snapshot" IS NULL));
