CREATE TYPE "public"."health_evaluation_phase" AS ENUM ('H4_CANDIDATE', 'H5_CANARY', 'H5_POST_ROLLOUT');
--> statement-breakpoint
CREATE TYPE "public"."health_evaluation_status" AS ENUM ('ACTIVE', 'COMPLETED');
--> statement-breakpoint
CREATE TABLE "health_profile_evaluations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "evaluation_key_sha256" varchar(64) NOT NULL,
  "phase" "health_evaluation_phase" NOT NULL,
  "provider" varchar(64) NOT NULL,
  "surface" varchar(128) NOT NULL,
  "target" varchar(128) NOT NULL,
  "variant" varchar(128),
  "probe_layer" "health_probe_layer" NOT NULL,
  "baseline_profile_revision_id" uuid NOT NULL,
  "candidate_profile_revision_id" uuid NOT NULL,
  "suite_machine_key" varchar(64) NOT NULL,
  "suite_revision" integer NOT NULL,
  "browser_family" varchar(32) NOT NULL,
  "browser_version" varchar(64) NOT NULL,
  "environment_class" varchar(128) NOT NULL,
  "status" "health_evaluation_status" NOT NULL,
  "outcome" varchar(32) NOT NULL,
  "recommendation" varchar(32),
  "result" jsonb NOT NULL,
  "first_execution_id" uuid NOT NULL,
  "latest_execution_id" uuid NOT NULL,
  "first_evaluated_at" timestamp with time zone NOT NULL,
  "latest_evaluated_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "health_profile_evaluations_key_format" CHECK ("evaluation_key_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "health_profile_evaluations_suite_revision_positive" CHECK ("suite_revision" > 0),
  CONSTRAINT "health_profile_evaluations_browser_family" CHECK ("browser_family" IN ('chrome', 'yandex_chromium')),
  CONSTRAINT "health_profile_evaluations_result_object" CHECK (jsonb_typeof("result") = 'object'),
  CONSTRAINT "health_profile_evaluations_time_order" CHECK ("latest_evaluated_at" >= "first_evaluated_at")
);
--> statement-breakpoint
ALTER TABLE "health_profile_evaluations" ADD CONSTRAINT "health_profile_evaluations_baseline_revision_fk" FOREIGN KEY ("baseline_profile_revision_id") REFERENCES "public"."adapter_profile_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE "health_profile_evaluations" ADD CONSTRAINT "health_profile_evaluations_candidate_revision_fk" FOREIGN KEY ("candidate_profile_revision_id") REFERENCES "public"."adapter_profile_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX "health_profile_evaluations_key_unique" ON "health_profile_evaluations" USING btree ("evaluation_key_sha256");
--> statement-breakpoint
CREATE INDEX "health_profile_evaluations_scope_index" ON "health_profile_evaluations" USING btree ("provider","surface","target","phase");
