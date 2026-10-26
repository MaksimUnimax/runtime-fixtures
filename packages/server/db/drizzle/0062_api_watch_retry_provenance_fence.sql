-- C03 R10 SOURCE-ONLY draft. Do not apply to a live database independently of
-- the reviewed scheduler/fencing consumers and an operator-approved rollout.
-- Legacy Swagger next_run_at can be either periodic or an early retry: its
-- original regular deadline cannot be inferred. Preserve it for provenance.
ALTER TABLE "monitoring_lane_schedules"
  ADD COLUMN "ordinary_next_run_at" timestamp with time zone,
  ADD COLUMN "ordinary_due_provenance" varchar(16) NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "active_run_entered_at" timestamp with time zone,
  ADD COLUMN "active_run_trigger" varchar(16);
--> statement-breakpoint
ALTER TABLE "monitoring_lane_schedules"
  ADD CONSTRAINT "monitoring_ordinary_due_provenance_check"
  CHECK (
    ("ordinary_due_provenance" = 'KNOWN' AND "ordinary_next_run_at" IS NOT NULL)
    OR ("ordinary_due_provenance" = 'UNKNOWN' AND "ordinary_next_run_at" IS NULL)
  ),
  ADD CONSTRAINT "monitoring_active_trigger_check"
  CHECK ("active_run_trigger" IS NULL OR "active_run_id" IS NOT NULL),
  ADD CONSTRAINT "monitoring_entered_pair_check"
  CHECK ("active_run_entered_at" IS NULL OR "active_run_id" IS NOT NULL),
  ADD CONSTRAINT "monitoring_active_trigger_value_check"
  CHECK ("active_run_trigger" IS NULL OR "active_run_trigger" IN ('PERIODIC','RETRY','FORCED'));
--> statement-breakpoint
-- Do not backfill ordinary_next_run_at from any legacy next_run_at.
-- SWAGGER_API might have been advanced by a now-revoked family retry.
-- LLM continues to use its unchanged next_run_at field; the new columns
-- are reserved for the separately reviewed Swagger source/runtime consumer.
-- UNKNOWN is a hold state for new Swagger scheduling until a trusted baseline.
CREATE TABLE "api_watch_family_attempt_fences" (
  "source_family" varchar(32) PRIMARY KEY NOT NULL,
  "claimed_run_id" uuid,
  "claimed_lease_expires_at" timestamp with time zone,
  "claim_stage" varchar(16) NOT NULL DEFAULT 'IDLE',
  "claimed_at" timestamp with time zone,
  "entered_at" timestamp with time zone,
  "outcome_unknown" boolean NOT NULL DEFAULT false,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "api_watch_family_attempt_source_check"
    CHECK ("source_family" IN ('OZON_SELLER','OZON_PERFORMANCE','WILDBERRIES')),
  CONSTRAINT "api_watch_family_claim_stage_check"
    CHECK (
      ("claim_stage" = 'IDLE' AND "claimed_run_id" IS NULL AND "claimed_lease_expires_at" IS NULL AND "claimed_at" IS NULL AND "entered_at" IS NULL)
      OR
      ("claim_stage" = 'CLAIMED' AND "claimed_run_id" IS NOT NULL AND "claimed_lease_expires_at" IS NOT NULL AND "claimed_at" IS NOT NULL AND "entered_at" IS NULL)
      OR
      ("claim_stage" = 'ENTERED' AND "claimed_run_id" IS NOT NULL AND "claimed_lease_expires_at" IS NOT NULL AND "claimed_at" IS NOT NULL AND "entered_at" IS NOT NULL)
    ),
  CONSTRAINT "api_watch_family_unknown_idle_check"
    CHECK (NOT "outcome_unknown" OR "claim_stage" = 'IDLE'),
  CONSTRAINT "api_watch_family_claim_lease_valid_check"
    CHECK ("claimed_lease_expires_at" IS NULL OR ("claimed_at" IS NOT NULL AND "claimed_lease_expires_at" > "claimed_at"))
);
--> statement-breakpoint
INSERT INTO "api_watch_family_attempt_fences" ("source_family")
VALUES ('OZON_SELLER'),('OZON_PERFORMANCE'),('WILDBERRIES');
--> statement-breakpoint
-- Migration cannot prove whether a pending previous-generation retry was
-- already sent. Hold these families for explicit resolution, not auto-replay.
UPDATE "api_watch_family_attempt_fences" AS fence
SET "outcome_unknown" = true, "updated_at" = now()
WHERE EXISTS (
  SELECT 1 FROM "api_watch_retry_state" AS retry
  WHERE retry."source_family" = fence."source_family"
  AND retry."next_retry_at" IS NOT NULL
);
--> statement-breakpoint
-- A legacy active Swagger execution may be in-flight during migration.
-- Conservatively quarantine all families until an operator verifies its fate.
UPDATE "api_watch_family_attempt_fences"
SET "outcome_unknown" = true, "updated_at" = now()
WHERE EXISTS (
  SELECT 1 FROM "monitoring_lane_schedules"
  WHERE "lane" = 'SWAGGER_API' AND "active_run_id" IS NOT NULL
);
