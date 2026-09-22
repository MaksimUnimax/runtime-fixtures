CREATE TABLE "swagger_source_requests" (
  "request_id" varchar(128) PRIMARY KEY NOT NULL,
  "source_family" varchar(32) NOT NULL,
  "official_url" text NOT NULL,
  "expected_artifact_type" varchar(64) NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'PENDING_OPERATOR_UPLOAD',
  "expires_at" timestamp with time zone,
  "blocker_reason" varchar(500) NOT NULL,
  CONSTRAINT "swagger_source_requests_source_family_check" CHECK ("source_family" IN ('OZON_SELLER','OZON_PERFORMANCE','WILDBERRIES')),
  CONSTRAINT "swagger_source_requests_status_check" CHECK ("status" IN ('PENDING_OPERATOR_UPLOAD','UPLOAD_RECEIVED','QUARANTINED','VALIDATION_FAILED','DUPLICATE','CANDIDATE_READY','EXPIRED','CANCELLED'))
);
--> statement-breakpoint
CREATE INDEX "swagger_source_requests_pending_index" ON "swagger_source_requests" USING btree ("status","created_at");
--> statement-breakpoint
CREATE TABLE "swagger_source_artifacts" (
  "artifact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" varchar(128) NOT NULL,
  "source_family" varchar(32) NOT NULL,
  "official_url" text NOT NULL,
  "status" varchar(32) NOT NULL,
  "quarantine_filename" varchar(200) NOT NULL,
  "original_filename" varchar(160) NOT NULL,
  "operator_id" varchar(64) NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "detected_spec_version" varchar(32),
  "parser_result" jsonb NOT NULL,
  "validation_result" jsonb NOT NULL,
  "authority_state" varchar(96),
  CONSTRAINT "swagger_source_artifacts_request_fk" FOREIGN KEY ("request_id") REFERENCES "swagger_source_requests"("request_id") ON DELETE RESTRICT,
  CONSTRAINT "swagger_source_artifacts_source_family_check" CHECK ("source_family" IN ('OZON_SELLER','OZON_PERFORMANCE','WILDBERRIES')),
  CONSTRAINT "swagger_source_artifacts_status_check" CHECK ("status" IN ('VALIDATION_FAILED','CANDIDATE_READY','DUPLICATE')),
  CONSTRAINT "swagger_source_artifacts_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "swagger_source_artifacts_authority_boundary_check" CHECK (("status" = 'CANDIDATE_READY' AND "authority_state" = 'OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE') OR ("status" <> 'CANDIDATE_READY' AND "authority_state" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "swagger_source_artifacts_request_sha_unique" ON "swagger_source_artifacts" USING btree ("request_id","sha256");
CREATE INDEX "swagger_source_artifacts_request_index" ON "swagger_source_artifacts" USING btree ("request_id","received_at");
