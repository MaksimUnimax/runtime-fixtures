# B retention recurring compatibility — durable evidence — 2026-09-29

Status: **SOURCE + DISPOSABLE POSTGRESQL EVIDENCE; NOT LIVE / NOT DEPLOYED**.

Controller follow-up: `B-AUDIT-20260929-0233`.

## Exact identities

- Legacy writer source: `c2e715501161d421b1641bb697c7ee7786d84960`.
- Defect/fix source candidate: `2175f5b01ffe7358ebd2a09cea1d978ca6d04a62`.
- Post-main scheduler compatibility parent: `ba8ea2b7fc687daf3e8e95b560ffa0402c14aad3`.
- Main scheduler parent: `af2d2119722a29a33ff25ac9c465d95605a1015d`.
- Migration boundary under proof: exact schema prefix 0052, 41 migrations; no 0053 repair
  admission table and no 0054 API-watch baseline table.

The confirmed defect was cross-version, not a migration failure: migration 0052 backfills
receipts present at migration time, while the deployed c2 writer can continue creating
completed NO_SESSION runs after 0052 without creating
`health_no_session_run_receipts`. The pre-fix maintenance candidate scan only walked existing
receipts, so those post-0052 rows were invisible.

## Durable harness

The previously temporary evidence scripts are preserved at:

- `tooling/server/retention-compat-c2/setup.ts`
- `tooling/server/retention-compat-c2/legacy-writer.ts`
- `tooling/server/retention-compat-c2/maintenance.ts`
- `tooling/server/retention-compat-c2/README.md`

The versioned legacy writer has no private absolute path. It requires
`OCTOPORT_LEGACY_SOURCE_ROOT` and fail-closes unless that worktree's exact HEAD is the pinned
c2 SHA above. Current-side imports are repository-relative. No credential, token, cookie,
mailbox data or marketplace payload is embedded.

## Canonical executed sequence and observed result

1. Build exact disposable 0052 prefix and initialize test-only monitor authority.
2. Run the real c2 writer for sequences 1..5.
   Result: runs=5, observations=5, receipts=0, notifications=0.
3. Read-only inspect.
   Result: projection backlog=5; no mutation.
4. Bounded partial maintenance with backfill/reconcile cap=2.
   Result: projected=2, reconciled=2, pending projection=3; receipts=2,
   missingReceipts=3, recent=2, repeats=2, notifications=0.
5. Continuation.
   Result: projected=3, reconciled=3, pruned=2; receipts=5,
   missingReceipts=0, recent=3, maxRecentPerScope=3, repeats=5;
   compact latest advanced; notifications=0.
6. Run the same c2 writer for sequences 6 and 7 after prune.
   Both writes succeed. After sequence 7: runs=5, observations=5, receipts=5.
7. Inspect then continue maintenance.
   Inspect finds projection=2/missingReceipts=2.
   Continue gives projected=2, reconciled=2, pruned=2; receipts=7,
   missingReceipts=0, recent=3, maxRecentPerScope=3, repeats=7;
   latest advances through sequence 7; notifications=0.
8. Duplicate sequence 6 after prune.
   Rejected as `NO_SESSION_SCHEDULE_NOT_RUNNING`; no new run/notification.
9. Advance maintenance clock by eight days and retire.
   receiptRetired=4; watermarks=4; scheduled rows 7 -> 3; receipts 7 -> 3;
   compact recent=3/repeats=7 retained; notifications=0.
10. Immediate retry.
    All action counters are zero.
11. Duplicate retired sequence 1.
    Rejected as `NO_SESSION_SCHEDULED_RUN_NOT_FOUND`; no new run/notification.

Deadline semantics remained
`COOPERATIVE_BETWEEN_AWAITS`; C must provide the hard supervisor timeout/non-overlap
boundary. This evidence did not invoke a live pilot apply.

## Post-main combined verification

After C's scheduler commit reached main, B merged it with the compatibility fix and verified the
combined tree before submission.

Resource-job receipts under the standard control `resource-jobs/<id>/receipt.json` location:

- `25c5d1a36853440abc83cd2c68380cdb`: retention unit 7/7 PASS, exit 0,
  cleanup verified.
- `1acfc29aeac04ac6870f77b6ba0b0017`: retention upgrade integration,
  command exit 0, OOM 0, cleanup verified.
- `fd50f432e06a4f218458b2b230c7e047`: monitor retention integration
  3/3 PASS, exit 0, cleanup verified.
- `e150174dc1304bc2b54dc2849bd2badb`: @product/db 32/32 PASS plus
  typecheck exit 0, OOM 0, cleanup verified.
- C runner unit: 6/6 PASS.

No live DB/catalog row, provider/browser action, notification delivery or migration was applied.

## B04 queue boundary correction

B04 has two distinct acceptance lanes and must not use OWNER as a blanket technical blocker:

- **Technical authorization / server acceptance:** authorization already exists under the
  recorded owner-test technical authority. Existing B OTP/SMTP/auth/bootstrap/sync/revocation
  source/disposable proof and technical protected-session work may proceed without asking the
  owner to repeat GUI login/OTP permission.
- **Manual LIVE_OWNER evidence:** a future human mailbox/email-code observation and installed
  client acceptance remain separate live evidence gates. They do not invalidate or block
  technical source/disposable acceptance.

A concrete B server defect returned by A/C remains actionable immediately. Manual owner evidence
is requested only for the specific live-human gate, not as a prerequisite for ordinary technical
verification.
