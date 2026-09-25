# B01 prefix22 → current0051 rehearsal — 2026-09-25

Status: **SOURCE + READ-ONLY OWNER-TEST LINEAGE MATCH + DISPOSABLE POSTGRESQL PASS. LIVE MIGRATION NOT AUTHORIZED OR EXECUTED.**

Task: `B01_PREFIX22_TO_CURRENT_REHEARSAL`.

## Why "prefix22" is not migration tag 0022

The observed owner-test database has **22 applied ledger rows**. In the canonical ordered journal those positions are 0..21 and end at:

- tag `0032_s1_signing_reason_contract_guard`
- created_at `1790070000000`

The numbering gap is historical and intentional. The proof compares ordered `(hash, created_at)` tuples, not filename numbers.

## Read-only owner-test lineage result

The existing owner-test PostgreSQL migration ledger was queried read-only for:

`SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at,id`

No application rows, secrets, credentials, session material or marketplace data were read or written.

Result:

- observed rows: **22**
- canonical expected rows: **22**
- tuple comparison: **22/22 MATCH**
- classification: `CANONICAL_PREFIX`
- canonical prefix identity SHA256:
  `ab248aea9c8f708eabff6913c99e6970bba2d79f8911cf9c4c3a58d744a22b2a`
- owner-test ledger identity SHA256:
  `ab248aea9c8f708eabff6913c99e6970bba2d79f8911cf9c4c3a58d744a22b2a`

The complete position/tag/created_at/SQL-SHA256 inventory is recorded in:

`docs/development/coordination/receipts/B/B01_PREFIX22_CANONICAL_IDENTITY_2026-09-25.json`

This refreshes the historical B01 classification against the **current** repository bytes; it does not infer compatibility from an old acceptance statement.

## Disposable prefix22 → current proof

A new regression in:

`packages/server/db/src/canonical-lineage.integration.test.ts`

constructs an isolated migration directory with exactly the first 22 canonical journal entries, applies only that prefix to the B disposable PostgreSQL database, inserts one synthetic user row, and then runs the normal current migration runner.

Current canonical journal:

- entries: **40**
- latest tag: `0051_firefox_privacy_neutral_device_metadata`
- latest created_at: `1790071018000`

The regression proves:

1. the exact 22-entry prefix is accepted by the canonical lineage guard;
2. normal forward migration reaches all **40** current entries through `0051`;
3. the synthetic user row survives the upgrade;
4. post-prefix monitoring schema exists (`swagger_source_requests`);
5. the current Firefox privacy-neutral migration shape is present (`devices.browser_family` nullable).

Existing prefix23, divergent-history, untracked-object/type/function, and historical hybrid fail-closed coverage remains intact.

## Verification

Required environment: Node `24.20.0`, pnpm `10.34.5`.

PASS:

- `@product/db` typecheck
- migration unit tests: **17/17**
- targeted disposable PostgreSQL canonical-lineage suite: **7/7**
  - exact prefix22 → current0051 case PASS
  - existing prefix23 → current case PASS
  - observed historical hybrid remains fail-closed PASS
- resource runner exit 0; cleanup verified; no live DATABASE_URL used

## Safety / limits

- No live migration was run.
- No live schema or migration ledger row was changed.
- No journal rewrite, hash substitution, renumbering, down migration, reset, or force operation was performed.
- The owner-test observation proves **lineage compatibility of its 22 applied tuples with current canonical source**. It does not prove application-data-specific behavior of a real live upgrade.
- The actual forward upgrade proof is synthetic/disposable only.
- Production/owner-test migration still requires the separate deployment authorization/runbook boundary.

The historical non-canonical Stream-2 hybrid remains a different case and must continue to fail closed; this receipt does not reclassify or repair it.
