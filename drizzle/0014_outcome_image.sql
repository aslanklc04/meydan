-- FAZ 8 — seçenek görseli (maçlarda takım arması).
--
-- Görsel ADRESİ saklanır, görselin kendisi değil: telif ve depolama yükü
-- alınmaz, sağlayıcı armayı güncellediğinde kendiliğinden güncellenir.
ALTER TABLE "event_outcome" ADD COLUMN "image_url" varchar(300);
