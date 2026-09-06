CREATE TYPE "public"."feed_item_kind" AS ENUM('PREDICTION_CREATED', 'CHALLENGE_CREATED', 'CHALLENGE_COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('CHALLENGE_RECEIVED', 'CHALLENGE_ACCEPTED', 'CHALLENGE_DECLINED', 'CHALLENGE_COMPLETED', 'PREDICTION_CORRECT', 'PREDICTION_INCORRECT', 'RATING_CHANGED', 'NEW_FOLLOWER', 'FOLLOWED_USER_PREDICTION', 'BADGE_EARNED', 'SEASON_RESULT');--> statement-breakpoint
CREATE TYPE "public"."reaction_kind" AS ENUM('LIKE', 'FIRE', 'CLAP');--> statement-breakpoint
CREATE TYPE "public"."reaction_target" AS ENUM('PREDICTION', 'EVENT');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('SPAM', 'ABUSE', 'IMPERSONATION', 'CHEATING', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('OPEN', 'REVIEWED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."badge_rule" AS ENUM('CORRECT_PREDICTIONS', 'CHALLENGE_WINS', 'PREDICTION_POWER', 'COMPLETED_PREDICTIONS', 'CATEGORY_EXPERT', 'LEADERBOARD_RANK');--> statement-breakpoint
CREATE TYPE "public"."leaderboard_period" AS ENUM('WEEKLY', 'MONTHLY', 'SEASON', 'ALL_TIME');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('UPCOMING', 'ACTIVE', 'CLOSED');--> statement-breakpoint
ALTER TYPE "public"."settlement_kind" ADD VALUE 'REFUND_CREATOR';--> statement-breakpoint
CREATE TABLE "block" (
	"blocker_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "block_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id")
);
--> statement-breakpoint
CREATE TABLE "feed_item" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"kind" "feed_item_kind" NOT NULL,
	"event_id" text,
	"prediction_id" text,
	"challenge_id" text,
	"category_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow" (
	"follower_id" text NOT NULL,
	"following_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_follower_id_following_id_pk" PRIMARY KEY("follower_id","following_id")
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"actor_id" text,
	"body" varchar(300) NOT NULL,
	"href" varchar(200),
	"payload" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" varchar(160) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reaction" (
	"user_id" text NOT NULL,
	"target_type" "reaction_target" NOT NULL,
	"target_id" text NOT NULL,
	"kind" "reaction_kind" DEFAULT 'LIKE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reaction_user_id_target_type_target_id_pk" PRIMARY KEY("user_id","target_type","target_id")
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" text PRIMARY KEY NOT NULL,
	"reporter_id" text NOT NULL,
	"target_type" varchar(20) NOT NULL,
	"target_id" text NOT NULL,
	"reason" "report_reason" NOT NULL,
	"note" varchar(500),
	"status" "report_status" DEFAULT 'OPEN' NOT NULL,
	"reviewed_by_id" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "badge" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar(60) NOT NULL,
	"name" varchar(60) NOT NULL,
	"description" varchar(200) NOT NULL,
	"icon" varchar(8) NOT NULL,
	"rule" "badge_rule" NOT NULL,
	"rule_config" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaderboard_entry" (
	"snapshot_id" text NOT NULL,
	"user_id" text NOT NULL,
	"rank" integer NOT NULL,
	"power" numeric(6, 3) NOT NULL,
	"completed_predictions" integer NOT NULL,
	"correct_predictions" integer NOT NULL,
	CONSTRAINT "leaderboard_entry_snapshot_id_user_id_pk" PRIMARY KEY("snapshot_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "leaderboard_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"period" "leaderboard_period" NOT NULL,
	"category_id" text,
	"season_id" text,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"min_predictions" integer NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"slug" varchar(60) NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" "season_status" DEFAULT 'UPCOMING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trending_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"rank" integer NOT NULL,
	"score" numeric(12, 4) NOT NULL,
	"recent_predictions" integer DEFAULT 0 NOT NULL,
	"recent_challenges" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_badge" (
	"user_id" text NOT NULL,
	"badge_id" text NOT NULL,
	"season_id" text,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_badge_user_id_badge_id_pk" PRIMARY KEY("user_id","badge_id")
);
--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_blocker_id_user_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_blocked_id_user_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_item" ADD CONSTRAINT "feed_item_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_item" ADD CONSTRAINT "feed_item_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_item" ADD CONSTRAINT "feed_item_prediction_id_prediction_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."prediction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_item" ADD CONSTRAINT "feed_item_challenge_id_challenge_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_item" ADD CONSTRAINT "feed_item_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow" ADD CONSTRAINT "follow_follower_id_user_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow" ADD CONSTRAINT "follow_following_id_user_id_fk" FOREIGN KEY ("following_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_reviewed_by_id_user_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entry" ADD CONSTRAINT "leaderboard_entry_snapshot_id_leaderboard_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."leaderboard_snapshot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entry" ADD CONSTRAINT "leaderboard_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_snapshot" ADD CONSTRAINT "leaderboard_snapshot_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_snapshot" ADD CONSTRAINT "leaderboard_snapshot_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trending_snapshot" ADD CONSTRAINT "trending_snapshot_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badge" ADD CONSTRAINT "user_badge_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badge" ADD CONSTRAINT "user_badge_badge_id_badge_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."badge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badge" ADD CONSTRAINT "user_badge_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "block_blocked_idx" ON "block" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "feed_actor_created_idx" ON "feed_item" USING btree ("actor_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "feed_created_idx" ON "feed_item" USING btree ("created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "follow_following_idx" ON "follow" USING btree ("following_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "follow_follower_idx" ON "follow" USING btree ("follower_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedupe_key" ON "notification" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_unread_idx" ON "notification" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "reaction_target_idx" ON "reaction" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_once_per_target" ON "report" USING btree ("reporter_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "report_status_idx" ON "report" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "badge_slug_key" ON "badge" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "badge_active_idx" ON "badge" USING btree ("active");--> statement-breakpoint
CREATE INDEX "leaderboard_entry_rank_idx" ON "leaderboard_entry" USING btree ("snapshot_id","rank");--> statement-breakpoint
CREATE INDEX "leaderboard_entry_user_idx" ON "leaderboard_entry" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_snapshot_unique" ON "leaderboard_snapshot" USING btree ("period","category_id","period_start");--> statement-breakpoint
CREATE INDEX "leaderboard_snapshot_lookup" ON "leaderboard_snapshot" USING btree ("period","category_id","generated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "season_slug_key" ON "season" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "season_status_idx" ON "season" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "trending_event_unique" ON "trending_snapshot" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "trending_rank_idx" ON "trending_snapshot" USING btree ("rank");--> statement-breakpoint
CREATE INDEX "user_badge_user_idx" ON "user_badge" USING btree ("user_id","awarded_at" DESC NULLS LAST);