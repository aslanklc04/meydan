-- MEYDAN SOHBETİ — her etkinliğin kendi sohbeti.
--
-- ── NEDEN ETKİNLİK BAŞINA, NEDEN GENEL ODA DEĞİL ─────────────────────────────
-- Genel bir sohbet odası ancak kalabalıkla canlıdır: üç kişilik bir sitede boş
-- bir oda, ürünün ıssız olduğunu ilan eden bir ekrandır. Etkinlik altındaki
-- sohbetin ise konusu hazır gelir ve iki kişiyle bile anlamlıdır.
--
-- ── TEK SEVİYE CEVAP ─────────────────────────────────────────────────────────
-- `parent_id` yalnızca kök yorumu gösterebilir; cevabın cevabı YOKTUR. Derin
-- ağaçlar telefonda okunamaz hâle gelir ve tartışmayı konudan koparır. Kural
-- serviste uygulanır (PostgreSQL kısmi bir yabancı anahtarı desteklemiyor) ve
-- entegrasyon testiyle korunur.

CREATE TABLE IF NOT EXISTS "event_comment" (
  "id"           text PRIMARY KEY NOT NULL,
  "event_id"     text NOT NULL REFERENCES "event"("id") ON DELETE CASCADE,
  "author_id"    text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "parent_id"    text REFERENCES "event_comment"("id") ON DELETE CASCADE,
  "body"         varchar(500) NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  -- Yazarın kendi sildiği yorum: metni silinir, satır kalır ki cevapları
  -- öksüz kalmasın. "Bu yorum silindi" demek, cevapları yok etmekten iyidir.
  "deleted_at"   timestamptz,
  -- Moderasyonun gizlediği yorum. İkisi ayrı: biri kullanıcının kararı,
  -- diğeri bizim kararımız ve denetim kaydına düşer.
  "hidden_at"    timestamptz,
  "hidden_by_id" text REFERENCES "user"("id")
);

-- Boş yorum yazılamaz; üst sınır veritabanında da durur ki arayüz
-- atlandığında bile aşılamasın.
ALTER TABLE "event_comment" ADD CONSTRAINT "event_comment_body_length"
  CHECK (char_length(btrim("body")) BETWEEN 1 AND 500);

-- Gizleme kaydı EKSİK OLAMAZ: kimin gizlediği bilinmeyen bir gizleme,
-- hesap sorulamayan bir moderasyondur.
ALTER TABLE "event_comment" ADD CONSTRAINT "event_comment_hidden_complete"
  CHECK (("hidden_at" IS NULL) = ("hidden_by_id" IS NULL));

-- Yorum kendi kendisinin cevabı olamaz.
ALTER TABLE "event_comment" ADD CONSTRAINT "event_comment_no_self_parent"
  CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

CREATE INDEX IF NOT EXISTS "event_comment_event_idx"
  ON "event_comment" ("event_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "event_comment_parent_idx"
  ON "event_comment" ("parent_id", "created_at");
CREATE INDEX IF NOT EXISTS "event_comment_author_idx"
  ON "event_comment" ("author_id", "created_at" DESC);

-- Moderasyon denetim kaydı için yeni eylem.
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'COMMENT_HIDDEN';

-- Cevap bildirimi: yorumuna cevap gelen kişi haberdar olmalı, yoksa sohbet
-- tek yönlü bir duvar yazısına dönüşür.
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'COMMENT_REPLY';
