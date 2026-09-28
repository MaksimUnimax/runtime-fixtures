# A — STORE 0.2.6 C-integrated full acceptance — 2026-09-28

Status: **C INTEGRATION CANDIDATE FULL D2.4 PASS / MAIN PUBLICATION + LIVE STORE GATES OPEN**

Task: continuation of `A_STORE1_0_2_6_CONSUMER_ACCEPTANCE`.

Exact clean C integration candidate tested read-only:
- HEAD: `cb6d0e8e6a7a953e35093d8de0a9a656092b0c5b`;
- tree: `84244178c177f8947bd1515de8b42df80d4ecf5d`;
- branch: `work/c-integration`;
- C worktree was clean before archive;
- A did not modify the C worktree.

This exact C candidate contains:
- STORE release source `0.2.6`;
- A-owned STORE contract expectation `0.2.6`;
- A-owned `extension_core.py` expected version `0.2.6`;
- shared `extension_import.py` version-family support for `0.2.6`;
- C-owned additional version-consumer updates in `extension_i1.py` and
  `client-i1/make-browser-config.mjs`.

## Exact full acceptance

A archived exact clean C commit `cb6d0e8e...` into a temporary read-only acceptance
copy and ran:

`python3 tooling/checks/extension_core.py --output /tmp/a-c-final-026-full-cb6d0e8e`

through the A resource supervisor.

Result:
- stage: `D2.4`;
- status: `PASS`;
- gate processes: `131`;
- Node: `v24.20.0`;
- live provider calls: `0`;
- installed acceptance: `false`;
- composition version: `0.2.6`;
- local-development package:
  `SELLER_AGENTS_I1_C1_v0.2.6_LOCAL_DEVELOPMENT.zip`;
- package SHA-256:
  `4a247ff12f5ca1b549a1bd0f5047cc1da726b9b1b4167bfbc34a8cf8247a9d92`;
- repeat archive identity: PASS;
- source/extracted byte identity: PASS.

Summary evidence:
`/tmp/a-c-final-026-full-cb6d0e8e/summary.json`

SHA-256:
`6fcd77471756f6a89c01d4001da276b0102c708752e04574116405d1d3d368c5`.

Resource receipt:
`/root/octoport-control/resource-jobs/6c5045680e0e495fa4145d10d1956bf4/receipt.json`.

Supervisor:
- exit 0;
- systemd success;
- OOM 0;
- cleanup verified;
- peak 177209344 bytes.

The runner negative control still intentionally reports its internal
`middle-failure`; the overall D2.4 result is PASS and the later gates executed.

## Evidence boundary

This closes the repository-byte full extension-core gate for the exact clean C
integration candidate `cb6d0e8e...`.

It does not claim:
- publication of that C candidate to `main`;
- Opera Add-ons catalog installation;
- reviewer authentication or LIVE_OWNER flow;
- live Ozon/WB provider acceptance;
- same-item signed store update;
- deployment, upload, Submit, approval or publication.

Exact STORE 0.2.6 package identities and real Opera development-flag signed-out UI
evidence remain recorded in:
`A_STORE_0_2_6_EXACT_PACKAGE_ACCEPTANCE_2026-09-28.md`.

A should consume the eventual accepted `main` normally after C publishes it.
No repeat full D2.4 is needed merely because the exact already-tested
`cb6d0e8e...` commit becomes an ancestor of main without changed extension bytes.
