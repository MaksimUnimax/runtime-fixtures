# C02 A03 RESOLVED-v2 parity intake — 2026-09-25

Status: CANDIDATE / NOT MAIN / NOT DEPLOYED

Base main:
`e7d66152bdb77918b65115486c9829ef7a634e69`.

Exact A submission:
`635ca1935cb14ae1a09666662b68aad3c0d86621`.

C merge:
`b09102114743cd52b792a6fbf28a3f1b6931b4c1`.

## Scope verification

The merge changes exactly four A-owned test/evidence files:
- `docs/development/coordination/receipts/A/A03_RESOLVED_V2_REAL_BROWSER_PARITY_2026-09-25.md`;
- `tests/regression/extension-core/client-i1/api-harness.ts`;
- `tests/regression/extension-core/client-i1/browser-resolved-v2-parity.py`;
- `tests/regression/extension-core/client-i1/make-browser-config.mjs`.

All four merged blobs are byte-identical to the exact submitted A candidate. No product runtime, DB, migration, shared wire, store package, live service or credential path changed.

## Accepted A evidence

A receipt records:
- Opera 136 real browser + disposable API signed RESOLVED control_plane_v2 PASS, accepted R8 result SHA256 `4a86921003717786fecb87db62d53577de7d94bcf690ccf1f58701179c28e25e`;
- Firefox 155.0.1 real permission Deny/Allow/Revoke + disposable API RESOLVED-v2 PASS, accepted R10 result SHA256 `edb20285512afbe0cb8e4d4298ecfe89f426ae77b630170f74c522bcdc1e1c52`;
- five denied Health acquisitions after revoke caused zero additional metadata-forget requests;
- preservation manifest `b05c98037013d8dd12b1b0c4bd38281aaff0c7e51643ab13180ff9b8ad34f1b1` covers controller P1/P2, autonomous Work, C3D 18/18, C3E 6/6;
- no live provider calls or owner credentials.

Evidence class remains REAL_BROWSER + DISPOSABLE_API, not LIVE_OWNER or DEPLOYMENT.

## C verification

- exact candidate scope/diff reviewed;
- merge conflict scan clean;
- merged blobs equal submitted blobs;
- `git diff --check`: PASS;
- Python parity harness `py_compile`: PASS;
- `make-browser-config.mjs` Node syntax: PASS;
- Prettier on MD/TS/MJS: PASS.

Generic standalone ESLint is not an acceptance gate for these harness files: the baseline already reports Node-global/no-unused placeholder errors in the same files. C did not alter the accepted A blobs merely to change lint context. The exact merged tree must pass the repository's five required branch workflows before any main publication.

No live mutation, deployment, store submission or catalog mutation is represented by this receipt.

## Remaining browser-delta intake

Second exact A submission:
`44ee420662dd7fe035247ee3d7e274c96e72fcbd`.

C merge:
`a79ada0d1892b23e572e7ffe807365b78a04d129`.

The actual new tree delta over the prior C candidate is exactly:
- `docs/development/coordination/receipts/A/A03_REMAINING_BROWSER_DELTA_2026-09-25.md`;
- `tests/regression/extension-core/client-i1/api-harness.ts`;
- `tests/regression/extension-core/client-i1/browser-resolved-v2-parity.py`.

All three merged blobs are byte-identical to the submitted A candidate. Product runtime remains the accepted `e7d66152...` repair.

Accepted A evidence:
- Yandex Browser Beta `26.8.1.1101-1`, runtime family `yandex_chromium`: REAL_BROWSER + DISPOSABLE_API RESOLVED-v2 PASS, result SHA256 `7d7b6dafaecbc1988628361c68763ab1c98ca68bf5bd6f0ce6d6ad1bd413eff4`, `canWork=true`, live provider calls 0;
- branded Google Chrome `147.0.7727.116`: `PASS_ENVIRONMENT_GATE`, not product PASS and not product FAIL. The supported automated unpacked flag is rejected by branded Chrome and no Seller Agents target was installed, so Chromium/Opera evidence is not relabeled as Chrome.

C focused verification:
- merged blob identity: PASS;
- `git diff --check`: PASS;
- Python parity harness `py_compile`: PASS;
- Prettier on changed receipt/TS harness: PASS.

The remaining branded-Chrome installed/store route stays an external release-specific gate. No browser policy, native picker, owner session, marketplace credential, live API, deployment or store action was bypassed or used.
