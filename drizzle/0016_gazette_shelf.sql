-- FAZ 8 — Gazete rafı: görünürlük tercihi ve moderasyon gizlemesi.

CREATE TYPE "gazette_visibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- Moderasyon kararının denetim kaydında bir adı olmalı. Bir kapağın neden
-- gizlendiği ve kimin gizlediği sorulabilir olmalıdır; adsız bir eylem
-- denetlenemez.
--
-- Yeni değer BU göçte yalnızca EKLENİR, kullanılmaz. PostgreSQL, aynı işlem
-- içinde eklenen bir enum değerinin yine aynı işlemde KULLANILMASINA izin
-- vermez; kullanım çalışma anında, çok sonra olacağı için sorun çıkmaz.
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'GAZETTE_HIDDEN';

ALTER TABLE "gazette"
  ADD COLUMN "visibility" "gazette_visibility" DEFAULT 'PRIVATE' NOT NULL,
  ADD COLUMN "made_private_at" timestamptz,
  ADD COLUMN "hidden_at" timestamptz,
  ADD COLUMN "hidden_by_id" text;

ALTER TABLE "gazette" ADD CONSTRAINT "gazette_hidden_by_id_user_id_fk"
  FOREIGN KEY ("hidden_by_id") REFERENCES "user"("id");

-- ── VARSAYILAN NEDEN "PRIVATE" ────────────────────────────────────────────
--
-- Bu göç çalıştığında sistemde zaten kurulmuş kapaklar var. Onlar, herkese
-- açık bir raf yokken kuruldu; sahipleri "bunu ana sayfada göster" diye bir
-- şey seçmedi. Varsayılanı PUBLIC yapmak, geçmişte verilmemiş bir izni
-- geriye dönük olarak varsaymak olurdu.
--
-- Yeni kapaklarda tercih kullanıcıya sorulur; varsayılan yine kapalıdır.

CREATE INDEX "gazette_shelf_idx"
  ON "gazette" ("visibility", "hidden_at", "created_at" DESC);

-- ── TEK YÖNLÜ MANDAL ──────────────────────────────────────────────────────
--
-- Kullanıcı herkese açık bir kapağı gizleyebilir ama geri açamaz.
--
-- Serbest olsaydı "man&#351;et silinemez" kuralı raf düzeyinde delinirdi:
-- kullanıcı kapağını açar, manşetleri tutmayınca gizler, tutunca yeniden
-- açardı. Raf o zaman gerçeği değil herkesin en iyi gününü gösterirdi.
--
-- Kural burada durur çünkü uygulama kodundaki bir kontrol ileride bir
-- düzenleme sırasında sessizce kaldırılabilir; kısıt kaldırılamaz.
ALTER TABLE "gazette" ADD CONSTRAINT "gazette_visibility_one_way"
  CHECK ("made_private_at" IS NULL OR "visibility" = 'PRIVATE');

-- Gizleme tutarlılığı: kim gizlediyse ne zaman gizlediği de yazılı olmalı.
-- Yarım doldurulmuş bir satır, denetim kaydını cevapsız bırakır.
ALTER TABLE "gazette" ADD CONSTRAINT "gazette_hidden_complete"
  CHECK (("hidden_at" IS NULL) = ("hidden_by_id" IS NULL));
