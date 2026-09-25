# B05 current0049 recovery rehearsal

Date: 2026-09-25
Role: B
Status: helper fixed; preliminary dirty-worktree rehearsal PASS; clean exact-source rerun pending
Scope: current canonical schema source0049 plus synthetic no-session Health data

## Rerun command

Run from this worktree through the parent heavy runner, which supplies the only
database connection reference and supervises the process group:

```bash
python3 tooling/coordination/control.py B heavy --db --profile integration --timeout-seconds 3600 -- pnpm exec tsx tooling/server/b05-current0049-recovery.ts
```

The helper accepts only the loopback B disposable database URL for
`octoport_b_test` on port 15542 as supplied by `control.py B heavy --db`.
It uses only the fixed B-owned disposable names
`octoport_b_recovery_source_current0049` and
`octoport_b_recovery_restore_current0049`, replacing those exact names at the
start of a rerun. The source is always dropped after the run. The restore target
is retained only after PASS for C05 and is dropped on failure. PostgreSQL client
commands run inside `octoport-b-test-pg`; no host client installation is
needed.

## Assertions performed by the helper

- Canonical journal file contains exactly 39 entries and ends at
  `0049_s2_l5_no_session_persistence`; migrations are applied to a fresh source
  database through the canonical migration runner. Source and restored applied
  journal rows are hashed in order and must have the same identity.
- A synthetic user, ACTIVE owned account, and portal session are created via
  `AuthService.requestOtp` and `AuthService.verifyOtp` with deterministic
  test-only OTP material. The token stays in process memory and is never
  printed or written to evidence.
- Minimal synthetic adapter/surface/published profile/revision authority is
  seeded, then the existing scheduler materializes and starts one `NO_SESSION`
  run. The existing no-session persistence repository stores its `BROKEN`
  observation and metadata-only evidence before backup, simulating recovery
  after persistence and before incident processing.
- `pg_dump -Fc` creates the archive. A fresh database is restored with
  `pg_restore --exit-on-error --no-owner`; `pg_restore --list` reads the custom
  archive TOC. The archive is mode `0600`; byte count, SHA-256, and TOC entry
  count are reported.
- Restored state is checked for 39 applied migrations through source0049,
  exactly one synthetic user/account/portal session, authentication and
  owned-account access, the no-session row/detail/evidence, and
  `/health/ready` HTTP 200 through the API's inject path.
- The existing scheduler `reconcilePersistedResults` path processes the
  restored persisted result. Exact replay through the existing completion
  adapter plus a second reconciliation must leave `health_runs`,
  `health_no_session_observations`, `health_incidents`, and `LLM_HEALTH`
  notification/outbox counts unchanged at one each.

Each invocation writes a unique archive under
`/root/octoport-control/backups/B/b05-current0049-recovery-*.dump` and a
privacy-safe summary under
`/root/octoport-control/logs/B/b05-current0049-recovery-*.log`, preserving
prior rehearsal artifacts. PASS also writes the private mode-`0600` handoff
reference
`/root/octoport-control/backups/B/b05-current0049-restored-target.json`.
Only that private local file contains the disposable target connection
reference; the Git receipt and normal log do not. Output contains the exact Git
revision/tree, migration identities, synthetic counts, archive metadata and
PASS/FAIL only. It does not contain credentials, OTP material, session tokens or
customer data.

## Preliminary rehearsal evidence — NOT final acceptance

Tested source revision:
`57b231b193bd752d9ea892a0432d6a4152759ff6`.

This run exercised helper bytes that still had an uncommitted follow-up diff, so the recorded HEAD/tree do not identify the exact executed helper. Preserve the run as useful preliminary evidence only; a clean committed exact-source rerun is required before B05 handoff acceptance.

Tested source tree:
`9427633bac4f410102238118497e8a1c63e304e8`.

Supervised command:
`python3 tooling/coordination/control.py B heavy --db --profile integration --timeout-seconds 3600 -- pnpm exec tsx tooling/server/b05-current0049-recovery.ts`.

Result:
- exit code `0`; resource job
  `b415448da80f48f2b1673f76e2fc7c57`;
- unit `octoport-test-b-b415448da80f48f2b1673f76e2fc7c57.service`;
- peak `310378496` bytes (~296 MiB), OOM `0`, cleanup verified;
- journal file SHA-256
  `9aae17cef6769bea4c621ad3b68c8048af3d3387a9b9ffad461442259cffeabc`;
- source and restored applied journals both
  `39 / 0049_s2_l5_no_session_persistence / 1790071016000`;
- ordered applied-journal identity on both sides:
  `563cadf21d89a967c0909ab30765b5811b549c6552831d5aa482edbd9831ada5`;
- restored synthetic application data: users `1`, accounts `1`,
  portal sessions `1`; restored authentication and owned-account read PASS;
- restored API `/health/ready`: HTTP `200`;
- restored no-session state: classification `BROKEN`, metadata evidence `1`,
  scheduler reconciled to `SUCCEEDED`;
- replay/reconciliation final counts stayed exactly
  `runs=1, observations=1, incidents=1, LLM_HEALTH outbox=1`;
- archive:
  `/root/octoport-control/backups/B/b05-current0049-recovery-a9b2621a066f.dump`,
  SHA-256
  `5b07f1ce96c15bd58cf369c52346cec0dbe3fc9954301a1df7503679134ede84`,
  `401087` bytes, mode `0600`, TOC entries `689`;
- retained disposable target:
  `octoport_b_recovery_restore_current0049` in `octoport-b-test-pg`;
- private C05 handoff reference:
  `/root/octoport-control/backups/B/b05-current0049-restored-target.json`,
  confirmed mode `0600`. The DB URL remains only in that private local file.

Resource receipt:
`/root/octoport-control/resource-jobs/b415448da80f48f2b1673f76e2fc7c57/receipt.json`.

## Evidence state and limits

This preliminary run shows the current source0049 recovery procedure can complete successfully on B's disposable PostgreSQL, but it is not the final exact-source acceptance because the helper worktree was dirty during execution.

It does not prove immutable application-artifact rollback, live0049,
production, Telegram delivery, production RPO/RTO, scheduled backup retention,
or deployment acceptance. C owns the immutable artifact/rollback part of C05
and may consume the retained private disposable target above. No live DB,
0050, down migration, real mailbox, customer data or production service was
used or changed.
