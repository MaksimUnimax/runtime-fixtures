CREATE TABLE admin_maintenance_grants (
  id uuid PRIMARY KEY,
  label varchar(64) NOT NULL,
  admin_principal_id uuid NOT NULL REFERENCES admin_principals(id) ON DELETE RESTRICT,
  issuer_revision integer NOT NULL CHECK (issuer_revision > 0),
  source_admin_session_id uuid NOT NULL,
  permissions jsonb NOT NULL CHECK (jsonb_typeof(permissions) = 'array' AND jsonb_array_length(permissions) BETWEEN 1 AND 9),
  token_hash char(64) NOT NULL UNIQUE,
  previous_token_hash char(64),
  rotation_nonce_hash char(64),
  rotation_replay_until timestamptz,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  revoked_at timestamptz,
  CHECK ((previous_token_hash IS NULL AND rotation_nonce_hash IS NULL AND rotation_replay_until IS NULL)
      OR (previous_token_hash IS NOT NULL AND rotation_nonce_hash IS NOT NULL AND rotation_replay_until IS NOT NULL)),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
--> statement-breakpoint
CREATE INDEX admin_maintenance_grants_principal_idx ON admin_maintenance_grants(admin_principal_id);
