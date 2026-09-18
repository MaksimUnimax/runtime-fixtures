CREATE TYPE "public"."health_probe_layer" AS ENUM ('NO_SESSION', 'AUTHENTICATED_DEEP');
--> statement-breakpoint
CREATE TYPE "public"."health_scheduled_run_state" AS ENUM ('PENDING', 'CLAIMED', 'RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'TIMED_OUT', 'CANCELLED');
--> statement-breakpoint
CREATE TYPE "public"."health_failure_class" AS ENUM ('TRANSIENT_ENVIRONMENT', 'PROVIDER_ACCESS_OR_NETWORK', 'BROWSER_UNAVAILABLE', 'TERMINAL_CONFIGURATION', 'PROVEN_PRODUCT_DRIFT', 'MAINTENANCE');
--> statement-breakpoint
ALTER TABLE "health_runs" ADD COLUMN "scheduled_run_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX "health_runs_scheduled_run_unique" ON "health_runs" USING btree ("scheduled_run_id");
--> statement-breakpoint
CREATE TABLE "health_schedules" (
  "id" uuid PRIMARY KEY NOT NULL,
  "monitor_target" varchar(128) NOT NULL,
  "provider" varchar(32) NOT NULL,
  "surface" varchar(64) NOT NULL,
  "probe_layer" "health_probe_layer" NOT NULL,
  "enabled" boolean NOT NULL,
  "cadence" jsonb NOT NULL,
  "next_due_at" timestamp with time zone NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "revision" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "health_schedules_target_revision_unique" UNIQUE("monitor_target", "revision"),
  CONSTRAINT "health_schedules_target_format" CHECK ("monitor_target" ~ '^[a-z][a-z0-9_]{0,127}$'),
  CONSTRAINT "health_schedules_provider_format" CHECK ("provider" ~ '^[a-z][a-z0-9_]{0,31}$'),
  CONSTRAINT "health_schedules_surface_format" CHECK ("surface" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT "health_schedules_revision_positive" CHECK ("revision" > 0),
  CONSTRAINT "health_schedules_cadence_object" CHECK (jsonb_typeof("cadence") = 'object')
);
--> statement-breakpoint
CREATE INDEX "health_schedules_due_index" ON "health_schedules" USING btree ("enabled", "next_due_at");
--> statement-breakpoint
CREATE TABLE "health_scheduled_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "schedule_id" uuid NOT NULL,
  "monitor_target" varchar(128) NOT NULL,
  "provider" varchar(32) NOT NULL,
  "surface" varchar(64) NOT NULL,
  "probe_layer" "health_probe_layer" NOT NULL,
  "schedule_revision" integer NOT NULL,
  "due_slot_at" timestamp with time zone NOT NULL,
  "idempotency_key" varchar(64) NOT NULL,
  "state" "health_scheduled_run_state" NOT NULL,
  "owner_id" varchar(128),
  "lease_id" uuid,
  "claimed_at" timestamp with time zone,
  "lease_expires_at" timestamp with time zone,
  "timeout_at" timestamp with time zone,
  "attempt" integer NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "next_attempt_at" timestamp with time zone,
  "failure_class" "health_failure_class",
  "failure_code" varchar(128),
  "health_run_id" uuid,
  "health_state" varchar(16),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "health_scheduled_runs_schedule_fk" FOREIGN KEY ("schedule_id") REFERENCES "health_schedules"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "health_scheduled_runs_health_run_fk" FOREIGN KEY ("health_run_id") REFERENCES "health_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "health_scheduled_runs_idempotency_unique" UNIQUE("schedule_id", "schedule_revision", "due_slot_at", "monitor_target"),
  CONSTRAINT "health_scheduled_runs_key_unique" UNIQUE("idempotency_key"),
  CONSTRAINT "health_scheduled_runs_health_run_unique" UNIQUE("health_run_id"),
  CONSTRAINT "health_scheduled_runs_revision_positive" CHECK ("schedule_revision" > 0),
  CONSTRAINT "health_scheduled_runs_attempt_positive" CHECK ("attempt" > 0),
  CONSTRAINT "health_scheduled_runs_health_state" CHECK ("health_state" IS NULL OR "health_state" IN ('HEALTHY', 'DRIFT', 'DEGRADED', 'BROKEN', 'UNKNOWN', 'MAINTENANCE'))
);
--> statement-breakpoint
CREATE INDEX "health_scheduled_runs_claim_index" ON "health_scheduled_runs" USING btree ("state", "next_attempt_at", "lease_expires_at");
--> statement-breakpoint
CREATE INDEX "health_scheduled_runs_schedule_index" ON "health_scheduled_runs" USING btree ("schedule_id", "due_slot_at" DESC);
