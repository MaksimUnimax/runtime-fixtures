-- Correct the revocation CHECK without rewriting the published 0062 lineage.
-- Validate all retained rows; inconsistent data must fail migration, never be
-- silently revoked, deleted, or converted to active credentials.
ALTER TABLE account_connection_credentials
  DROP CONSTRAINT account_connection_credentials_revocation_shape,
  ADD CONSTRAINT account_connection_credentials_revocation_shape CHECK(
    (revoked_at IS NULL AND revocation_reason IS NULL) OR
    (revoked_at IS NOT NULL AND revoked_at >= created_at AND revocation_reason IS NOT NULL)
  );
