-- Harden the credential-transfer fence function ACL after the canonical
-- migration runner has recorded 0060. PostgreSQL functions default to PUBLIC
-- EXECUTE; runtime admission must never rely on that default.
REVOKE ALL ON FUNCTION octoport_transfer_fence.clear_transaction_authorization() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION octoport_transfer_fence.claim_writer(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION octoport_transfer_fence.authorize_writer(bigint,uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION octoport_transfer_fence.guard_transfer_statement() FROM PUBLIC;
