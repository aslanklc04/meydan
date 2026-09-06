-- Identity bütünlük kuralları — Spesifikasyon Bölüm 2.13.
--
-- Bu kuralların uygulama katmanında da karşılığı vardır. Buradaki CHECK'ler son
-- savunma hattıdır: kod hatası, migration hatası veya elle SQL durumunda devreye
-- girer ve transaction'ı geri alır.

-- Kullanıcı adı: 3-20 karakter, yalnızca harf/rakam/alt çizgi.
ALTER TABLE "user" ADD CONSTRAINT user_username_format
  CHECK ("username" ~ '^[A-Za-z0-9_]{3,20}$');

-- usernameLower her zaman username'in küçük harfli hâlidir.
-- Bu olmadan iki kolon ayrışabilir ve /u/emir yanlış hesaba çözülebilir.
ALTER TABLE "user" ADD CONSTRAINT user_username_lower_consistent
  CHECK ("username_lower" = lower("username"));

-- E-posta normalize edilmiş saklanır; aksi hâlde unique index kimlik taklidine açılır.
ALTER TABLE "user" ADD CONSTRAINT user_email_normalized
  CHECK ("email" = lower("email") AND "email" = btrim("email"));

-- Oturum epoch'u geriye gidemez.
ALTER TABLE "user" ADD CONSTRAINT user_session_epoch_non_negative
  CHECK ("session_epoch" >= 0);

-- Sayaçlar negatif olamaz.
ALTER TABLE "profile" ADD CONSTRAINT profile_counts_non_negative
  CHECK ("follower_count" >= 0 AND "following_count" >= 0);

-- Oturum süresi oluşturulma anından sonra olmalıdır.
ALTER TABLE "session" ADD CONSTRAINT session_expiry_after_creation
  CHECK ("expires_at" > "created_at");

-- Token süresi oluşturulma anından sonra olmalıdır.
ALTER TABLE "verification_token" ADD CONSTRAINT verification_expiry_after_creation
  CHECK ("expires_at" > "created_at");

-- Aynı kullanıcı için aynı amaçla yalnızca TEK aktif (tüketilmemiş) token bulunabilir.
-- Parola sıfırlama bağlantısı üretmek, öncekini geçersiz kılmalıdır.
CREATE UNIQUE INDEX verification_one_active_per_purpose
  ON "verification_token" ("user_id", "purpose")
  WHERE "consumed_at" IS NULL;
