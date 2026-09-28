# A — STORE 0.2.6 consumer version-pin reconciliation — 2026-09-28

Status: **A-OWNED CONSUMER PATCH READY / FULL PASS PROVEN WITH C-SHARED DEPENDENCY**

Basis:
`/root/octoport-control/logs/C/A_STORE1_0_2_6_CONSUMER_ACCEPTANCE_REQUEST_2026-09-28.md`.

Exact C release authority:
- source HEAD `028d5dd56341719e2061a47b5e82e216256619f7`;
- source tree `99e12233864a592510032e30bb96668b41682204`;
- version `0.2.6`;
- Chromium/Opera ZIP `579dc15aaf692fc9e96ad650e660ac0190bb7e136c949b7ad401e5bc82a909b5`;
- Firefox ZIP `b5de9b4f0773c08a705fbad050e77d382f265aa34fd2ca8d3657553bad577305`.

## A-owned consumer updates

A changes only:
- `tests/regression/extension-core/store-package-contract.py`;
- `tooling/checks/extension_core.py`.

The store fixture advances exactly:
- synthetic authority `productVersion: 0.2.5 -> 0.2.6`;
- expected Chromium STORE filename `0.2.5 -> 0.2.6`;
- expected Firefox STORE filename `0.2.5 -> 0.2.6`.

Authority schema, PREPRODUCTION requirement, HTTPS origins, trust validation and all negative checks remain unchanged.

`extension_core.py` advances the composed runtime expectation passed into
`extension_import.ozon_route()` from `0.2.5` to `0.2.6`.

No product/runtime source is changed by A.

## Exact-source targeted proof

A created a temporary acceptance copy from frozen C source `028d5dd5...`
and overlaid only the A-owned consumer changes.

The updated `store-package-contract.py` alone PASSed on that exact source:
- STORE HTTPS/v2 config;
- Octoport icons;
- deterministic Chromium ZIP;
- Firefox store derivative;
- HTTP authority rejection;
- PRODUCTION authority rejection;
- duplicate trust-key rejection.

This proves the originally assigned store fixture update is correct for the frozen
0.2.6 source.

## Shared version consumer discovered

The first full `extension_core` run on exact frozen source, with only the assigned
A fixture change, passed:
1. `core-store-package-contract`;
2. `core-build-create-pending-extraction`;

and then failed closed before source runtime tests.

Root cause:
`tooling/checks/extension_import.py::ozon_route()` is outside A ownership and still
allows only versions through `0.2.5`.

It contains seven version-family conditions that must include `0.2.6` with the same
behavior class as `0.2.5` because C's release receipt defines 0.2.6 as a release-identity
bump only.

A did not edit this shared file in the active worktree.

Exact proposed shared patch is persisted as A evidence (not applied to the shared file):
`docs/development/coordination/receipts/A/A_STORE_0_2_6_EXTENSION_IMPORT_SHARED_PROPOSAL.patch`.

SHA-256:
`4e31d247beaf4b98ca8bd27f20147191bdc1f236cdb9a220be71930291913048`.

The patch only adds `0.2.6` to the existing version tuples for:
- accepted version set;
- marketplace host-permission expansion;
- loopback development host-permission expansion;
- expected version-bearing file count;
- policy-whitespace adaptation;
- predispatch structural adaptation;
- full-worker composed application route.

It does not relax any assertion or change a behavior expectation.

## Full diagnostic acceptance

A then applied that exact shared patch only in the temporary frozen-source
acceptance copy, together with the two A-owned consumer changes, and ran the full
`tooling/checks/extension_core.py`.

Result:
- D2.4: PASS;
- gate processes: 131;
- live provider calls: 0;
- installed acceptance: false;
- generated local-development package:
  `SELLER_AGENTS_I1_C1_v0.2.6_LOCAL_DEVELOPMENT.zip`;
- package SHA-256:
  `4a247ff12f5ca1b549a1bd0f5047cc1da726b9b1b4167bfbc34a8cf8247a9d92`;
- repeat archive identity: PASS;
- source/extracted byte identity: PASS.

Summary:
`/tmp/a-store026-full-r2/summary.json`
SHA-256:
`6fcd77471756f6a89c01d4001da276b0102c708752e04574116405d1d3d368c5`.

Resource receipt:
`/root/octoport-control/resource-jobs/442887a035ee465586208e484c6f674b/receipt.json`.

Supervisor exit 0, systemd success, OOM 0, cleanup verified,
peak 183500800 bytes.

## Integration requirement

A's owned consumer changes are ready.

C must apply/reconcile the exact shared `extension_import.py` 0.2.6 version-family
patch before claiming the repository full extension-core gate on the release source.
After that shared change is integrated with C source `028d5dd5...`, rerunning the
same full gate should use repository bytes rather than the temporary acceptance copy.

This receipt does not authorize A to edit the shared file, release source, C metadata,
DB/schema/migrations, deployment, catalog state or store submission.

Evidence level is SOURCE/PACKAGE test infrastructure only. Existing exact 0.2.6
package and Opera installed-synthetic evidence are recorded separately in
`A_STORE_0_2_6_EXACT_PACKAGE_ACCEPTANCE_2026-09-28.md`.
