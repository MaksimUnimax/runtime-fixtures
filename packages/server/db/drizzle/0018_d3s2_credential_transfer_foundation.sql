CREATE TYPE "public"."transfer_request_state" AS ENUM ('REQUESTED', 'SOURCE_SEEN', 'PACKET_AVAILABLE_EPHEMERAL', 'DELIVERED_TO_RECIPIENT', 'COMPLETED', 'EXPIRED', 'CANCELLED');
--> statement-breakpoint
CREATE TABLE "credential_transfer_requests" (
  "request_id" uuid PRIMARY KEY NOT NULL,
  "account_id" uuid NOT NULL,
  "recipient_device_id" uuid NOT NULL,
  "source_device_id" uuid,
  "recipient_public_key_spki" varchar(2048) NOT NULL,
  "selected_store_ids" varchar(128)[] NOT NULL,
  "state" "transfer_request_state" NOT NULL DEFAULT 'REQUESTED',
  "revision" integer NOT NULL DEFAULT 1,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "credential_transfer_requests_selected_store_ids_bounded" CHECK (cardinality("selected_store_ids") <= 16),
  CONSTRAINT "credential_transfer_requests_revision_positive" CHECK ("revision" > 0),
  CONSTRAINT "credential_transfer_requests_expiry_after_creation" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "credential_transfer_requests_account_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "credential_transfer_requests_recipient_device_fk" FOREIGN KEY ("recipient_device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "credential_transfer_requests_source_device_fk" FOREIGN KEY ("source_device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
--> statement-breakpoint
CREATE INDEX "credential_transfer_requests_account_state_expiry_index" ON "credential_transfer_requests" ("account_id", "state", "expires_at");
--> statement-breakpoint
CREATE INDEX "credential_transfer_requests_source_state_expiry_index" ON "credential_transfer_requests" ("source_device_id", "state", "expires_at");
