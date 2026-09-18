-- S2-O2 R1 is an LLM Health-only notification adapter. It is separate from
-- health incident truth and contains no provider credentials or message body.
CREATE TYPE "public"."health_notification_event_kind" AS ENUM (
  'INCIDENT_OPENED',
  'INCIDENT_ESCALATED',
  'INCIDENT_RECOVERED',
  'MAINTENANCE_ENTERED',
  'MAINTENANCE_EXITED'
);
--> statement-breakpoint
CREATE TYPE "public"."health_notification_severity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
--> statement-breakpoint
CREATE TYPE "public"."health_notification_state" AS ENUM (
  'PENDING',
  'CLAIMED',
  'DELIVERED',
  'FAILED_RETRYABLE',
  'FAILED_TERMINAL',
  'SUPPRESSED'
);
--> statement-breakpoint
CREATE TABLE "health_notification_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "dedup_key" varchar(256) NOT NULL,
  "source_domain" varchar(32) NOT NULL,
  "incident_id" uuid NOT NULL,
  "health_run_id" uuid NOT NULL,
  "event_kind" "health_notification_event_kind" NOT NULL,
  "severity" "health_notification_severity" NOT NULL,
  "route_key" varchar(64) NOT NULL,
  "state" "health_notification_state" NOT NULL,
  "group_count" integer DEFAULT 1 NOT NULL,
  "first_observed_at" timestamp with time zone NOT NULL,
  "latest_observed_at" timestamp with time zone NOT NULL,
  "cooldown_until" timestamp with time zone NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "claim_owner" varchar(128),
  "claim_token" uuid,
  "claim_expires_at" timestamp with time zone,
  "last_error_code" varchar(64),
  "suppression_reason" varchar(64),
  "payload" jsonb NOT NULL,
  "retention_class" varchar(64) DEFAULT 'OPERATIONAL_DEFAULT' NOT NULL,
  "expires_at" timestamp with time zone,
  "provider_adapter_key" varchar(64),
  "provider_delivery_id" varchar(128),
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "health_notification_intents_incident_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."health_incidents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "health_notification_intents_health_run_fk" FOREIGN KEY ("health_run_id") REFERENCES "public"."health_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "health_notification_intents_dedup_key_unique" UNIQUE("dedup_key"),
  CONSTRAINT "health_notification_intents_source_domain" CHECK ("source_domain" = 'LLM_HEALTH'),
  CONSTRAINT "health_notification_intents_route_key" CHECK ("route_key" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT "health_notification_intents_group_count_positive" CHECK ("group_count" > 0),
  CONSTRAINT "health_notification_intents_attempt_count_nonnegative" CHECK ("attempt_count" >= 0),
  CONSTRAINT "health_notification_intents_payload_object" CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "health_notification_intents_observation_order" CHECK ("latest_observed_at" >= "first_observed_at"),
  CONSTRAINT "health_notification_intents_delivery_pair" CHECK ("delivered_at" IS NULL OR "state" = 'DELIVERED'),
  CONSTRAINT "health_notification_intents_claim_pair" CHECK ("state" <> 'CLAIMED' OR ("claim_owner" IS NOT NULL AND "claim_token" IS NOT NULL AND "claim_expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "health_notification_intents_due_index" ON "health_notification_intents" USING btree ("state", "next_attempt_at", "claim_expires_at");
--> statement-breakpoint
CREATE INDEX "health_notification_intents_incident_index" ON "health_notification_intents" USING btree ("incident_id", "event_kind", "latest_observed_at");
