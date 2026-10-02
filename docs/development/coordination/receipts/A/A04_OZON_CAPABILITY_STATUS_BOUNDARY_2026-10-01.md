# A04 Ozon capability status boundary — fresh-main successor 2026-10-02

Status: **SOURCE + LOCAL_PACKAGE_CONTRACT CANDIDATE / INDEPENDENT REVIEW PENDING**.

Task: `A04-OZON-CAPABILITY-STATUS-BOUNDARY-SUCCESSOR-20261002`.
Role: A.
Fresh base: `509c6680fba3b4fb7a741fbe324630dc9843594f`.

## Result

The preserved fail-closed Ozon capability-status boundary was reconstructed semantically on current main instead of cherry-picking the historical candidate over newer business-gold coverage.

The current canonical matrix is enforced as:

- 45 ordered rows: STD-01..STD-20 then CAP-01..CAP-25;
- 26 exact CLEAN_PASS;
- 16 QUALIFIED_PASS;
- CAP-22 PARTIAL;
- CAP-24 REOPENED;
- CAP-25 IN_PROGRESS;
- guidance-gap rows CAP-16, CAP-18 and CAP-21 remain QUALIFIED_PASS.

The historical terminal set remains STD-01..STD-20 + CAP-01..CAP-24 = 44 IDs. Current status projection over those 44 is 26 clean + 16 qualified + 1 partial + 1 reopened. The gate therefore rejects the false aggregate interpretation “44 terminal = 44 clean PASS”.

## Fresh-main reconstruction

Changed product/evidence paths are limited to:

- `tests/regression/extension-core/ozon-capability-status-boundary.mjs`;
- `tests/regression/extension-core/business-scenario-coverage.mjs` — one functional import into the current business-gold-aware runner;
- `docs/product/readiness/OZON_CAPABILITY_STATUS_BOUNDARY.md`;
- this receipt.

Historical formatting-only changes from the old candidate were not replayed. No extension runtime, server, provider, DB, catalog or live-service path is changed.

## Verification

Direct Node 24.20.0 boundary gate: **PASS**.

Direct Node 24.20.0 current business-scenario coverage: **PASS** with 45 rows and the expected Ozon status taxonomy.

Normal extension-core harness was executed through the role-A supervised build profile with output under the registered task root.

Resource job: `b6d25d353af344dcad83d04960f281ba`.

Observed final harness result:

- stage `D2.4`;
- status `PASS`;
- Node `v24.20.0`;
- source contracts PASS;
- extracted-package contracts PASS;
- 145 gate processes;
- supervisor exit 0;
- peak supervised memory about 146 MiB;
- cleanup verified;
- `live_provider_calls=0`;
- `installed_acceptance=false`.

The harness `middle-failure` line is its expected negative control and the overall supervised run returned PASS.

Formatting checks: all three newly added files pass the existing Prettier binary. `business-scenario-coverage.mjs` retains a pre-existing current-main Prettier deviation in three long statements; the exact same deviation is present in `origin/main`, so this four-path semantic fix does not reformat unrelated business-gold code. `git diff --check` passes.

A direct invocation of `core-contracts.mjs` without its required runtime argument was also attempted once and failed at its command interface before contract execution. It was replaced by the canonical `extension_core.py` harness above; that interface mistake is not counted as product evidence.

## Platform-denied evidence readback

After the PASS, one combined shell request to calculate SHA256 values for summary/resource/source files was explicitly rejected by platform safety before execution. It was not retried through another tool or route.

Therefore this receipt does **not** invent those content hashes. Exact acceptance remains bound to the fresh Git candidate SHA after commit, the resource job ID above, the preserved harness output, and later independent review/publication receipts.

## Evidence boundary

Evidence level is **SOURCE + LOCAL_PACKAGE_CONTRACT**.

No live Ozon account values, provider request, browser authentication, AI useful result, owner semantic verdict, installed acceptance, deployment or production readiness is claimed.

Independent gpt-6-luna exact-candidate review and governed fresh-main publication gates remain required.
