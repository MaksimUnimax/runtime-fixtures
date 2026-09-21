CREATE TYPE "public"."feedback_category" AS ENUM ('INSTALLATION', 'AUTH', 'OTP', 'STORE', 'OZON', 'WILDBERRIES', 'AI', 'COMMAND', 'REPORT', 'FILE_RESULT', 'SYNC', 'TRANSFER', 'BACKUP', 'BROWSER_COMPAT', 'SERVER_UNAVAILABLE', 'VERSION_INCOMPATIBLE', 'OTHER');
--> statement-breakpoint
CREATE TYPE "public"."feedback_case_status" AS ENUM ('NEW', 'TRIAGED', 'NEEDS_INFO', 'RESOLVED', 'CLOSED');
--> statement-breakpoint
CREATE TYPE "public"."feedback_severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'BLOCKING');
--> statement-breakpoint
CREATE TYPE "public"."feedback_marketplace" AS ENUM ('NONE', 'OZON', 'WILDBERRIES');
--> statement-breakpoint
CREATE TYPE "public"."feedback_signal_event" AS ENUM ('registration_started', 'account_created', 'device_activated', 'first_store_added', 'first_start', 'feedback_case_created', 'feedback_case_resolved');
--> statement-breakpoint
CREATE TABLE "feedback_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid,
  "created_by_user_id" uuid,
  "device_id" uuid,
  "category" "feedback_category" NOT NULL,
  "severity" "feedback_severity" DEFAULT 'LOW' NOT NULL,
  "status" "feedback_case_status" DEFAULT 'NEW' NOT NULL,
  "description" varchar(4000) NOT NULL,
  "diagnostics" jsonb,
  "server_version" varchar(64),
  "portal_version" varchar(64),
  "extension_version" varchar(64),
  "browser_family" varchar(64),
  "browser_version" varchar(64),
  "marketplace" "feedback_marketplace" DEFAULT 'NONE' NOT NULL,
  "support_code" varchar(128),
  "release_identity" varchar(128),
  "assigned_admin_principal_id" uuid,
  "resolution_code" varchar(128),
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "feedback_cases_description_not_blank" CHECK (length(trim("description")) > 0),
  CONSTRAINT "feedback_cases_account_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT "feedback_cases_created_by_user_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT "feedback_cases_device_fk" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT "feedback_cases_admin_principal_fk" FOREIGN KEY ("assigned_admin_principal_id") REFERENCES "admin_principals"("id") ON DELETE SET NULL ON UPDATE RESTRICT
);
--> statement-breakpoint
CREATE INDEX "feedback_cases_account_created_index" ON "feedback_cases" ("account_id", "created_at");
--> statement-breakpoint
CREATE INDEX "feedback_cases_status_updated_index" ON "feedback_cases" ("status", "updated_at");
--> statement-breakpoint
CREATE INDEX "feedback_cases_filter_index" ON "feedback_cases" ("category", "extension_version", "browser_family", "marketplace");
--> statement-breakpoint
CREATE TABLE "feedback_followups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "author_type" varchar(16) NOT NULL,
  "author_user_id" uuid,
  "author_admin_principal_id" uuid,
  "body" varchar(4000) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "feedback_followups_author_type_valid" CHECK ("author_type" IN ('USER','SUPPORT','ADMIN')),
  CONSTRAINT "feedback_followups_body_not_blank" CHECK (length(trim("body")) > 0),
  CONSTRAINT "feedback_followups_case_fk" FOREIGN KEY ("case_id") REFERENCES "feedback_cases"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "feedback_followups_user_fk" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT "feedback_followups_admin_fk" FOREIGN KEY ("author_admin_principal_id") REFERENCES "admin_principals"("id") ON DELETE SET NULL ON UPDATE RESTRICT
);
--> statement-breakpoint
CREATE INDEX "feedback_followups_case_created_index" ON "feedback_followups" ("case_id", "created_at");
--> statement-breakpoint
CREATE TABLE "feedback_signal_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event" "feedback_signal_event" NOT NULL,
  "product_version" varchar(64),
  "extension_version" varchar(64),
  "browser_family" varchar(64),
  "category" "feedback_category",
  "status" "feedback_case_status",
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "feedback_signal_events_aggregate_index" ON "feedback_signal_events" ("occurred_at", "event", "product_version", "extension_version", "browser_family", "category", "status");
--> statement-breakpoint
CREATE TABLE "feedback_retention_config" (
  "id" integer PRIMARY KEY NOT NULL,
  "closed_case_days" integer DEFAULT 90 NOT NULL,
  "signal_days" integer DEFAULT 180 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "feedback_retention_config_singleton" CHECK ("id" = 1),
  CONSTRAINT "feedback_retention_config_positive" CHECK ("closed_case_days" > 0 AND "signal_days" > 0)
);
--> statement-breakpoint
INSERT INTO "feedback_retention_config" ("id") VALUES (1);
