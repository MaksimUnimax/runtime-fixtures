ALTER TABLE "swagger_source_requests" ADD COLUMN "document_key" varchar(128);
--> statement-breakpoint
ALTER TABLE "api_watch_snapshots" ADD COLUMN "document_key" varchar(128);
--> statement-breakpoint
CREATE INDEX "swagger_source_requests_document_index" ON "swagger_source_requests" USING btree ("source_family","document_key","official_url","status");
--> statement-breakpoint
CREATE TABLE "api_watch_source_documents" (
  "source_family" varchar(32) NOT NULL,
  "document_key" varchar(128) NOT NULL,
  "official_url" text NOT NULL,
  "authority_status" varchar(32) NOT NULL,
  "sha256" varchar(64),
  "size_bytes" bigint,
  "spec_version" varchar(32),
  "family_manifest_sha256" varchar(64),
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "api_watch_source_documents_pk" PRIMARY KEY ("source_family","document_key"),
  CONSTRAINT "api_watch_source_documents_family_check" CHECK ("source_family" IN ('OZON_SELLER','OZON_PERFORMANCE','WILDBERRIES')),
  CONSTRAINT "api_watch_source_documents_status_check" CHECK ("authority_status" IN ('AUTHORITY_ACCEPTED','AUTHORITY_PARTIAL','AUTHORITY_BLOCKED','AUTHORITY_REVIEW_REQUIRED','AUTHORITY_REJECTED')),
  CONSTRAINT "api_watch_source_documents_sha_check" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$')
);
