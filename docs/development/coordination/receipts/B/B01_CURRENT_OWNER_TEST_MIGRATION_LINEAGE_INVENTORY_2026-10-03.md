# B01 current owner-test migration lineage inventory — 2026-10-03

Status: **READ_ONLY_LIVE_MIGRATION_LEDGER / CANONICAL_PREFIX / NO LIVE MIGRATION**

Task: `B01-CURRENT-OWNER-TEST-MIGRATION-LINEAGE-INVENTORY-20261003`.

## Purpose

Refresh B01 against the current owner-test PostgreSQL migration ledger without
running migrations or reading application/business rows. The comparison is bound
to fresh `origin/main` `5344ac35a3915f4fe7be7568452fc00c63bba1ee`.

## Read-only live observation

The running owner-test API uses the protected systemd EnvironmentFile
`/etc/seller-agents-owner-test/api.env`. Its `DATABASE_URL` was passed only
through the child process environment and was never printed, persisted in this
receipt, or placed on the command line.

A single database connection executed:

1. `BEGIN`;
2. `SET TRANSACTION READ ONLY`;
3. `SHOW transaction_read_only`;
4. `SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at,id`;
5. `SELECT count(*)::text,max(created_at)::text FROM drizzle.__drizzle_migrations`;
6. transaction completion.
`transaction_read_only=on` was verified before reading the ledger. No application
tables, account/user/session rows, marketplace data, credentials, or other
business data were read.

Result:

- observed applied migration rows: **40**;
- independently reported count: **40**;
- latest applied timestamp: `1790071018000`;
- current canonical journal rows: **45**;
- current canonical latest tag: `0056_beta_targeted_identity_invitations`;
- ordered tuple classification: **CANONICAL_PREFIX**;
- first divergence: **none**;
- owner-test ordered `(hash,created_at)` identity SHA256:
  `94cea1875daee66fcdfeba877a28896165b4a4f9f98a1d656ebe2f92d09de1b0`.

The full technical ledger comparison is stored in the protected evidence file:

`/root/octoport-control/logs/B/b01-current-owner-test-migration-lineage-inventory-20261003/LIVE_LEDGER.json`

## Pending canonical suffix

Exactly five canonical migrations are not yet applied to this owner-test
database:

1. position 40 — `0052_monitoring_bounded_retention` — `1790071019000`;
2. position 41 — `0053_monitor_profile_repair_admission` — `1790071020000`;
3. position 42 — `0054_api_watch_product_baselines` — `1790622000000`;
4. position 43 — `0055_api_watch_document_scope_persistence` — `1790674500000`;
5. position 44 — `0056_beta_targeted_identity_invitations` — `1790882827000`.

The local migration directory and `migrations.ts` are byte-identical between the
B checkout and `origin/main`, so the comparison uses the exact current canonical
migration bytes.

## Interpretation

The owner-test database is **not divergent**. Its 40 applied tuples are an exact
ordered prefix of the current 45-entry canonical journal. This refreshes the
lineage fact previously proven at smaller prefixes.

This result does **not** authorize or prove a live forward upgrade. Applying the
five pending migrations remains a separate deployment/recovery operation that
must preserve the current backup/restore and application compatibility gates.

## Safety / non-claims

- No migration runner executed.
- No live schema or migration journal row was changed.
- No service was restarted.
- No journal hash/timestamp was edited or normalized.
- No application/business row was read.
- No DEPLOYMENT, LIVE_OWNER, PRODUCTION, or application-data upgrade acceptance
  is claimed.
