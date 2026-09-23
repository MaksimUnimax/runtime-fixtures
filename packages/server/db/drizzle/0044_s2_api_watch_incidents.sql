CREATE TABLE "api_watch_incidents" (
  "incident_id" varchar(160) PRIMARY KEY NOT NULL,
  "incident_key" varchar(700) NOT NULL UNIQUE,
  "incident_type" varchar(40) NOT NULL,
  "source_family" varchar(32),
  "operation_identity" varchar(512),
  "first_seen_at" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "occurrence_count" integer NOT NULL DEFAULT 1,
  "severity" varchar(24) NOT NULL,
  "latest_report_id" varchar(160) NOT NULL,
  "latest_diff_sha256" varchar(64),
  "safe_summary_code" varchar(80) NOT NULL,
  "state" varchar(16) NOT NULL,
  CONSTRAINT "api_watch_incident_type_check" CHECK ("incident_type" IN ('SOURCE_AUTHORITY_BLOCKED','API_CHANGE_BLOCKING','API_CHANGE_REVIEW_REQUIRED','RUNTIME_OPERATION_STALE','RUNTIME_MAPPING_AMBIGUOUS','WATCH_RUN_FAILED')),
  CONSTRAINT "api_watch_incident_state_check" CHECK ("state" IN ('OPEN','RESOLVED')),
  CONSTRAINT "api_watch_incident_severity_check" CHECK ("severity" IN ('BLOCKING_RISK','REVIEW_REQUIRED','UNKNOWN','NO_POLICY_IMPACT')),
  CONSTRAINT "api_watch_incident_count_check" CHECK ("occurrence_count" > 0)
);
--> statement-breakpoint
CREATE INDEX "api_watch_incidents_open_index" ON "api_watch_incidents" USING btree ("state","source_family","incident_key");
