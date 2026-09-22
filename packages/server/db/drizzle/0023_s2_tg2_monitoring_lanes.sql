CREATE TABLE "monitoring_lane_schedules" (
  "lane" varchar(32) PRIMARY KEY NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "interval_seconds" integer NOT NULL,
  "next_run_at" timestamp with time zone NOT NULL,
  "last_run_at" timestamp with time zone,
  "active_run_id" uuid,
  "active_run_source" varchar(16),
  "active_run_started_at" timestamp with time zone,
  "active_run_lease_expires_at" timestamp with time zone,
  "last_result" jsonb,
  "notification_failure_count" integer NOT NULL DEFAULT 0,
  "last_notification_error" varchar(160),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "monitoring_lane_schedules_lane_check" CHECK ("lane" IN ('LLM','SWAGGER_API')),
  CONSTRAINT "monitoring_lane_schedules_interval_check" CHECK ("interval_seconds" >= 300 AND "interval_seconds" <= 2592000),
  CONSTRAINT "monitoring_lane_schedules_active_pair_check" CHECK (("active_run_id" IS NULL AND "active_run_source" IS NULL AND "active_run_started_at" IS NULL AND "active_run_lease_expires_at" IS NULL) OR ("active_run_id" IS NOT NULL AND "active_run_source" IS NOT NULL AND "active_run_started_at" IS NOT NULL AND "active_run_lease_expires_at" IS NOT NULL)),
  CONSTRAINT "monitoring_lane_schedules_result_object_check" CHECK ("last_result" IS NULL OR jsonb_typeof("last_result") = 'object')
);
--> statement-breakpoint
CREATE INDEX "monitoring_lane_schedules_due_index" ON "monitoring_lane_schedules" USING btree ("enabled", "next_run_at");
