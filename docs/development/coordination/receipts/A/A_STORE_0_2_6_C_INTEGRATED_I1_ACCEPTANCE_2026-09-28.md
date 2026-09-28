# A — STORE 0.2.6 C-integrated I1 acceptance — 2026-09-28

Status: **EXACT C CANDIDATE I1 SOURCE+PACKAGE PASS / INSTALLED+LIVE STORE GATES OPEN**

Task: continuation of `A_STORE1_0_2_6_CONSUMER_ACCEPTANCE`.

Exact clean C integration candidate:
- HEAD `cb6d0e8e6a7a953e35093d8de0a9a656092b0c5b`;
- tree `84244178c177f8947bd1515de8b42df80d4ecf5d`.

Reason for this run:
C additionally changed the version consumers in:
- `tooling/checks/extension_i1.py`;
- `tests/regression/extension-core/client-i1/make-browser-config.mjs`.

Those bytes were not covered by the preceding full `extension_core` acceptance, so a
fresh I1 run had a new technical cause and is not a redundant repeat.

## Execution identity

A used a separate local shared clone with its own Git metadata, checked out detached at
the exact C commit. The C worktree itself was not modified.

Pinned execution tools:
- Node `v24.20.0`;
- pnpm `10.34.5`.

The first archive-only attempt stopped at the first browser-proof because
`browser_verifier.py` requires `git rev-parse HEAD`. That was an evidence-environment
limitation, not a product failure. It was not accepted.

The repeated run used the exact same tracked commit bytes with real local Git metadata.

## Full I1 result

Command scope:
`tooling/checks/extension_i1.py` on exact `cb6d0e8e...`.

Result:
- stage `I1-C1`;
- status `PASS`;
- gate processes `160`;
- composition version `0.2.6`;
- installed acceptance `false`;
- local-development package:
  `SELLER_AGENTS_I1_C1_v0.2.6_LOCAL_DEVELOPMENT.zip`;
- package SHA-256:
  `4a247ff12f5ca1b549a1bd0f5047cc1da726b9b1b4167bfbc34a8cf8247a9d92`;
- repeat archive identity PASS;
- source/extracted byte identity PASS.

The suite includes source and extracted-package browser proof, syntax, browser-family
contract, WB, provider outcome, lifecycle, races, network correctness, offline/online
authority, sync/reconciliation, corrected predispatch/autonomy, signed readback and
bootstrap verifier paths.

## Browser-proof identities

SOURCE browser proof:
- status PASS;
- sourceHead `cb6d0e8e6a7a953e35093d8de0a9a656092b0c5b`;
- browser `151.0.7922.34`;
- runtime SHA-256 `d7211a17715b5ad968e258de648f37ad8790447da15a4b96cd31b61755f1f8b3`;
- tamperRejected `true`;
- result SHA-256
  `97b712c1c7230d9ffed323168b063ef6b326d426946b9eb19e91b6cb922d3dd0`.

PACKAGE browser proof:
- status PASS;
- sourceHead identical;
- browser identical;
- runtime SHA-256 identical;
- tamperRejected `true`;
- result SHA-256
  `2e811d08eb40b6639d208d222626f7ad9cc940646205defef2f35a1fb2cc7427`.

These are deterministic browser proofs inside the I1 test contract, not store-installed
or LIVE_OWNER browser acceptance.

## Evidence and resource receipt

Summary:
`/tmp/a-c-final-026-i1-git-cb6d0e8e/summary.json`

SHA-256:
`7d64ae60b4af0745973ddc51c2c7f37b2bbab2e8eda4165cc334cdaeba4bf358`.

Resource receipt:
`/root/octoport-control/resource-jobs/b7bfc990f4e24043880d161dbe9de06a/receipt.json`.

Supervisor:
- exit 0;
- systemd success;
- OOM 0;
- cleanup verified;
- peak 531628032 bytes.

The runner negative control intentionally contains its internal middle failure; the
overall I1 result is PASS and all later source/package gates executed.

## Evidence boundary and remaining gates

This closes A's automatable I1 source/package acceptance for exact clean C candidate
`cb6d0e8e...`.

It does not claim:
- that `cb6d0e8e...` is published to main;
- browser-store catalog installation;
- LIVE_OWNER/reviewer authentication;
- live marketplace/provider values;
- same-item signed N→N+1 store update;
- Windows owner UX/preservation;
- upload, Submit, approval, publication or production deployment.

Existing real Opera exact-STORE signed-out installed-synthetic evidence remains separate.
After C publishes an unchanged descendant containing this exact extension tree, no
repeat of the same I1 suite is needed solely for the publication event.
