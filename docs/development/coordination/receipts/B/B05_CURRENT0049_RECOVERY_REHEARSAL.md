# B05 current0049 recovery rehearsal

Date: 2026-09-25
Role: B
Status: helper implemented; parent supervised disposable PostgreSQL run pending
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

## Evidence state and limits

The helper has not been run by this child. Parent must run the exact supervised
command above and review the emitted evidence before recording rehearsal PASS.
No immutable artifact rollback, live0049, production, Telegram delivery, or
deployment acceptance is claimed. This helper only proves source and restored
state in the disposable B PostgreSQL environment.
