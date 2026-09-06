CREATE TYPE "public"."category_kind" AS ENUM('GENERAL', 'FINANCIAL');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('DRAFT', 'OPEN', 'CLOSED', 'RESOLVING', 'RESOLVED', 'VOID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."recurrence" AS ENUM('DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."resolution_source" AS ENUM('MANUAL', 'SPORTS', 'WEATHER', 'CRYPTO_MARKET', 'STOCK_MARKET');--> statement-breakpoint
CREATE TYPE "public"."prediction_result" AS ENUM('CORRECT', 'INCORRECT', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."prediction_status" AS ENUM('OPEN', 'LOCKED', 'RESOLVED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."challenge_mode" AS ENUM('DIRECT', 'OPEN');--> statement-breakpoint
CREATE TYPE "public"."challenge_status" AS ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."settlement_kind" AS ENUM('WIN_LOSS', 'REFUND_BOTH');--> statement-breakpoint
CREATE TYPE "public"."ledger_type" AS ENUM('INITIAL_GRANT', 'CHALLENGE_STAKE', 'CHALLENGE_WIN', 'CHALLENGE_REFUND', 'DAILY_REWARD', 'ADMIN_ADJUSTMENT', 'SYSTEM_COUNTERPART');--> statement-breakpoint
CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar(40) NOT NULL,
	"name" varchar(60) NOT NULL,
	"icon" varchar(8) NOT NULL,
	"description" varchar(200),
	"kind" "category_kind" DEFAULT 'GENERAL' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_outcome" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"key" varchar(40) NOT NULL,
	"label" varchar(80) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"prediction_count" integer DEFAULT 0 NOT NULL,
	"consensus_share" numeric(6, 5)
);
--> statement-breakpoint
CREATE TABLE "event_template" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar(60) NOT NULL,
	"category_id" text NOT NULL,
	"title_pattern" varchar(200) NOT NULL,
	"question_pattern" varchar(200) NOT NULL,
	"slug_pattern" varchar(200) NOT NULL,
	"outcomes" jsonb NOT NULL,
	"recurrence" "recurrence" NOT NULL,
	"recurrence_config" jsonb,
	"timezone" varchar(60) DEFAULT 'UTC' NOT NULL,
	"closes_at_local" varchar(8) NOT NULL,
	"resolves_at_local" varchar(8) NOT NULL,
	"resolution_source" "resolution_source" DEFAULT 'MANUAL' NOT NULL,
	"generate_ahead_days" integer DEFAULT 3 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"title" varchar(160) NOT NULL,
	"question" varchar(200) NOT NULL,
	"description" varchar(600),
	"slug" varchar(180) NOT NULL,
	"status" "event_status" DEFAULT 'DRAFT' NOT NULL,
	"starts_at" timestamp with time zone,
	"closes_at" timestamp with time zone NOT NULL,
	"resolves_at" timestamp with time zone NOT NULL,
	"timezone" varchar(60) DEFAULT 'UTC' NOT NULL,
	"resolution_source" "resolution_source" DEFAULT 'MANUAL' NOT NULL,
	"resolved_outcome_id" text,
	"resolved_at" timestamp with time zone,
	"void_reason" varchar(200),
	"prediction_count" integer DEFAULT 0 NOT NULL,
	"challenge_count" integer DEFAULT 0 NOT NULL,
	"template_id" text,
	"occurrence_key" varchar(20),
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event_id" text NOT NULL,
	"outcome_id" text NOT NULL,
	"category_id" text NOT NULL,
	"stake_amount" integer DEFAULT 0 NOT NULL,
	"status" "prediction_status" DEFAULT 'OPEN' NOT NULL,
	"result" "prediction_result",
	"difficulty_score" numeric(6, 5),
	"rating_applied" boolean DEFAULT false NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "challenge" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"mode" "challenge_mode" DEFAULT 'DIRECT' NOT NULL,
	"status" "challenge_status" DEFAULT 'PENDING' NOT NULL,
	"creator_id" text NOT NULL,
	"opponent_id" text,
	"creator_outcome_id" text NOT NULL,
	"opponent_outcome_id" text NOT NULL,
	"creator_prediction_id" text NOT NULL,
	"opponent_prediction_id" text,
	"stake_amount" integer NOT NULL,
	"winner_user_id" text,
	"settlement" "settlement_kind",
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coin_account" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coin_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"amount" integer NOT NULL,
	"type" "ledger_type" NOT NULL,
	"reference_type" varchar(20),
	"reference_id" text,
	"balance_after" integer NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_resolution" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"outcome_id" text,
	"decision" varchar(20) NOT NULL,
	"source" varchar(20) NOT NULL,
	"note" varchar(300),
	"resolved_by_id" text,
	"predictions_resolved" integer DEFAULT 0 NOT NULL,
	"challenges_settled" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating_history" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category_id" text,
	"power" numeric(6, 3) NOT NULL,
	"delta" numeric(6, 3) NOT NULL,
	"reason" varchar(80) NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_category_stat" (
	"user_id" text NOT NULL,
	"category_id" text NOT NULL,
	"prediction_power" numeric(6, 3) DEFAULT '40' NOT NULL,
	"completed_predictions" integer DEFAULT 0 NOT NULL,
	"correct_predictions" integer DEFAULT 0 NOT NULL,
	"difficulty_weight_sum" numeric(12, 5) DEFAULT '0' NOT NULL,
	"difficulty_score_sum" numeric(12, 5) DEFAULT '0' NOT NULL,
	"form_score" numeric(6, 5) DEFAULT '0.5' NOT NULL,
	"recent_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_category_stat_user_id_category_id_pk" PRIMARY KEY("user_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "user_rating" (
	"user_id" text PRIMARY KEY NOT NULL,
	"prediction_power" numeric(6, 3) DEFAULT '40' NOT NULL,
	"raw_accuracy" numeric(6, 5) DEFAULT '0' NOT NULL,
	"completed_predictions" integer DEFAULT 0 NOT NULL,
	"correct_predictions" integer DEFAULT 0 NOT NULL,
	"difficulty_weight_sum" numeric(12, 5) DEFAULT '0' NOT NULL,
	"difficulty_score_sum" numeric(12, 5) DEFAULT '0' NOT NULL,
	"form_score" numeric(6, 5) DEFAULT '0.5' NOT NULL,
	"recent_count" integer DEFAULT 0 NOT NULL,
	"last30_correct" integer DEFAULT 0 NOT NULL,
	"last30_total" integer DEFAULT 0 NOT NULL,
	"algorithm_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_outcome" ADD CONSTRAINT "event_outcome_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_template" ADD CONSTRAINT "event_template_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction" ADD CONSTRAINT "prediction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction" ADD CONSTRAINT "prediction_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction" ADD CONSTRAINT "prediction_outcome_id_event_outcome_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."event_outcome"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction" ADD CONSTRAINT "prediction_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_opponent_id_user_id_fk" FOREIGN KEY ("opponent_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_creator_outcome_id_event_outcome_id_fk" FOREIGN KEY ("creator_outcome_id") REFERENCES "public"."event_outcome"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_opponent_outcome_id_event_outcome_id_fk" FOREIGN KEY ("opponent_outcome_id") REFERENCES "public"."event_outcome"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_creator_prediction_id_prediction_id_fk" FOREIGN KEY ("creator_prediction_id") REFERENCES "public"."prediction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_opponent_prediction_id_prediction_id_fk" FOREIGN KEY ("opponent_prediction_id") REFERENCES "public"."prediction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_winner_user_id_user_id_fk" FOREIGN KEY ("winner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_resolution" ADD CONSTRAINT "event_resolution_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_resolution" ADD CONSTRAINT "event_resolution_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_category_stat" ADD CONSTRAINT "user_category_stat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_category_stat" ADD CONSTRAINT "user_category_stat_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_rating" ADD CONSTRAINT "user_rating_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_slug_key" ON "category" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "category_active_idx" ON "category" USING btree ("active","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "event_outcome_key_unique" ON "event_outcome" USING btree ("event_id","key");--> statement-breakpoint
CREATE INDEX "event_outcome_order_idx" ON "event_outcome" USING btree ("event_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "event_template_slug_key" ON "event_template" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "event_template_active_idx" ON "event_template" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "event_slug_key" ON "event" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "event_status_closes_idx" ON "event" USING btree ("status","closes_at");--> statement-breakpoint
CREATE INDEX "event_category_status_idx" ON "event" USING btree ("category_id","status");--> statement-breakpoint
CREATE INDEX "event_resolves_idx" ON "event" USING btree ("resolves_at","status");--> statement-breakpoint
CREATE INDEX "prediction_user_created_idx" ON "prediction" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "prediction_event_idx" ON "prediction" USING btree ("event_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "prediction_user_category_idx" ON "prediction" USING btree ("user_id","category_id","status");--> statement-breakpoint
CREATE INDEX "prediction_status_event_idx" ON "prediction" USING btree ("status","event_id");--> statement-breakpoint
CREATE INDEX "challenge_opponent_idx" ON "challenge" USING btree ("opponent_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "challenge_creator_idx" ON "challenge" USING btree ("creator_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "challenge_event_status_idx" ON "challenge" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "challenge_expiry_idx" ON "challenge" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coin_ledger_idempotency_key" ON "coin_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "coin_ledger_owner_idx" ON "coin_ledger" USING btree ("owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "coin_ledger_reference_idx" ON "coin_ledger" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_resolution_event_unique" ON "event_resolution" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "rating_history_user_idx" ON "rating_history" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "user_category_power_idx" ON "user_category_stat" USING btree ("category_id","prediction_power" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "user_rating_power_idx" ON "user_rating" USING btree ("prediction_power" DESC NULLS LAST,"completed_predictions" DESC NULLS LAST);