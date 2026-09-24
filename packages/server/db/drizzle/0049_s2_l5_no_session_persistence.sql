CREATE TYPE "public"."health_run_kind" AS ENUM ('BASELINE_CONTOUR', 'NO_SESSION_OBSERVATION');
--> statement-breakpoint
ALTER TABLE "health_runs" ADD COLUMN "run_kind" "health_run_kind" NOT NULL DEFAULT 'BASELINE_CONTOUR';
--> statement-breakpoint
ALTER TABLE "health_runs" ALTER COLUMN "suite_revision_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "health_runs" ALTER COLUMN "extension_version" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "health_runs" ALTER COLUMN "adapter_engine_version" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "health_runs" ADD CONSTRAINT "health_runs_kind_shape" CHECK (
  ("run_kind"='BASELINE_CONTOUR' AND "suite_revision_id" IS NOT NULL AND "extension_version" IS NOT NULL AND "adapter_engine_version" IS NOT NULL)
  OR ("run_kind"='NO_SESSION_OBSERVATION' AND "suite_revision_id" IS NULL AND "extension_version" IS NULL AND "adapter_engine_version" IS NULL AND "scheduled_run_id" IS NOT NULL AND "health_level"='H2' AND "operator_maintenance"=false AND "operator_maintenance_authority" IS NULL)
);
--> statement-breakpoint
CREATE FUNCTION health_contour_run_kind_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_kind "health_run_kind";
BEGIN
  SELECT run_kind INTO parent_kind FROM "health_runs" WHERE id=NEW.run_id;
  IF parent_kind IS DISTINCT FROM 'BASELINE_CONTOUR' THEN
    RAISE EXCEPTION 'baseline contour result requires baseline run' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER health_contour_run_kind_guard BEFORE INSERT ON "health_contour_results" FOR EACH ROW EXECUTE FUNCTION health_contour_run_kind_guard();
--> statement-breakpoint
CREATE TABLE "health_no_session_observations" (
  "run_id" uuid PRIMARY KEY NOT NULL,
  "provider_id" varchar(32) NOT NULL,
  "observation_surface_id" varchar(64) NOT NULL,
  "target_key" varchar(64) NOT NULL,
  "strategy_id" varchar(64) NOT NULL,
  "strategy_revision" integer NOT NULL,
  "classification" varchar(16) NOT NULL,
  "classification_basis" varchar(64) NOT NULL,
  "surface_outcome" varchar(64) NOT NULL,
  "blocker" varchar(64) NOT NULL,
  "observed_at" timestamp with time zone NOT NULL,
  "result_sha256" varchar(64) NOT NULL,
  "observation" jsonb NOT NULL,
  CONSTRAINT "health_no_session_observations_run_fk" FOREIGN KEY ("run_id") REFERENCES "health_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "health_no_session_observations_revision_positive" CHECK ("strategy_revision">0),
  CONSTRAINT "health_no_session_observations_classification" CHECK ("classification" IN ('HEALTHY','DRIFT','DEGRADED','BROKEN','UNKNOWN','MAINTENANCE')),
  CONSTRAINT "health_no_session_observations_result_sha256" CHECK ("result_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "health_no_session_observations_object" CHECK (jsonb_typeof("observation")='object' AND pg_column_size("observation")<=65536),
  CONSTRAINT "health_no_session_observations_columns_match" CHECK (
    "observation"->>'providerId'="provider_id" AND "observation"->>'surfaceId'="observation_surface_id"
    AND "observation"->>'targetKey'="target_key" AND "observation"->>'strategyId'="strategy_id"
    AND ("observation"->>'strategyRevision')::integer="strategy_revision"
    AND "observation"->>'classification'="classification"
    AND "observation"->>'classificationBasis'="classification_basis"
    AND "observation"->>'surfaceOutcome'="surface_outcome"
    AND "observation"->>'blocker'="blocker"
    AND ("observation"->>'observedAt')::timestamptz="observed_at"
  )
);
--> statement-breakpoint
CREATE FUNCTION health_no_session_observation_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_kind "health_run_kind";
  parent_state varchar(16);
  parent_started timestamp with time zone;
  parent_completed timestamp with time zone;
BEGIN
  SELECT run_kind,health_state,started_at,completed_at
    INTO parent_kind,parent_state,parent_started,parent_completed
    FROM "health_runs" WHERE id=NEW.run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no-session observation parent run not found' USING ERRCODE='23503';
  END IF;
  IF parent_kind <> 'NO_SESSION_OBSERVATION' THEN
    RAISE EXCEPTION 'no-session observation requires no-session run' USING ERRCODE='23514';
  END IF;
  IF parent_state <> NEW.classification THEN
    RAISE EXCEPTION 'no-session observation classification mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.observed_at < parent_started OR NEW.observed_at > parent_completed THEN
    RAISE EXCEPTION 'no-session observation timestamp outside run' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER health_no_session_observation_insert_guard BEFORE INSERT ON "health_no_session_observations" FOR EACH ROW EXECUTE FUNCTION health_no_session_observation_insert_guard();
--> statement-breakpoint
CREATE FUNCTION health_no_session_observation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'health no-session observations are immutable' USING ERRCODE='55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER health_no_session_observation_guard BEFORE UPDATE OR DELETE ON "health_no_session_observations" FOR EACH ROW EXECUTE FUNCTION health_no_session_observation_guard();
--> statement-breakpoint
CREATE TABLE "health_no_session_evidence_references" (
  "evidence_id" uuid PRIMARY KEY NOT NULL,
  "run_id" uuid NOT NULL,
  "rule_id" varchar(64) NOT NULL,
  "classification" varchar(32) NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "size_bytes" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "health_no_session_evidence_run_fk" FOREIGN KEY ("run_id") REFERENCES "health_no_session_observations"("run_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "health_no_session_evidence_rule" CHECK ("rule_id" IN ('SAFE_ELEMENT_METADATA','STATE_TRANSITION_TRACE')),
  CONSTRAINT "health_no_session_evidence_classification" CHECK ("classification"='METADATA'),
  CONSTRAINT "health_no_session_evidence_sha256" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "health_no_session_evidence_size" CHECK ("size_bytes" BETWEEN 0 AND 4096)
);
--> statement-breakpoint
CREATE FUNCTION health_no_session_evidence_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "health_no_session_observations" o
    CROSS JOIN LATERAL jsonb_array_elements(o.observation->'evidence') e
    WHERE o.run_id=NEW.run_id AND (e->>'evidenceId')::uuid=NEW.evidence_id
      AND e->>'ruleId'=NEW.rule_id AND e->>'classification'=NEW.classification
      AND e->>'sha256'=NEW.sha256 AND (e->>'sizeBytes')::integer=NEW.size_bytes
  ) THEN
    RAISE EXCEPTION 'no-session evidence must derive from validated observation' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER health_no_session_evidence_insert_guard BEFORE INSERT ON "health_no_session_evidence_references" FOR EACH ROW EXECUTE FUNCTION health_no_session_evidence_insert_guard();
--> statement-breakpoint
CREATE FUNCTION health_no_session_evidence_mutation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'health no-session evidence references are immutable' USING ERRCODE='55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER health_no_session_evidence_mutation_guard BEFORE UPDATE OR DELETE ON "health_no_session_evidence_references" FOR EACH ROW EXECUTE FUNCTION health_no_session_evidence_mutation_guard();
