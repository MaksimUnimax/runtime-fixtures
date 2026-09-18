CREATE TABLE "sync_entities" (
	"account_id" uuid NOT NULL,
	"entity_id" varchar(128) NOT NULL,
	"server_revision" integer DEFAULT 0 NOT NULL,
	"state" jsonb NOT NULL,
	"installation_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_entities_account_entity_unique" UNIQUE("account_id","entity_id"),
	CONSTRAINT "sync_entities_revision_nonnegative" CHECK ("sync_entities"."server_revision" >= 0),
	CONSTRAINT "sync_entities_state_bounded" CHECK (octet_length("sync_entities"."state"::text) <= 4096)
);
--> statement-breakpoint
CREATE TABLE "sync_request_receipts" (
	"account_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"entity_id" varchar(128) NOT NULL,
	"mutation_id" varchar(320) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"server_revision" integer NOT NULL,
	"server_state" jsonb,
	"code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_request_receipts_account_installation_request_unique" UNIQUE("account_id","installation_id","request_id"),
	CONSTRAINT "sync_request_receipts_state_bounded" CHECK ("sync_request_receipts"."server_state" IS NULL OR octet_length("sync_request_receipts"."server_state"::text) <= 4096)
);
--> statement-breakpoint
ALTER TABLE "sync_entities" ADD CONSTRAINT "sync_entities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "sync_request_receipts" ADD CONSTRAINT "sync_request_receipts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
CREATE INDEX "sync_entities_account_updated_index" ON "sync_entities" USING btree ("account_id","updated_at");
--> statement-breakpoint
CREATE INDEX "sync_request_receipts_account_entity_index" ON "sync_request_receipts" USING btree ("account_id","entity_id");
