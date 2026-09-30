# B — STORE 0.2.10 integration fixture rework

Task: `B_STORE0210_INTEGRATION_FIXTURE_REWORK`.

Base B HEAD: `a227b04544d731c0b2a076f7127bbde2ffbdd767`.

## Trigger

Exact C integration candidate `dc9adfbdb7f3d517d12376b2a7181b15dd4f83f1`
failed GitHub server job `109895599962` in
`tests/integration/server/store1-opera-admin-activation.integration.test.ts`.

The file had 6 cases; 5 failed before their intended assertions because the
positive package fixture still modeled the superseded STORE 0.2.9 layout:
`service_worker.js` contained only packaged config and
`shared/bootstrap_verifier.js` carried the verifier separately.
The 0.2.10 B preflight correctly rejects that shape with
`STORE1_PACKAGE_REDUNDANT_VERIFIER_ENTRY`.

## Change

Only the positive integration fixture changed:
- embed the exact trusted `VERIFIER_SOURCE` once in `service_worker.js`;
- append the packaged STORE config after the verifier source;
- omit the standalone `shared/bootstrap_verifier.js` entry.

The product preflight is unchanged. The focused unit negative case that
requires redundant standalone verifier rejection is unchanged.

No DB/schema/migration/live/catalog/provider/store-dashboard mutation.

## Verification

Environment:
- Node `v24.20.0`;
- pnpm `10.34.5`.

Checks:
- `git diff --check`: PASS.
- Prettier focused check: PASS.
- ESLint focused check: PASS.
- B heavy focused Vitest:
  `tooling/server/store1-v2-signature-preflight.test.ts` +
  `tooling/server/store1-opera-admin-activation.test.ts`: 48/48 PASS.
- B heavy --db integration:
  `tests/integration/server/store1-opera-admin-activation.integration.test.ts`:
  command exit 0 for all 6 cases.
  Resource receipt:
  `/root/octoport-control/resource-jobs/a4b2061927bd4b21a66f5ae94b49fc84/receipt.json`.
  Peak memory 540,016,640 bytes, OOM 0, cleanup verified.

The GitHub failure is therefore reproduced as a stale positive fixture and
closed locally without weakening the 0.2.10 verifier/package invariant.
