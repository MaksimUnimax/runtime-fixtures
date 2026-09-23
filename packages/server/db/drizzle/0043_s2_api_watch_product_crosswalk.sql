CREATE TABLE "api_watch_product_crosswalk" (
  "crosswalk_id" varchar(520) PRIMARY KEY NOT NULL,
  "report_id" varchar(160) NOT NULL,
  "source_family" varchar(32) NOT NULL,
  "source_identity" varchar(512) NOT NULL,
  "runtime_alias" varchar(255),
  "crosswalk_state" varchar(32) NOT NULL,
  "review_state" varchar(24) NOT NULL,
  "execution_enabled" boolean,
  "impact_severity" varchar(24),
  "diff_sha256" varchar(64),
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "api_watch_crosswalk_family_check" CHECK ("source_family" IN ('OZON_SELLER','OZON_PERFORMANCE','WILDBERRIES')),
  CONSTRAINT "api_watch_crosswalk_state_check" CHECK ("crosswalk_state" IN ('MAPPED_ENABLED','MAPPED_DISABLED','SOURCE_ONLY','RUNTIME_ONLY','AMBIGUOUS_RUNTIME_MAPPING')),
  CONSTRAINT "api_watch_crosswalk_review_check" CHECK ("review_state" IN ('NO_ACTION','REVIEW_REQUIRED','BLOCKING_RISK')),
  CONSTRAINT "api_watch_crosswalk_impact_check" CHECK ("impact_severity" IS NULL OR "impact_severity" IN ('BLOCKING_RISK','REVIEW_REQUIRED','UNKNOWN','NO_POLICY_IMPACT')),
  CONSTRAINT "api_watch_crosswalk_report_fk" FOREIGN KEY ("report_id") REFERENCES "api_watch_reports"("report_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "api_watch_crosswalk_report_index" ON "api_watch_product_crosswalk" USING btree ("report_id","source_family","source_identity");
