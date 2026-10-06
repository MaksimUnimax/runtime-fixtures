# B02 multibrowser artifact persistence — fresh-main R5

Task: `B02-MULTIBROWSER-ARTIFACT-PERSISTENCE-FRESH-MAIN-R5-20261006`

Evidence level at this receipt: **SOURCE / DB_TESTED** only.

## Why R5 exists

R4 candidate `f60d84bb69e8133ff6fdb918226572f9687c6f38` was independently reviewed and preserved the accepted multibrowser release-artifact persistence boundary. Its mandatory Server CI then failed deterministically only in integration tests that still described the pre-0058 repository journal as 46 migrations/current0057. R4 was superseded; its failed candidate/registration is not retried.

R5 starts directly from current main `40c139fcb39733cdae6f4f57cad7239993c5e46f`, preserving the accepted Octoport 0.2.13 identity from C01.

## Exact reconstruction boundary

The R5 reconstruction is fail-closed:

- 17 inherited B02/R4 paths are byte-for-byte the R4 candidate blobs;
- `tooling/b1/release-safety.test.mjs` preserves current-main product version `0.2.13` and changes only the current repository migration expectation `57 -> 58`;
- exactly eight integration-test files change only CI-proven current-journal facts:
  - current count `46 -> 47`;
  - current head `current0057 -> current0058` / `0057_admin_maintenance_access -> 0058_extension_release_browser_artifacts` where the current head is asserted;
  - current latest migration timestamp `1791098438000 -> 1791098439000` where asserted;
- historical migration prefixes, historical fixtures, UUIDs, runtime/repository behavior and unrelated test semantics are unchanged.

Scope validator evidence:

- `/root/octoport-control/logs/A/b02-multibrowser-artifact-persistence-fresh-main-r5-20261006/VALIDATE_R5_R1.log`
- SHA-256 `b6f402da141459a63bbb0135cf71b86771d235691b9dad0c7d9e881b27b98b51`
- result before this receipt: `PASS changed_paths=26 inherited_exact=17 edited_allowlisted=9`.

## Release-safety focused check

Node `v24.20.0`:

- `tooling/b1/release-safety.test.mjs`: **42/42 PASS**.
- Evidence:
  `/root/octoport-control/logs/A/b02-multibrowser-artifact-persistence-fresh-main-r5-20261006/RELEASE_SAFETY_R2.log`
- SHA-256:
  `b733c8915d826bcaa64e289da6582d19b4ab620a679654ab2eea113c6896df10`.

An earlier invocation reached the test suite from the wrong Desktop Commander cwd and produced two module-path failures; it is not acceptance evidence. R2 above is the correctly rooted run.

## Disposable PostgreSQL integration check

The only execution that reached the selected Vitest assertions used A's own disposable PostgreSQL via the governed heavy supervisor:

- resource job: `7f1f09aada1d4946ac692ff1b0f1c89a`;
- profile: `integration`;
- memory cap: 2048 MiB;
- peak: 449,839,104 bytes;
- OOM kills: 0;
- command/systemd exit: 0;
- cleanup verified: true.

Exact result:

- **8/8 test files PASS**
- **208/208 tests PASS**

Files:

1. `tests/integration/server/p2-auth.integration.test.ts`
2. `tests/integration/server/p5-7-p5-final-acceptance.integration.test.ts`
3. `tests/integration/server/p6-1-admin-security.integration.test.ts`
4. `packages/server/db/src/adapter-registry.integration.test.ts`
5. `packages/server/db/src/api-watch-document-scope-migration.integration.test.ts`
6. `packages/server/db/src/canonical-lineage.integration.test.ts`
7. `packages/server/db/src/health-retention-upgrade.integration.test.ts`
8. `packages/server/db/src/postgres.integration.test.ts`

Evidence:

- log:
  `/root/octoport-control/logs/A/b02-multibrowser-artifact-persistence-fresh-main-r5-20261006/INTEGRATION_8_R3.log`
- log SHA-256:
  `b473621a535a17fb566f77b36954d84386e20837657a187b0fce2539c7fd70a5`
- resource receipt:
  `/root/octoport-control/resource-jobs/7f1f09aada1d4946ac692ff1b0f1c89a/receipt.json`
- resource receipt SHA-256:
  `73ff007cd0fc1ec2e34c4fa6cd57109fc69605822c3355350b3674cbeb941aa8`.

Two prior command attempts are preserved but are not product runs:

- R1 was rejected by `ROLE_LOCATION_MISMATCH` before a resource job/test;
- R2 entered a supervised cgroup but failed on a malformed shell string before Vitest started; cleanup was verified.

The successful R3 run above is therefore the first and only R5 execution of the eight product test files.

## Dependency boundary

No dependency installation or network fetch was performed.

The R5 `pnpm-lock.yaml` SHA-256 equals the existing canonical dependency lock:

`e0be2cd7574eaa5eddd8e7450260f949406498e05b92bfc9f8a181d48682040a`.

A task-local dependency view reuses the already installed canonical `.pnpm` bytes while relative workspace links resolve to R5 source. This view is ignored build/test infrastructure and is not product source.

## Still required

This receipt does **not** accept or publish R5 by itself. Before DONE:

1. formatting and final diff/scope checks must pass with this receipt included;
2. the exact candidate must be committed cleanly as a single-parent successor of fresh main;
3. one fresh independent `gpt-6-luna` read-only review must PASS;
4. origin/main and every task path must be rechecked for drift;
5. publication must use a new governed task-publication registration/task-ref;
6. all five mandatory CI workflows must be exact-candidate SUCCESS;
7. ready-main, non-force main publication/readback, task-ref cleanup, registration close, disk cleanup and strict queue completion must all succeed.

## Non-claims

No package was rebuilt. No browser, provider, marketplace, ordinary-auth or owner session action occurred. No live catalog/config/DB mutation, deployment, production, PACKAGE, INSTALLED_SYNTHETIC or LIVE_OWNER claim follows from this receipt.
