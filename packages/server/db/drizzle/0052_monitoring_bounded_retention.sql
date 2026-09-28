CREATE TABLE "health_no_session_run_receipts" (
  "run_id" uuid PRIMARY KEY NOT NULL,
  "scheduled_run_id" uuid NOT NULL,
  "schedule_id" uuid NOT NULL,
  "schedule_revision" integer NOT NULL,
  "due_slot_at" timestamp with time zone NOT NULL,
  "idempotency_key" varchar(64) NOT NULL,
  "monitor_target" varchar(128) NOT NULL,
  "health_state" varchar(16) NOT NULL,
  "scope_sha256" varchar(64) NOT NULL,
  "callback_result_sha256" varchar(64) NOT NULL,
  "normalized_result_sha256" varchar(64),
  "adapter_id" uuid NOT NULL,
  "surface_id" uuid NOT NULL,
  "variant_id" uuid,
  "profile_id" uuid NOT NULL,
  "profile_revision_id" uuid NOT NULL,
  "profile_revision" integer NOT NULL,
  "browser_family" varchar(32) NOT NULL,
  "completed_at" timestamp with time zone NOT NULL,
  "projection_applied_at" timestamp with time zone,
  "incident_processed_at" timestamp with time zone,
  "payload_pruned_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "health_no_session_run_receipts_schedule_fk" FOREIGN KEY ("schedule_id") REFERENCES "health_schedules"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "health_no_session_run_receipts_scheduled_fk" FOREIGN KEY ("scheduled_run_id") REFERENCES "health_scheduled_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "health_no_session_run_receipts_scheduled_unique" UNIQUE("scheduled_run_id"),
  CONSTRAINT "health_no_session_run_receipts_idempotency_unique" UNIQUE("idempotency_key"),
  CONSTRAINT "health_no_session_run_receipts_schedule_revision_positive" CHECK ("schedule_revision" > 0),
  CONSTRAINT "health_no_session_run_receipts_profile_revision_positive" CHECK ("profile_revision" > 0),
  CONSTRAINT "health_no_session_run_receipts_health_state" CHECK ("health_state" IN ('HEALTHY','DRIFT','DEGRADED','BROKEN','UNKNOWN','MAINTENANCE')),
  CONSTRAINT "health_no_session_run_receipts_scope_sha256" CHECK ("scope_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "health_no_session_run_receipts_callback_sha256" CHECK ("callback_result_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "health_no_session_run_receipts_normalized_sha256" CHECK ("normalized_result_sha256" IS NULL OR "normalized_result_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "health_no_session_run_receipts_projection_pair" CHECK (("normalized_result_sha256" IS NULL AND "projection_applied_at" IS NULL) OR ("normalized_result_sha256" IS NOT NULL AND "projection_applied_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "health_no_session_run_receipts_scope_completed_index" ON "health_no_session_run_receipts" ("scope_sha256","completed_at" DESC);
--> statement-breakpoint
CREATE TABLE "health_no_session_scope_states" (
  "scope_sha256" varchar(64) PRIMARY KEY NOT NULL,
  "provider_id" varchar(32) NOT NULL,
  "observation_surface_id" varchar(64) NOT NULL,
  "target_key" varchar(64) NOT NULL,
  "strategy_id" varchar(64) NOT NULL,
  "strategy_revision" integer NOT NULL,
  "browser_family" varchar(32) NOT NULL,
  "latest_run_id" uuid NOT NULL,
  "latest_normalized_result_sha256" varchar(64) NOT NULL,
  "latest_health_state" varchar(16) NOT NULL,
  "latest_classification_basis" varchar(64) NOT NULL,
  "latest_surface_outcome" varchar(64) NOT NULL,
  "latest_blocker" varchar(64) NOT NULL,
  "latest_observed_at" timestamp with time zone NOT NULL,
  "last_attempt_at" timestamp with time zone NOT NULL,
  "last_verified_at" timestamp with time zone,
  "accepted_baseline_run_id" uuid,
  "accepted_baseline_result_sha256" varchar(64),
  "accepted_baseline_health_state" varchar(16),
  "accepted_baseline_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "health_no_session_scope_states_scope_sha256" CHECK ("scope_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "health_no_session_scope_states_strategy_revision_positive" CHECK ("strategy_revision" > 0),
  CONSTRAINT "health_no_session_scope_states_latest_sha256" CHECK ("latest_normalized_result_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "health_no_session_scope_states_latest_health_state" CHECK ("latest_health_state" IN ('HEALTHY','DRIFT','DEGRADED','BROKEN','UNKNOWN','MAINTENANCE')),
  CONSTRAINT "health_no_session_scope_states_baseline_shape" CHECK (
    ("accepted_baseline_run_id" IS NULL AND "accepted_baseline_result_sha256" IS NULL AND "accepted_baseline_health_state" IS NULL AND "accepted_baseline_at" IS NULL)
    OR
    ("accepted_baseline_run_id" IS NOT NULL AND "accepted_baseline_result_sha256" ~ '^[0-9a-f]{64}$' AND "accepted_baseline_health_state"='HEALTHY' AND "accepted_baseline_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "health_no_session_scope_states_target_index" ON "health_no_session_scope_states" ("provider_id","observation_surface_id","target_key");
--> statement-breakpoint
CREATE TABLE "health_no_session_recent_states" (
  "scope_sha256" varchar(64) NOT NULL,
  "slot" integer NOT NULL,
  "normalized_result_sha256" varchar(64) NOT NULL,
  "health_state" varchar(16) NOT NULL,
  "classification_basis" varchar(64) NOT NULL,
  "surface_outcome" varchar(64) NOT NULL,
  "blocker" varchar(64) NOT NULL,
  "summary" jsonb NOT NULL,
  "first_seen_at" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  "repeat_count" integer NOT NULL DEFAULT 1,
  "latest_run_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "health_no_session_recent_states_scope_fk" FOREIGN KEY ("scope_sha256") REFERENCES "health_no_session_scope_states"("scope_sha256") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "health_no_session_recent_states_pk" PRIMARY KEY("scope_sha256","slot"),
  CONSTRAINT "health_no_session_recent_states_fingerprint_unique" UNIQUE("scope_sha256","normalized_result_sha256"),
  CONSTRAINT "health_no_session_recent_states_slot" CHECK ("slot" BETWEEN 1 AND 3),
  CONSTRAINT "health_no_session_recent_states_sha256" CHECK ("normalized_result_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "health_no_session_recent_states_health_state" CHECK ("health_state" IN ('HEALTHY','DRIFT','DEGRADED','BROKEN','UNKNOWN','MAINTENANCE')),
  CONSTRAINT "health_no_session_recent_states_summary" CHECK (jsonb_typeof("summary")='object' AND pg_column_size("summary") <= 4096),
  CONSTRAINT "health_no_session_recent_states_repeat_positive" CHECK ("repeat_count" > 0),
  CONSTRAINT "health_no_session_recent_states_seen_order" CHECK ("last_seen_at" >= "first_seen_at")
);
--> statement-breakpoint
CREATE INDEX "health_no_session_recent_states_recent_index" ON "health_no_session_recent_states" ("scope_sha256","last_seen_at" DESC,"slot");
--> statement-breakpoint
INSERT INTO "health_no_session_run_receipts"(
  run_id,scheduled_run_id,schedule_id,schedule_revision,due_slot_at,idempotency_key,monitor_target,
  health_state,scope_sha256,callback_result_sha256,adapter_id,surface_id,variant_id,profile_id,
  profile_revision_id,profile_revision,browser_family,completed_at
)
SELECT h.id,h.scheduled_run_id,s.schedule_id,s.schedule_revision,s.due_slot_at,s.idempotency_key,s.monitor_target,
       h.health_state,h.scope_sha256,o.result_sha256,h.adapter_id,h.surface_id,h.variant_id,h.profile_id,
       h.profile_revision_id,h.profile_revision,h.browser_family,h.completed_at
FROM health_runs h
JOIN health_no_session_observations o ON o.run_id=h.id
JOIN health_scheduled_runs s ON s.id=h.scheduled_run_id
WHERE h.run_kind='NO_SESSION_OBSERVATION'
ON CONFLICT (run_id) DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION health_no_session_run_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE'
     AND (to_jsonb(NEW) - ARRAY['normalized_result_sha256','projection_applied_at','incident_processed_at','payload_pruned_at'])
       = (to_jsonb(OLD) - ARRAY['normalized_result_sha256','projection_applied_at','incident_processed_at','payload_pruned_at'])
     AND (OLD.normalized_result_sha256 IS NULL OR NEW.normalized_result_sha256=OLD.normalized_result_sha256)
     AND (OLD.projection_applied_at IS NULL OR NEW.projection_applied_at=OLD.projection_applied_at)
     AND (OLD.incident_processed_at IS NULL OR NEW.incident_processed_at=OLD.incident_processed_at)
     AND (OLD.payload_pruned_at IS NULL OR NEW.payload_pruned_at=OLD.payload_pruned_at)
     AND ((NEW.normalized_result_sha256 IS NULL AND NEW.projection_applied_at IS NULL) OR (NEW.normalized_result_sha256 IS NOT NULL AND NEW.projection_applied_at IS NOT NULL))
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'health no-session run receipts are append/monotonic only' USING ERRCODE='55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER health_no_session_run_receipt_guard
BEFORE UPDATE OR DELETE ON "health_no_session_run_receipts"
FOR EACH ROW EXECUTE FUNCTION health_no_session_run_receipt_guard();
--> statement-breakpoint
CREATE FUNCTION health_no_session_payload_gc_allowed(candidate_run_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM health_no_session_run_receipts receipt
    JOIN health_runs run ON run.id=receipt.run_id
    JOIN health_scheduled_runs scheduled ON scheduled.id=receipt.scheduled_run_id
    WHERE receipt.run_id=candidate_run_id
      AND receipt.payload_pruned_at IS NOT NULL
      AND receipt.projection_applied_at IS NOT NULL
      AND receipt.incident_processed_at IS NOT NULL
      AND run.run_kind='NO_SESSION_OBSERVATION'
      AND scheduled.state='SUCCEEDED'
      AND scheduled.health_run_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM health_incidents incident
        WHERE incident.first_seen_run_id=candidate_run_id
           OR incident.latest_seen_run_id=candidate_run_id
           OR incident.last_observed_run_id=candidate_run_id
           OR incident.resolved_by_run_id=candidate_run_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM health_notification_intents notification
        WHERE notification.health_run_id=candidate_run_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM health_no_session_scope_states state
        WHERE state.accepted_baseline_run_id=candidate_run_id
           OR state.latest_run_id=candidate_run_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM health_no_session_recent_states recent
        WHERE recent.latest_run_id=candidate_run_id
      )
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION health_no_session_evidence_mutation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND health_no_session_payload_gc_allowed(OLD.run_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'health no-session evidence references are immutable' USING ERRCODE='55000';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION health_no_session_observation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND health_no_session_payload_gc_allowed(OLD.run_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'health no-session observations are immutable' USING ERRCODE='55000';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION p8_2_health_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.run_kind='NO_SESSION_OBSERVATION' AND health_no_session_payload_gc_allowed(OLD.id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'P8.2 completed health runs are immutable' USING ERRCODE='55000';
END;
$$;
--> statement-breakpoint
CREATE TABLE "health_schedule_retention_watermarks" (
  "schedule_id" uuid PRIMARY KEY NOT NULL,
  "retired_through_revision" integer NOT NULL,
  "retired_through_due_slot_at" timestamp with time zone NOT NULL,
  "retired_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "health_schedule_retention_watermarks_schedule_fk" FOREIGN KEY ("schedule_id") REFERENCES "health_schedules"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "health_schedule_retention_watermarks_revision_positive" CHECK ("retired_through_revision" > 0)
);
--> statement-breakpoint
CREATE FUNCTION health_schedule_retention_watermark_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  safe_retirement boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'health schedule retention watermarks are non-deletable' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' AND NOT (
    NEW.schedule_id=OLD.schedule_id
    AND (
      NEW.retired_through_revision > OLD.retired_through_revision
      OR (
        NEW.retired_through_revision = OLD.retired_through_revision
        AND NEW.retired_through_due_slot_at > OLD.retired_through_due_slot_at
      )
    )
    AND NEW.retired_at >= OLD.retired_at
    AND NEW.updated_at >= OLD.updated_at
  ) THEN
    RAISE EXCEPTION 'health schedule retention watermarks are monotonic' USING ERRCODE='55000';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM health_scheduled_runs scheduled
    WHERE scheduled.schedule_id=NEW.schedule_id
      AND scheduled.schedule_revision=NEW.retired_through_revision
      AND scheduled.due_slot_at=NEW.retired_through_due_slot_at
      AND (
        (
          scheduled.state='SUCCEEDED'
          AND scheduled.health_run_id IS NULL
          AND EXISTS (
            SELECT 1 FROM health_no_session_run_receipts receipt
            WHERE receipt.scheduled_run_id=scheduled.id
              AND receipt.payload_pruned_at IS NOT NULL
          )
          AND NOT EXISTS (SELECT 1 FROM health_runs run WHERE run.scheduled_run_id=scheduled.id)
        )
        OR
        (
          scheduled.state IN ('FAILED_TERMINAL','CANCELLED')
          AND scheduled.health_run_id IS NULL
          AND scheduled.next_attempt_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM health_runs run WHERE run.scheduled_run_id=scheduled.id)
          AND NOT EXISTS (
            SELECT 1 FROM health_no_session_run_receipts receipt
            WHERE receipt.scheduled_run_id=scheduled.id
          )
        )
      )
  ) INTO safe_retirement;
  IF NOT safe_retirement THEN
    RAISE EXCEPTION 'health schedule retention watermark lacks safe terminal authority' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER health_schedule_retention_watermark_guard
BEFORE INSERT OR UPDATE OR DELETE ON "health_schedule_retention_watermarks"
FOR EACH ROW EXECUTE FUNCTION health_schedule_retention_watermark_guard();
--> statement-breakpoint
CREATE FUNCTION health_scheduled_run_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id=OLD.id
     AND NEW.schedule_id=OLD.schedule_id
     AND NEW.monitor_target=OLD.monitor_target
     AND NEW.provider=OLD.provider
     AND NEW.surface=OLD.surface
     AND NEW.probe_layer=OLD.probe_layer
     AND NEW.schedule_revision=OLD.schedule_revision
     AND NEW.due_slot_at=OLD.due_slot_at
     AND NEW.idempotency_key=OLD.idempotency_key
     AND NEW.created_at=OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'health scheduled run identity is immutable' USING ERRCODE='55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER health_scheduled_run_identity_guard
BEFORE UPDATE ON "health_scheduled_runs"
FOR EACH ROW EXECUTE FUNCTION health_scheduled_run_identity_guard();
--> statement-breakpoint
CREATE FUNCTION health_scheduled_run_retention_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM health_schedule_retention_watermarks watermark
    WHERE watermark.schedule_id=OLD.schedule_id
      AND (
        watermark.retired_through_revision > OLD.schedule_revision
        OR (
          watermark.retired_through_revision=OLD.schedule_revision
          AND watermark.retired_through_due_slot_at >= OLD.due_slot_at
        )
      )
  )
  AND OLD.state IN ('SUCCEEDED','FAILED_TERMINAL','CANCELLED')
  AND OLD.health_run_id IS NULL
  AND OLD.next_attempt_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM health_runs persisted
    WHERE persisted.scheduled_run_id=OLD.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM health_no_session_run_receipts receipt
    WHERE receipt.scheduled_run_id=OLD.id
  )
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'health scheduled run deletion requires retired watermark and no persisted replay authority' USING ERRCODE='55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER health_scheduled_run_retention_delete_guard
BEFORE DELETE ON "health_scheduled_runs"
FOR EACH ROW EXECUTE FUNCTION health_scheduled_run_retention_delete_guard();
--> statement-breakpoint
CREATE FUNCTION health_no_session_payload_mark_allowed(candidate_run_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM health_no_session_run_receipts receipt
    JOIN health_runs run ON run.id=receipt.run_id
    JOIN health_no_session_observations observation ON observation.run_id=receipt.run_id
    JOIN health_scheduled_runs scheduled ON scheduled.id=receipt.scheduled_run_id
    WHERE receipt.run_id=candidate_run_id
      AND receipt.projection_applied_at IS NOT NULL
      AND receipt.incident_processed_at IS NOT NULL
      AND receipt.payload_pruned_at IS NULL
      AND run.run_kind='NO_SESSION_OBSERVATION'
      AND scheduled.state='SUCCEEDED'
      AND scheduled.health_run_id=receipt.run_id
      AND NOT EXISTS (
        SELECT 1 FROM health_incidents incident
        WHERE incident.first_seen_run_id=candidate_run_id
           OR incident.latest_seen_run_id=candidate_run_id
           OR incident.last_observed_run_id=candidate_run_id
           OR incident.resolved_by_run_id=candidate_run_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM health_notification_intents notification
        WHERE notification.health_run_id=candidate_run_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM health_no_session_scope_states state
        WHERE state.accepted_baseline_run_id=candidate_run_id
           OR state.latest_run_id=candidate_run_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM health_no_session_recent_states recent
        WHERE recent.latest_run_id=candidate_run_id
      )
  );
$$;
--> statement-breakpoint
CREATE FUNCTION health_no_session_receipt_gc_allowed(candidate_run_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM health_no_session_run_receipts receipt
    JOIN health_schedule_retention_watermarks watermark
      ON watermark.schedule_id=receipt.schedule_id
    JOIN health_scheduled_runs scheduled ON scheduled.id=receipt.scheduled_run_id
    WHERE receipt.run_id=candidate_run_id
      AND receipt.payload_pruned_at IS NOT NULL
      AND scheduled.state='SUCCEEDED'
      AND scheduled.health_run_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM health_runs run WHERE run.id=receipt.run_id)
      AND NOT EXISTS (
        SELECT 1 FROM health_no_session_observations observation
        WHERE observation.run_id=receipt.run_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM health_no_session_evidence_references evidence
        WHERE evidence.run_id=receipt.run_id
      )
      AND (
        watermark.retired_through_revision > receipt.schedule_revision
        OR (
          watermark.retired_through_revision = receipt.schedule_revision
          AND watermark.retired_through_due_slot_at >= receipt.due_slot_at
        )
      )
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION health_no_session_run_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND health_no_session_receipt_gc_allowed(OLD.run_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE'
     AND (to_jsonb(NEW) - ARRAY['normalized_result_sha256','projection_applied_at','incident_processed_at','payload_pruned_at'])
       = (to_jsonb(OLD) - ARRAY['normalized_result_sha256','projection_applied_at','incident_processed_at','payload_pruned_at'])
     AND (OLD.normalized_result_sha256 IS NULL OR NEW.normalized_result_sha256=OLD.normalized_result_sha256)
     AND (OLD.projection_applied_at IS NULL OR NEW.projection_applied_at=OLD.projection_applied_at)
     AND (OLD.incident_processed_at IS NULL OR NEW.incident_processed_at=OLD.incident_processed_at)
     AND (OLD.payload_pruned_at IS NULL OR NEW.payload_pruned_at=OLD.payload_pruned_at)
     AND (
       OLD.payload_pruned_at IS NOT NULL
       OR NEW.payload_pruned_at IS NULL
       OR health_no_session_payload_mark_allowed(OLD.run_id)
     )
     AND ((NEW.normalized_result_sha256 IS NULL AND NEW.projection_applied_at IS NULL) OR (NEW.normalized_result_sha256 IS NOT NULL AND NEW.projection_applied_at IS NOT NULL))
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'health no-session run receipts are append/monotonic only' USING ERRCODE='55000';
END;
$$;
