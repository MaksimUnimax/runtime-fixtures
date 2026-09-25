# C04/C05 ops runtime checkpoint — 2026-09-25

Status: **NOT_ACCEPTED — PENDING IMMUTABLE RELEASE REHEARSAL AND SECOND REVIEW**

Base accepted main:
`a844c1230edbd32a5a9ec4d7773d5eaa806b8991`.

Scope:
- Telegram operator fail-closed runtime config and production unit/install preparation;
- immutable ops release builder/verifier;
- independent PostgreSQL backup runtime, retention verifier, systemd service/timer and installer preflight;
- runtime TypeScript dependency closure for API-watch;
- production operations documentation.

No DB/migration schema, marketplace payload, live service, live database, store, payment or provider mutation is in this checkpoint.

## Independent review findings and corrections

Luna read-only review initially returned `NEEDS_CHANGES`:
- High: retention could count a self-claimed but non-revalidated historical backup;
- Medium: Telegram config accidentally narrowed multi-chat notification semantics;
- Medium: backup service/timer lacked a bounded installer/preflight;
- Medium: Telegram installer did not prove service-user runtime accessibility;
- Low: pgpass setup failure could leave an incomplete directory.

Parent corrections:
- retention requires `pgRestoreListVerified=true`, exact size/hash and a fresh `pg_restore --list` revalidation before a backup counts toward pruning;
- multi-destination Telegram notification semantics are preserved;
- backup installer renders/verifies service+timer, requires independent real mounts, service-user write/traverse/read permissions, minimum free space and missing-host-tool fail-closed;
- Telegram installer rejects home-scoped release roots and performs service-user Node/entry/tsx + empty-environment dependency/access preflight before unit installation;
- pgpass/incomplete cleanup is protected across setup failures.

## Current validation before checkpoint

- backup + ops-release verifier Python tests: 16/16 PASS;
- Telegram operator: 53/53 PASS, typecheck PASS, build PASS;
- API-watch: 166/166 PASS, typecheck PASS, build PASS;
- shell syntax for all three operations scripts: PASS;
- Python compile for backup/release verifier and tests: PASS;
- synthetic systemd rendering for Telegram service + backup service/timer: PASS with no unresolved tokens;
- real-host backup installer missing-`pg_dump/pg_restore` preflight: fail-closed before unit mutation; target units unchanged;
- `git diff --check`: PASS;
- production secrets were not read or copied; no installer enable/start action was executed.

Focused accepted resource job for package tests/builds:
`octoport-test-c-f9ba7b32ea86479981795acfc84aacbb.service`, exit0, peak654 MiB, cleanup verified.

Still required before acceptance:
1. prepare exact immutable ops release from this clean checkpoint;
2. verify self-integrity, production dependency closure and non-root runtime access;
3. rerun bounded read-only review on corrected final diff;
4. create final acceptance receipt and fresh exact-head five-workflow CI.
