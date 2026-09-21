# B1 deployment and rollback checklist

This is a preproduction/production preparation checklist. It does not perform
production mutation.

## Release path

`PRECHECK → BUILD → VERIFY_ARTIFACTS → BACKUP → MIGRATION_CHECK → DEPLOY_API →
DEPLOY_PORTAL → HEALTH → BOOTSTRAP → PACKAGE_COMPATIBILITY → ROLLBACK_DECISION`

Precheck must verify the exact RC manifest, Node 24, environment identity,
separate DB/trust identity, no localhost endpoints, SMTP external status, and
the absence of client/server secret leakage. Backup is identified and hashed
before any deployment. Migrations are forward-compatible; no destructive
downgrade is an automatic rollback step.

Health must include API ready, portal HTTP 200, Bootstrap signature/trust
verification, package contract/version compatibility, and Business Bridge
health. A failed health or trust check stops the release and records revision,
migration level, error class, request ID, timestamp, and rollback result.

## Rollback

1. Freeze the candidate rollout and preserve safe evidence.
2. Restore the exact previous API and portal revisions by immutable identity.
3. Keep the database at its compatible forward schema; use forward-fix or an
   isolated restore procedure, never an automatic destructive down migration.
4. If trust was rotated, keep overlap until all clients are compatible; restore
   a server key only while the client trust set still accepts it.
5. Restore the previous compatible extension package through its supported
   channel; do not promise a forced downgrade of store-installed clients.
6. Re-run health, Bootstrap, logout, and account/device isolation checks.

Owner data, local credentials, and accepted device state must not be deleted by
application rollback.
