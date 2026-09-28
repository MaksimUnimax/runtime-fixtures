CREATE TABLE "monitor_profile_repair_bindings" (
  "repair_case_id" uuid NOT NULL,
  "case_revision" integer NOT NULL,
  "binding_sha256" varchar(64) NOT NULL,
  "binding" jsonb NOT NULL,
  "incident_id" uuid NOT NULL,
  "scope_sha256" varchar(64) NOT NULL,
  "deployment_environment" varchar(32) NOT NULL,
  "observation_run_id" uuid NOT NULL,
  "observation_normalized_state_sha256" varchar(64) NOT NULL,
  "accepted_baseline_run_id" uuid NOT NULL,
  "accepted_baseline_profile_revision_id" uuid NOT NULL,
  "candidate_profile_revision_id" uuid NOT NULL,
  "tested_extension_version" varchar(64) NOT NULL,
  "tested_browser_family" varchar(32) NOT NULL,
  "tested_browser_version" varchar(64) NOT NULL,
  "tested_source_commit_sha" varchar(40) NOT NULL,
  "tested_source_tree_sha" varchar(40) NOT NULL,
  "tested_package_sha256" varchar(64) NOT NULL,
  "suite_revision_id" uuid NOT NULL,
  "suite_machine_key" varchar(64) NOT NULL,
  "suite_revision" integer NOT NULL,
  "suite_definition_sha256" varchar(64) NOT NULL,
  "h4_evaluation_id" uuid NOT NULL,
  "h4_evaluation_key" varchar(64) NOT NULL,
  "installed_behavior_evidence_sha256" varchar(64) NOT NULL,
  "matrix_sha256" varchar(64) NOT NULL,
  "results_sha256" varchar(64) NOT NULL,
  "assignment_id" uuid NOT NULL,
  "expected_assignment_revision" integer NOT NULL,
  "initial_percentage_bps" integer NOT NULL,
  "rollback_run_id" uuid NOT NULL,
  "rollback_profile_revision_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "monitor_profile_repair_bindings_pk" PRIMARY KEY("repair_case_id","case_revision"),
  CONSTRAINT "monitor_profile_repair_bindings_hash_unique" UNIQUE("binding_sha256"),
  CONSTRAINT "monitor_profile_repair_bindings_incident_fk" FOREIGN KEY ("incident_id") REFERENCES "health_incidents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "monitor_profile_repair_bindings_observation_run_fk" FOREIGN KEY ("observation_run_id") REFERENCES "health_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "monitor_profile_repair_bindings_baseline_run_fk" FOREIGN KEY ("accepted_baseline_run_id") REFERENCES "health_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "monitor_profile_repair_bindings_candidate_revision_fk" FOREIGN KEY ("candidate_profile_revision_id") REFERENCES "adapter_profile_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "monitor_profile_repair_bindings_baseline_revision_fk" FOREIGN KEY ("accepted_baseline_profile_revision_id") REFERENCES "adapter_profile_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "monitor_profile_repair_bindings_suite_fk" FOREIGN KEY ("suite_revision_id") REFERENCES "health_suite_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "monitor_profile_repair_bindings_h4_fk" FOREIGN KEY ("h4_evaluation_id") REFERENCES "health_profile_evaluations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "monitor_profile_repair_bindings_assignment_fk" FOREIGN KEY ("assignment_id") REFERENCES "adapter_profile_assignments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "monitor_profile_repair_bindings_rollback_run_fk" FOREIGN KEY ("rollback_run_id") REFERENCES "health_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "monitor_profile_repair_bindings_rollback_revision_fk" FOREIGN KEY ("rollback_profile_revision_id") REFERENCES "adapter_profile_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "monitor_profile_repair_bindings_case_revision_positive" CHECK ("case_revision" > 0),
  CONSTRAINT "monitor_profile_repair_bindings_assignment_revision_positive" CHECK ("expected_assignment_revision" > 0),
  CONSTRAINT "monitor_profile_repair_bindings_percentage_bounds" CHECK ("initial_percentage_bps" BETWEEN 1 AND 10000),
  CONSTRAINT "monitor_profile_repair_bindings_scope_sha" CHECK ("scope_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "monitor_profile_repair_bindings_binding_sha" CHECK ("binding_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "monitor_profile_repair_bindings_observation_sha" CHECK ("observation_normalized_state_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "monitor_profile_repair_bindings_external_hashes" CHECK (
    "tested_package_sha256" ~ '^[0-9a-f]{64}$'
    AND "suite_definition_sha256" ~ '^[0-9a-f]{64}$'
    AND "h4_evaluation_key" ~ '^[0-9a-f]{64}$'
    AND "installed_behavior_evidence_sha256" ~ '^[0-9a-f]{64}$'
    AND "matrix_sha256" ~ '^[0-9a-f]{64}$'
    AND "results_sha256" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "monitor_profile_repair_bindings_git_shas" CHECK (
    "tested_source_commit_sha" ~ '^[0-9a-f]{40}$'
    AND "tested_source_tree_sha" ~ '^[0-9a-f]{40}$'
  ),
  CONSTRAINT "monitor_profile_repair_bindings_environment" CHECK ("deployment_environment" IN ('MONITOR_PILOT','OWNER_TEST','PRODUCTION')),
  CONSTRAINT "monitor_profile_repair_bindings_json_object" CHECK (jsonb_typeof("binding")='object' AND pg_column_size("binding") <= 32768)
);
--> statement-breakpoint
CREATE INDEX "monitor_profile_repair_bindings_candidate_index" ON "monitor_profile_repair_bindings" ("candidate_profile_revision_id","created_at");
--> statement-breakpoint
CREATE INDEX "monitor_profile_repair_bindings_incident_index" ON "monitor_profile_repair_bindings" ("incident_id","created_at");
--> statement-breakpoint
CREATE TABLE "monitor_profile_repair_decisions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "operator_principal_id" uuid NOT NULL,
  "idempotency_key" uuid NOT NULL,
  "repair_case_id" uuid NOT NULL,
  "case_revision" integer NOT NULL,
  "binding_sha256" varchar(64) NOT NULL,
  "request_sha256" varchar(64) NOT NULL,
  "request" jsonb NOT NULL,
  "decision" varchar(16) NOT NULL,
  "manual_checklist_sha256" varchar(64) NOT NULL,
  "issued_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "monitor_profile_repair_decisions_principal_idempotency_unique" UNIQUE("operator_principal_id","idempotency_key"),
  CONSTRAINT "monitor_profile_repair_decisions_binding_fk" FOREIGN KEY ("repair_case_id","case_revision") REFERENCES "monitor_profile_repair_bindings"("repair_case_id","case_revision") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "monitor_profile_repair_decisions_operator_fk" FOREIGN KEY ("operator_principal_id") REFERENCES "admin_principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "monitor_profile_repair_decisions_binding_sha" CHECK ("binding_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "monitor_profile_repair_decisions_request_sha" CHECK ("request_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "monitor_profile_repair_decisions_checklist_sha" CHECK ("manual_checklist_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "monitor_profile_repair_decisions_value" CHECK ("decision" IN ('APPROVED','REJECTED')),
  CONSTRAINT "monitor_profile_repair_decisions_time_order" CHECK ("expires_at" > "issued_at" AND ("revoked_at" IS NULL OR "revoked_at" >= "issued_at")),
  CONSTRAINT "monitor_profile_repair_decisions_request_object" CHECK (jsonb_typeof("request")='object' AND pg_column_size("request") <= 8192)
);
--> statement-breakpoint
CREATE INDEX "monitor_profile_repair_decisions_case_index" ON "monitor_profile_repair_decisions" ("repair_case_id","case_revision","issued_at" DESC);
--> statement-breakpoint
CREATE TABLE "monitor_profile_repair_operations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "approval_id" uuid NOT NULL,
  "repair_case_id" uuid NOT NULL,
  "case_revision" integer NOT NULL,
  "operation_kind" varchar(32) NOT NULL,
  "state" varchar(16) NOT NULL,
  "actor_principal_id" uuid NOT NULL,
  "admission_txid" bigint NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "committed_at" timestamp with time zone,
  "published_profile_revision_id" uuid,
  "assignment_revision_id" uuid,
  "result" jsonb,
  CONSTRAINT "monitor_profile_repair_operations_approval_unique" UNIQUE("approval_id","operation_kind"),
  CONSTRAINT "monitor_profile_repair_operations_approval_fk" FOREIGN KEY ("approval_id") REFERENCES "monitor_profile_repair_decisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "monitor_profile_repair_operations_binding_fk" FOREIGN KEY ("repair_case_id","case_revision") REFERENCES "monitor_profile_repair_bindings"("repair_case_id","case_revision") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "monitor_profile_repair_operations_actor_fk" FOREIGN KEY ("actor_principal_id") REFERENCES "admin_principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "monitor_profile_repair_operations_published_revision_fk" FOREIGN KEY ("published_profile_revision_id") REFERENCES "adapter_profile_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "monitor_profile_repair_operations_assignment_revision_fk" FOREIGN KEY ("assignment_revision_id") REFERENCES "adapter_profile_assignment_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "monitor_profile_repair_operations_kind" CHECK ("operation_kind"='INITIAL_ROLLOUT'),
  CONSTRAINT "monitor_profile_repair_operations_state" CHECK ("state" IN ('IN_PROGRESS','COMMITTED')),
  CONSTRAINT "monitor_profile_repair_operations_result_shape" CHECK (
    ("state"='IN_PROGRESS' AND "committed_at" IS NULL AND "published_profile_revision_id" IS NULL AND "assignment_revision_id" IS NULL AND "result" IS NULL)
    OR
    ("state"='COMMITTED' AND "committed_at" IS NOT NULL AND "published_profile_revision_id" IS NOT NULL AND "assignment_revision_id" IS NOT NULL AND jsonb_typeof("result")='object')
  )
);
--> statement-breakpoint
CREATE INDEX "monitor_profile_repair_operations_case_index" ON "monitor_profile_repair_operations" ("repair_case_id","case_revision","started_at" DESC);
--> statement-breakpoint
CREATE FUNCTION monitor_profile_repair_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'monitor profile repair bindings are immutable' USING ERRCODE='55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER monitor_profile_repair_binding_guard
BEFORE UPDATE OR DELETE ON "monitor_profile_repair_bindings"
FOR EACH ROW EXECUTE FUNCTION monitor_profile_repair_immutable_guard();
--> statement-breakpoint
CREATE FUNCTION monitor_profile_repair_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE'
     AND OLD.revoked_at IS NULL
     AND NEW.revoked_at IS NOT NULL
     AND (to_jsonb(NEW) - 'revoked_at') = (to_jsonb(OLD) - 'revoked_at')
     AND NEW.revoked_at >= OLD.issued_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'monitor profile repair decisions are immutable except revocation' USING ERRCODE='55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER monitor_profile_repair_decision_guard
BEFORE UPDATE OR DELETE ON "monitor_profile_repair_decisions"
FOR EACH ROW EXECUTE FUNCTION monitor_profile_repair_decision_guard();
--> statement-breakpoint
CREATE FUNCTION monitor_profile_repair_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE'
     AND OLD.state='IN_PROGRESS'
     AND NEW.state='COMMITTED'
     AND (to_jsonb(NEW) - ARRAY['state','committed_at','published_profile_revision_id','assignment_revision_id','result'])
       = (to_jsonb(OLD) - ARRAY['state','committed_at','published_profile_revision_id','assignment_revision_id','result'])
     AND NEW.committed_at IS NOT NULL
     AND NEW.published_profile_revision_id IS NOT NULL
     AND NEW.assignment_revision_id IS NOT NULL
     AND jsonb_typeof(NEW.result)='object'
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'monitor profile repair operations are immutable after one commit transition' USING ERRCODE='55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER monitor_profile_repair_operation_guard
BEFORE UPDATE OR DELETE ON "monitor_profile_repair_operations"
FOR EACH ROW EXECUTE FUNCTION monitor_profile_repair_operation_guard();
--> statement-breakpoint
CREATE FUNCTION monitor_profile_repair_current_operation_id() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE raw text;
BEGIN
  raw := current_setting('octoport.repair_operation_id', true);
  IF raw IS NULL OR raw='' OR raw !~ '^[0-9a-fA-F-]{36}$' THEN
    RETURN NULL;
  END IF;
  RETURN raw::uuid;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION monitor_profile_repair_publish_authorized(candidate_revision_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM monitor_profile_repair_operations operation
    JOIN monitor_profile_repair_bindings binding
      ON binding.repair_case_id=operation.repair_case_id
     AND binding.case_revision=operation.case_revision
    WHERE operation.id=monitor_profile_repair_current_operation_id()
      AND operation.state='IN_PROGRESS'
      AND operation.admission_txid=txid_current()
      AND operation.operation_kind='INITIAL_ROLLOUT'
      AND binding.candidate_profile_revision_id=candidate_revision_id
  );
$$;
--> statement-breakpoint
CREATE FUNCTION monitor_profile_repair_profile_publish_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state='CANDIDATE' AND NEW.state='PUBLISHED'
     AND EXISTS (
       SELECT 1 FROM monitor_profile_repair_bindings binding
       WHERE binding.candidate_profile_revision_id=OLD.id
     )
     AND NOT monitor_profile_repair_publish_authorized(OLD.id)
  THEN
    RAISE EXCEPTION 'registered repair candidate requires current repair admission' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER monitor_profile_repair_profile_publish_guard
BEFORE UPDATE OF state ON "adapter_profile_revisions"
FOR EACH ROW EXECUTE FUNCTION monitor_profile_repair_profile_publish_guard();
--> statement-breakpoint
CREATE FUNCTION monitor_profile_repair_assignment_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE registered boolean;
DECLARE authorized boolean;
DECLARE prior_candidate uuid;
DECLARE prior_baseline uuid;
DECLARE prior_percentage integer;
BEGIN
  SELECT prior.candidate_profile_revision_id,prior.baseline_profile_revision_id,prior.percentage_bps
  INTO prior_candidate,prior_baseline,prior_percentage
  FROM adapter_profile_assignment_revisions prior
  WHERE prior.assignment_id=NEW.assignment_id
  ORDER BY prior.revision DESC
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM monitor_profile_repair_bindings binding
    WHERE binding.candidate_profile_revision_id=NEW.candidate_profile_revision_id
       OR binding.candidate_profile_revision_id=NEW.baseline_profile_revision_id
       OR binding.candidate_profile_revision_id=prior_candidate
       OR binding.candidate_profile_revision_id=prior_baseline
  ) INTO registered;
  IF NOT registered THEN
    RETURN NEW;
  END IF;

  -- Safety pause is exposure-restricting and remains available without a new approval.
  IF NEW.mode='PAUSED'
     AND prior_candidate IS NOT NULL
     AND NEW.baseline_profile_revision_id=prior_baseline
     AND NEW.candidate_profile_revision_id=prior_candidate
     AND NEW.percentage_bps=prior_percentage
  THEN
    RETURN NEW;
  END IF;

  -- One exact initial rollout is authorized only by the current admitted operation.
  SELECT EXISTS (
    SELECT 1
    FROM monitor_profile_repair_operations operation
    JOIN monitor_profile_repair_bindings binding
      ON binding.repair_case_id=operation.repair_case_id
     AND binding.case_revision=operation.case_revision
    WHERE operation.id=monitor_profile_repair_current_operation_id()
      AND operation.state='IN_PROGRESS'
      AND operation.admission_txid=txid_current()
      AND operation.operation_kind='INITIAL_ROLLOUT'
      AND binding.assignment_id=NEW.assignment_id
      AND binding.expected_assignment_revision + 1=NEW.revision
      AND binding.accepted_baseline_profile_revision_id=NEW.baseline_profile_revision_id
      AND binding.candidate_profile_revision_id=NEW.candidate_profile_revision_id
      AND binding.initial_percentage_bps=NEW.percentage_bps
      AND NEW.mode='ROLLOUT'
  ) INTO authorized;
  IF authorized THEN
    RETURN NEW;
  END IF;

  -- A bound rollback is restrictive and may return to only the exact pre-approved
  -- rollback revision. Arbitrary DIRECT targets and rollout completion stay blocked.
  IF NEW.mode='DIRECT'
     AND NEW.candidate_profile_revision_id IS NULL
     AND NEW.percentage_bps=0
     AND EXISTS (
       SELECT 1 FROM monitor_profile_repair_bindings binding
       WHERE binding.assignment_id=NEW.assignment_id
         AND binding.rollback_profile_revision_id=NEW.baseline_profile_revision_id
         AND binding.candidate_profile_revision_id IN (prior_candidate,prior_baseline)
     )
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'registered repair assignment requires current repair admission or exact bound rollback' USING ERRCODE='55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER monitor_profile_repair_assignment_insert_guard
BEFORE INSERT ON "adapter_profile_assignment_revisions"
FOR EACH ROW EXECUTE FUNCTION monitor_profile_repair_assignment_insert_guard();
