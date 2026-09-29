# B Store 0.2.7 config policy scope replacement — 2026-09-29

Status: **SOURCE + DISPOSABLE POSTGRESQL PASS / NO LIVE MUTATION**.

Request:
`C-B-STORE027-CONFIG-POLICY-SCOPE-REPLACE-20260929-0503`.

## Defect

`publishAdminConfigRelease` previously merged compatibility policy links by
revision ID only. If the base config linked Opera rev1 and the admin explicitly
supplied Opera rev2, both IDs were retained. `validateConfigSources` correctly
rejects two policies in the same browser scope, so ordinary-admin publication
could not upgrade a policy revision in-place.

## Correction

Admin publication now treats explicitly supplied policy IDs as replacements for
their compatibility scopes. Existing policies in unrelated browser/global
scopes are preserved; base policies in incoming scopes are removed before the
incoming IDs are linked.
Before replacement, incoming IDs are loaded inside the same transaction and
must all exist, match the requested contract, and have unique scopes. The final
manifest still passes the existing full `validateConfigSources` validation
before insertion.

Unchanged boundaries:

- `expectedLatestConfigVersion` CAS/stale-base behavior;
- transaction-time admin authorization;
- config publication audit;
- signing key identity and lifecycle validation;
- snapshot/envelope/contract identity;
- feature-rule and rollout links copied from the base config;
- `P3_CONFIG_LINK_NO_CHANGE` when the supplied revision is already linked and
  no scope changes;
- generic ordinary-admin repository path only; no STORE-only DB path;
- no schema or migration change.

## PostgreSQL evidence
Focused regression:
`tests/integration/server/p3-admin-config-policy-replacement.integration.test.ts`

It proves:

- Opera rev1 (0.2.6) -> rev2 (0.2.7) replacement;
- unrelated Chrome scope preserved;
- rev1 not retained in the new config;
- contract/snapshot/envelope/signing identity preserved;
- feature-rule and rollout revision identities preserved;
- admin audit emitted transactionally;
- current-revision replay remains `P3_CONFIG_LINK_NO_CHANGE`;
- stale base remains `P3_CONFIG_BASE_STALE`;
- duplicate incoming Opera scopes fail `P3_POLICY_SOURCE_INVALID`;
- mismatched-contract incoming policy fails `P3_POLICY_SOURCE_INVALID`;
- invalid attempts add neither config release nor admin config audit.

Final focused resource job:
`octoport-test-b-d728b53ea24849a0ad1a63f6086092b4.service` —
2/2 PASS, exit 0, peak 382 MiB, cleanup verified.
Additional unchanged-boundary verification:

- P3 publication integration: 4/4 PASS,
  resource job `8894cc741384473ca2dd2cbd6d89e0eb`;
- ordinary-admin P6 `A05*`: 8/8 PASS (112 skipped outside filter),
  resource job `a6a6b36e39f94a64a020031be0b48e07`;
- `@product/db` unit: 32/32 PASS,
  resource job `fb1c8c0ea72b42b4a9f219936d1c5e87`;
- `@product/db` typecheck: exit 0,
  resource job `004930de22a2419395d503f93ec87fba`;
- targeted Prettier, ESLint and `git diff --check`: PASS.

All database tests used B's role-owned disposable PostgreSQL through
`control.py B heavy --db`. No owner-test, monitor-pilot, product database,
provider, service, beta state or catalog was mutated by B.
