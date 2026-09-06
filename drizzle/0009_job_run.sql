CREATE TYPE "public"."job_status" AS ENUM('RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE "job_run" (
	"id" text PRIMARY KEY NOT NULL,
	"job_name" varchar(60) NOT NULL,
	"status" "job_status" DEFAULT 'RUNNING' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"report" jsonb,
	"error" varchar(500),
	"correlation_id" varchar(40)
);
--> statement-breakpoint
CREATE INDEX "job_run_name_idx" ON "job_run" USING btree ("job_name","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "job_run_status_idx" ON "job_run" USING btree ("status","started_at" DESC NULLS LAST);