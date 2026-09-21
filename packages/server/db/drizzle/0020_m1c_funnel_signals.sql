ALTER TYPE "feedback_signal_event" ADD VALUE IF NOT EXISTS 'feedback_case_triaged';
ALTER TYPE "feedback_signal_event" ADD VALUE IF NOT EXISTS 'feedback_case_closed';

ALTER TABLE "feedback_signal_events"
  ADD COLUMN "schema_version" integer NOT NULL DEFAULT 1,
  ADD COLUMN "account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE RESTRICT,
  ADD COLUMN "device_id" uuid REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE RESTRICT,
  ADD COLUMN "subject_id" uuid,
  ADD COLUMN "idempotency_key" varchar(128),
  ADD COLUMN "payload_hash" varchar(64),
  ADD COLUMN "release_identity" varchar(128),
  ADD COLUMN "browser_version" varchar(64),
  ADD COLUMN "marketplace" "feedback_marketplace",
  ADD COLUMN "support_code" varchar(128);

UPDATE "feedback_signal_events"
SET "idempotency_key" = 'legacy-' || "id"::text,
    "payload_hash" = repeat('0', 64)
WHERE "idempotency_key" IS NULL;

ALTER TABLE "feedback_signal_events"
  ALTER COLUMN "idempotency_key" SET NOT NULL,
  ALTER COLUMN "payload_hash" SET NOT NULL;

CREATE UNIQUE INDEX "feedback_signal_events_idempotency_key_unique"
  ON "feedback_signal_events" ("idempotency_key");
CREATE UNIQUE INDEX "feedback_signal_events_account_first_milestone_unique"
  ON "feedback_signal_events" ("account_id", "event")
  WHERE "account_id" IS NOT NULL AND "event" IN (
    'registration_started', 'account_created', 'device_activated',
    'first_store_added', 'first_start'
  );
CREATE INDEX "feedback_signal_events_funnel_filter_index"
  ON "feedback_signal_events" ("occurred_at", "event", "account_id", "subject_id", "marketplace");
