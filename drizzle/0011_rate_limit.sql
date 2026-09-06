CREATE TABLE "rate_limit_counter" (
	"bucket_key" varchar(200) PRIMARY KEY NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limit_expiry_idx" ON "rate_limit_counter" USING btree ("expires_at");