CREATE TABLE "beta_identity_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "normalized_identity_target" varchar(320) NOT NULL,
  "create_request_id_hash" varchar(128) NOT NULL,
  "create_payload_hash" varchar(128) NOT NULL,
  "created_by_admin_principal_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "consumed_user_id" uuid,
  "revoked_at" timestamp with time zone,
  "revoked_by_admin_principal_id" uuid,
  "revoke_request_id_hash" varchar(128),
  "revoke_payload_hash" varchar(128),
  CONSTRAINT "beta_identity_invitations_create_request_unique" UNIQUE("create_request_id_hash"),
  CONSTRAINT "beta_identity_invitations_revoke_request_unique" UNIQUE("revoke_request_id_hash"),
  CONSTRAINT "beta_identity_invitations_expiry_after_creation" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "beta_identity_invitations_consumed_shape" CHECK (("consumed_at" IS NULL AND "consumed_user_id" IS NULL) OR ("consumed_at" IS NOT NULL AND "consumed_user_id" IS NOT NULL)),
  CONSTRAINT "beta_identity_invitations_revoked_shape" CHECK (("revoked_at" IS NULL AND "revoked_by_admin_principal_id" IS NULL AND "revoke_request_id_hash" IS NULL AND "revoke_payload_hash" IS NULL) OR ("revoked_at" IS NOT NULL AND "revoked_by_admin_principal_id" IS NOT NULL AND "revoke_request_id_hash" IS NOT NULL AND "revoke_payload_hash" IS NOT NULL)),
  CONSTRAINT "beta_identity_invitations_terminal_exclusive" CHECK (NOT ("consumed_at" IS NOT NULL AND "revoked_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "beta_identity_invitations" ADD CONSTRAINT "beta_identity_invitations_created_by_admin_fk" FOREIGN KEY ("created_by_admin_principal_id") REFERENCES "public"."admin_principals"("id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "beta_identity_invitations" ADD CONSTRAINT "beta_identity_invitations_revoked_by_admin_fk" FOREIGN KEY ("revoked_by_admin_principal_id") REFERENCES "public"."admin_principals"("id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "beta_identity_invitations" ADD CONSTRAINT "beta_identity_invitations_consumed_user_fk" FOREIGN KEY ("consumed_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
CREATE INDEX "beta_identity_invitations_target_index" ON "beta_identity_invitations" USING btree ("normalized_identity_target","created_at");
--> statement-breakpoint
CREATE INDEX "beta_identity_invitations_expiry_index" ON "beta_identity_invitations" USING btree ("expires_at");
