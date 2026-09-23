CREATE TABLE "api_watch_semantic_diffs" (
  "diff_id" varchar(320) PRIMARY KEY NOT NULL,
  "source_family" varchar(32) NOT NULL,
  "base_snapshot_sha256" varchar(64) NOT NULL,
  "target_snapshot_sha256" varchar(64) NOT NULL,
  "diff_sha256" varchar(64) NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "base_path_count" integer NOT NULL,
  "target_path_count" integer NOT NULL,
  "base_operation_count" integer NOT NULL,
  "target_operation_count" integer NOT NULL,
  "added_count" integer NOT NULL,
  "removed_count" integer NOT NULL,
  "changed_count" integer NOT NULL,
  "unchanged_count" integer NOT NULL,
  "method_counts_before" jsonb NOT NULL,
  "method_counts_after" jsonb NOT NULL,
  "deprecated_before" integer NOT NULL,
  "deprecated_after" integer NOT NULL,
  CONSTRAINT "api_watch_semantic_diffs_family_check" CHECK ("source_family" IN ('OZON_SELLER','OZON_PERFORMANCE','WILDBERRIES')),
  CONSTRAINT "api_watch_semantic_diffs_base_sha_check" CHECK ("base_snapshot_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "api_watch_semantic_diffs_target_sha_check" CHECK ("target_snapshot_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "api_watch_semantic_diffs_diff_sha_check" CHECK ("diff_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "api_watch_semantic_diffs_counts_check" CHECK ("added_count" >= 0 AND "removed_count" >= 0 AND "changed_count" >= 0 AND "unchanged_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_watch_semantic_diffs_identity_unique" ON "api_watch_semantic_diffs" USING btree ("source_family","base_snapshot_sha256","target_snapshot_sha256","diff_sha256");
--> statement-breakpoint
CREATE TABLE "api_watch_semantic_diff_operations" (
  "diff_id" varchar(320) NOT NULL,
  "identity" varchar(512) NOT NULL,
  "source_family" varchar(32) NOT NULL,
  "method" varchar(16) NOT NULL,
  "path" text NOT NULL,
  "state" varchar(16) NOT NULL,
  "before_operation" jsonb,
  "after_operation" jsonb,
  "deltas" jsonb NOT NULL,
  CONSTRAINT "api_watch_semantic_diff_operations_pk" PRIMARY KEY ("diff_id","identity"),
  CONSTRAINT "api_watch_semantic_diff_operations_diff_fk" FOREIGN KEY ("diff_id") REFERENCES "api_watch_semantic_diffs"("diff_id") ON DELETE CASCADE,
  CONSTRAINT "api_watch_semantic_diff_operations_family_check" CHECK ("source_family" IN ('OZON_SELLER','OZON_PERFORMANCE','WILDBERRIES')),
  CONSTRAINT "api_watch_semantic_diff_operations_state_check" CHECK ("state" IN ('ADDED','REMOVED','CHANGED','UNCHANGED'))
);
--> statement-breakpoint
CREATE INDEX "api_watch_semantic_diff_operations_order_index" ON "api_watch_semantic_diff_operations" USING btree ("diff_id","source_family","path","method","identity");
