# c2 writer -> schema 0052 retention compatibility harness

This bounded evidence harness preserves the exact cross-version scenario that exposed the
post-0052 missing-receipt defect. It is test tooling only. It must never target a live service
database.

Legacy writer source is pinned to:

`c2e715501161d421b1641bb697c7ee7786d84960`

`legacy-writer.ts` refuses to run unless `OCTOPORT_LEGACY_SOURCE_ROOT` points to a Git
worktree whose exact HEAD equals that SHA.

## Preconditions

Use Node 24.20.0 / pnpm 10.34.5 and B's disposable PostgreSQL only.

Create a detached legacy source worktree outside this repository:

```bash
LEGACY_SHA=c2e715501161d421b1641bb697c7ee7786d84960
LEGACY_ROOT="$(mktemp -d)/legacy-c2"
git worktree add --detach "$LEGACY_ROOT" "$LEGACY_SHA"
python3 tooling/coordination/control.py B ensure-db
```

Every database-touching command below must run through
`python3 tooling/coordination/control.py B heavy --db -- ...`.

`setup.ts` also enforces this boundary in executable code before creating a
database runtime or issuing `DROP SCHEMA`. It accepts only B's role-owned
disposable identity: loopback host, port `15542`, role `octoport_test`,
database `octoport_b_test`, with no URL query/fragment. Monitor-pilot,
product-shaped, non-loopback, wrong-role, wrong-port and otherwise unmarked
URLs fail closed.

## Reproduction sequence

Run `setup.ts` once. It recreates the disposable database at the exact 0052 prefix
(41 migrations), initializes test-only pilot authority and proves 0053/0054 are absent.

Run the exact legacy writer for sequences 1 through 5:

```bash
pnpm exec tsx tooling/server/retention-compat-c2/legacy-writer.ts write 1
pnpm exec tsx tooling/server/retention-compat-c2/legacy-writer.ts write 2
pnpm exec tsx tooling/server/retention-compat-c2/legacy-writer.ts write 3
pnpm exec tsx tooling/server/retention-compat-c2/legacy-writer.ts write 4
pnpm exec tsx tooling/server/retention-compat-c2/legacy-writer.ts write 5
```

The environment for each legacy writer command must include
`OCTOPORT_LEGACY_SOURCE_ROOT="$LEGACY_ROOT"`.

Then execute maintenance phases in this order:

1. `maintenance.ts inspect`
2. `maintenance.ts partial`
3. `maintenance.ts continue`
4. legacy writer `write 6`
5. legacy writer `write 7`
6. `maintenance.ts inspect`
7. `maintenance.ts continue`
8. legacy writer `duplicate 6`
9. `maintenance.ts retire`
10. `maintenance.ts retry`
11. legacy writer `duplicate 1`

## Required invariants

- Initial five legacy writes create five runs/observations and zero retention receipts.
- Inspect sees five pending projections without mutating state.
- Partial maintenance materializes/projects two receipts and leaves three pending.
- Continuation reaches zero missing receipts, max three recent states per scope and no
  notifications.
- Legacy writes 6 and 7 still succeed after pruning; next maintenance discovers both missing
  receipts and advances the compact latest state.
- Duplicate callback after prune is rejected without a new run or notification.
- At +8 days, old receipts/scheduled rows retire only through retention watermarks.
- Immediate maintenance retry is a no-op.
- Duplicate callback after retirement is rejected and cannot resurrect a run or emit a
  notification.
- Tables introduced by 0053 and 0054 remain absent for the compatibility proof.

The canonical observed results and exact source/test SHAs are recorded in
`docs/development/coordination/receipts/B/B_RETENTION_RECURRING_COMPAT_DURABLE_EVIDENCE_2026-09-29.md`.
