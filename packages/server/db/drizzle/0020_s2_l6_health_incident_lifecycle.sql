-- S2-L6 incident lifecycle is additive. Existing physical incidents remain
-- rows in the same authority; old rows receive a deterministic legacy key.
ALTER TABLE "health_incidents" ADD COLUMN "incident_scope_sha256" varchar(64);
--> statement-breakpoint
ALTER TABLE "health_incidents" ADD COLUMN "incident_key_sha256" varchar(64);
--> statement-breakpoint
ALTER TABLE "health_incidents" ADD COLUMN "last_observed_run_id" uuid;
--> statement-breakpoint
ALTER TABLE "health_incidents" ADD COLUMN "last_observed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "health_incidents" ADD COLUMN "resolved_by_run_id" uuid;
--> statement-breakpoint
ALTER TABLE "health_incidents" ADD COLUMN "resolved_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "health_incidents"
SET
  -- Existing rows predate the structured incident identity. The two MD5
  -- halves are a deterministic 64-hex compatibility fingerprint only; new
  -- lifecycle rows use application SHA-256 identity authority.
  incident_scope_sha256 = md5('legacy-v1:scope:' || scope_sha256) || md5('legacy-v1:scope-v2:' || scope_sha256),
  incident_key_sha256 = md5('legacy-v1:key:' || scope_sha256 || ':' || COALESCE(root_contour_key, '')) || md5('legacy-v1:key-v2:' || scope_sha256 || ':' || COALESCE(root_contour_key, '')),
  last_observed_run_id = latest_seen_run_id,
  last_observed_at = last_seen_at
WHERE incident_scope_sha256 IS NULL;
--> statement-breakpoint
ALTER TABLE "health_incidents" ALTER COLUMN "incident_scope_sha256" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "health_incidents" ALTER COLUMN "incident_key_sha256" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "health_incidents" ALTER COLUMN "last_observed_run_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "health_incidents" ALTER COLUMN "last_observed_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "health_incidents"
  ADD CONSTRAINT "health_incidents_last_observed_run_fk"
  FOREIGN KEY ("last_observed_run_id") REFERENCES "health_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE "health_incidents"
  ADD CONSTRAINT "health_incidents_resolved_run_fk"
  FOREIGN KEY ("resolved_by_run_id") REFERENCES "health_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE "health_incidents"
  ADD CONSTRAINT "health_incidents_incident_scope_checksum_format"
  CHECK ("incident_scope_sha256" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
ALTER TABLE "health_incidents"
  ADD CONSTRAINT "health_incidents_incident_key_checksum_format"
  CHECK ("incident_key_sha256" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
ALTER TABLE "health_incidents"
  ADD CONSTRAINT "health_incidents_last_observed_after_first"
  CHECK ("last_observed_at" >= "first_seen_at");
--> statement-breakpoint
ALTER TABLE "health_incidents"
  ADD CONSTRAINT "health_incidents_resolution_pair"
  CHECK (("resolved_by_run_id" IS NULL AND "resolved_at" IS NULL) OR ("resolved_by_run_id" IS NOT NULL AND "resolved_at" IS NOT NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX "health_incidents_active_key_unique"
  ON "health_incidents" USING btree ("incident_key_sha256")
  WHERE "status" IN ('OPEN', 'INVESTIGATING', 'CANDIDATE_FIX', 'CANDIDATE_PASS', 'CANARY_ROLLOUT', 'ROLLOUT', 'MAINTENANCE');
--> statement-breakpoint
CREATE INDEX "health_incidents_scope_status_index"
  ON "health_incidents" USING btree ("incident_scope_sha256", "status", "last_observed_at" DESC);
