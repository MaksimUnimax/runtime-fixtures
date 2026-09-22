CREATE TABLE "api_watch_authority_records" (
  "record_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_family" varchar(32) NOT NULL,
  "official_url" text,
  "acquisition_mode" varchar(32) NOT NULL,
  "authority_status" varchar(32) NOT NULL,
  "sha256" varchar(64),
  "size_bytes" bigint,
  "spec_version" varchar(32),
  "acquired_at" timestamp with time zone,
  "validated_at" timestamp with time zone NOT NULL,
  "operator_request_id" varchar(128),
  "artifact_extension" varchar(16),
  "safe_provenance" jsonb NOT NULL,
  "failure_classification" varchar(96),
  CONSTRAINT "api_watch_authority_records_source_family_check" CHECK ("source_family" IN ('OZON_SELLER','OZON_PERFORMANCE','WILDBERRIES')),
  CONSTRAINT "api_watch_authority_records_acquisition_mode_check" CHECK ("acquisition_mode" IN ('AUTOMATIC','OPERATOR_SUPPLIED')),
  CONSTRAINT "api_watch_authority_records_status_check" CHECK ("authority_status" IN ('AUTHORITY_ACCEPTED','AUTHORITY_REVIEW_REQUIRED','AUTHORITY_REJECTED','AUTHORITY_BLOCKED')),
  CONSTRAINT "api_watch_authority_records_sha256_check" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "api_watch_authority_records_size_check" CHECK ("size_bytes" IS NULL OR "size_bytes" >= 0)
);
--> statement-breakpoint
CREATE INDEX "api_watch_authority_records_family_index" ON "api_watch_authority_records" USING btree ("source_family","validated_at");
--> statement-breakpoint
CREATE TABLE "api_watch_snapshots" (
  "snapshot_id" varchar(160) PRIMARY KEY NOT NULL,
  "source_family" varchar(32) NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "spec_version" varchar(32) NOT NULL,
  "official_url" text NOT NULL,
  "acquisition_mode" varchar(32) NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "authority_record_id" uuid NOT NULL,
  "artifact_path" text NOT NULL,
  CONSTRAINT "api_watch_snapshots_authority_fk" FOREIGN KEY ("authority_record_id") REFERENCES "api_watch_authority_records"("record_id") ON DELETE RESTRICT,
  CONSTRAINT "api_watch_snapshots_family_check" CHECK ("source_family" IN ('OZON_SELLER','OZON_PERFORMANCE','WILDBERRIES')),
  CONSTRAINT "api_watch_snapshots_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "api_watch_snapshots_mode_check" CHECK ("acquisition_mode" IN ('AUTOMATIC','OPERATOR_SUPPLIED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_watch_snapshots_family_sha_unique" ON "api_watch_snapshots" USING btree ("source_family","sha256");
--> statement-breakpoint
CREATE TABLE "api_watch_inventories" (
  "source_family" varchar(32) NOT NULL,
  "snapshot_sha256" varchar(64) NOT NULL,
  "path_count" integer NOT NULL,
  "operation_count" integer NOT NULL,
  "deprecated_count" integer NOT NULL,
  "operation_id_present_count" integer NOT NULL,
  "operation_id_missing_count" integer NOT NULL,
  "operations_by_method" jsonb NOT NULL,
  "inventory" jsonb NOT NULL,
  CONSTRAINT "api_watch_inventories_pk" PRIMARY KEY ("source_family","snapshot_sha256"),
  CONSTRAINT "api_watch_inventories_family_check" CHECK ("source_family" IN ('OZON_SELLER','OZON_PERFORMANCE','WILDBERRIES')),
  CONSTRAINT "api_watch_inventories_sha256_check" CHECK ("snapshot_sha256" ~ '^[0-9a-f]{64}$')
);
