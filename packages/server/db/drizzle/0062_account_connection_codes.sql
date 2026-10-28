-- Additive enrollment: legacy portal approvals and existing device/session IDs survive.
-- No plaintext connection code is persisted; only a purpose-separated verifier.
CREATE TABLE account_connection_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  issued_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  verifier_hash varchar(128) NOT NULL,
  generation integer NOT NULL,
  issue_operation_hash varchar(128) NOT NULL,
  issue_request_fingerprint varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revocation_reason varchar(32),
  CONSTRAINT account_connection_credentials_verifier_unique UNIQUE(verifier_hash),
  CONSTRAINT account_connection_credentials_account_generation_unique UNIQUE(account_id,generation),
  CONSTRAINT account_connection_credentials_account_operation_unique UNIQUE(account_id,issue_operation_hash),
  CONSTRAINT account_connection_credentials_id_account_unique UNIQUE(id,account_id),
  CONSTRAINT account_connection_credentials_generation_positive CHECK(generation > 0),
  CONSTRAINT account_connection_credentials_revocation_shape CHECK(
    (revoked_at IS NULL AND revocation_reason IS NULL) OR
    (revoked_at >= created_at AND revocation_reason IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX account_connection_credentials_one_active
  ON account_connection_credentials(account_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
ALTER TABLE devices
  ADD COLUMN connection_credential_id uuid,
  ADD COLUMN credential_transfer_approved_at timestamptz,
  ADD COLUMN credential_transfer_approved_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT devices_connection_credential_account_fk
    FOREIGN KEY(connection_credential_id,account_id)
    REFERENCES account_connection_credentials(id,account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT devices_credential_transfer_approval_shape CHECK(
    (credential_transfer_approved_at IS NULL AND credential_transfer_approved_by_user_id IS NULL) OR
    (credential_transfer_approved_at IS NOT NULL AND credential_transfer_approved_by_user_id IS NOT NULL)
  );
--> statement-breakpoint
CREATE INDEX devices_connection_credential_index ON devices(connection_credential_id);
--> statement-breakpoint
CREATE TABLE connection_exchange_receipts (
  credential_id uuid NOT NULL REFERENCES account_connection_credentials(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  operation_hash varchar(128) NOT NULL,
  request_fingerprint varchar(128) NOT NULL,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  replay_until timestamptz NOT NULL,
  CONSTRAINT connection_exchange_receipts_pkey PRIMARY KEY(credential_id,operation_hash),
  CONSTRAINT connection_exchange_receipts_device_unique UNIQUE(device_id),
  CONSTRAINT connection_exchange_receipts_session_unique UNIQUE(session_id),
  CONSTRAINT connection_exchange_receipts_replay_after_creation CHECK(replay_until > created_at)
);
--> statement-breakpoint
CREATE INDEX connection_exchange_receipts_replay_until_index
  ON connection_exchange_receipts(replay_until);
--> statement-breakpoint
-- Enforce recipient approval for code-enrolled devices even if an older API
-- binary is rolled back. Legacy devices retain their existing approval policy.
CREATE FUNCTION public.octoport_guard_connection_transfer_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.id=NEW.recipient_device_id AND d.account_id=NEW.account_id
      AND d.connection_credential_id IS NOT NULL
      AND d.credential_transfer_approved_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='CONNECTION_TRANSFER_APPROVAL_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER connection_transfer_approval_guard
BEFORE INSERT OR UPDATE ON credential_transfer_requests
FOR EACH ROW EXECUTE FUNCTION public.octoport_guard_connection_transfer_approval();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.octoport_guard_connection_transfer_approval() FROM PUBLIC;
